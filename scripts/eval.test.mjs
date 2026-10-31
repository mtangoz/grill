// End-to-end tests for eval.mjs, the self-eval CLI. node:test + node:assert only, no
// dependencies. The fixture-driven run replays a saved OpenRouter response via JUDGE_FIXTURE
// (same mechanism scripts/judge.test.mjs uses), so nothing here reaches the real network, no
// real API key is required, and no real OpenRouter judge is ever actually called.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "eval.mjs");
const FIXTURES = join(HERE, "fixtures");
const CASES_DIR = join(HERE, "..", "evals", "cases");

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** A clean environment: real process.env (so PATH/node resolve) minus every var these CLIs read. */
function envFor(overrides = {}) {
  const env = { ...process.env };
  for (const k of [
    "GRILL_API_KEY",
    "OPENROUTER_API_KEY",
    "JUDGE_FIXTURE",
    "JUDGE_MODEL",
    "JUDGE_TIMEOUT_MS",
    "JUDGE_OPENROUTER_URL",
    "JUDGE_CHECK",
    "JUDGE_DECISIONS_URL",
    "GITHUB_STEP_SUMMARY",
  ]) {
    delete env[k];
  }
  // Never the developer's real key file: point at one that does not exist.
  return { ...env, GRILL_KEY_FILE: join(tmpdir(), "grill-tests-no-key-file", "key"), ...overrides };
}

/** A temp dir holding copies of exactly the two named cases from evals/cases/. */
function tempCasesDir(...ids) {
  const dir = mkdtempSync(join(tmpdir(), "eval-cases-"));
  for (const id of ids) {
    writeFileSync(join(dir, `${id}.json`), readFileSync(join(CASES_DIR, `${id}.json`), "utf8"));
  }
  return dir;
}

// ---------------------------------------------------------------------------
describe("eval.mjs over a temp copy of 2 cases, replaying a fixture", () => {
  // usable-response.json always returns verdict "weak" with one moderate challenge. Both
  // cases below are SOUND (expect.verdict_in excludes "weak"), so this is a deterministic
  // false alarm on both — chosen specifically so this test does not depend on any
  // must_target substring-matching behaviour, only on the CLI's plumbing.
  const dir = tempCasesDir("sound-ab-test-pricing-page", "sound-vendor-pilot-before-commit");
  // Results go to their own dir: a results file left among the cases would be read as a case.
  const outDir = mkdtempSync(join(tmpdir(), "eval-out-"));

  it("writes a results file with both scores and a summary, and exits 1 on the resulting false-alarm regression", async () => {
    const outPath = join(outDir, "out.json");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });

    const { code, stdout } = await runCli(["--cases", dir, "--out", outPath, "--concurrency", "2"], env);

    assert.equal(code, 1, "both sound cases score a false alarm against thresholds.json's 0.34 ceiling");

    assert.ok(existsSync(outPath), "the output file must exist");
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(written.scores.length, 2);
    assert.deepEqual(
      written.scores.map((s) => s.id).sort(),
      ["sound-ab-test-pricing-page", "sound-vendor-pilot-before-commit"],
    );
    for (const s of written.scores) {
      assert.equal(s.kind, "sound");
      assert.equal(s.verdict, "weak");
      assert.equal(s.falseAlarm, true);
      assert.equal(typeof s.latencyMs, "number");
    }
    assert.equal(written.summary.metrics.n, 2);
    assert.equal(written.summary.metrics.falseAlarmRate, 1);
    assert.ok(written.summary.regressions.some((r) => r.startsWith("falseAlarmRate")));

    // The same markdown is printed to stdout.
    assert.match(stdout, /# Grill self-eval results/);
    assert.match(stdout, /## Threshold regressions/);
    assert.match(stdout, /falseAlarmRate/);
  });

  it("appends the same markdown to $GITHUB_STEP_SUMMARY when it is set", async () => {
    const outPath = join(outDir, "out-summary.json");
    const summaryPath = join(outDir, "step-summary.md");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json"), GITHUB_STEP_SUMMARY: summaryPath });

    const { code } = await runCli(["--cases", dir, "--out", outPath], env);

    assert.equal(code, 1);
    assert.ok(existsSync(summaryPath));
    const summaryFile = readFileSync(summaryPath, "utf8");
    assert.match(summaryFile, /# Grill self-eval results/);
  });

  it("creates the --out directory when it does not already exist", async () => {
    const nestedOut = join(outDir, "nested", "deeper", "out.json");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });

    const { code } = await runCli(["--cases", dir, "--out", nestedOut], env);

    assert.equal(code, 1);
    assert.ok(existsSync(nestedOut));
  });
});

