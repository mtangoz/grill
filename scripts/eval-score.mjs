#!/usr/bin/env node
/**
 * eval-score.mjs — score a filled labels.csv from eval-verdicts.mjs.
 *
 * The candidate passes when it wins at least 60% of decided pairs and the one-sided
 * sign-test p-value is under 0.1. Ties are not decided. This reads the labels file only.
 * It does not call a model.
 *
 * USAGE
 *   node scripts/eval-score.mjs --labels evals/verdict-quality/out/<date>/labels.csv
 *
 * EXIT
 *   0   the candidate passes both bars
 *   1   scored, and it does not pass, or the file is malformed
 *   2   the labels file is missing
 */

import { readFileSync } from "node:fs";

import { labelsFromCsv, renderScore, scoreLabels } from "./verdictEvalCore.mjs";

function fail(message, code = 1) {
  console.error(`[verdict-score] ${message}`);
  process.exit(code);
}

let labelsPath = "";
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--labels") {
    labelsPath = argv[++i];
    if (!labelsPath) fail("--labels needs a path");
  } else if (arg === "--help" || arg === "-h") {
    console.log("usage: node scripts/eval-score.mjs --labels <labels.csv>");
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

const score = scoreLabels(rows);
process.stdout.write(renderScore(score));
process.exit(score.passes ? 0 : 1);
