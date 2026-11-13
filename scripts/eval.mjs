#!/usr/bin/env node
/**
 * eval.mjs — the judge's self-improvement measurement loop, CLI half.
 *
 * Runs every synthetic case under evals/cases/ through the real judge CLI (scripts/judge.mjs),
 * scores what comes back with evalCore.scoreCase, rolls the scores up with evalCore.summarize,
 * and renders the result with evalCore.renderSummary. This file owns all the I/O — reading the
 * case files, spawning judge.mjs per case, timing it, writing the results file — and defers
 * every bit of scoring/rendering logic to evalCore.mjs so it can be pinned by a test without a
 * live model.
 *
 * THE PRIVACY RULE THIS LOOP EXISTS UNDER: it must never need a real user's decision. Every
 * case it runs is fictional: the public set is committed under evals/cases/, and a held-out set
 * (cases marked `heldOut: true`, passed with --cases) lives outside this repository.
 *
 * A HELD-OUT RUN keeps its cases private. Its cases must not sit inside this repository, its
 * results file must be written outside it, and what it prints (and appends to the job summary)
 * is rates only, never a case id or phrase. A run counts as held out when any case says so.
 *
 * THE QUALITY CHECK IS ALWAYS ON HERE (`--check`), because these subjects are synthetic and
 * the eval is where the check's numbers are worth collecting. Flawed and loaded cases also
 * pass their `why` as `--check-flaw`, so Jev says whether any challenge identified the planted
 * flaw in other words than the phrases the gate matches. Both are informational: see
 * evalCore.summarize. Under JUDGE_FIXTURE the judge sends nothing, so neither does the check,
 * and those rows read "n/a".
 *
 * USAGE
 *   node scripts/eval.mjs [--cases evals/cases] [--concurrency 4] [--out evals/results/latest.json]
 *                         [--require-key]
 *   node scripts/eval.mjs --cases <held-out dir> --out <path outside this repo>
 *
 *   --require-key   the scheduled and manual runs pass this. With no key and no fixture, the run
 *                   exits 2 and says nothing was measured, instead of a green skip. A skip that
 *                   passes looks the same as a judge that passed, so the weekly loop could stay
 *                   green for weeks without calling a judge once.
 *
 * NOT MEASURED IS NEVER A SCORE. A run with a key can still measure nothing: a dead key, or
 * one that is out of credit, gives no verdict for any case. Scored as usual that would read as
 * every flaw missed, which is a claim about the judge that the run cannot support. So when no
 * case gets a verdict back, the run prints "Not measured: 0 of N cases reached a judge.",
 * writes no results file and no table, and exits 2, with or without --require-key.
 *
 * ALWAYS THE PRODUCT PATH. Each case goes to the judge the way a person's grill does: the
 * default Auto Router and today's instructions. JUDGE_MODEL (a pinned judge) and
 * GRILL_JUDGE_COMMIT (the candidate rule) are removed from the judge's environment, so a run
 * with either set still scores, and records, the judge people use. It says so in one line.
 *
 * THE PUBLIC BLOCK. Beside the results file (latest.json gives latest.public.json) a measured
 * run also writes its counts in the shape data/results.json keeps under regression.runs: whole
 * numbers, the date, the Actions run number, a short commit hash and judge company ids. No
 * case id, no model name, no cost. The written text is checked with
 * resultsCore.validateRegressionRun first. A run with no Actions run number or commit cannot
 * make a valid block, so it writes none and prints one line saying so. A held-out run writes
 * none either: that block is the record of the public set. Nor does a run that replays
 * JUDGE_FIXTURE: no judge was asked, so there is nothing to record.
 *
 * ENVIRONMENT
 *   GRILL_API_KEY / OPENROUTER_API_KEY / the key file / JUDGE_FIXTURE
 *                                        same meaning as for judge.mjs, and found the same way
 *                                        (apiKey.resolveApiKey). With NONE of them there is no
 *                                        way to get a real answer out of the judge CLI, so this
 *                                        script prints a notice and exits 0 rather than failing
 *                                        a CI run that has no key configured (e.g. a fork PR
 *                                        with secrets withheld).
 *   GITHUB_STEP_SUMMARY                  when set, the rendered markdown is also appended here
 *                                        (GitHub Actions' own job-summary mechanism).
 *   GITHUB_OUTPUT                        when set, `reached_judge=<count>` is appended, so the
 *                                        workflow can tell a run that measured from one that
 *                                        did not.
 *   GITHUB_RUN_ID / GITHUB_SHA           the run number and commit for the public block.
 *   JUDGE_MODEL / GRILL_JUDGE_COMMIT     never passed to the judge. See above.
 *
 * EXIT CODES
 *   0   ran clean (including the "skipped, no key" path without --require-key).
 *   1   at least one threshold in evals/thresholds.json regressed, or a case file is malformed,
 *       or a held-out run would put its cases or results inside this repository.
 *   2   nothing was measured: --require-key was given and there was no key, or no case got a
 *       verdict back.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveApiKey } from "./apiKey.mjs";
import { actionsRunOf, caseProblems, publicRunBlock, renderSummary, scoreCase, summarize } from "./evalCore.mjs";
import { validateRegressionRun } from "./resultsCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const JUDGE_CLI = join(HERE, "judge.mjs");
const DEFAULT_CASES_DIR = join(REPO_ROOT, "evals", "cases");
const DEFAULT_OUT = join(REPO_ROOT, "evals", "results", "latest.json");
const THRESHOLDS_PATH = join(REPO_ROOT, "evals", "thresholds.json");

function fail(message) {
  console.error(`[eval] ERROR: ${message}`);
  process.exit(1);
}

// ── Arguments ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { casesDir: DEFAULT_CASES_DIR, concurrency: 4, out: DEFAULT_OUT, requireKey: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--cases":
        opts.casesDir = next();
        break;
      case "--concurrency": {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) fail("--concurrency must be a positive integer");
        opts.concurrency = n;
        break;
      }
      case "--out":
        opts.out = next();
        break;
      case "--require-key":
        opts.requireKey = true;
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

/** Append to a file GitHub Actions reads: the job summary or the step outputs. Never fatal. */
function appendTo(envName, text) {
  const path = process.env[envName];
  if (!path) return;
  try {
    writeFileSync(path, text, { flag: "a" });
  } catch (e) {
    console.error(`[eval] could not append to ${envName}: ${e?.message ?? e}`);
  }
}

