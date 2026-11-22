#!/usr/bin/env node
/**
 * Measure the prior-challenges candidate (GRILL_JUDGE_PRIOR_CHALLENGES) against today's judge.
 * This spends router credit. It is not part of npm test and must not be added to CI.
 *
 *   OPENROUTER_API_KEY=… node scripts/eval-prior-challenges.mjs [--out <dir>] [--concurrency 6]
 *
 * --revisions-only skips holdout v2 (for a second look at the revision cases).
 *
 * Holdout v2 is read only and its checksum is checked before anything is sent. Nothing is
 * added to it. Writes results.json, a summary, and blind pairs (pairs.md, with the sides in
 * key.json) from the revision set for a person to rate.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRIOR_CHALLENGES_OPTION, readPriorChallenges, renderLayers } from "./judgeCore.mjs";
import { falseFixes, markAccuracy, parseCases, passesBar, priorsFrom, sha256, verdictAgreement } from "./priorChallengesEvalCore.mjs";
import { questionFor } from "./verdictEvalCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const JUDGE_CLI = join(HERE, "judge.mjs");

function fail(message) {
  console.error(`[eval-prior] ${message}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};
const outDir = opt("--out", join(ROOT, "evals", "prior-challenges", "out", new Date().toISOString().slice(0, 10)));
const concurrency = Math.max(1, Number(opt("--concurrency", "6")) || 6);
if (!process.env.OPENROUTER_API_KEY && !process.env.GRILL_API_KEY) fail("no key: set OPENROUTER_API_KEY or GRILL_API_KEY. Nothing was sent.");

const holdoutText = readFileSync(join(ROOT, "evals/verdict-quality/holdout-v2.jsonl"), "utf8");
if (sha256(holdoutText) !== readFileSync(join(ROOT, "evals/verdict-quality/holdout-v2.sha256"), "utf8").trim()) {
  fail("holdout v2 does not match its checksum. Nothing was sent.");
}
const holdout = parseCases(holdoutText);
const revisions = parseCases(readFileSync(join(ROOT, "evals/prior-challenges/cases.jsonl"), "utf8"));
const contextDir = mkdtempSync(join(tmpdir(), "grill-prior-eval-"));

function childEnv(candidate) {
  const env = { ...process.env };
  for (const name of ["JUDGE_FIXTURE", "JUDGE_CHECK", "GRILL_JUDGE_COMMIT", "JUDGE_MODEL"]) delete env[name];
  if (candidate) env[PRIOR_CHALLENGES_OPTION] = "1";
  else delete env[PRIOR_CHALLENGES_OPTION];
  return env;
}

function judgeOnce({ subject, question = "", context = "", id, priors = [] }) {
  return new Promise((resolve) => {
    const args = [JUDGE_CLI, "--json"];
    if (question) args.push("--question", question);
    if (context) {
      const path = join(contextDir, `${id}.txt`);
      writeFileSync(path, context, "utf8");
      args.push("--context", path);
    }
    for (const prior of priors) args.push("--prior", prior);
    const child = spawn(process.execPath, args, { env: childEnv(priors.length > 0), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", () => {});
    const timer = setTimeout(() => child.kill("SIGKILL"), 330_000);
    child.on("error", () => resolve(null));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed && parsed.verdict ? parsed : null);
      } catch {
        resolve(null);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(subject);
  });
}

async function judge(input) {
  return (await judgeOnce(input)) || (await judgeOnce(input));
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const slim = (r) =>
  r && {
    verdict: r.verdict,
    verdictReason: r.verdictReason,
    challenges: (r.challenges || []).map((c) => ({
      kind: c.kind,
      severity: c.severity,
      challenge: c.challenge,
      falsifier: c.falsifier,
      what_would_have_to_be_true: c.what_would_have_to_be_true,
    })),
    strongestObjection: r.strongestObjection,
    missingOption: r.missingOption,
    factsNeeded: r.factsNeeded,
    needsFacts: r.needsFacts,
    degraded: r.degraded,
    priorChallenges: r.priorChallenges || null,
    servedModel: r.servedModel,
  };

console.error(`[eval-prior] holdout v2: ${holdout.length} cases x 3 runs; revisions: ${revisions.length} cases x 2 runs`);
const revisionsOnly = argv.includes("--revisions-only");
const holdoutRows = await mapLimit(revisionsOnly ? [] : holdout, concurrency, async (row) => {
  const base = { subject: row.subject, question: questionFor(row), context: row.context || "", id: row.id };
  const [first, second] = await Promise.all([judge(base), judge(base)]);
  const priors = priorsFrom(first);
  const candidate = priors.length ? await judge({ ...base, priors }) : null;
  console.error(`[eval-prior] holdout ${row.id}: ${first?.verdict} / ${second?.verdict} / ${candidate?.verdict ?? "(no earlier challenges)"}`);
  return { id: row.id, first: slim(first), second: slim(second), candidate: slim(candidate), priors };
});

const revisionRows = await mapLimit(revisions, concurrency, async (row) => {
  const base = { subject: row.subject, id: row.id };
  const [current, candidate] = await Promise.all([judge(base), judge({ ...base, priors: row.priors })]);
  const marks = candidate ? candidate.priorChallenges || readPriorChallenges(candidate, { priors: row.priors, subject: row.subject }) : [];
  console.error(`[eval-prior] revision ${row.id}: ${current?.verdict} / ${candidate?.verdict}; marks ${marks.map((m) => m.status).join(",")}`);
  return { id: row.id, subject: row.subject, priors: row.priors, expected: row.expected, current, candidate, marks };
});

const withCandidate = holdoutRows.filter((row) => row.first && row.second && row.candidate);
const summary = {
  holdout: {
    cases: holdout.length,
    usable: withCandidate.length,
    baseline: verdictAgreement(withCandidate.map((row) => [row.first.verdict, row.second.verdict])),
    candidate: verdictAgreement(withCandidate.map((row) => [row.first.verdict, row.candidate.verdict])),
    candidateVsSecond: verdictAgreement(withCandidate.map((row) => [row.second.verdict, row.candidate.verdict])),
    falseFixes: falseFixes(withCandidate.map((row) => row.candidate.priorChallenges || [])),
  },
  revisions: {
    cases: revisions.length,
    accuracy: markAccuracy(revisionRows.filter((row) => row.candidate).map((row) => ({ expected: row.expected, marks: row.marks }))),
    verdicts: verdictAgreement(revisionRows.filter((row) => row.current && row.candidate).map((row) => [row.current.verdict, row.candidate.verdict])),
  },
};
summary.bar = passesBar(summary);

// Blind pairs from the revision set: today's re-grill of the revised plan beside the candidate's.
let seed = 0x5eed;
const coin = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 1) === 1;
const key = {};
const sheet = [
  "# Blind pairs: re-grill of a revised plan",
  "",
  "Each pair is the same revised plan, grilled two ways. Read both answers and pick the one that tells you more truthfully how the plan improved and what is still weak. Reply in the block at the end, one line per pair, like `1: A`. `tie` is fine.",
  "",
];
revisionRows.forEach((row, i) => {
  if (!row.current || !row.candidate) return;
  const current = renderLayers(row.current, { subject: row.subject }).brief;
  const candidate = renderLayers({ ...row.candidate, priorChallenges: row.marks }, { subject: row.subject }).brief;
  const candidateIsA = coin();
  key[i + 1] = { id: row.id, candidate_side: candidateIsA ? "A" : "B" };
  sheet.push(
    `## ${i + 1}. ${row.id}`,
    "",
    `**Revised plan:** ${row.subject}`,
    "",
    `**Earlier challenges:** ${row.priors.map((p, n) => `(${n + 1}) ${p}`).join(" ")}`,
    "",
    "**A**",
    "",
    candidateIsA ? candidate : current,
    "",
    "**B**",
    "",
    candidateIsA ? current : candidate,
    "",
  );
});
sheet.push("## Your replies", "", "```", ...Object.keys(key).map((n) => `${n}: `), "```", "");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "results.json"), JSON.stringify({ summary, holdout: holdoutRows, revisions: revisionRows.map((r) => ({ ...r, current: slim(r.current), candidate: slim(r.candidate) })) }, null, 2));
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
writeFileSync(join(outDir, "pairs.md"), sheet.join("\n"));
writeFileSync(join(outDir, "key.json"), JSON.stringify(key, null, 2));
console.log(JSON.stringify(summary, null, 2));
