// The verdict-quality harness. No router key and no paid call.
// The holdout checksum below is the frozen set. Updating it to make a tuning change pass
// breaks the condition this harness exists for.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HoldoutLocked,
  LABEL_COLUMNS,
  PANEL_MODELS,
  SCREEN_LABEL_COLUMNS,
  answerExcerpt,
  applyReplies,
  blindOutput,
  buildPair,
  buildPanelPrompt,
  caseProblems,
  casesFromJsonl,
  finishLabels,
  holdoutCanonical,
  holdoutChecksum,
  holdoutV1SpentMessage,
  holdoutV2Canonical,
  holdoutV2Checksum,
  labelsFromCsv,
  panelCall,
  panelRequestBody,
  parseCsv,
  parsePanelVote,
  parseReplies,
  purposeFor,
  questionFor,
  rateClears,
  renderHumanSheet,
  renderScore,
  resolvePanel,
  scoreLabels,
  sha256,
  signTestP,
  toCsv,
  verdictText,
} from "./verdictEvalCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES_PATH = join(ROOT, "evals", "verdict-quality", "cases.jsonl");
const CHECKSUM_PATH = join(ROOT, "evals", "verdict-quality", "holdout.sha256");
const V2_CASES_PATH = join(ROOT, "evals", "verdict-quality", "holdout-v2.jsonl");
const V2_CHECKSUM_PATH = join(ROOT, "evals", "verdict-quality", "holdout-v2.sha256");
const FROZEN_HOLDOUT_SHA256 = "aa7b64f4b385211330f4e5403230841c91bdf175dc06cd80575e6fff813945a6";
const FROZEN_HOLDOUT_V2_SHA256 = "4c8013164eb1297ba3f92d169ffbf4ac59ba25119ea98e92756975d0f2761d9f";

const CHARLIE =
  "Will my manager Charlie see this co-developed weekly GTM update skill as best in class? He wants business updates he can lift for investor updates, plus rep reflection and accountability.";
const PLAN =
  "move the run note to the end, fix crux truncation, add a judge rule, build an eval set, add opt-in feedback";

function line(row) {
  return JSON.stringify(row);
}

describe("the holdout guard", () => {
  const text = [
    line({ id: "dev-case", subject: "A dev decision with enough words to be a real case for the guard.", context: "notes", split: "dev" }),
    line({ id: "holdout-case", subject: "SECRET HOLDOUT SUBJECT that tuning must not return to the caller.", context: "hidden", split: "holdout" }),
  ].join("\n");

  it("refuses a tuning request for the holdout before it parses", () => {
    assert.throws(() => purposeFor({ split: "holdout", tune: true }), HoldoutLocked);
    assert.throws(() => casesFromJsonl(text, { purpose: "tune", split: "holdout" }), HoldoutLocked);
    assert.equal(purposeFor({ split: "dev", tune: true }), "tune");
    assert.equal(purposeFor({ split: "dev" }), "tune");
    assert.equal(purposeFor({ split: "holdout" }), "eval");
  });

  it("a tuning read returns dev rows only and does not keep the holdout subject", () => {
    const dev = casesFromJsonl(text, { purpose: "tune", split: "dev" });
    assert.deepEqual(dev.map((row) => row.id), ["dev-case"]);
    assert.equal(JSON.stringify(dev).includes("SECRET HOLDOUT"), false);
    const holdout = casesFromJsonl(text, { purpose: "eval", split: "holdout" });
    assert.equal(holdout[0].subject.includes("SECRET HOLDOUT"), true);
  });

  it("the eval script refuses holdout tuning before it reads the cases file", () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-verdicts.mjs"), "--split", "holdout", "--tune", "--cases", "/nonexistent/verdict-cases.jsonl"],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not read holdout cases/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ENOENT|nonexistent/);
  });
});