// ── The skip path: no way to reach a real judge, and nothing standing in for one. ──
// The key is looked for the way judge.mjs looks for it (GRILL_API_KEY, OPENROUTER_API_KEY,
// then the key file), so a run the judge could have answered is never reported as a skip.
if (!resolveApiKey(process.env).key && !process.env.JUDGE_FIXTURE) {
  console.log("SKIPPED: no judge ran");
  if (!opts.requireKey) process.exit(0);
  const message = "Not measured: no OPENROUTER_API_KEY, so no case reached a judge.";
  console.log(`::error::${message}`);
  appendTo("GITHUB_STEP_SUMMARY", `## Judge self-eval\n\n**${message}** Set the repository secret, then run this workflow again.\n`);
  process.exit(2);
}

// ── Load the cases ───────────────────────────────────────────────────────────
if (!existsSync(opts.casesDir)) fail(`no such cases directory: ${opts.casesDir}`);

const caseFiles = readdirSync(opts.casesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();
if (caseFiles.length === 0) fail(`no case files (*.json) found under ${opts.casesDir}`);

const cases = caseFiles.map((f) => {
  const path = join(opts.casesDir, f);
  let c;
  try {
    c = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(`cannot parse case ${path}: ${e?.message ?? e}`);
  }
  const problems = caseProblems(c, f);
  if (problems.length > 0) fail(`case ${path} is malformed: ${problems.join("; ")}`);
  return c;
});

// ── A held-out set stays out of this public repository, cases and results both ──
const insideRepo = (p) => {
  const rel = relative(REPO_ROOT, resolve(p));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const heldOut = cases.some((c) => c.heldOut === true);
if (heldOut) {
  if (insideRepo(opts.casesDir)) fail("held-out cases never live inside this repository; keep them in a private location and pass --cases");
  if (insideRepo(opts.out)) fail("a held-out run writes its results outside this repository: pass --out <path outside the repo>");
}

// ── The judge's environment: the product path, whatever this shell has set ──
// A pinned judge or the candidate rule would be scored, and written to the public block, as
// if it were the judge people use. eval-verdicts.mjs is where the candidate rule is compared.
const NOT_PASSED_TO_THE_JUDGE = ["JUDGE_MODEL", "GRILL_JUDGE_COMMIT"];
const judgeEnv = { ...process.env };
for (const name of NOT_PASSED_TO_THE_JUDGE) {
  const value = judgeEnv[name];
  delete judgeEnv[name];
  if (typeof value === "string" && value.trim()) {
    console.error(`[eval] ${name} is set and was not passed to the judge: the eval always runs the product path`);
  }
}

// ── Run one case through the real judge CLI, timing it ──────────────────────
function runOneCase(caseDef) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const args = ["--json", "--check"];
    if (caseDef.question) args.push("--question", caseDef.question);
    // Only where there is a planted flaw to find: a sound case has none, and asking whether a
    // challenge found one would only invite a false positive.
    if ((caseDef.kind === "flawed" || caseDef.kind === "loaded") && typeof caseDef.why === "string" && caseDef.why.trim()) {
      args.push("--check-flaw", caseDef.why);
    }

    const child = spawn(process.execPath, [JUDGE_CLI, ...args], {
      env: judgeEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => {
      const latencyMs = Date.now() - startedAt;
      let result = null;
      let note = null;
      if (code === 0) {
        try {
          result = JSON.parse(stdout);
        } catch (e) {
          note = `judge.mjs printed unparseable JSON on stdout: ${e?.message ?? e}`;
        }
      } else {
        note = `judge.mjs exited ${code}: ${stderr.trim().slice(0, 500)}`;
      }
      resolve({ caseDef, result, latencyMs, note });
    });
    child.stdin.write(String(caseDef.subject ?? ""));
    child.stdin.end();
  });
}

