import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSignalIssues } from "./signals.mjs";
import { aggregate, FIELDS, isSignalIssue, parseSignal, recommend, renderReport, SIGNAL_LABEL, SIGNAL_TITLE } from "./signalsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS_CLI = join(ROOT, "scripts/signals.mjs");

/** Render a body the way GitHub renders an issue form submission. */
function body(values) {
  return Object.entries(FIELDS)
    .map(([id, f]) => `### ${f.label}\n\n${values[id] ?? "_No response_"}`)
    .join("\n\n");
}

const rated = (judge, rating, category = "pricing") => ({ event: "rated", category, judge, verdict: "shaky", rating, client: "desktop" });
const resolved = (verdict, outcome) => ({ event: "resolved", category: "hiring", judge: "openai", verdict, outcome, confidence: "70-89" });

describe("the form and the parser agree", () => {
  it("every field id, label and option in the issue form matches FIELDS", () => {
    const form = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/grill-signal.yml"), "utf8");
    for (const [id, f] of Object.entries(FIELDS)) {
      assert.ok(form.includes(`id: ${id}`), `form lacks id ${id}`);
      assert.ok(form.includes(`label: ${f.label}`), `form lacks label ${f.label}`);
      assert.ok(form.includes(JSON.stringify(f.options).replace(/","/g, '", "')), `options drifted for ${id}`);
    }
    assert.doesNotMatch(form, /type: (input|textarea|checkboxes)/, "the form must stay dropdown-only");
  });

  it("offers anthropic as a judge family, and the parser and the tally read it", () => {
    const form = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/grill-signal.yml"), "utf8");
    // A Claude model can be the judge whenever another company's assistant wrote the write-up.
    const judgeDropdown = form.slice(form.indexOf("id: judge"), form.indexOf("id: verdict"));
    assert.match(judgeDropdown, /options: \[.*"anthropic".*\]/);
    assert.ok(FIELDS.judge.options.includes("anthropic"));
    assert.equal(parseSignal(body(rated("anthropic", "yes"))).judge, "anthropic");
    assert.deepEqual(aggregate([rated("anthropic", "yes"), rated("anthropic", "no")]).worthEngaging.byJudge.anthropic, { yes: 1, n: 2 });
    // Every family the form offered before is still there, so an older signal still parses.
    for (const family of ["openai", "google", "deepseek", "meta", "mistral", "qwen", "xai", "moonshot", "other", "paste-route"]) {
      assert.ok(FIELDS.judge.options.includes(family), family);
    }
    // A name the form does not offer is still dropped whole.
    assert.equal(parseSignal(body(rated("claude", "yes"))), null);
  });
});

describe("parseSignal", () => {
  it("reads a well-formed submission", () => {
    assert.deepEqual(parseSignal(body(rated("openai", "yes"))), rated("openai", "yes"));
  });

  it("drops a body with free text in a field", () => {
    assert.equal(parseSignal(body({ ...rated("openai", "yes"), category: "we are raising a $2M seed" })), null);
  });

  it("drops a body with an added section", () => {
    assert.equal(parseSignal(`${body(rated("openai", "yes"))}\n\n### Notes\n\nmy decision was…`), null);
  });

  it("drops a body missing a required field, and ignores optional non-answers", () => {
    const { category, ...noCategory } = rated("openai", "yes");
    assert.equal(parseSignal(body(noCategory)), null);
    assert.equal(parseSignal(body({ event: "rated", category, judge: "openai", verdict: "solid" })).rating, undefined);
  });

  it("reads an older verdict name as the public one", () => {
    assert.equal(parseSignal(body({ event: "rated", category: "pricing", judge: "openai", verdict: "holds" })).verdict, "solid");
    assert.equal(
      parseSignal(body({ event: "rated", category: "pricing", judge: "openai", verdict: "holds-with-conditions" })).verdict,
      "solid if",
    );
    assert.equal(parseSignal(body({ event: "resolved", category: "hiring", judge: "openai", verdict: "weak", outcome: "no" })).verdict, "shaky");
    assert.equal(
      parseSignal(body({ event: "resolved", category: "hiring", judge: "openai", verdict: "refuted", outcome: "yes" })).verdict,
      "doesn't hold up",
    );
  });
});