// ---------------------------------------------------------------------------
describe("the skip path — no OPENROUTER_API_KEY and no JUDGE_FIXTURE", () => {
  it("prints the notice and exits 0 without touching the cases directory", async () => {
    const outPath = join(mkdtempSync(join(tmpdir(), "eval-skip-")), "out.json");
    const { code, stdout } = await runCli(["--out", outPath], envFor({}));

    assert.equal(code, 0);
    assert.match(stdout, /::notice::no OPENROUTER_API_KEY; eval skipped/);
    assert.ok(!existsSync(outPath), "the skip path must not run any case or write a results file");
  });

  it("with --require-key, exits 2 and says nothing was measured, without running a case", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-require-"));
    const outPath = join(dir, "out.json");
    const summary = join(dir, "summary.md");
    const { code, stdout } = await runCli(["--require-key", "--out", outPath], envFor({ GITHUB_STEP_SUMMARY: summary }));

    assert.equal(code, 2);
    assert.match(stdout, /::error::Not measured: no OPENROUTER_API_KEY/);
    assert.ok(!stdout.includes("eval skipped"), "a required run must not read as a skip");
    assert.ok(!existsSync(outPath));
    assert.match(readFileSync(summary, "utf8"), /Not measured/);
  });

  it("with --require-key and JUDGE_FIXTURE, runs as usual", async () => {
    const oneCase = tempCasesDir("sound-ab-test-pricing-page");
    const outPath = join(oneCase, "out.json");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });

    const { code } = await runCli(["--require-key", "--cases", oneCase, "--out", outPath], env);

    assert.notEqual(code, 2);
    assert.ok(existsSync(outPath));
  });

  it("is NOT skipped when JUDGE_FIXTURE is set, even with no OPENROUTER_API_KEY", async () => {
    const oneCase = tempCasesDir("sound-ab-test-pricing-page");
    const outPath = join(oneCase, "out.json");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });

    const { stdout } = await runCli(["--cases", oneCase, "--out", outPath], env);

    assert.ok(!stdout.includes("eval skipped"));
    assert.ok(existsSync(outPath));
  });
});

// ---------------------------------------------------------------------------
describe("argument and input handling", () => {
  it("fails clearly when --cases points at a directory that does not exist", async () => {
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });
    const { code, stderr } = await runCli(["--cases", "/no/such/directory/here"], env);
    assert.equal(code, 1);
    assert.match(stderr, /no such cases directory/);
  });

  it("rejects an unknown flag", async () => {
    const { code, stderr } = await runCli(["--bogus"], envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") }));
    assert.equal(code, 1);
    assert.match(stderr, /unknown argument/);
  });

  it("rejects a non-positive-integer --concurrency", async () => {
    const { code, stderr } = await runCli(["--concurrency", "0"], envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") }));
    assert.equal(code, 1);
    assert.match(stderr, /--concurrency must be a positive integer/);
  });
});

// ---------------------------------------------------------------------------
describe("the quality check in the eval loop", () => {
  it("always asks for it; under a fixture it sends nothing, so its rows read n/a", async () => {
    const oneCase = tempCasesDir("sound-ab-test-pricing-page");
    const outPath = join(oneCase, "out.json");
    const { stdout } = await runCli(["--cases", oneCase, "--out", outPath], envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") }));

    assert.match(stdout, /## Quality \(informational, not gated\)/);
    assert.match(stdout, /\| Falsifiers scored concrete and cheap \(Jev\) \| n\/a \|/);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(written.scores[0].quality, null, "the fixture run's check did not run");
    assert.deepEqual(written.scores[0].grounding, { checked: 1, found: 0 }, "the local quote check still ran");
  });

  it("sends each flawed case's planted flaw to Jev, scores the semantic catch, and leaves the gate to the phrase match", async () => {
    const id = "hidden-assumption-annual-billing";
    const caseDef = JSON.parse(readFileSync(join(CASES_DIR, `${id}.json`), "utf8"));
    const dir = tempCasesDir(id, "sound-ab-test-pricing-page");
    const outPath = join(dir, "out.json");
    const fake = await startFakeOpenRouter();

    const { code, stdout } = await runCli(
      ["--cases", dir, "--out", outPath, "--concurrency", "1"],
      envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env }),
    );
    await fake.close();

    assert.equal(fake.seen.chat.length, 2);
    assert.equal(fake.seen.decisions.length, 2, "--check on every case");
    const flawed = fake.seen.decisions.find((d) => d.body.state.write_up === caseDef.subject);
    const sound = fake.seen.decisions.find((d) => d.body.state.write_up !== caseDef.subject);
    assert.ok(flawed, "the flawed case's subject reached the check verbatim (it holds nothing to mask)");
    assert.equal(
      flawed.body.questions.catches_planted_flaw.instructions,
      `Does any challenge identify this specific flaw: ${caseDef.why.replace(/\.$/, "")}?`,
    );
    assert.equal(sound.body.questions.catches_planted_flaw, undefined, "a sound case has no planted flaw to ask about");

    const written = JSON.parse(readFileSync(outPath, "utf8"));
    const flawedScore = written.scores.find((s) => s.id === id);
    // usable-response.json quotes none of this case's must_target phrases: a phrase-match miss
    // that Jev (answering 0.9 here) scores as a semantic catch. The gate still reads the miss.
    assert.equal(flawedScore.caught, false);
    assert.equal(flawedScore.semanticCaught, true);
    assert.equal(written.summary.metrics.semanticCatchRate, 1);
    assert.equal(written.summary.metrics.catchRate, 0);
    assert.ok(written.summary.regressions.some((r) => r.startsWith("catchRate")));
    assert.equal(code, 1, "the phrase-match gate still decides the exit code");
    assert.match(stdout, /Planted flaw identified, semantic \(Jev\) \| 1\.00 \| 1 of 1 flawed\/loaded cases scored; phrase match caught 0 of the same 1/);
  });
});

