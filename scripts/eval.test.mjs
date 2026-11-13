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
import { JUDGE_COMMIT_RULE } from "./judgeCore.mjs";
import { isIsoDate, validateRegressionRun } from "./resultsCore.mjs";

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
    "GRILL_JUDGE_COMMIT",
    // In CI these are set for the job that runs this test. A child that inherited them would
    // write its count to the real step outputs and a public block beside every --out.
    "GITHUB_OUTPUT",
    "GITHUB_RUN_ID",
    "GITHUB_SHA",
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
  it("prints SKIPPED and exits 0 without a score when there is no key", async () => {
    const outPath = join(mkdtempSync(join(tmpdir(), "eval-skip-")), "out.json");
    const { code, stdout } = await runCli(["--out", outPath], envFor({}));

    assert.equal(code, 0);
    assert.match(stdout, /SKIPPED: no judge ran/);
    assert.doesNotMatch(stdout, /PASS|Catch rate|catchRate/);
    assert.ok(!existsSync(outPath), "the skip path must not run any case or write a results file");
  });

  it("with --require-key, exits 2 and says nothing was measured, without running a case", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-require-"));
    const outPath = join(dir, "out.json");
    const summary = join(dir, "summary.md");
    const { code, stdout } = await runCli(["--require-key", "--out", outPath], envFor({ GITHUB_STEP_SUMMARY: summary }));

    assert.equal(code, 2);
    assert.match(stdout, /SKIPPED: no judge ran/);
    assert.match(stdout, /::error::Not measured: no OPENROUTER_API_KEY/);
    assert.doesNotMatch(stdout, /PASS|Catch rate|catchRate/);
    assert.ok(!existsSync(outPath));
    assert.match(readFileSync(summary, "utf8"), /Not measured/);
    assert.doesNotMatch(readFileSync(summary, "utf8"), /PASS|Catch rate/);
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

    assert.ok(!stdout.includes("SKIPPED: no judge ran"));
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

// ---------------------------------------------------------------------------
describe("the key is found the way the judge finds it", () => {
  it("a key in GRILL_API_KEY or in the key file counts as a key, so the run is not skipped", async () => {
    for (const where of ["GRILL_API_KEY", "the key file"]) {
      const fake = await startFakeOpenRouter();
      const dir = tempCasesDir("sound-ab-test-pricing-page");
      const outPath = join(mkdtempSync(join(tmpdir(), "eval-key-out-")), "out.json");
      const keyFile = join(mkdtempSync(join(tmpdir(), "eval-key-")), "key");
      if (where === "the key file") writeFileSync(keyFile, "test-key-loopback-only\n", { mode: 0o600 });
      const key = where === "GRILL_API_KEY" ? { GRILL_API_KEY: "test-key-loopback-only" } : { GRILL_KEY_FILE: keyFile };

      const { code, stdout } = await runCli(["--require-key", "--cases", dir, "--out", outPath], envFor({ ...fake.env, ...key }));
      await fake.close();

      assert.ok(!stdout.includes("SKIPPED: no judge ran"), where);
      assert.notEqual(code, 2, where);
      assert.equal(fake.seen.chat.length, 1, `${where}: the case reached the judge`);
      assert.equal(fake.seen.chat[0].headers.authorization, "Bearer test-key-loopback-only", where);
      assert.ok(existsSync(outPath), where);
    }
  });
});

// ---------------------------------------------------------------------------
describe("not measured is never reported as a score", () => {
  const SCORE_WORDS = /PASS|FAIL|Catch rate|False alarm|catchRate|falseAlarmRate|Threshold regressions|Failed cases|# Grill self-eval results/;
  const NOT_MEASURED = "Not measured: 0 of 2 cases reached a judge.";
  const twoCases = () => tempCasesDir("hidden-assumption-annual-billing", "sound-ab-test-pricing-page");

  it("when no case returns a verdict, exits 2 with the not-measured line and no score, with or without --require-key", async () => {
    for (const flags of [[], ["--require-key"]]) {
      const outDir = mkdtempSync(join(tmpdir(), "eval-not-measured-"));
      const outPath = join(outDir, "latest.json");
      const summary = join(outDir, "summary.md");
      const output = join(outDir, "output.txt");
      const env = envFor({
        JUDGE_FIXTURE: join(FIXTURES, "no-tool-call-response.json"),
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_OUTPUT: output,
        GITHUB_RUN_ID: "4242",
        GITHUB_SHA: "a".repeat(40),
      });

      const { code, stdout, stderr } = await runCli([...flags, "--cases", twoCases(), "--out", outPath], env);

      assert.equal(code, 2, "exit 2 is not measured; exit 1 would read as quality below threshold");
      assert.ok(stdout.split("\n").includes(NOT_MEASURED), "the line stands on its own");
      assert.ok(stdout.split("\n").includes(`::error::${NOT_MEASURED}`), "and is an annotation in Actions");
      assert.doesNotMatch(stdout, SCORE_WORDS);
      assert.doesNotMatch(stdout, /SKIPPED/, "cases ran; this is not the no-key skip");
      const posted = readFileSync(summary, "utf8");
      assert.ok(posted.includes(NOT_MEASURED));
      assert.doesNotMatch(posted, SCORE_WORDS);
      assert.ok(!existsSync(outPath), "no results file: there is no result");
      assert.ok(!existsSync(join(outDir, "latest.public.json")), "and no public block");
      assert.equal(readFileSync(output, "utf8"), "reached_judge=0\n", "the workflow can see that nothing was measured");
      assert.equal(stderr.match(/the judge returned no verdict/g)?.length, 2, "one line per case says why");
    }
  });

  it("a key the router rejects, or one that is out of credit, is not measured rather than a failed threshold", async () => {
    for (const status of [401, 402]) {
      const fake = await startFakeOpenRouter({ chat: () => ({ status, text: JSON.stringify({ error: { message: "refused", code: status } }) }) });
      const outDir = mkdtempSync(join(tmpdir(), "eval-dead-key-"));
      const outPath = join(outDir, "latest.json");
      const summary = join(outDir, "summary.md");
      const env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env, GITHUB_STEP_SUMMARY: summary });

      const { code, stdout, stderr } = await runCli(["--require-key", "--cases", twoCases(), "--out", outPath], env);
      await fake.close();

      assert.equal(fake.seen.chat.length, 2, "both cases were sent");
      assert.equal(fake.seen.decisions.length, 0, "no verdict, so nothing went to the quality check");
      assert.equal(code, 2, String(status));
      assert.ok(stdout.split("\n").includes(NOT_MEASURED));
      assert.doesNotMatch(stdout, SCORE_WORDS);
      assert.match(stderr, new RegExp(`the judge returned no verdict \\(the router answered ${status}\\)`));
      assert.ok(!stderr.includes("refused"), "the response body is not echoed, only its status");
      const posted = readFileSync(summary, "utf8");
      assert.ok(posted.includes(`The router answered with status ${status}.`));
      assert.doesNotMatch(posted, SCORE_WORDS);
      assert.ok(!existsSync(outPath));
    }
  });

  it("one verdict is enough to score the run, and the summary says how many cases reached a judge", async () => {
    const usable = readFileSync(join(FIXTURES, "usable-response.json"), "utf8");
    let calls = 0;
    // The first case gets an answer. The key then runs out.
    const fake = await startFakeOpenRouter({
      chat: () => (calls++ === 0 ? { text: usable } : { status: 402, text: JSON.stringify({ error: { message: "refused", code: 402 } }) }),
    });
    const outDir = mkdtempSync(join(tmpdir(), "eval-partial-"));
    const outPath = join(outDir, "latest.json");
    const output = join(outDir, "output.txt");
    const env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env, GITHUB_OUTPUT: output });

    const { code, stdout } = await runCli(["--require-key", "--cases", twoCases(), "--out", outPath, "--concurrency", "1"], env);
    await fake.close();

    assert.equal(code, 1, "a run that reached a judge is scored, and the case with no verdict counts against it");
    assert.match(stdout, /^Reached a judge: 1 of 2 cases\. 1 case got no verdict\. It is scored below as a miss or a false alarm\.$/m);
    assert.match(stdout, /_One run\. Too few cases to compare companies\. 1 case got no verdict and is in no row\._/);
    assert.equal(readFileSync(output, "utf8"), "reached_judge=1\n");
    assert.equal(JSON.parse(readFileSync(outPath, "utf8")).summary.counts.reachedJudge, 1);
  });
});