describe("aggregate and recommend", () => {
  it("computes worth-engaging rates by judge and verdict outcomes", () => {
    const agg = aggregate([rated("openai", "yes"), rated("openai", "no"), rated("google", "yes"), resolved("shaky", "no"), resolved("solid", "yes")]);
    assert.equal(agg.counts.rated, 3);
    assert.deepEqual(agg.worthEngaging.byJudge.openai, { yes: 1, n: 2 });
    assert.deepEqual(agg.verdictOutcomes.shaky, { cameTrue: 0, n: 1 });
  });

  it("stays silent on thin data", () => {
    assert.deepEqual(recommend(aggregate([rated("meta", "no"), rated("openai", "yes")])), []);
  });

  it("flags a judge family rated far below the rest, with enough data", () => {
    const signals = [
      ...Array.from({ length: 30 }, () => rated("openai", "yes")),
      ...Array.from({ length: 8 }, () => rated("meta", "no")),
      ...Array.from({ length: 3 }, () => rated("meta", "yes")),
    ];
    const recs = recommend(aggregate(signals));
    assert.equal(recs.length, 1);
    assert.match(recs[0], /`meta`/);
  });

  it("flags verdicts that don't predict outcomes", () => {
    const signals = [
      ...Array.from({ length: 10 }, (_, i) => resolved("solid", i < 5 ? "yes" : "no")),
      ...Array.from({ length: 10 }, (_, i) => resolved("shaky", i < 6 ? "yes" : "no")),
    ];
    assert.match(recommend(aggregate(signals)).join("\n"), /don't predict outcomes/);
  });

  it("renders a report that says when there is nothing to act on", () => {
    const md = renderReport(aggregate([rated("openai", "yes")]), [], { dropped: 2, period: "2026-10" });
    assert.match(md, /Grill learning report: 2026-10/);
    assert.match(md, /2 dropped as off-form/);
    assert.match(md, /None yet/);
  });

  it("shows n/a, not a dash, where nothing was rated", () => {
    const md = renderReport(aggregate([resolved("solid", "yes")]), []);
    assert.match(md, /^\| \*\*all\*\* \| 0 \| n\/a \|$/m);
    assert.doesNotMatch(md, /[\u2013\u2014]/);
  });
});

describe("which issues the report reads", () => {
  const formLines = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/grill-signal.yml"), "utf8").split("\n");

  it("looks for the form's own title and label", () => {
    assert.ok(formLines.includes(`title: ${JSON.stringify(SIGNAL_TITLE)}`), "the form's title is the one the report matches");
    assert.ok(formLines.includes(`labels: [${JSON.stringify(SIGNAL_LABEL)}]`), "the form's label is the one the report matches");
  });

  it("reads an issue that carries the signal label, whatever its title", () => {
    assert.equal(isSignalIssue({ number: 1, title: "A renamed signal", labels: [{ name: "signal" }] }), true);
    assert.equal(isSignalIssue({ number: 2, title: "Grill signal", labels: [{ name: "bug" }, { name: "signal" }] }), true);
    assert.equal(isSignalIssue({ number: 3, title: "A renamed signal", labels: ["signal"] }), true);
  });

  it("also reads an issue with no label when its title is exactly the form's title", () => {
    assert.equal(isSignalIssue({ number: 4, title: "Grill signal", labels: [] }), true);
    assert.equal(isSignalIssue({ number: 5, title: "Grill signal" }), true);
  });

  it("leaves out an issue with any other title and no label, and every pull request", () => {
    const others = ["Grill signal: pricing", "grill signal", "Grill signal ", " Grill signal", "Re: Grill signal", "Learning report", "Learning report: 2026-11", ""];
    for (const title of others) {
      assert.equal(isSignalIssue({ number: 6, title, labels: [{ name: "learning" }] }), false, JSON.stringify(title));
    }
    assert.equal(isSignalIssue({ number: 7, title: "Grill signal", labels: [{ name: "signal" }], pull_request: { url: "x" } }), false);
    for (const notAnIssue of [null, undefined, "Grill signal", 7, []]) assert.equal(isSignalIssue(notAnIssue), false);
  });
});

describe("reading the issues from GitHub", () => {
  /** A stand-in for fetch. It serves these pages in order and records each request. */
  function pagedFetch(pages) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: new URL(url), headers: init.headers });
      const page = Number(new URL(url).searchParams.get("page"));
      return { ok: true, status: 200, json: async () => pages[page - 1] ?? [] };
    };
    return { fetchImpl, calls };
  }
  const issue = (number, extra = {}) => ({ number, title: "Some other issue", labels: [], body: "", ...extra });
  const fullPage = (from) => Array.from({ length: 100 }, (_, i) => issue(from + i));

  it("asks for every issue with no label filter, and keeps only the signal issues", async () => {
    const page = [
      issue(10),
      issue(11, { title: "A renamed signal", labels: [{ name: "signal" }], body: body(rated("openai", "yes")) }),
      issue(12, { title: "Grill signal", body: body(rated("anthropic", "no")) }),
      issue(13, { title: "Grill signal", body: "free text" }),
      issue(14, { title: "Grill signal", pull_request: { url: "x" } }),
      issue(15, { title: "Learning report", labels: [{ name: "learning" }] }),
    ];
    const { fetchImpl, calls } = pagedFetch([page]);
    const got = await fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "" });
    assert.deepEqual(got.map((i) => i.number), [11, 12, 13]);
    // The off-form one is kept here on purpose: the report counts it as dropped.
    assert.deepEqual(got.map((i) => parseSignal(i.body)?.judge ?? null), ["openai", "anthropic", null]);
    assert.equal(calls.length, 1);
    const { url, headers } = calls[0];
    assert.equal(`${url.origin}${url.pathname}`, "https://api.github.com/repos/mtangoz/grill/issues");
    assert.equal(url.searchParams.get("state"), "all");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.has("labels"), false, "a label filter would miss a signal that arrived without its label");
    assert.equal(headers.accept, "application/vnd.github+json");
    assert.equal("authorization" in headers, false, "with no token there is no authorization header");
  });

  it("reads page after page until a short one, and keeps an issue once when a page repeats it", async () => {
    const first = fullPage(1000);
    first[3] = issue(1003, { title: "Grill signal", body: body(rated("google", "yes")) });
    const second = [issue(1003, { title: "Grill signal", body: body(rated("google", "yes")) }), issue(2000, { labels: [{ name: "signal" }] })];
    const { fetchImpl, calls } = pagedFetch([first, second]);
    const got = await fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "" });
    assert.deepEqual(got.map((i) => i.number), [1003, 2000]);
    assert.deepEqual(calls.map((call) => call.url.searchParams.get("page")), ["1", "2"]);
  });

  it("sends the token when there is one", async () => {
    const { fetchImpl, calls } = pagedFetch([[]]);
    assert.deepEqual(await fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "t0ken-for-the-test" }), []);
    assert.equal(calls[0].headers.authorization, "Bearer t0ken-for-the-test");
  });

  it("fails rather than report on part of the issues", async () => {
    const refused = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await assert.rejects(fetchSignalIssues("mtangoz/grill", { fetchImpl: refused, token: "" }), /GitHub API 403 for mtangoz\/grill/);
    const notAList = async () => ({ ok: true, status: 200, json: async () => ({ message: "moved" }) });
    await assert.rejects(fetchSignalIssues("mtangoz/grill", { fetchImpl: notAList, token: "" }), /no list of issues/);
    const { fetchImpl, calls } = pagedFetch([fullPage(1), fullPage(101), fullPage(201)]);
    await assert.rejects(
      fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "", maxPages: 2 }),
      /more than 200 issues and pull requests, so the report would be incomplete/,
    );
    assert.equal(calls.length, 2);
  });
});