describe("the frozen holdout", () => {
  const text = readFileSync(CASES_PATH, "utf8");
  const holdout = casesFromJsonl(text, { purpose: "eval", split: "holdout" });
  const dev = casesFromJsonl(text, { purpose: "tune", split: "dev" });

  it("is 15 cases, checksum-locked, and the two real failures are on it", () => {
    assert.equal(holdout.length, 15);
    assert.ok(dev.length >= 20);
    assert.equal(holdoutChecksum(holdout), FROZEN_HOLDOUT_SHA256);
    assert.equal(readFileSync(CHECKSUM_PATH, "utf8").trim(), FROZEN_HOLDOUT_SHA256);
    assert.equal(sha256(holdoutCanonical(holdout)), FROZEN_HOLDOUT_SHA256);
    const charlie = holdout.find((row) => row.subject.includes(CHARLIE));
    const plan = holdout.find((row) => row.subject.includes(PLAN));
    assert.ok(charlie, "the Charlie case is missing from the holdout");
    assert.ok(plan, "the verdict-tool plan is missing from the holdout");
    assert.equal(charlie.split, "holdout");
    assert.equal(plan.split, "holdout");
    assert.equal(JSON.stringify(dev).includes("best in class"), false);
    assert.equal(JSON.stringify(dev).includes("crux truncation"), false);
    assert.equal(questionFor(charlie), "Will my manager Charlie see this co-developed weekly GTM update skill as best in class?");
  });

  it("changes the checksum when a holdout case changes, and not when a dev case changes", () => {
    const changedHoldout = holdout.map((row) => (row.id === holdout[0].id ? { ...row, subject: `${row.subject} extra` } : row));
    assert.notEqual(holdoutChecksum(changedHoldout), FROZEN_HOLDOUT_SHA256);
    const withDev = [...holdout, { ...dev[0], subject: `${dev[0].subject} extra` }];
    assert.equal(holdoutChecksum(withDev), FROZEN_HOLDOUT_SHA256);
  });

  it("every committed case is well formed and the readme states the rules", () => {
    for (const row of [...holdout, ...dev]) assert.deepEqual(caseProblems(row), [], row.id);
    const ids = new Set([...holdout, ...dev].map((row) => row.id));
    assert.equal(ids.size, holdout.length + dev.length);
    const readme = readFileSync(join(ROOT, "evals", "verdict-quality", "README.md"), "utf8");
    assert.match(readme, /once per candidate/);
    assert.match(readme, /never for tuning/);
    assert.match(readme, /grill_feedback/);
    assert.match(readme, /60%/);
    assert.match(readme, /0\.1/);
    assert.match(readme, /would change what you do next/);
  });
});

describe("blind pairs", () => {
  it("randomises A and B and strips model names from the outputs only", () => {
    const control = "Models: anthropic/claude-sonnet-4.5 (judge)\nShaky. Show the Monday note.\nPrivate: sent only to zero-data-retention endpoints.";
    const candidate = "Solid if. Ask Charlie if he would lift this note. openrouter/auto";
    const first = buildPair({ id: "c", subject: "Will Charlie approve?", context: "criteria", control, candidate, rng: () => 0 });
    const second = buildPair({ id: "c", subject: "Will Charlie approve?", context: "criteria", control, candidate, rng: () => 0.75 });
    assert.equal(first.label.candidate_side, "A");
    assert.equal(second.label.candidate_side, "B");
    assert.equal(first.pair.a.includes("Charlie"), true);
    assert.equal(first.pair.b.includes("Monday"), true);
    assert.equal(JSON.stringify(first.pair).includes("anthropic"), false);
    assert.equal(JSON.stringify(first.pair).includes("claude"), false);
    assert.equal(JSON.stringify(first.pair).includes("openrouter"), false);
    assert.equal(JSON.stringify(first.pair).includes("Models:"), false);
    assert.equal(first.pair.subject, "Will Charlie approve?");
    assert.deepEqual(Object.keys(first.pair).sort(), ["a", "b", "context", "id", "subject"]);
  });

  it("renders a verdict without the model that served it", () => {
    const text = verdictText(
      {
        verdict: "weak",
        verdictReason: "The note does not say what Charlie would lift.",
        servedModel: "anthropic/claude-sonnet-4.5",
        challenges: [
          {
            challenge: "Best in class is Charlie's call, and the draft is not shown against his list.",
            falsifier: "Show Charlie one Monday note and ask which lines he would paste into the investor update.",
            severity: "serious",
            kind: "unfalsifiable",
            confidence: "medium",
            call: "yours",
            target: "best in class",
            what_would_have_to_be_true: "Charlie has already called this draft the one he lifts.",
          },
        ],
      },
      "Will Charlie see this as best in class?",
    );
    assert.equal(text.includes("anthropic"), false);
    assert.equal(text.includes("claude"), false);
    assert.match(text, /Charlie|Cheap test|best in class/i);
    assert.equal(blindOutput("judge: `openai/gpt-5.6-sol`\nA call."), "A call.");
  });
});

