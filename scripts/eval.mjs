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
 * case it runs comes from evals/cases/*.json, fictional and committed to the repo — this
 * script never reads anything else as a subject.
 *
 * USAGE
 *   node scripts/eval.mjs [--cases evals/cases] [--concurrency 4] [--out evals/results/latest.json]
 *
 * ENVIRONMENT
 *   OPENROUTER_API_KEY / JUDGE_FIXTURE   same meaning as for judge.mjs. With NEITHER set,
 *                                        there is no way to get a real answer out of the judge
 *                                        CLI, so this script prints a notice and exits 0
 *                                        rather than failing a CI run that has no key
 *                                        configured (e.g. a fork PR with secrets withheld).
 *   GITHUB_STEP_SUMMARY                  when set, the rendered markdown is also appended here
 *                                        (GitHub Actions' own job-summary mechanism).
 *
 * EXIT CODES
 *   0   ran clean (including the "skipped, no key" path).
 *   1   at least one threshold in evals/thresholds.json regressed.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSummary, scoreCase, summarize } from "./evalCore.mjs";

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
  const opts = { casesDir: DEFAULT_CASES_DIR, concurrency: 4, out: DEFAULT_OUT };
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
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

// ── The skip path: no way to reach a real judge, and nothing standing in for one. ──
if (!process.env.OPENROUTER_API_KEY && !process.env.JUDGE_FIXTURE) {
  console.log("::notice::no OPENROUTER_API_KEY; eval skipped");
  process.exit(0);
}

// ── Load the cases ───────────────────────────────────────────────────────────
if (!existsSync(opts.casesDir)) fail(`no such cases directory: ${opts.casesDir}`);

const caseFiles = readdirSync(opts.casesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();
if (caseFiles.length === 0) fail(`no case files (*.json) found under ${opts.casesDir}`);

const cases = caseFiles.map((f) => {
  const path = join(opts.casesDir, f);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(`cannot parse case ${path}: ${e?.message ?? e}`);
  }
});

// ── Run one case through the real judge CLI, timing it ──────────────────────
function runOneCase(caseDef) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const args = ["--json"];
    if (caseDef.question) args.push("--question", caseDef.question);

    const child = spawn(process.execPath, [JUDGE_CLI, ...args], {
      env: process.env,
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
  if (note) console.error(`[eval] ${caseDef.id}: ${note}`);
}

const scores = runs.map(({ caseDef, result, latencyMs }) => ({ ...scoreCase(caseDef, result), latencyMs }));

const thresholds = JSON.parse(readFileSync(THRESHOLDS_PATH, "utf8"));
const summary = summarize(scores, thresholds);
const markdown = renderSummary(summary, scores);

mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify({ scores, summary }, null, 2), "utf8");
console.error(`[eval] results written to ${opts.out}`);

console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: "a" });
  } catch (e) {
    console.error(`[eval] could not append to GITHUB_STEP_SUMMARY: ${e?.message ?? e}`);
  }
}

process.exit(summary.regressions.length > 0 ? 1 : 0);