describe("the CLI, offline", () => {
  it("reads saved issues and prints the report", () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-signals-"));
    const file = join(dir, "issues.json");
    writeFileSync(file, JSON.stringify([{ body: body(rated("openai", "yes")) }, { body: "free text" }]));
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/signals.mjs"), "--from-file", file, "--period", "2026-10"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.match(out, /1 signals \(1 rated, 0 resolved\); 1 dropped as off-form/);
  });

  it("tells the workflow how many signals it counted, and still writes the job summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-signals-"));
    const run = (issues) => {
      const file = join(dir, "issues.json");
      const output = join(dir, "output.txt");
      const summary = join(dir, "summary.md");
      writeFileSync(file, JSON.stringify(issues));
      writeFileSync(output, "");
      writeFileSync(summary, "");
      const out = execFileSync(process.execPath, [SIGNALS_CLI, "--from-file", file, "--period", "2026-12"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      });
      return { out, output: readFileSync(output, "utf8"), summary: readFileSync(summary, "utf8") };
    };
    const some = run([{ body: body(rated("openai", "yes")) }, { body: body(resolved("solid", "yes")) }, { body: "free text" }]);
    assert.equal(some.output, "signals=2\n");
    assert.match(some.out, /^2 signals \(1 rated, 1 resolved\); 1 dropped as off-form\.$/m);
    assert.equal(some.summary, some.out, "the job summary gets the same report");
    // Off-form issues are not signals. A report with nothing but those counts zero.
    const none = run([{ body: "free text" }]);
    assert.equal(none.output, "signals=0\n");
    assert.match(none.out, /^0 signals \(0 rated, 0 resolved\); 1 dropped as off-form\.$/m);
    assert.equal(none.summary, none.out, "a report with zero signals still reaches the job summary");
    assert.equal(run([]).output, "signals=0\n");
  });
});