describe("the scorer", () => {
  it("computes the one-sided sign test", () => {
    assert.equal(signTestP(0, 0), 1);
    assert.equal(signTestP(0, 5), 1);
    assert.ok(Math.abs(signTestP(1, 1) - 0.5) < 1e-12);
    assert.ok(Math.abs(signTestP(11, 15) - 1941 / 32768) < 1e-10);
    assert.ok(Math.abs(signTestP(9, 15) - 9949 / 32768) < 1e-10);
    assert.ok(Math.abs(signTestP(8, 10) - 56 / 1024) < 1e-12);
    assert.ok(Math.abs(signTestP(6, 10) - 386 / 1024) < 1e-12);
    assert.ok(Math.abs(signTestP(10, 10) - 1 / 1024) < 1e-12);
    assert.throws(() => signTestP(2, 1), /wins/);
    assert.throws(() => signTestP(1.5, 2), /wins/);
  });

  it("passes only when the candidate wins at least 60% and p is under 0.1", () => {
    assert.equal(rateClears(9, 15), true);
    assert.equal(rateClears(8, 15), false);
    assert.equal(rateClears(0, 0), false);
    const row = (id, would, side) => ({ id, would_change: would, candidate_side: side });
    const eleven = scoreLabels([
      ...Array.from({ length: 11 }, (_, i) => row(`w${i}`, "A", "A")),
      ...Array.from({ length: 4 }, (_, i) => row(`l${i}`, "B", "A")),
    ]);
    assert.equal(eleven.decided, 15);
    assert.equal(eleven.candidateWins, 11);
    assert.equal(eleven.passes, true);
    const nine = scoreLabels([
      ...Array.from({ length: 9 }, (_, i) => row(`w${i}`, "b", "B")),
      ...Array.from({ length: 6 }, (_, i) => row(`l${i}`, "A", "B")),
    ]);
    assert.equal(nine.candidateWins, 9);
    assert.equal(nine.controlWins, 6);
    assert.equal(nine.winRate, 0.6);
    assert.equal(nine.passes, false);
    const ties = scoreLabels([row("a", "tie", "A"), row("b", "", "A"), row("c", "A", "")]);
    assert.equal(ties.decided, 0);
    assert.equal(ties.ties, 1);
    assert.equal(ties.unlabeled, 2);
    assert.equal(ties.passes, false);
    assert.equal(ties.winRate, null);
    assert.equal(ties.signTestP, null);
  });

  it("tallies the secondary rubric apart from the gate, and round-trips the csv", () => {
    const rows = [
      {
        id: "one",
        would_change: "A",
        candidate_side: "A",
        took_position_a: "yes",
        took_position_b: "no",
        specific_a: "yes",
        specific_b: "no",
        cheap_test_a: "yes",
        cheap_test_b: "no",
      },
      {
        id: "two",
        would_change: "A",
        candidate_side: "B",
        took_position_a: "no",
        took_position_b: "yes",
        specific_a: "",
        specific_b: "",
        cheap_test_a: "",
        cheap_test_b: "",
      },
      {
        id: "three",
        would_change: "tie",
        candidate_side: "A",
        took_position_a: "yes",
        took_position_b: "yes",
        specific_a: "no",
        specific_b: "yes",
        cheap_test_a: "no",
        cheap_test_b: "yes",
      },
    ];
    const score = scoreLabels(rows);
    assert.equal(score.decided, 2);
    assert.equal(score.candidateWins, 1);
    assert.equal(score.controlWins, 1);
    assert.equal(score.passes, false);
    assert.deepEqual(score.secondary.took_position, { candidateYes: 3, candidateRated: 3, controlYes: 1, controlRated: 3 });
    assert.deepEqual(score.secondary.specific, { candidateYes: 1, candidateRated: 2, controlYes: 1, controlRated: 2 });
    assert.deepEqual(score.secondary.cheap_test, { candidateYes: 1, candidateRated: 2, controlYes: 1, controlRated: 2 });
    const parsed = labelsFromCsv(toCsv(rows));
    assert.deepEqual(scoreLabels(parsed).secondary, score.secondary);
    assert.deepEqual(parseCsv(`"a,b","say ""hi"""\n`), [["a,b", 'say "hi"']]);
    assert.deepEqual(LABEL_COLUMNS.includes("candidate_side"), true);
    assert.match(renderScore(score), /passes: no/);
  });

  it("the score script exits 0 on a pass and 1 when the candidate does not clear the bars", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-score-"));
    const header = LABEL_COLUMNS.join(",");
    const passing = join(dir, "pass.csv");
    const failing = join(dir, "fail.csv");
    const blank = (id, choice, side) => [id, choice, "", "", "", "", "", "", side].join(",");
    writeFileSync(passing, `${header}\n${Array.from({ length: 11 }, (_, i) => blank(`w${i}`, "A", "A")).join("\n")}\n${Array.from({ length: 4 }, (_, i) => blank(`l${i}`, "B", "A")).join("\n")}\n`);
    writeFileSync(failing, `${header}\n${blank("a", "A", "A")}\n${blank("b", "B", "A")}\n`);
    const env = { ...process.env };
    const pass = spawnSync(process.execPath, [join(ROOT, "scripts", "eval-score.mjs"), "--labels", passing], { encoding: "utf8", env });
    const fail = spawnSync(process.execPath, [join(ROOT, "scripts", "eval-score.mjs"), "--labels", failing], { encoding: "utf8", env });
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /passes: yes/);
    assert.match(pass.stdout, /candidate_wins: 11/);
    assert.equal(fail.status, 1, fail.stdout);
    assert.match(fail.stdout, /passes: no/);
    const missing = spawnSync(process.execPath, [join(ROOT, "scripts", "eval-score.mjs"), "--labels", join(dir, "missing.csv")], { encoding: "utf8" });
    assert.equal(missing.status, 2);
  });

  it("a dev run with no key skips and writes no pairs", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-dev-"));
    const cases = join(dir, "cases.jsonl");
    writeFileSync(
      cases,
      `${line({ id: "dev-only", subject: "Ship the small change on Thursday and watch errors for a day before telling customers.", context: "One engineer is on call.", split: "dev" })}\n${line({ id: "hidden", subject: "SECRET HOLDOUT SUBJECT that a dev run must not print.", context: "no", split: "holdout" })}\n`,
    );
    const env = { ...process.env, GRILL_KEY_FILE: join(dir, "missing-key") };
    delete env.OPENROUTER_API_KEY;
    delete env.GRILL_API_KEY;
    delete env.GRILL_JUDGE_COMMIT;
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-verdicts.mjs"), "--split", "dev", "--cases", cases, "--out", join(dir, "out")],
      { encoding: "utf8", env },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(`${result.stdout}${result.stderr}`, /no router key; eval skipped/);
    assert.equal(`${result.stdout}${result.stderr}`.includes("SECRET HOLDOUT"), false);
    assert.throws(() => readFileSync(join(dir, "out", "pairs.jsonl")));
  });
});

