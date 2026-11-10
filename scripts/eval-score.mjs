#!/usr/bin/env node
/**
 * eval-score.mjs — score a filled labels.csv from eval-verdicts.mjs.
 *
 * The candidate passes when it wins at least 60% of decided pairs and the one-sided
 * sign-test p-value is under 0.1. Ties are not decided. This reads the labels file and
 * an optional replies file. It does not call a model.
 *
 * Panel labels and human replies are scored together and reported apart. The pass bar
 * is the combined decided pairs. A reply fills a sheet row. It does not replace a
 * panel label.
 *
 * USAGE
 *   node scripts/eval-score.mjs --labels evals/verdict-quality/out/<date>/labels.csv
 *   node scripts/eval-score.mjs --labels evals/verdict-quality/out/<date>/labels.csv --replies replies.txt
 *
 * EXIT
 *   0   the candidate passes both bars
 *   1   scored, and it does not pass, or the file is malformed
 *   2   the labels file or the replies file is missing
 */

import { readFileSync } from "node:fs";

import { applyReplies, labelsFromCsv, parseReplies, renderScore, scoreLabels } from "./verdictEvalCore.mjs";

function fail(message, code = 1) {
  console.error(`[verdict-score] ${message}`);
  process.exit(code);
}

let labelsPath = "";
let repliesPath = "";
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--labels") {
    labelsPath = argv[++i];
    if (!labelsPath) fail("--labels needs a path");
  } else if (arg === "--replies") {
    repliesPath = argv[++i];
    if (!repliesPath) fail("--replies needs a path");
  } else if (arg === "--help" || arg === "-h") {
    console.log("usage: node scripts/eval-score.mjs --labels <labels.csv> [--replies <replies.txt>]");
    process.exit(0);
  } else {
    fail(`unknown argument: ${arg}`);
  }
}
if (!labelsPath) fail("pass --labels <labels.csv>");

let text;
try {
  text = readFileSync(labelsPath, "utf8");
} catch (e) {
  fail(`cannot read labels: ${e?.message ?? e}`, 2);
}

let rows;
try {
  rows = labelsFromCsv(text);
} catch (e) {
  fail(e?.message ?? e);
}

if (repliesPath) {
  let replyText;
  try {
    replyText = readFileSync(repliesPath, "utf8");
  } catch (e) {
    fail(`cannot read replies: ${e?.message ?? e}`, 2);
  }
  const replies = parseReplies(replyText);
  const known = new Set(rows.map((row) => String(row.sheet_n ?? "").trim()).filter(Boolean));
  for (const reply of replies) {
    if (!known.has(String(reply.n))) console.error(`[verdict-score] reply ${reply.n} matches no pair on the sheet`);
  }
  rows = applyReplies(rows, replies);
}

const score = scoreLabels(rows);
process.stdout.write(renderScore(score));
process.exit(score.passes ? 0 : 1);