/** A tiny concurrency-limited map — not worth a dependency for. */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

const runs = await mapWithConcurrency(cases, opts.concurrency, runOneCase);

for (const { caseDef, note } of runs) {
  if (note) console.error(`[eval] ${heldOut ? "a held-out case" : caseDef.id}: ${note}`);
}

const scores = runs.map(({ caseDef, result, latencyMs }) => ({ ...scoreCase(caseDef, result), latencyMs }));

const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, "utf8"));
const summary = summarize(scores, thresholds);
const reached = summary.counts.reachedJudge;

// The workflow reads this to tell a run that measured from one that did not.
appendTo("GITHUB_OUTPUT", `reached_judge=${reached}\n`);

// ── No case got a verdict back: nothing was measured, so nothing is scored or written ──
// A dead key, or one that is out of credit, lands here. Scoring it would report every flaw
// as missed, and the weekly run would open "quality below threshold" for a judge that never ran.
if (reached === 0) {
  // Why, as far as a status code can say. Only the three digits are read out of the judge's
  // own note: the rest of that note can carry a response body, and this goes to a public log.
  const statuses = [];
  for (const { caseDef, result, note } of runs) {
    if (note) continue;
    const notes = Array.isArray(result?.degraded) ? result.degraded : [];
    const status = notes.map((d) => /\breturned (\d{3})\b/.exec(String(d))?.[1]).find(Boolean);
    if (status && !statuses.includes(status)) statuses.push(status);
    console.error(
      `[eval] ${heldOut ? "a held-out case" : caseDef.id}: the judge returned no verdict${status ? ` (the router answered ${status})` : ""}`,
    );
  }
  const message = `Not measured: 0 of ${scores.length} cases reached a judge.`;
  console.log(message);
  console.log(`::error::${message}`);
  const seen = statuses.length > 0 ? ` The router answered with status ${statuses.sort().join(", ")}.` : "";
  appendTo(
    "GITHUB_STEP_SUMMARY",
    `## Judge self-eval\n\n**${message}** No verdict came back, so no score is reported.${seen} The key may be dead or out of credit. Read this run's log, fix the cause, then run this workflow again.\n`,
  );
  process.exit(2);
}

const markdown = renderSummary(summary, scores, { heldOut });

mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify({ scores, summary }, null, 2), "utf8");
console.error(`[eval] results written to ${opts.out}`);

// ── The public block: this run as counts only, beside the results file ──────
const publicPath = opts.out.endsWith(".json") ? `${opts.out.slice(0, -".json".length)}.public.json` : `${opts.out}.public.json`;
const actionsRun = actionsRunOf(process.env);
if (heldOut) {
  console.error("[eval] no public block: a held-out run is not the record of the public set");
} else if (!actionsRun) {
  console.error("[eval] no public block: this run has no GitHub Actions run number and commit (GITHUB_RUN_ID, GITHUB_SHA)");
} else if (process.env.JUDGE_FIXTURE) {
  console.error("[eval] no public block: this run replayed JUDGE_FIXTURE, so no judge was asked");
} else {
  const block = publicRunBlock(scores, { date: new Date().toISOString().slice(0, 10), ...actionsRun });
  const text = `${JSON.stringify(block, null, 2)}\n`;
  try {
    // Checked as it will be read back: the text, parsed, not the object it was built from.
    validateRegressionRun(JSON.parse(text));
    writeFileSync(publicPath, text, "utf8");
    console.error(`[eval] public block written to ${publicPath}`);
  } catch (e) {
    console.error(`[eval] no public block: ${e?.message ?? e}`);
  }
}

console.log(markdown);

appendTo("GITHUB_STEP_SUMMARY", `${markdown}\n`);

process.exit(summary.regressions.length > 0 ? 1 : 0);