describe("holdout v2", () => {
  const v1Text = readFileSync(CASES_PATH, "utf8");
  const v2Text = readFileSync(V2_CASES_PATH, "utf8");
  const v1 = casesFromJsonl(v1Text, { purpose: "eval", split: "holdout" });
  const v2 = casesFromJsonl(v2Text, { purpose: "eval", split: "holdout-v2" });

  it("is 25 fresh cases, checksum-locked, and v1 is spent and unchanged", () => {
    assert.equal(v2.length, 25);
    assert.equal(holdoutV2Checksum(v2), FROZEN_HOLDOUT_V2_SHA256);
    assert.equal(readFileSync(V2_CHECKSUM_PATH, "utf8").trim(), FROZEN_HOLDOUT_V2_SHA256);
    assert.equal(sha256(v2Text), FROZEN_HOLDOUT_V2_SHA256);
    assert.equal(holdoutV2Canonical(v2), v2Text.endsWith("\n") ? v2Text : `${v2Text}\n`);
    assert.equal(readFileSync(CHECKSUM_PATH, "utf8").trim(), FROZEN_HOLDOUT_SHA256);
    assert.equal(holdoutChecksum(v1), FROZEN_HOLDOUT_SHA256);
    const v1Ids = new Set(v1.map((row) => row.id));
    for (const row of v2) {
      assert.deepEqual(caseProblems(row), [], row.id);
      assert.equal(v1Ids.has(row.id), false, row.id);
    }
    assert.equal(v2Text.includes("proposed-holdout"), false);
    const spent = readFileSync(join(ROOT, "evals", "verdict-quality", "holdout-v1-spent.txt"), "utf8");
    assert.match(spent, /spent/);
    assert.match(spent, /won 9 and lost 6/);
    assert.match(holdoutV1SpentMessage(), /won 9 and lost 6, p=0\.30/);
    const readme = readFileSync(join(ROOT, "evals", "verdict-quality", "README.md"), "utf8");
    assert.match(readme, /holdout-v2 --screen/);
    assert.match(readme, /openai\/gpt-4o-mini/);
    assert.match(readme, /full answers/);
    assert.match(readme, /1: A/);
  });

  it("changes the v2 checksum when a v2 case changes, and not when v1 changes", () => {
    const changed = v2.map((row) => (row.id === v2[0].id ? { ...row, subject: `${row.subject} extra` } : row));
    assert.notEqual(holdoutV2Checksum(changed), FROZEN_HOLDOUT_V2_SHA256);
    assert.equal(holdoutChecksum([...v1, ...v2]), FROZEN_HOLDOUT_SHA256);
    assert.equal(holdoutV2Checksum([...v1, ...v2]), FROZEN_HOLDOUT_V2_SHA256);
    assert.equal(holdoutV2Checksum(v1), sha256("\n"));
  });

  it("a tuning read skips a holdout v2 line before parsing it", () => {
    const text = [
      '{not json "split": "holdout-v2"}',
      line({ id: "dev-case", subject: "A dev decision with enough words to be a real case for the guard.", context: "notes", split: "dev" }),
    ].join("\n");
    const dev = casesFromJsonl(text, { purpose: "tune", split: "dev" });
    assert.deepEqual(dev.map((row) => row.id), ["dev-case"]);
    assert.equal(JSON.stringify(dev).includes("not json"), false);
    assert.throws(() => purposeFor({ split: "holdout-v2", tune: true }), HoldoutLocked);
    assert.equal(purposeFor({ split: "holdout-v2" }), "eval");
  });

  it("refuses a spent v1 run and a v2 tuning run before opening the cases file", () => {
    const spent = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-verdicts.mjs"), "--split", "holdout", "--cases", "/nonexistent/verdict-cases.jsonl"],
      { encoding: "utf8" },
    );
    assert.notEqual(spent.status, 0);
    assert.match(spent.stderr, /holdout v1 is spent/);
    assert.match(spent.stderr, /p=0\.30/);
    assert.doesNotMatch(`${spent.stdout}${spent.stderr}`, /ENOENT|nonexistent/);
    const tune = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-verdicts.mjs"), "--split", "holdout-v2", "--tune", "--cases", "/nonexistent/verdict-cases.jsonl"],
      { encoding: "utf8" },
    );
    assert.notEqual(tune.status, 0);
    assert.match(tune.stderr, /must not read holdout cases/);
    assert.doesNotMatch(`${tune.stdout}${tune.stderr}`, /ENOENT|nonexistent/);
  });

  it("a v2 run with no key writes nothing, and a bad checksum fails before that", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-v2-"));
    const cases = join(dir, "cases.jsonl");
    const row = {
      id: "fresh-v2-case",
      subject: "Ship the small reversible change on Thursday and watch the error rate for one day before telling customers.",
      context: "One engineer is on call.",
      split: "holdout-v2",
    };
    writeFileSync(cases, `${JSON.stringify(row)}\n`);
    const sum = holdoutV2Checksum([row]);
    writeFileSync(join(dir, "good.sha256"), `${sum}\n`);
    writeFileSync(join(dir, "bad.sha256"), `${"0".repeat(64)}\n`);
    const env = { ...process.env, GRILL_KEY_FILE: join(dir, "missing-key") };
    delete env.OPENROUTER_API_KEY;
    delete env.GRILL_API_KEY;
    delete env.GRILL_JUDGE_COMMIT;
    const bad = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-verdicts.mjs"), "--split", "holdout-v2", "--cases", cases, "--checksum", join(dir, "bad.sha256"), "--out", join(dir, "out")],
      { encoding: "utf8", env },
    );
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /holdout v2 checksum does not match/);
    assert.doesNotMatch(`${bad.stdout}${bad.stderr}`, /no router key/);
    const skipped = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-verdicts.mjs"), "--split", "holdout-v2", "--screen", "--cases", cases, "--checksum", join(dir, "good.sha256"), "--out", join(dir, "out")],
      { encoding: "utf8", env },
    );
    assert.equal(skipped.status, 2, skipped.stderr);
    assert.match(skipped.stderr, /Not measured/);
    assert.throws(() => readFileSync(join(dir, "out", "pairs.jsonl")));
  });
});