// ---------------------------------------------------------------------------
describe("the public block: one run as counts only", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const fixtureEnv = (extra = {}) => envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json"), ...extra });
  const twoSound = () => tempCasesDir("sound-ab-test-pricing-page", "sound-vendor-pilot-before-commit");

  it("is written beside the results file, and the written text passes the results validator", async () => {
    // A loopback router answers, so this run asked a judge: one flawed case and one sound case.
    const fake = await startFakeOpenRouter();
    const dir = tempCasesDir("hidden-assumption-annual-billing", "sound-ab-test-pricing-page");
    const outDir = mkdtempSync(join(tmpdir(), "eval-public-"));
    const outPath = join(outDir, "latest.json");
    const output = join(outDir, "output.txt");

    const { code, stdout, stderr } = await runCli(
      ["--cases", dir, "--out", outPath],
      envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env, GITHUB_RUN_ID: "43354935479", GITHUB_SHA: SHA, GITHUB_OUTPUT: output }),
    );
    await fake.close();

    assert.equal(code, 1, "a miss and a false alarm under this answer; the block is written all the same");
    const text = readFileSync(join(outDir, "latest.public.json"), "utf8");
    const { date, ...counts } = validateRegressionRun(JSON.parse(text));
    assert.ok(isIsoDate(date));
    assert.ok(date <= new Date().toISOString().slice(0, 10));
    assert.deepEqual(counts, {
      run_id: 43354935479,
      commit: "0123456",
      cases: 2,
      reached_judge: 2,
      flawed: { caught: 0, of: 1 },
      wrong_figure: { caught: 0, of: 0 },
      loaded: { caught: 0, of: 0 },
      sound: { false_alarms: 1, of: 1 },
      schema_violations: { k: 0, of: 2 },
      different_company: { k: 2, of: 2 },
      quotes: { found: 0, of: 2 },
      semantic: { caught: 1, of: 1 },
      by_company: [{ company: "openai", cases: 2 }],
    });
    for (const leak of ["hidden-assumption", "sound-ab-test", "gpt-", "weak", "Usd", "latency", "$", "typesafe"]) {
      assert.ok(!text.includes(leak), `the public block holds no ${leak}`);
    }
    assert.match(stderr, /\[eval\] public block written to /);
    // One line names the command that adds these counts to data/results.json, with the file to give it.
    assert.deepEqual(
      stderr.split("\n").filter((line) => line.includes("results.mjs")),
      [`[eval] to publish these counts: node scripts/results.mjs merge-run ${join(outDir, "latest.public.json")}`],
    );
    assert.equal(readFileSync(output, "utf8"), "reached_judge=2\n");

    // The same counts are in the summary a person reads.
    assert.match(stdout, /^Reached a judge: 2 of 2 cases\.$/m);
    assert.match(stdout, /## By judge company \(counts, not gated\)/);
    assert.match(stdout, /^\| openai \| 2 \| 0 of 1 \| 1 of 1 \|$/m);
    assert.match(stdout, /\| False alarm rate \(sound\) \| 1\.00 \| <= 0\.34 \| FAIL \| 1 of 1 \|/);
  });

  it("a replayed fixture writes none: no judge was asked", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "eval-public-fixture-"));
    const outPath = join(outDir, "latest.json");

    const { stderr } = await runCli(["--cases", twoSound(), "--out", outPath], fixtureEnv({ GITHUB_RUN_ID: "43354935479", GITHUB_SHA: SHA }));

    assert.ok(existsSync(outPath), "the results file is still written");
    assert.ok(!existsSync(join(outDir, "latest.public.json")));
    assert.ok(!stderr.includes("merge-run"), "with no block written, no command to publish one is named");
    const said = stderr.split("\n").filter((line) => line.startsWith("[eval] no public block: "));
    assert.equal(said.length, 1);
    assert.match(said[0], /replayed JUDGE_FIXTURE/);
  });

  it("with no Actions run number or commit, writes none and says so in one line", async () => {
    for (const ids of [{}, { GITHUB_RUN_ID: "43354935479" }, { GITHUB_SHA: SHA }, { GITHUB_RUN_ID: "0", GITHUB_SHA: SHA }, { GITHUB_RUN_ID: "43354935479", GITHUB_SHA: "main" }]) {
      const outDir = mkdtempSync(join(tmpdir(), "eval-public-none-"));
      const outPath = join(outDir, "latest.json");

      const { stderr } = await runCli(["--cases", twoSound(), "--out", outPath], fixtureEnv(ids));

      assert.ok(existsSync(outPath), "the results file is still written");
      assert.ok(!existsSync(join(outDir, "latest.public.json")), JSON.stringify(ids));
      const said = stderr.split("\n").filter((line) => line.startsWith("[eval] no public block: "));
      assert.equal(said.length, 1, JSON.stringify(ids));
      assert.match(said[0], /no GitHub Actions run number and commit/);
    }
  });

  it("a held-out run writes none: that block is the record of the public set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-held-out-public-"));
    const c = JSON.parse(readFileSync(join(CASES_DIR, "hidden-assumption-annual-billing.json"), "utf8"));
    writeFileSync(join(dir, "private-held-out-case.json"), JSON.stringify({ ...c, id: "private-held-out-case", heldOut: true }));
    const outDir = mkdtempSync(join(tmpdir(), "eval-held-out-public-results-"));
    const outPath = join(outDir, "results.json");

    const { stdout, stderr } = await runCli(["--cases", dir, "--out", outPath], fixtureEnv({ GITHUB_RUN_ID: "43354935479", GITHUB_SHA: SHA }));

    assert.ok(existsSync(outPath));
    assert.ok(!existsSync(join(outDir, "results.public.json")));
    assert.ok(!stderr.includes("merge-run"), "with no block written, no command to publish one is named");
    assert.equal(stderr.split("\n").filter((line) => line.startsWith("[eval] no public block: ")).length, 1);
    // Counts by company carry no case, so a held-out summary shows them too.
    assert.match(stdout, /^Reached a judge: 1 of 1 cases\.$/m);
    assert.match(stdout, /^\| openai \| 1 \| 0 of 1 \| 0 of 0 \|$/m);
    assert.ok(!stdout.includes("private-held-out-case") && !stderr.includes("private-held-out-case"));
  });
});

