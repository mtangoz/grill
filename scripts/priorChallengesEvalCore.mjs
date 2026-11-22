/**
 * Scoring for the prior-challenges candidate (GRILL_JUDGE_PRIOR_CHALLENGES). Pure helpers.
 *
 * Two sets:
 * - holdout-v2, read only and checksum-checked: each case is judged twice by today's judge
 *   (a noise baseline) and once by the candidate with the first run's challenges as the
 *   earlier list. The subject did not change, so any "fixed" is a false fix, and a verdict
 *   that moves more than today's judge moves between two runs is anchoring.
 * - evals/prior-challenges/cases.jsonl: revised plans with hand-marked earlier challenges.
 *   Today's judge re-grills the revision; the candidate also marks each earlier challenge.
 */
import { createHash } from "node:crypto";

export const VERDICT_ORDER = Object.freeze(["refuted", "weak", "holds-with-conditions", "holds"]);

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function parseCases(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Earlier challenges from a judge result: each challenge's own sentence, at most 6. */
export function priorsFrom(result) {
  return (Array.isArray(result?.challenges) ? result.challenges : [])
    .map((row) => String(row?.challenge || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);
}

function rank(verdict) {
  return VERDICT_ORDER.indexOf(verdict);
}

/** Share of rows where two verdicts agree, and the mean signed move (positive: kinder). */
export function verdictAgreement(pairs) {
  const usable = pairs.filter(([a, b]) => rank(a) >= 0 && rank(b) >= 0);
  if (usable.length === 0) return { n: 0, agree: 0, rate: null, meanShift: null };
  const agree = usable.filter(([a, b]) => a === b).length;
  const shift = usable.reduce((sum, [a, b]) => sum + (rank(b) - rank(a)), 0) / usable.length;
  return { n: usable.length, agree, rate: agree / usable.length, meanShift: shift };
}

/** On an unchanged subject every fixed mark is false. Unquoted fixes were already read as open. */
export function falseFixes(marksByCase) {
  let marks = 0;
  let fixed = 0;
  let unchecked = 0;
  for (const marksList of marksByCase) {
    for (const row of marksList || []) {
      marks += 1;
      if (row.status === "fixed") fixed += 1;
      if (row.status === "unchecked") unchecked += 1;
    }
  }
  return { marks, fixed, unchecked, rate: marks ? fixed / marks : null };
}

/** Marks against the hand labels. unchecked counts as wrong. */
export function markAccuracy(rows) {
  let total = 0;
  let right = 0;
  let falseFixed = 0;
  let missedFix = 0;
  for (const { expected, marks } of rows) {
    expected.forEach((want, i) => {
      const got = marks?.[i]?.status || "unchecked";
      total += 1;
      if (got === want) right += 1;
      else if (got === "fixed") falseFixed += 1;
      else if (want === "fixed") missedFix += 1;
    });
  }
  return { total, right, rate: total ? right / total : null, falseFixed, missedFix };
}

/**
 * The bar this candidate must clear before anyone turns it on. Not a launch decision: the
 * flag stays off until the owner says yes after reading the blind pairs.
 */
export function passesBar({ holdout, revisions }) {
  const reasons = [];
  if (holdout.falseFixes.rate === null || holdout.falseFixes.rate > 0.1) reasons.push("false fixes on unchanged holdout subjects above 10%");
  if (holdout.baseline.rate !== null && holdout.candidate.rate !== null && holdout.candidate.rate < holdout.baseline.rate - 0.15) {
    reasons.push("candidate verdicts move more than 15 points beyond today's run-to-run noise");
  }
  if (revisions.accuracy.rate === null || revisions.accuracy.rate < 0.75) reasons.push("fixed/open marks right on fewer than 75% of hand labels");
  return { pass: reasons.length === 0, reasons };
}