describe("the screen", () => {
  const vote = (choice, confident = true) => JSON.stringify({ choice, confident });

  it("asks three providers to rate the full answer, with A and B randomised", () => {
    const providers = PANEL_MODELS.map((model) => model.split("/")[0]);
    assert.deepEqual(providers, ["openai", "deepseek", "google"]);
    assert.equal(new Set(providers).size, 3);
    assert.equal(PANEL_MODELS.includes("openrouter/auto"), false);
    const tail = `UNIQUE-TAIL-${"z".repeat(4000)}`;
    const full = `Shaky. The bar is not met.\n${tail}`;
    const prompt = buildPanelPrompt({
      subject: "Will Marta approve the Canada entity on her stated criteria?",
      context: "Revenue is under the bar.",
      a: full,
      b: "Holds. Show her the page.",
    });
    assert.equal(prompt.includes(tail), true);
    assert.equal(prompt.includes(full), true);
    assert.match(prompt, /Which answer would change the decision more/);
    const body = panelRequestBody({ model: PANEL_MODELS[0], prompt });
    assert.equal(body.messages[1].content, prompt);
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.provider, { zdr: true, data_collection: "deny" });
    assert.throws(() => panelRequestBody({ model: "openrouter/auto", prompt }), /panel model/);
    const swapped = panelCall({ subject: "s", context: "c", a: "PAIR-A", b: "PAIR-B", rng: () => 0 });
    const straight = panelCall({ subject: "s", context: "c", a: "PAIR-A", b: "PAIR-B", rng: () => 0.75 });
    assert.equal(swapped.swap, true);
    assert.equal(swapped.prompt.includes("ANSWER A\nPAIR-B"), true);
    assert.equal(straight.swap, false);
    assert.equal(straight.prompt.includes("ANSWER A\nPAIR-A"), true);
  });

  it("auto-labels only a unanimous confident panel, and maps a swapped vote back", () => {
    assert.deepEqual(parsePanelVote('```json\n{"choice":"A","confident":true}\n```'), { choice: "A", confident: true });
    assert.equal(parsePanelVote('{"choice":"tie","confident":"yes"}').confident, true);
    assert.equal(parsePanelVote("no json"), null);
    const agreed = resolvePanel(PANEL_MODELS.map((model) => ({ model, swap: true, raw: vote("A") })));
    assert.equal(agreed.unanimous, true);
    assert.equal(agreed.auto, "B");
    const split = resolvePanel([
      { model: PANEL_MODELS[0], swap: false, raw: vote("A") },
      { model: PANEL_MODELS[1], swap: false, raw: vote("A") },
      { model: PANEL_MODELS[2], swap: false, raw: vote("B") },
    ]);
    assert.equal(split.unanimous, false);
    assert.equal(split.auto, "");
    const unsure = resolvePanel(PANEL_MODELS.map((model) => ({ model, swap: false, raw: vote("A", false) })));
    assert.equal(unsure.unanimous, false);
    const ties = resolvePanel(PANEL_MODELS.map((model) => ({ model, swap: false, raw: vote("tie") })));
    assert.equal(ties.unanimous, true);
    assert.equal(ties.auto, "tie");
    assert.equal(resolvePanel(PANEL_MODELS.slice(0, 2).map((model) => ({ model, swap: false, raw: vote("A") }))).unanimous, false);
  });

  it("puts split pairs on a short sheet and lets a reply fill them without touching a panel label", () => {
    const secret = "SECRET-FOURTH-LINE-SHOULD-NOT-SHOW";
    const sheet = renderHumanSheet([
      {
        n: 1,
        id: "ceo-will-greenlight-canada",
        subject: "Will the CEO, Marta, greenlight opening a Canada entity this quarter?",
        a: ["Shaky. Revenue is under the bar.", "Missing: a counsel on retainer.", "Cheap test: show Marta the three criteria.", secret].join("\n"),
        b: ["Holds.", "Do the small test.", "Then stop.", secret].join("\n"),
      },
    ]);
    assert.equal(sheet.includes(secret), false);
    assert.match(sheet, /Shaky\. Revenue is under the bar\./);
    assert.match(sheet, /Missing: a counsel on retainer\./);
    assert.match(sheet, /Cheap test: show Marta the three criteria\./);
    assert.match(sheet, /1: A/);
    assert.match(sheet, /^1: $/m);
    assert.equal(parseReplies(sheet).length, 0);
    assert.deepEqual(answerExcerpt(`one\n\ntwo\nthree\n${secret}`), ["one", "two", "three"]);
    assert.deepEqual(parseReplies("1: A\n--- replies ---\n1: B\n2: tie\n--- end ---\n3: A\n"), [
      { n: 1, choice: "B" },
      { n: 2, choice: "tie" },
    ]);
    const labels = finishLabels(
      [
        { id: "one", would_change: "", candidate_side: "A" },
        { id: "two", would_change: "", candidate_side: "B" },
      ],
      [
        { id: "one", unanimous: true, auto: "A" },
        { id: "two", unanimous: false, auto: "" },
      ],
    );
    assert.equal(labels[0].label_source, "panel");
    assert.equal(labels[0].would_change, "A");
    assert.equal(labels[1].sheet_n, "1");
    const merged = applyReplies(labels, parseReplies("1: B\n"));
    assert.equal(merged[0].would_change, "A");
    assert.equal(merged[0].label_source, "panel");
    assert.equal(merged[1].would_change, "B");
    assert.equal(merged[1].label_source, "human");
    const stuck = applyReplies([{ id: "one", would_change: "A", label_source: "panel", sheet_n: "1", candidate_side: "A" }], parseReplies("1: B\n"));
    assert.equal(stuck[0].would_change, "A");
    const score = scoreLabels(merged);
    assert.equal(score.candidateWins, 2);
    assert.equal(score.passes, false);
    assert.equal(score.panel.candidateWins, 1);
    assert.equal(score.human.candidateWins, 1);
    assert.equal(score.pending, 0);
    assert.match(renderScore(score), /panel_candidate_wins: 1/);
    assert.match(renderScore(score), /human_candidate_wins: 1/);
    const round = labelsFromCsv(toCsv(merged, SCREEN_LABEL_COLUMNS));
    assert.equal(round[1].sheet_n, "1");
    assert.equal(scoreLabels(applyReplies(round, parseReplies("1: B\n"))).human.candidateWins, 1);
  });

  it("the score script combines a reply with the panel and still uses the same pass bar", () => {
    const dir = mkdtempSync(join(tmpdir(), "verdict-screen-score-"));
    const header = SCREEN_LABEL_COLUMNS.join(",");
    const cell = (id, choice, side, source, n) => [id, choice, "", "", "", "", "", "", side, source, n].join(",");
    const lines = [header];
    for (let i = 0; i < 10; i++) lines.push(cell(`p${i}`, "A", "A", "panel", ""));
    lines.push(cell("h1", "", "A", "", "1"));
    lines.push(cell("h2", "", "B", "", "2"));
    const labels = join(dir, "labels.csv");
    const replies = join(dir, "replies.txt");
    writeFileSync(labels, `${lines.join("\n")}\n`);
    writeFileSync(replies, "1: A\n2: A\n");
    const scored = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-score.mjs"), "--labels", labels, "--replies", replies],
      { encoding: "utf8" },
    );
    assert.equal(scored.status, 0, scored.stderr);
    assert.match(scored.stdout, /passes: yes/);
    assert.match(scored.stdout, /candidate_wins: 11/);
    assert.match(scored.stdout, /panel_candidate_wins: 10/);
    assert.match(scored.stdout, /human_candidate_wins: 1/);
    assert.match(scored.stdout, /human_control_wins: 1/);
    const missing = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "eval-score.mjs"), "--labels", labels, "--replies", join(dir, "missing.txt")],
      { encoding: "utf8" },
    );
    assert.equal(missing.status, 2);
  });
});