// ---------------------------------------------------------------------------
describe("a held-out set stays private", () => {
  const REPO = join(HERE, "..");
  /** A temp dir outside the repo with one public case re-marked as a held-out case under a new id. */
  function heldOutDir(parent = tmpdir()) {
    const dir = mkdtempSync(join(parent, "eval-held-out-"));
    const c = JSON.parse(readFileSync(join(CASES_DIR, "hidden-assumption-annual-billing.json"), "utf8"));
    const held = { ...c, id: "private-held-out-case", heldOut: true };
    writeFileSync(join(dir, `${held.id}.json`), JSON.stringify(held));
    return dir;
  }
  const fixtureEnv = (extra = {}) => envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json"), ...extra });

  it("prints and posts rates only, and keeps the full scores in the results file outside the repo", async () => {
    const dir = heldOutDir();
    const outPath = join(mkdtempSync(join(tmpdir(), "eval-held-out-results-")), "results.json");
    const summaryPath = join(dir, "step-summary.md");
    const { code, stdout, stderr } = await runCli(["--cases", dir, "--out", outPath], fixtureEnv({ GITHUB_STEP_SUMMARY: summaryPath }));

    assert.equal(code, 1, "the one flawed case is a phrase-match miss under this fixture");
    for (const text of [stdout, stderr, readFileSync(summaryPath, "utf8")]) {
      assert.ok(!text.includes("private-held-out-case"), "no case id is printed or posted");
      assert.ok(!text.includes("commit annually without complaint"), "no expect phrase is printed or posted");
    }
    assert.match(stdout, /# Grill self-eval results \(held-out set\)/);
    assert.match(stdout, /1 of 1 cases failed/);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    assert.equal(written.scores[0].id, "private-held-out-case", "the private results file keeps the detail");
  });

  it("refuses to write a held-out run's results inside the repo, the default included", async () => {
    const dir = heldOutDir();
    const inside = join(REPO, "evals", "results", "held-out-should-not-exist.json");
    for (const args of [["--cases", dir], ["--cases", dir, "--out", inside]]) {
      const { code, stderr } = await runCli(args, fixtureEnv());
      assert.equal(code, 1, args.join(" "));
      assert.match(stderr, /writes its results outside this repository/);
    }
    assert.ok(!existsSync(inside));
  });

  it("refuses held-out cases that sit inside the repo", async () => {
    const scratch = join(REPO, "evals", "results");
    mkdirSync(scratch, { recursive: true });
    const dir = heldOutDir(scratch);
    try {
      const outPath = join(mkdtempSync(join(tmpdir(), "eval-held-out-results-")), "results.json");
      const { code, stderr } = await runCli(["--cases", dir, "--out", outPath], fixtureEnv());
      assert.equal(code, 1);
      assert.match(stderr, /held-out cases never live inside this repository/);
      assert.ok(!existsSync(outPath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stops before any judge call when a case file is malformed, naming the problem", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-bad-case-"));
    const c = JSON.parse(readFileSync(join(CASES_DIR, "hidden-assumption-annual-billing.json"), "utf8"));
    writeFileSync(join(dir, `${c.id}.json`), JSON.stringify({ ...c, expect: { must_target: ["nowhere in the subject"], verdict_not: ["holds"] } }));
    const outPath = join(dir, "out.json");
    const { code, stderr } = await runCli(["--cases", dir, "--out", outPath], fixtureEnv());
    assert.equal(code, 1);
    assert.match(stderr, /is malformed: "nowhere in the subject" not found in subject/);
    assert.ok(!existsSync(outPath));
  });
});
