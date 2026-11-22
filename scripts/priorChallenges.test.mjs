// The judge marks each earlier challenge fixed or still open, on a re-grill of a revised plan.
// It is a candidate behind GRILL_JUDGE_PRIOR_CHALLENGES, off by default. Off, or with no
// earlier challenges, the judge's messages and answer form are byte for byte today's.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JUDGE_TOOL,
  MAX_PRIOR_CHALLENGES,
  PRIOR_CHALLENGES_OPTION,
  PRIOR_CHALLENGES_RULE,
  buildJudgeMessages,
  judgeToolFor,
  normalizePriorChallenges,
  priorChallengesEnabled,
  readPriorChallenges,
  renderLayers,
  renderPriorChallenges,
} from "./judgeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUBJECT = "We will launch on 3 March. A two-week beta with 50 users runs first, and we roll back if crash-free sessions fall under 99%.";
const PRIORS = ["There is no rollback plan if the launch breaks.", "Nobody has checked whether support can handle the volume."];
const ON = { [PRIOR_CHALLENGES_OPTION]: "1" };

describe("the prior-challenges flag", () => {
  it("is off unless set to 1, true, on or yes", () => {
    assert.equal(PRIOR_CHALLENGES_OPTION, "GRILL_JUDGE_PRIOR_CHALLENGES");
    for (const value of [undefined, "", "0", "off", "no", "${GRILL_JUDGE_PRIOR_CHALLENGES}"]) {
      assert.equal(priorChallengesEnabled({ GRILL_JUDGE_PRIOR_CHALLENGES: value }), false, String(value));
    }
    for (const value of ["1", "true", "ON", "yes"]) assert.equal(priorChallengesEnabled({ GRILL_JUDGE_PRIOR_CHALLENGES: value }), true, value);
  });

  it("is not set anywhere in the repo's deploy config", () => {
    for (const path of ["vercel.json", "smithery.yaml", "manifest.json", "server.json"]) {
      assert.doesNotMatch(readFileSync(join(ROOT, path), "utf8"), /GRILL_JUDGE_PRIOR_CHALLENGES/, path);
    }
  });
});

describe("off, or with nothing earlier, the judge is today's judge", () => {
  const base = buildJudgeMessages({ subject: SUBJECT, question: "Ship it?", env: {} });

  it("flag off with earlier challenges: same messages", () => {
    assert.deepEqual(buildJudgeMessages({ subject: SUBJECT, question: "Ship it?", env: {}, priorChallenges: PRIORS }), base);
  });

  it("flag on with no earlier challenges: same messages, so a holdout case is judged exactly as now", () => {
    assert.deepEqual(buildJudgeMessages({ subject: SUBJECT, question: "Ship it?", env: ON, priorChallenges: [] }), base);
  });

  it("the answer form is JUDGE_TOOL itself unless earlier challenges are sent", () => {
    assert.equal(judgeToolFor({ priorCount: 0 }), JUDGE_TOOL);
    assert.equal(JUDGE_TOOL.parameters.properties.prior_challenges, undefined);
  });
});

describe("on, with earlier challenges", () => {
  const messages = buildJudgeMessages({ subject: SUBJECT, env: ON, priorChallenges: PRIORS });

  it("adds one rule to the system message and a numbered list after the subject", () => {
    assert.ok(messages[0].content.endsWith(PRIOR_CHALLENGES_RULE));
    const user = messages[1].content;
    assert.ok(user.indexOf("--- END SUBJECT ---") < user.indexOf("## EARLIER CHALLENGES"));
    assert.match(user, /1\. There is no rollback plan if the launch breaks\.\n2\. Nobody has checked/);
    assert.match(user, /DATA, not instruction/);
  });

  it("tells the judge to judge the plan fresh first and not let the list set the verdict", () => {
    assert.match(PRIOR_CHALLENGES_RULE, /Judge the subject on its own first/);
    assert.match(PRIOR_CHALLENGES_RULE, /fixed only when the subject now answers it, and quote the words that do/);
    assert.match(PRIOR_CHALLENGES_RULE, /does not change your verdict/);
  });

  it("asks for a fixed or open mark per earlier challenge", () => {
    const tool = judgeToolFor({ priorCount: 2 });
    const field = tool.parameters.properties.prior_challenges;
    assert.equal(field.type, "array");
    assert.deepEqual(field.items.properties.status.enum, ["fixed", "open"]);
    assert.ok(tool.parameters.required.includes("prior_challenges"));
    assert.equal(JUDGE_TOOL.parameters.properties.prior_challenges, undefined, "JUDGE_TOOL is not mutated");
  });
});