// ---------------------------------------------------------------------------
// .github/workflows/learn.yml, the monthly job that runs signals.mjs and posts the report.
//
// The file is read as text. There is no YAML parser here and none is needed: each pin is a
// line or a block that must be present as written. Its two shell steps are also run for real,
// through bash, against a stand-in `gh` that records what it was asked to do.

const learnYml = readFileSync(join(ROOT, ".github/workflows/learn.yml"), "utf8");
const learnLines = learnYml.split("\n");
const LABEL_STEP = "Make sure the signal and learning labels exist";
const AGGREGATE_STEP = "Aggregate the signals";
const POST_STEP = "With at least one signal, add the report to ONE rolling issue";
const ROLLING_TITLE = "Learning report";
const EXACT_ROLLING_FILTER = `[.[] | select(.title == "${ROLLING_TITLE}")][0].number // empty`;

/** The lines of the step with this name, up to the next step. */
function stepLines(name) {
  const from = learnLines.indexOf(`      - name: ${name}`);
  assert.ok(from >= 0, `learn.yml has a step named "${name}"`);
  let to = from + 1;
  // A step item starts at six spaces. A comment above the next step belongs to that step.
  while (to < learnLines.length && !/^ {6}(- |# )/.test(learnLines[to])) to += 1;
  return learnLines.slice(from, to);
}

/** The shell script of a step: the block under `run: |`, with its indentation removed. */
function runScript(name) {
  const step = stepLines(name);
  const at = step.indexOf("        run: |");
  assert.ok(at >= 0, `the step "${name}" has a run block`);
  return step
    .slice(at + 1)
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

// `gh`, as a stand-in. It records each call. It answers "issue list" the way the pinned filter
// would, and refuses any other filter, so a change to the filter has to come back through the
// text pin. It can play a repository where the labels already exist, or where one is missing.
const GH_STUB = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + "\\n");
const flag = (name) => args[args.indexOf(name) + 1];
const fail = (why) => {
  process.stderr.write(why + "\\n");
  process.exit(1);
};
if (args[0] === "label" && args[1] === "create") {
  if (process.env.GH_LABELS_EXIST === "1") fail("label already exists");
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "list") {
  if (flag("--state") !== "open" || flag("--json") !== "number,title" || flag("--jq") !== process.env.GH_EXPECT_JQ) {
    fail("unexpected gh issue list arguments");
  }
  const hit = JSON.parse(process.env.GH_OPEN_ISSUES).find((issue) => issue.title === process.env.GH_EXACT_TITLE);
  if (hit) process.stdout.write(String(hit.number) + "\\n");
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "create") {
  if (args.includes("--label") && process.env.GH_LABEL_MISSING === "1") fail("could not add label: not found");
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "comment") process.exit(0);
fail("unexpected gh " + args.join(" "));
`;

/** Run one step's script the way the runner does (bash -eo pipefail), with the stand-in gh. */
function runStep(name, { openIssues = [], labelsExist = false, labelMissing = false, expectJq = EXACT_ROLLING_FILTER } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "learn-workflow-"));
  const bin = join(dir, "bin");
  const log = join(dir, "calls.jsonl");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(log, "");
  writeFileSync(join(dir, "learning-report.md"), "# Grill learning report: 2026-12\n");
  const script = runScript(name);
  assert.ok(!script.includes("${{"), "the script reads the environment, not workflow expressions");
  const scriptPath = join(dir, "step.sh");
  writeFileSync(scriptPath, script);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GH_STUB_LOG: log,
    GH_OPEN_ISSUES: JSON.stringify(openIssues),
    GH_EXPECT_JQ: expectJq,
    GH_EXACT_TITLE: ROLLING_TITLE,
    GH_LABELS_EXIST: labelsExist ? "1" : "0",
    GH_LABEL_MISSING: labelMissing ? "1" : "0",
    GH_TOKEN: "test-token",
    GITHUB_REPOSITORY: "mtangoz/grill",
  };
  let status = 0;
  try {
    execFileSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", scriptPath], { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    status = err.status ?? 1;
  }
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  rmSync(dir, { recursive: true, force: true });
  return { status, calls };
}

describe("learn.yml: when it runs and what it may do", () => {
  it("runs on the first of each month and by hand, and never on a pull request or a push", () => {
    assert.ok(learnYml.includes('\non:\n  schedule:\n    - cron: "0 14 1 * *"\n  workflow_dispatch:\n\npermissions:\n'));
    assert.doesNotMatch(learnYml, /pull_request|^ {2}push:/m);
  });

  it("keeps least privilege: read the code, write issues, and no secret", () => {
    assert.ok(learnYml.includes("\npermissions:\n  contents: read\n  issues: write\n\njobs:\n"));
    assert.equal(learnYml.match(/^\s*permissions:/gm).length, 1, "one permissions block, at the top");
    assert.doesNotMatch(learnYml, /contents: write|pull-requests: write|id-token|write-all|secrets\./);
    const uses = learnLines.filter((line) => /^\s*(- )?uses: /.test(line)).map((line) => line.trim().replace(/^- /, ""));
    assert.deepEqual(uses, ["uses: actions/checkout@v4", "uses: actions/setup-node@v4"]);
    assert.ok(learnLines.includes("    runs-on: ubuntu-latest"));
    assert.ok(learnLines.includes("    timeout-minutes: 10"));
  });
});

describe("learn.yml: the labels", () => {
  const script = runScript(LABEL_STEP);

  it("makes the signal and learning labels before anything else, every month", () => {
    const steps = learnLines.filter((line) => /^ {6}- /.test(line));
    assert.equal(steps[0], `      - name: ${LABEL_STEP}`, "the label step is the first step");
    assert.ok(!stepLines(LABEL_STEP).some((line) => /^ {8}if:/.test(line)), "it has no condition, so a month with zero signals still makes the labels");
    assert.deepEqual(script.split("\n").filter(Boolean), [
      'gh label create signal --repo "$GITHUB_REPOSITORY" --description "A Grill signal: choices only, filed through the signal form" || true',
      'gh label create learning --repo "$GITHUB_REPOSITORY" --description "The rolling learning report" || true',
    ]);
    assert.ok(script.includes(`gh label create ${SIGNAL_LABEL} `), "the label it makes is the one the form asks for");
    assert.doesNotMatch(learnYml, /--force/, "an existing label is never overwritten");
  });

  it("creates both labels, and a label that is already there does not fail the run", () => {
    const fresh = runStep(LABEL_STEP);
    assert.equal(fresh.status, 0);
    assert.deepEqual(fresh.calls.map((call) => call.slice(0, 5)), [
      ["label", "create", "signal", "--repo", "mtangoz/grill"],
      ["label", "create", "learning", "--repo", "mtangoz/grill"],
    ]);
    const existing = runStep(LABEL_STEP, { labelsExist: true });
    assert.equal(existing.status, 0, "both creates failed and the step still passed");
    assert.equal(existing.calls.length, 2, "the second label is still tried after the first one failed");
  });
});

describe("learn.yml: one rolling issue, and nothing when there are zero signals", () => {
  const step = stepLines(POST_STEP);
  const script = runScript(POST_STEP);

  it("posts only when the script counted at least one signal", () => {
    const aggregate = stepLines(AGGREGATE_STEP);
    assert.ok(aggregate.includes("        id: report"));
    assert.ok(aggregate.includes('        run: node scripts/signals.mjs --period "$(date -u +%Y-%m)" > learning-report.md'));
    assert.ok(step.includes("        if: steps.report.outputs.signals != '' && steps.report.outputs.signals != '0'"));
    // The count it reads is the one signals.mjs writes to the step outputs.
    const cli = readFileSync(SIGNALS_CLI, "utf8");
    assert.ok(cli.includes("appendFileSync(process.env.GITHUB_OUTPUT, `signals=${agg.counts.signals}\\n`);"));
    assert.equal(learnYml.match(/gh issue (create|comment)/g).length, 3, "no other step posts anything");
    assert.equal(learnLines.filter((line) => /^ {6}- name: /.test(line)).length, 3, "label, aggregate, post: three named steps");
  });

  it("looks only at open issues and picks only the exact title, which carries no month", () => {
    assert.ok(script.includes(`TITLE="${ROLLING_TITLE}"`));
    assert.ok(
      script.includes(
        `NUMBER=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --limit 100 --search "\\"$TITLE\\" in:title" --json number,title --jq '${EXACT_ROLLING_FILTER}')`,
      ),
    );
    assert.ok(!script.includes("$(date"), "the title is the same every month");
    assert.ok(!learnYml.includes(`${ROLLING_TITLE}:`), "the older one-issue-a-month title is gone");
  });

  it("comments on that issue or opens it, and does nothing else to any issue", () => {
    assert.deepEqual(script.match(/gh [a-z]+ [a-z]+/g), ["gh issue list", "gh issue comment", "gh issue create", "gh issue create"]);
    assert.ok(script.includes('gh issue comment "$NUMBER" --repo "$GITHUB_REPOSITORY" --body-file learning-report.md'));
    assert.ok(script.includes('gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body-file learning-report.md --label learning || \\'));
    assert.ok(script.includes('  gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body-file learning-report.md\n'));
    assert.ok(step.includes("          GH_TOKEN: ${{ github.token }}"));
    assert.doesNotMatch(learnYml, /gh issue (close|reopen|delete|edit|lock|transfer|pin)|gh pr |gh api /);
  });

  it("adds a comment to the open rolling issue, and leaves the older monthly issues alone", () => {
    const { status, calls } = runStep(POST_STEP, {
      openIssues: [
        { number: 123, title: "Learning report: 2026-11" },
        { number: 22, title: "Learning report: 2026-10" },
        { number: 300, title: ROLLING_TITLE },
      ],
    });
    assert.equal(status, 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].slice(0, 9), ["issue", "list", "--repo", "mtangoz/grill", "--state", "open", "--limit", "100", "--search"]);
    assert.equal(calls[0][9], `"${ROLLING_TITLE}" in:title`);
    assert.deepEqual(calls[1], ["issue", "comment", "300", "--repo", "mtangoz/grill", "--body-file", "learning-report.md"]);
  });

  it("opens the rolling issue when only the older monthly issues are open, and comments on neither", () => {
    const { status, calls } = runStep(POST_STEP, {
      openIssues: [
        { number: 123, title: "Learning report: 2026-11" },
        { number: 22, title: "Learning report: 2026-10" },
      ],
    });
    assert.equal(status, 0);
    assert.deepEqual(calls.map((call) => call.slice(0, 2).join(" ")), ["issue list", "issue create"]);
    assert.deepEqual(calls[1], ["issue", "create", "--repo", "mtangoz/grill", "--title", ROLLING_TITLE, "--body-file", "learning-report.md", "--label", "learning"]);
  });

  it("still opens the issue, without the label, when the label is missing", () => {
    const { status, calls } = runStep(POST_STEP, { labelMissing: true });
    assert.equal(status, 0);
    assert.deepEqual(calls.map((call) => call.slice(0, 2).join(" ")), ["issue list", "issue create", "issue create"]);
    assert.ok(calls[1].includes("--label"));
    assert.deepEqual(calls[2], ["issue", "create", "--repo", "mtangoz/grill", "--title", ROLLING_TITLE, "--body-file", "learning-report.md"]);
  });

  it("posts nothing when it cannot read the open issues", () => {
    // The stand-in refuses a list call whose filter is not the one it expects, as a failed call would.
    const { status, calls } = runStep(POST_STEP, { expectJq: "another filter" });
    assert.notEqual(status, 0);
    assert.deepEqual(calls.map((call) => call.slice(0, 2).join(" ")), ["issue list"]);
  });
});