// ---------------------------------------------------------------------------
describe("the eval always runs the product path", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const run = async (settings) => {
    const fake = await startFakeOpenRouter();
    const dir = tempCasesDir("hidden-assumption-annual-billing", "sound-ab-test-pricing-page");
    const outDir = mkdtempSync(join(tmpdir(), "eval-product-path-"));
    const result = await runCli(
      ["--require-key", "--cases", dir, "--out", join(outDir, "latest.json")],
      envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env, GITHUB_RUN_ID: "43354935479", GITHUB_SHA: SHA, ...settings }),
    );
    await fake.close();
    return { ...result, fake, outDir };
  };
  const prompts = (fake) => fake.seen.chat.map((call) => JSON.stringify(call.body.messages));

  it("a pinned JUDGE_MODEL in the environment is not passed to the judge, so the public block is never a pinned judge's record", async () => {
    const { fake, outDir, stderr } = await run({ JUDGE_MODEL: "openai/gpt-pinned-for-test" });

    assert.equal(fake.seen.chat.length, 2, "both cases reached the router");
    assert.equal(fake.seen.chat[0].body.model, "openrouter/auto");
    assert.deepEqual([...new Set(fake.seen.chat.map((call) => call.body.model))], ["openrouter/auto"]);
    assert.ok(existsSync(join(outDir, "latest.public.json")), "the block is written, and it records the router's own choice");
    assert.match(stderr, /^\[eval\] JUDGE_MODEL is set and was not passed to the judge: the eval always runs the product path$/m);
  });

  it("GRILL_JUDGE_COMMIT is not passed either, so the candidate rule is never what the weekly number scores", async () => {
    const { fake, stderr } = await run({ GRILL_JUDGE_COMMIT: "1" });

    assert.equal(fake.seen.chat.length, 2);
    for (const prompt of prompts(fake)) assert.ok(!prompt.includes(JSON.stringify(JUDGE_COMMIT_RULE).slice(1, -1)), "the judge got today's instructions");
    assert.match(stderr, /^\[eval\] GRILL_JUDGE_COMMIT is set and was not passed to the judge: the eval always runs the product path$/m);
  });

  it("with neither set, nothing is said about them", async () => {
    const { fake, stderr } = await run({});

    assert.deepEqual([...new Set(fake.seen.chat.map((call) => call.body.model))], ["openrouter/auto"]);
    for (const prompt of prompts(fake)) assert.ok(prompt.includes("You are an independent adversarial judge."), "the prompt is where this test looks for the rule");
    assert.doesNotMatch(stderr, /was not passed to the judge/);
  });
});
