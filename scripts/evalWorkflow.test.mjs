// Text pins for .github/workflows/eval.yml, the weekly judge self-eval.
//
// The workflow spends money when it runs and decides when an alarm issue opens and closes,
// and no test read it before this one. These pins hold three things in place: which pull
// requests start a paid run, that the weekly and manual runs must measure, and that the step
// which closes the "not measuring" issue touches that issue only, on a run that measured.
//
// The file is read as text. There is no YAML parser here and none is needed: each pin is a
// line or a block that must be present as written. The close step is also run for real,
// through bash, against a stand-in `gh` that records what it was asked to do.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const yml = readFileSync(join(ROOT, ".github", "workflows", "eval.yml"), "utf8");
const lines = yml.split("\n");

const NOT_MEASURING = "Judge self-eval is not measuring";
const BELOW_THRESHOLD = "Judge quality below threshold";
const CLOSE_STEP = "On a weekly or manual run that measured, close the open not-measuring issue";
const OPEN_STEP = "On a scheduled failure, open or update ONE issue";
const EXACT_TITLE_FILTER = `[.[] | select(.title == "${NOT_MEASURING}")][0].number // empty`;

/** The lines of the step with this name, up to the next step. */
function stepLines(name) {
  const from = lines.indexOf(`      - name: ${name}`);
  assert.ok(from >= 0, `eval.yml has a step named "${name}"`);
  let to = from + 1;
  // A step item starts at six spaces. A comment above the next step belongs to that step.
  while (to < lines.length && !/^ {6}(- |# )/.test(lines[to])) to += 1;
  return lines.slice(from, to);
}

/** The shell script of a step: the block under `run: |`, with its indentation removed. */
function runScript(name) {
  const body = stepLines(name);
  const at = body.indexOf("        run: |");
  assert.ok(at >= 0, `the step "${name}" has a run block`);
  return body
    .slice(at + 1)
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
}

describe("eval.yml: when the judge self-eval runs", () => {
  it("a pull request starts the paid eval only for the judge files, a case or the thresholds", () => {
    const at = lines.indexOf("  pull_request:");
    assert.ok(at >= 0);
    assert.equal(lines[at + 1], "    paths:");
    const paths = [];
    for (let i = at + 2; lines[i].startsWith("      - "); i += 1) paths.push(lines[i].slice("      - ".length));
    assert.deepEqual(paths, ["scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "evals/cases/**", "evals/thresholds.json"]);
    assert.ok(!yml.includes("evals/**"), "the whole evals folder is no longer a trigger");
  });

  it("runs every Monday and by hand, and never as pull_request_target", () => {
    assert.ok(yml.includes('  schedule:\n    - cron: "0 13 * * 1"\n'));
    assert.ok(lines.includes("  workflow_dispatch:"));
    assert.ok(!yml.includes("pull_request_target"));
  });

  it("the weekly and manual runs must measure: they pass --require-key, and a pull request does not", () => {
    const script = runScript("Run the judge self-eval");
    assert.ok(script.includes('if [ "$EVENT" = "pull_request" ]; then node scripts/eval.mjs; else node scripts/eval.mjs --require-key; fi'));
    assert.equal(script.match(/node scripts\/eval\.mjs/g).length, 2, "the eval is called in that one line only");
    assert.ok(stepLines("Run the judge self-eval").includes("          EVENT: ${{ github.event_name }}"));
    // The exit code is kept for the issue step, and the step still fails with it.
    assert.ok(script.includes('echo "code=$code" >> "$GITHUB_OUTPUT"'));
    assert.ok(script.includes("exit $code"));
  });
});

describe("eval.yml: its shape", () => {
  it("keeps least privilege: read the code, write issues, nothing else", () => {
    assert.ok(yml.includes("\npermissions:\n  contents: read\n  issues: write\n\njobs:\n"));
    assert.equal(yml.match(/^\s*permissions:/gm).length, 1, "one permissions block, at the top");
    assert.doesNotMatch(yml, /contents: write|pull-requests: write|id-token|write-all/);
  });

  it("keeps the runner, the timeout and the action versions", () => {
    assert.ok(lines.includes("    runs-on: ubuntu-latest"));
    assert.ok(lines.includes("    timeout-minutes: 30"));
    const uses = lines.filter((line) => /^\s*(- )?uses: /.test(line)).map((line) => line.trim().replace(/^- /, ""));
    assert.deepEqual(uses, ["uses: actions/checkout@v4", "uses: actions/setup-node@v4", "uses: actions/upload-artifact@v4"]);
    assert.ok(lines.includes("          node-version: 22"));
  });

  it("reads one secret, the router key, and hands it to the eval step only", () => {
    assert.deepEqual([...new Set(yml.match(/secrets\.[A-Za-z0-9_]+/g))], ["secrets.OPENROUTER_API_KEY"]);
    assert.equal(yml.match(/secrets\.OPENROUTER_API_KEY/g).length, 1);
    assert.ok(stepLines("Run the judge self-eval").includes("          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}"));
  });

  it("uploads the results folder, where the counts-only block is written", () => {
    const upload = stepLines("Upload results");
    assert.ok(upload.includes("        if: always()"));
    assert.ok(upload.includes("          path: evals/results"));
    assert.ok(upload.includes("          if-no-files-found: ignore"));
  });
});

describe("eval.yml: the alarm issue opens on a failed weekly run", () => {
  it("opens or updates one issue, on a scheduled failure only", () => {
    const step = stepLines(OPEN_STEP);
    assert.ok(step.includes("        if: failure() && github.event_name == 'schedule'"));
    const script = runScript(OPEN_STEP);
    assert.ok(script.includes('EXISTING=$(gh issue list --repo "$GITHUB_REPOSITORY" --search "$TITLE in:title" --state open --json number --jq \'.[0].number\')'));
    assert.ok(script.includes('gh issue comment "$EXISTING" --repo "$GITHUB_REPOSITORY" --body "$BODY"'));
    assert.ok(script.includes('gh issue create --repo "$GITHUB_REPOSITORY" --title "$TITLE" --body "$BODY"'));
  });

  it("exit 2 is not measuring; any other failure is quality below threshold", () => {
    const script = runScript(OPEN_STEP);
    const notMeasuring = script.indexOf(`TITLE="${NOT_MEASURING}"`);
    const below = script.indexOf(`TITLE="${BELOW_THRESHOLD}"`);
    assert.ok(script.indexOf('if [ "$CODE" = "2" ]; then') >= 0);
    assert.ok(script.indexOf('if [ "$CODE" = "2" ]; then') < notMeasuring && notMeasuring < script.indexOf("\nelse\n") && script.indexOf("\nelse\n") < below);
    assert.ok(stepLines(OPEN_STEP).includes("          CODE: ${{ steps.eval.outputs.code }}"));
    // The not-measuring body names both causes, since a dead key lands here too.
    assert.match(script, /no case reached a judge\. Nothing was measured\./);
    assert.match(script, /no OPENROUTER_API_KEY secret, or the key is dead or out of credit/);
  });
});

describe("eval.yml: the not-measuring issue closes on a run that measured", () => {
  const step = stepLines(CLOSE_STEP);
  const script = runScript(CLOSE_STEP);

  it("runs on a weekly or manual run that reached a judge, and never on a pull request", () => {
    assert.ok(
      step.includes(
        "        if: always() && (github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') && steps.eval.outputs.reached_judge != '' && steps.eval.outputs.reached_judge != '0'",
      ),
    );
    assert.ok(!step.join("\n").includes("pull_request"));
    assert.equal(lines.indexOf(`      - name: ${CLOSE_STEP}`), lines.lastIndexOf(`      - name: ${CLOSE_STEP}`));
  });

  it("the count it reads is the one eval.mjs writes to the step outputs", () => {
    assert.ok(stepLines("Run the judge self-eval").includes("        id: eval"));
    assert.ok(step.includes("          REACHED: ${{ steps.eval.outputs.reached_judge }}"));
    const cli = readFileSync(join(ROOT, "scripts", "eval.mjs"), "utf8");
    assert.ok(cli.includes('appendTo("GITHUB_OUTPUT", `reached_judge=${reached}\\n`);'));
  });

  it("uses gh with the workflow's own token", () => {
    assert.ok(step.includes("          GH_TOKEN: ${{ github.token }}"));
    assert.doesNotMatch(step.join("\n"), /secrets\./);
  });

  it("looks only at open issues and picks only the exact title", () => {
    assert.ok(script.includes(`TITLE="${NOT_MEASURING}"`));
    assert.ok(
      script.includes(
        `NUMBER=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --search "\\"$TITLE\\" in:title" --json number,title --jq '${EXACT_TITLE_FILTER}')`,
      ),
    );
  });

  it("closes that one issue with a comment, and does nothing else to any issue", () => {
    assert.ok(script.includes('if [ -n "$NUMBER" ]; then'));
    assert.ok(script.includes('gh issue close "$NUMBER" --repo "$GITHUB_REPOSITORY" --reason completed --comment "Measuring again on $(date -u +%F). Cases that reached a judge: $REACHED.'));
    assert.deepEqual(script.match(/gh [a-z]+ [a-z]+/g), ["gh issue list", "gh issue close"]);
    assert.equal(yml.match(/gh issue close/g).length, 1, "nothing else in the workflow closes an issue");
    assert.doesNotMatch(yml, /gh issue (delete|edit|lock|transfer|pin)|gh pr |gh api /);
  });
});

// ---------------------------------------------------------------------------
// The close step, run for real through bash. `gh` is a stand-in that records each call. It
// answers "issue list" the way the pinned filter would, and refuses any other filter, so a
// change to the filter has to come back through the text pin above.
const GH_STUB = `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
appendFileSync(process.env.GH_STUB_LOG, JSON.stringify(args) + "\\n");
const flag = (name) => args[args.indexOf(name) + 1];
if (args[0] === "issue" && args[1] === "list") {
  if (flag("--state") !== "open" || flag("--json") !== "number,title" || flag("--jq") !== process.env.GH_EXPECT_JQ) {
    process.stderr.write("unexpected gh issue list arguments\\n");
    process.exit(1);
  }
  const hit = JSON.parse(process.env.GH_OPEN_ISSUES).find((issue) => issue.title === process.env.GH_EXACT_TITLE);
  if (hit) process.stdout.write(String(hit.number) + "\\n");
  process.exit(0);
}
if (args[0] === "issue" && args[1] === "close") process.exit(0);
process.stderr.write("unexpected gh " + args.join(" ") + "\\n");
process.exit(1);
`;

function runCloseStep(openIssues) {
  const dir = mkdtempSync(join(tmpdir(), "eval-workflow-"));
  const bin = join(dir, "bin");
  const log = join(dir, "calls.jsonl");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), GH_STUB);
  chmodSync(join(bin, "gh"), 0o755);
  writeFileSync(log, "");
  // GitHub fills in the expressions before the shell sees the script.
  const script = runScript(CLOSE_STEP)
    .replaceAll("${{ github.server_url }}", "https://github.com")
    .replaceAll("${{ github.repository }}", "mtangoz/grill")
    .replaceAll("${{ github.run_id }}", "43354935479");
  assert.ok(!script.includes("${{"), "every expression in the script was filled in");
  const scriptPath = join(dir, "close.sh");
  writeFileSync(scriptPath, script);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GH_STUB_LOG: log,
    GH_OPEN_ISSUES: JSON.stringify(openIssues),
    GH_EXPECT_JQ: EXACT_TITLE_FILTER,
    GH_EXACT_TITLE: NOT_MEASURING,
    GH_TOKEN: "test-token",
    GITHUB_REPOSITORY: "mtangoz/grill",
    REACHED: "29",
  };
  let status = 0;
  try {
    execFileSync("bash", [scriptPath], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    status = err.status ?? 1;
  }
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  rmSync(dir, { recursive: true, force: true });
  return { status, calls };
}

describe("eval.yml: the close step, run against a stand-in gh", () => {
  it("closes the open issue with the exact title, once, with the run link in the comment", () => {
    const { status, calls } = runCloseStep([
      { number: 201, title: `${NOT_MEASURING}, a second report` },
      { number: 134, title: NOT_MEASURING },
    ]);
    assert.equal(status, 0);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].slice(0, 7), ["issue", "list", "--repo", "mtangoz/grill", "--state", "open", "--search"]);
    assert.equal(calls[0][7], `"${NOT_MEASURING}" in:title`);
    const close = calls[1];
    assert.deepEqual(close.slice(0, 7), ["issue", "close", "134", "--repo", "mtangoz/grill", "--reason", "completed"]);
    assert.equal(close[7], "--comment");
    assert.match(close[8], /^Measuring again on \d{4}-\d{2}-\d{2}\. Cases that reached a judge: 29\.\n\nRun: https:\/\/github\.com\/mtangoz\/grill\/actions\/runs\/43354935479$/);
    assert.equal(close.length, 9);
  });

  it("closes nothing when the only open issues have other titles, or there are none", () => {
    for (const open of [[{ number: 201, title: `Why the ${NOT_MEASURING}` }, { number: 7, title: BELOW_THRESHOLD }], []]) {
      const { status, calls } = runCloseStep(open);
      assert.equal(status, 0);
      assert.deepEqual(calls.map((call) => call.slice(0, 2).join(" ")), ["issue list"]);
    }
  });
});
