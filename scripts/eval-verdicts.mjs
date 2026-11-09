#!/usr/bin/env node
/**
 * eval-verdicts.mjs — blind pairs of the current judge and the candidate.
 *
 * The candidate is the same judge with GRILL_JUDGE_COMMIT=1. The current judge is that
 * flag removed. Both go through scripts/judge.mjs and OpenRouter's Auto Router. This
 * script is not part of npm test and must not be added to CI: each case is two paid calls.
 *
 * A dev run is a tuning run. It refuses the holdout, including when the cases file is
 * missing, and it returns dev rows only. The holdout is one measurement per candidate.
 * Finish a holdout directory once. Do not run it again to tune.
 *
 * USAGE
 *   node scripts/eval-verdicts.mjs --split dev
 *   node scripts/eval-verdicts.mjs --split holdout
 *   node scripts/eval-verdicts.mjs --split holdout --tune     # refuses before reading
 *
 * ENVIRONMENT
 *   GRILL_API_KEY or OPENROUTER_API_KEY, or the key file. Same resolution as judge.mjs.
 *   With no key, a dev run prints a notice and exits 0. A holdout run exits 2 and writes
 *   nothing: a skipped holdout is not a measurement.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveApiKey } from "./apiKey.mjs";
import {
  HoldoutLocked,
  buildPair,
  casesFromJsonl,
  holdoutChecksum,
  purposeFor,
  questionFor,
  toCsv,
  verdictText,
} from "./verdictEvalCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const JUDGE_CLI = join(HERE, "judge.mjs");
const DEFAULT_CASES = join(REPO_ROOT, "evals", "verdict-quality", "cases.jsonl");
const DEFAULT_CHECKSUM = join(REPO_ROOT, "evals", "verdict-quality", "holdout.sha256");

function fail(message, code = 1) {
  console.error(`[verdict-eval] ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    split: "dev",
    tune: false,
    casesPath: DEFAULT_CASES,
    checksumPath: DEFAULT_CHECKSUM,
    out: "",
    concurrency: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    switch (arg) {
      case "--split":
        opts.split = next();
        break;
      case "--tune":
        opts.tune = true;
        break;
      case "--cases":
        opts.casesPath = next();
        break;
      case "--checksum":
        opts.checksumPath = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--concurrency": {
        const n = Number(next());
        if (!Number.isInteger(n) || n < 1) fail("--concurrency must be a positive integer");
        opts.concurrency = n;
        break;
      }
      case "--help":
      case "-h":
        console.log("usage: node scripts/eval-verdicts.mjs --split dev|holdout [--out dir] [--concurrency n]");
        console.log("Dev is a tuning run and will not read holdout cases. Holdout is once per candidate.");
        console.log("Not for CI. Each case spends two judge calls.");
        process.exit(0);
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  if (opts.split !== "dev" && opts.split !== "holdout") fail(`unknown split: ${opts.split}`);
  return opts;
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function childEnv(commit) {
  const env = { ...process.env };
  delete env.JUDGE_FIXTURE;
  delete env.JUDGE_CHECK;
  if (commit) env.GRILL_JUDGE_COMMIT = "1";
  else delete env.GRILL_JUDGE_COMMIT;
  return env;
}

function runJudge(row, { commit, contextPath }) {
  return new Promise((resolve) => {
    const args = [JUDGE_CLI, "--json", "--question", questionFor(row)];
    if (contextPath) args.push("--context", contextPath);
    const child = spawn(process.execPath, args, { env: childEnv(commit), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", () => {});
    child.on("error", () => resolve("No verdict returned."));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve("No verdict returned.");
        return;
      }
      try {
        resolve(verdictText(JSON.parse(stdout), row.subject));
      } catch {
        resolve("No verdict returned.");
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(row.subject);
  });
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

const opts = parseArgs(process.argv.slice(2));

let purpose;
try {
  purpose = purposeFor({ split: opts.split, tune: opts.tune });
} catch (e) {
  if (e instanceof HoldoutLocked) fail(e.message);
  throw e;
}

let text;
try {
  text = readFileSync(opts.casesPath, "utf8");
} catch (e) {
  fail(`cannot read cases: ${e?.message ?? e}`);
}

let cases;
try {
  cases = casesFromJsonl(text, { purpose, split: opts.split });
} catch (e) {
  if (e instanceof HoldoutLocked) fail(e.message);
  fail(e?.message ?? e);
}
if (cases.length === 0) fail(`no ${opts.split} cases`);

if (opts.split === "holdout") {
  let expected;
  try {
    expected = readFileSync(opts.checksumPath, "utf8").trim();
  } catch (e) {
    fail(`cannot read the holdout checksum: ${e?.message ?? e}`);
  }
  const got = holdoutChecksum(cases);
  if (got !== expected) fail("holdout checksum does not match. The holdout is frozen. Do not retune it.");
}

const outDir = opts.out || join(REPO_ROOT, "evals", "verdict-quality", "out", utcDate());
const pairsPath = join(outDir, "pairs.jsonl");
const labelsPath = join(outDir, "labels.csv");
if (opts.split === "holdout") {
  try {
    readFileSync(pairsPath);
    fail(`holdout pairs already exist at ${pairsPath}. The holdout is used once per candidate.`);
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
}

const key = resolveApiKey();
if (!key.key) {
  if (opts.split === "holdout") fail("Not measured: no router key, so the holdout was not run.", 2);
  console.log("[verdict-eval] no router key; eval skipped");
  process.exit(0);
}

const contextDir = mkdtempSync(join(tmpdir(), "verdict-eval-"));
try {
  const runs = await mapWithConcurrency(cases, opts.concurrency, async (row, index) => {
    let contextPath = "";
    if (row.context.trim()) {
      contextPath = join(contextDir, `${row.id}.txt`);
      writeFileSync(contextPath, row.context, "utf8");
    }
    const [control, candidate] = await Promise.all([
      runJudge(row, { commit: false, contextPath }),
      runJudge(row, { commit: true, contextPath }),
    ]);
    console.error(`[verdict-eval] ${index + 1}/${cases.length} ${row.id}`);
    return buildPair({
      id: row.id,
      subject: row.subject,
      context: row.context,
      control,
      candidate,
      rng: () => Math.random(),
    });
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(pairsPath, `${runs.map((run) => JSON.stringify(run.pair)).join("\n")}\n`, "utf8");
  writeFileSync(labelsPath, toCsv(runs.map((run) => run.label)), "utf8");
  console.error(`[verdict-eval] wrote ${runs.length} pairs to ${pairsPath}`);
  console.error("[verdict-eval] label from pairs.jsonl. Leave candidate_side as written. Do not label these yourself if you are the one who can see which arm is which.");
} finally {
  rmSync(contextDir, { recursive: true, force: true });
}