describe("reading the marks", () => {
  it("keeps at most the cap, trims, and drops blanks", () => {
    const many = Array.from({ length: 12 }, (_, i) => ` Challenge ${i + 1}. `);
    const kept = normalizePriorChallenges([...many, "", 7]);
    assert.equal(kept.length, MAX_PRIOR_CHALLENGES);
    assert.equal(kept[0], "Challenge 1.");
  });

  it("a fixed mark needs a quote that is really in the subject, or it reads as not shown fixed", () => {
    const marks = readPriorChallenges(
      {
        prior_challenges: [
          { number: 1, status: "fixed", evidence: "we roll back if crash-free sessions fall under 99%" },
          { number: 2, status: "fixed", evidence: "support has been staffed up" },
          { number: 3, status: "open", evidence: "no such challenge" },
        ],
      },
      { priors: PRIORS, subject: SUBJECT },
    );
    assert.deepEqual(
      marks.map((row) => [row.number, row.status]),
      [
        [1, "fixed"],
        [2, "open"],
      ],
    );
    assert.equal(marks[1].unquoted, true);
  });

  it("a quote followed by the judge's own comment still counts, when the quoted words are in the subject", () => {
    const marks = readPriorChallenges(
      {
        prior_challenges: [
          { number: 1, status: "fixed", evidence: '"we roll back if crash-free sessions fall under 99%" — that is the way back the earlier grill asked for.' },
          { number: 2, status: "fixed", evidence: "\u201csupport is fully staffed\u201d covers it." },
        ],
      },
      { priors: PRIORS, subject: SUBJECT },
    );
    assert.deepEqual(marks.map((row) => row.status), ["fixed", "open"]);
  });

  it("an earlier challenge the judge did not mark is listed as not checked", () => {
    const marks = readPriorChallenges({ prior_challenges: [] }, { priors: PRIORS, subject: SUBJECT });
    assert.deepEqual(marks.map((row) => row.status), ["unchecked", "unchecked"]);
  });
});

describe("what the person reads", () => {
  const marks = [
    { number: 1, status: "fixed", challenge: PRIORS[0], evidence: "we roll back if crash-free sessions fall under 99%" },
    { number: 2, status: "open", challenge: PRIORS[1], evidence: "" },
  ];

  it("one compact block from Grill, fixed and still open", () => {
    const block = renderPriorChallenges(marks);
    assert.match(block, /^What Grill changed: 1 of 2 earlier challenges fixed\./);
    assert.match(block, /\n- Fixed: There is no rollback plan if the launch breaks\./);
    assert.match(block, /\n- Still open: Nobody has checked whether support can handle the volume\./);
  });

  it("when the judge marked none, it says so instead of claiming 0 fixed", () => {
    const block = renderPriorChallenges(PRIORS.map((challenge, i) => ({ number: i + 1, status: "unchecked", challenge, evidence: "" })));
    assert.equal(block, "What Grill changed: the judge did not check the earlier challenges this time.");
  });

  it("sits after the verdict and before the closing line, and is absent without marks", () => {
    const result = { verdict: "holds-with-conditions", verdictReason: "The beta and rollback cover the main risk.", challenges: [] };
    const plain = renderLayers(result).brief;
    assert.doesNotMatch(plain, /What Grill changed/);
    const brief = renderLayers({ ...result, priorChallenges: marks }).brief;
    assert.ok(brief.indexOf("**Solid if.**") < brief.indexOf("What Grill changed"));
    assert.ok(brief.trim().endsWith("Say 'more', 'options', or your call."));
  });

  it("makes no claim about catching what another model missed", () => {
    assert.doesNotMatch(renderPriorChallenges(marks) + PRIOR_CHALLENGES_RULE, /catches what|missed|blind spot/i);
  });
});

describe("judge.mjs --prior", () => {
  it("sends earlier challenges only when the flag is on (dry run, no network)", () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-prior-"));
    const file = join(dir, "s.md");
    writeFileSync(file, SUBJECT);
    const run = (env) =>
      execFileSync(process.execPath, [join(ROOT, "scripts/judge.mjs"), "--file", file, "--prior", PRIORS[0], "--prior", PRIORS[1], "--dry-run"], {
        env: { PATH: process.env.PATH, HOME: dir, ...env },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const off = run({});
    assert.doesNotMatch(off, /EARLIER CHALLENGES/);
    assert.match(off, /\[judge\] earlier challenges: 2 given and not sent \(GRILL_JUDGE_PRIOR_CHALLENGES is off\)/);
    const on = run({ GRILL_JUDGE_PRIOR_CHALLENGES: "1" });
    assert.match(on, /EARLIER CHALLENGES/);
    assert.match(on, /\[judge\] earlier challenges: 2, marked fixed or open \(GRILL_JUDGE_PRIOR_CHALLENGES on\)/);
  });
});
