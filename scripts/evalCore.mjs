// evalCore.mjs — the pure half of the judge's self-improvement measurement loop.
//
// No fs, no network, no child_process — every function here takes plain data in (a case
// definition, a judge result object) and returns plain data out. eval.mjs owns the I/O
// (spawning judge.mjs, timing it, reading the case files, writing the output) and calls into
// this module for the scoring and rendering a test can pin without a live model.
//
// THE PRIVACY RULE THAT SHAPES THIS FILE: every case this scores is synthetic, committed to
// the repo under evals/cases/. This module never sees, and must never be given, a real user's
// decision — that is enforced by what calls it (eval.mjs only ever reads evals/cases/*.json),
// not by anything in here, but it is why renderSummary is careful never to echo case content
// beyond a case's id: a report meant to be posted to a public GitHub issue must stay safe to
// post even if it were one day pointed at something less synthetic than these 12 cases.
//
// Zero dependencies. Node >= 20. ESM throughout.

import { GOOD_NOUL, PLANTED_FLAW_QUESTION } from "./checkCore.mjs";

/** Severities ranked so "no more severe than X" is a numeric comparison. Mirrors judgeCore's SEVERITIES. */
const SEVERITY_RANK = Object.freeze({ minor: 0, moderate: 1, serious: 2, fatal: 3 });

/** The severities a challenge must clear to count as having "caught" a planted flaw. A minor challenge is real but not what these cases are testing for. */
const CAUGHT_SEVERITIES = new Set(["fatal", "serious", "moderate"]);

function lower(v) {
  return typeof v === "string" ? v.toLowerCase() : "";
}

function count(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * The numbers from judge.mjs's local quote check, or null. Counts only: the missing indexes
 * point into challenge text this module never carries.
 */
function groundingOf(r) {
  const g = r.grounding;
  if (!g || typeof g !== "object" || !Number.isInteger(g.checked)) return null;
  return { checked: count(g.checked), found: Math.min(count(g.found), count(g.checked)) };
}

/**
 * The numbers from the Jev check, or null when it did not run or came back unavailable. Counts
 * and probabilities only — never its flags or its `unavailable` reason, which can carry an error
 * body, and an eval summary is written to be posted publicly.
 */
function qualityOf(r) {
  const q = r.quality;
  if (!q || typeof q !== "object" || typeof q.unavailable === "string") return null;
  const pair = (p) => ({ n: count(p?.n), good: Math.min(count(p?.good), count(p?.n)) });
  return {
    concrete: pair(q.concrete),
    engages: pair(q.engages),
    verdictFits: typeof q.verdictFits === "number" ? q.verdictFits : null,
  };
}

/**
 * Score one case against the judge's result for it.
 *
 * `result` is the parsed `--json` object judge.mjs printed (see judge.mjs's `result` shape),
 * or null/undefined when the run produced nothing usable at all (a crash, unparseable
 * stdout). A `verdict` of null — whether because the run failed outright or because the judge
 * itself returned an unrecognisable verdict (see judgeCore.reconcileVerdict) — is "no usable
 * result" either way, and is scored as the worst case for the case's kind rather than being
 * skipped: a flawed/loaded case with no usable result counts as a MISS (we did not catch the
 * flaw), a sound case with no usable result counts as a FALSE ALARM (we cannot call an
 * unreadable run "the subject held up"), and it is never counted as decorrelated (an
 * unattributable or absent run bought no verified independence either).
 *
 * Returns an object carrying only structured, closed-vocabulary fields — verdicts, severities,
 * kinds, booleans, numbers — and the case's own short `expect` metadata. It never carries
 * `caseDef.subject` or `caseDef.question`: that is what lets renderSummary describe a failure
 * without ever re-printing a case's content, and what makes eval.mjs's output file and the
 * CI markdown it produces safe to read (and post) without paging back through the subjects.
 */
export function scoreCase(caseDef, result) {
  const kind = caseDef?.kind ?? null;
  const r = result && typeof result === "object" ? result : {};
  const challenges = Array.isArray(r.challenges) ? r.challenges : [];
  const verdict = typeof r.verdict === "string" ? r.verdict : null;
  const usable = verdict !== null;
  const expect = caseDef?.expect ?? {};

  let caught = null;
  let matchedPhrase = null;

  if (kind === "flawed" || kind === "loaded") {
    const mustTarget = Array.isArray(expect.must_target) ? expect.must_target : [];
    if (!usable) {
      caught = false;
    } else {
      caught = false;
      for (const c of challenges) {
        if (!CAUGHT_SEVERITIES.has(c?.severity)) continue;
        const target = lower(c?.target);
        const hit = mustTarget.find((phrase) => target.includes(lower(phrase)));
        if (hit !== undefined) {
          caught = true;
          matchedPhrase = hit;
          break;
        }
      }
    }
  }

  // THE SEMANTIC CATCH, beside the phrase match above and never instead of it. Jev was asked
  // whether any challenge identifies the case's planted flaw in the case's own words, which sees
  // a catch the phrase match misses when the judge quotes different words. Informational only:
  // the phrase match stays the gate, because it needs no second model to be right.
  let semanticCaught = null;
  if (kind === "flawed" || kind === "loaded") {
    const p = r.quality && typeof r.quality === "object" ? r.quality.extra?.[PLANTED_FLAW_QUESTION] : undefined;
    semanticCaught = typeof p === "number" ? p >= GOOD_NOUL : null;
  }

  let falseAlarm = null;
  if (kind === "sound") {
    if (!usable) {
      falseAlarm = true;
    } else {
      const verdictIn = Array.isArray(expect.verdict_in) ? expect.verdict_in : [];
      const maxSeverity = typeof expect.max_severity === "string" ? expect.max_severity : "moderate";
      const maxRank = SEVERITY_RANK[maxSeverity] ?? SEVERITY_RANK.moderate;
      const badVerdict = verdictIn.length > 0 && !verdictIn.includes(verdict);
      const tooSevere = challenges.some((c) => (SEVERITY_RANK[c?.severity] ?? 0) > maxRank);
      falseAlarm = badVerdict || tooSevere;
    }
  }

  return {
    id: caseDef?.id ?? null,
    kind,
    verdict,
    caught,
    falseAlarm,
    matchedPhrase,
    // kind + severity only — never the challenge's target/challenge/falsifier text, which
    // quotes or paraphrases the subject.
    challengeSummary: challenges.map((c) => ({ kind: c?.kind ?? null, severity: c?.severity ?? null })),
    expect,
    schemaIssues: result?.rejected?.length || 0,
    decorrelated: usable ? (typeof r.decorrelated === "boolean" ? r.decorrelated : null) : false,
    costUsd: typeof r.costUsd === "number" ? r.costUsd : null,
    servedModel: typeof r.servedModel === "string" ? r.servedModel : null,
    grounding: groundingOf(r),
    quality: qualityOf(r),
    semanticCaught,
    // Billed even when its answers were unusable, so it counts toward the run's total either way.
    checkCostUsd: typeof r.quality?.costUsd === "number" ? r.quality.costUsd : null,
  };
}

/**
 * rate(numerator, denominator, key) — a fraction, or, when there is nothing to divide by
 * (no sound cases in this run, no cases at all), the value that trivially satisfies THAT
 * metric's own pass direction: 1 for an `atLeast` floor (nothing to catch reads as fully
 * caught), 0 for an `atMost` ceiling (nothing to alarm on reads as zero alarms). Read from
 * `CHECKS` below rather than hardcoded here, so the two can never drift apart. This is what
 * keeps an empty subset from manufacturing a regression by itself — see the "completely empty
 * scores array" test in evalCore.test.mjs, which is exactly the case a flat `denominator > 0
 * ? … : 1` default got backwards for `falseAlarmRate`/`schemaViolationRate`.
 */
function rate(numerator, denominator, key) {
  if (denominator > 0) return numerator / denominator;
  return directionOf(key) === "atMost" ? 0 : 1;
}

/**
 * The five gates this loop checks, and which direction is "good" for each. `atLeast` fails
 * when the actual value falls below the threshold (a catch rate that dropped); `atMost` fails
 * when it rises above (a false-alarm or schema-violation rate that grew). decorrelatedRate is a
 * floor of 1.0: a single run answered from Claude's own family is a failure, because an
 * independent judge is the whole product.
 */
const CHECKS = Object.freeze([
  { key: "catchRate", direction: "atLeast" },
  { key: "falseAlarmRate", direction: "atMost" },
  { key: "loadedCatchRate", direction: "atLeast" },
  { key: "decorrelatedRate", direction: "atLeast" }, // every run must be judged outside Claude's family
  { key: "schemaViolationRate", direction: "atMost" },
]);

/** The configured direction for a metric key, defaulting to `atLeast` for anything unlisted. */
function directionOf(key) {
  return CHECKS.find((c) => c.key === key)?.direction ?? "atLeast";
}

/**
 * good / n for an INFORMATIONAL metric, or null when there was nothing to divide. Unlike `rate`,
 * there is no pass direction to satisfy here, so an empty basis reads "n/a" — never a flattering
 * 1.0 that a reader could mistake for a measurement.
 */
function share({ good, n }) {
  return n > 0 ? good / n : null;
}

/** Sum `{good, n}` pairs over the scores that have one. */
function tally(list, pick) {
  const total = { good: 0, n: 0 };
  for (const s of list) {
    const p = pick(s);
    if (p && Number.isInteger(p.n) && p.n > 0) {
      total.good += p.good;
      total.n += p.n;
    }
  }
  return total;
}

/**
 * Roll a list of `scoreCase` results (each optionally carrying a `latencyMs` eval.mjs measured
 * around the subprocess call — a timing concern that belongs to the I/O layer, not here) up
 * into the metrics table and a pass/fail check against `thresholds`.
 *
 * Returns `{metrics, regressions, checks, informational}`. `metrics` is the flat table of actual
 * values. `regressions` is human-readable strings, one per failed threshold, suitable for a CI
 * annotation or an issue body — this is what `eval.mjs` uses to decide its exit code.
 * `checks` echoes the threshold actually applied to each metric alongside the outcome, purely
 * so `renderSummary` — which receives no separate `thresholds` argument — can render a
 * pass/fail table without recomputing or re-parsing anything.
 *
 * `informational` does the same for the quality metrics (grounding, and the Jev scores), with
 * the counts behind each rate. They are NEVER gated: they are not in CHECKS, so no threshold,
 * even one set by mistake in thresholds.json, can turn them into a regression. Twelve cases
 * scored by a second stochastic model is a signal to read, not a bar to hold a release to.
 */
export function summarize(scores, thresholds) {
  const list = Array.isArray(scores) ? scores : [];
  const n = list.length;

  const flawed = list.filter((s) => s.kind === "flawed");
  const loaded = list.filter((s) => s.kind === "loaded");
  const sound = list.filter((s) => s.kind === "sound");

  const grounded = tally(list, (s) => s.grounding && { good: s.grounding.found, n: s.grounding.checked });
  const concrete = tally(list, (s) => s.quality?.concrete);
  const engages = tally(list, (s) => s.quality?.engages);
  const verdictFit = tally(
    list,
    (s) => typeof s.quality?.verdictFits === "number" && { good: s.quality.verdictFits >= GOOD_NOUL ? 1 : 0, n: 1 },
  );
  // Over the flawed and loaded cases Jev actually scored, so the phrase match beside it can be
  // counted on exactly the same cases.
  const semanticScored = [...flawed, ...loaded].filter((s) => typeof s.semanticCaught === "boolean");
  const semantic = { good: semanticScored.filter((s) => s.semanticCaught).length, n: semanticScored.length };
  const phraseOnSame = semanticScored.filter((s) => s.caught === true).length;

  const metrics = {
    catchRate: rate(flawed.filter((s) => s.caught === true).length, flawed.length, "catchRate"),
    falseAlarmRate: rate(sound.filter((s) => s.falseAlarm === true).length, sound.length, "falseAlarmRate"),
    loadedCatchRate: rate(loaded.filter((s) => s.caught === true).length, loaded.length, "loadedCatchRate"),
    decorrelatedRate: rate(list.filter((s) => s.decorrelated === true).length, n, "decorrelatedRate"),
    schemaViolationRate: rate(list.filter((s) => (s.schemaIssues || 0) > 0).length, n, "schemaViolationRate"),
    groundedRate: share(grounded),
    concreteRate: share(concrete),
    engagesRate: share(engages),
    verdictFitRate: share(verdictFit),
    semanticCatchRate: share(semantic),
    totalCostUsd: list.reduce(
      (sum, s) => sum + (typeof s.costUsd === "number" ? s.costUsd : 0) + (typeof s.checkCostUsd === "number" ? s.checkCostUsd : 0),
      0,
    ),
    meanLatencyMs: (() => {
      const known = list.map((s) => s.latencyMs).filter((v) => typeof v === "number");
      return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    })(),
    n,
  };

  const notRun = "none scored (the Jev check did not run, or came back unavailable)";
  const informational = [
    { key: "groundedRate", label: "Quoted targets found in the write-up", ...grounded, unit: "challenges", none: "no challenges to check" },
    { key: "concreteRate", label: "Falsifiers scored concrete and cheap (Jev)", ...concrete, unit: "challenges scored", none: notRun },
    { key: "engagesRate", label: "Challenges that engage the write-up (Jev)", ...engages, unit: "challenges scored", none: notRun },
    { key: "verdictFitRate", label: "Verdicts that fit their challenges (Jev)", ...verdictFit, unit: "cases scored", none: notRun },
    {
      key: "semanticCatchRate",
      label: "Planted flaw identified, semantic (Jev)",
      ...semantic,
      unit: "flawed/loaded cases scored",
      note: `phrase match caught ${phraseOnSame} of the same ${semantic.n}`,
      none: notRun,
    },
  ].map((row) => ({ ...row, value: metrics[row.key] }));

  const regressions = [];
  const checks = [];
  for (const { key, direction } of CHECKS) {
    const threshold = thresholds?.[key];
    if (typeof threshold !== "number") continue; // nothing configured for this metric — nothing to check
    const actual = metrics[key];
    const pass = direction === "atLeast" ? actual >= threshold : actual <= threshold;
    checks.push({ key, direction, threshold, actual, pass });
    if (!pass) {
      regressions.push(
        direction === "atLeast"
          ? `${key} is ${actual.toFixed(2)}, below the required minimum of ${threshold}`
          : `${key} is ${actual.toFixed(2)}, above the allowed maximum of ${threshold}`,
      );
    }
  }

  return { metrics, regressions, checks, informational };
}

const METRIC_LABEL = Object.freeze({
  catchRate: "Catch rate (flawed)",
  falseAlarmRate: "False alarm rate (sound)",
  loadedCatchRate: "Catch rate (loaded)",
  decorrelatedRate: "Decorrelated rate",
  schemaViolationRate: "Schema violation rate",
});

/**
 * Render the short markdown report: a metrics table with pass/fail per threshold, then one
 * line per failed case.
 *
 * NEVER INCLUDE SUBJECT TEXT BEYOND THE CASE ID. A failed case is described only by its id,
 * its `expect` metadata (the short planted-phrase / verdict acceptance criteria already
 * committed in evals/cases/*.json — not the subject's narrative) and closed-vocabulary
 * results (verdict, challenge kind/severity). This is what a scheduled run can safely paste
 * into a GitHub issue body without spending the one resource — attention — this loop exists
 * to protect, and without ever needing to re-read a real decision to explain a miss.
 */
export function renderSummary(summary, scores) {
  const { metrics = {}, regressions = [], checks = [], informational = [] } = summary ?? {};
  const list = Array.isArray(scores) ? scores : [];
  const out = [];

  out.push("# Grill self-eval results", "");
  out.push(
    `n = ${metrics.n ?? list.length} · total cost $${(metrics.totalCostUsd ?? 0).toFixed(4)} · mean latency ${Math.round(
      metrics.meanLatencyMs ?? 0,
    )}ms`,
    "",
  );

  out.push("| Metric | Value | Threshold | Status |", "| --- | --- | --- | --- |");
  for (const c of checks) {
    const cmp = c.direction === "atLeast" ? `>= ${c.threshold}` : `<= ${c.threshold}`;
    out.push(`| ${METRIC_LABEL[c.key] ?? c.key} | ${c.actual.toFixed(2)} | ${cmp} | ${c.pass ? "PASS" : "FAIL"} |`);
  }
  out.push("");

  // A separate table, under its own heading, with no Threshold or Status column: nothing here
  // can fail a run, and a reader must never have to work out which rows do.
  if (Array.isArray(informational) && informational.length > 0) {
    out.push("## Quality (informational, not gated)", "", "| Metric | Value | Basis |", "| --- | --- | --- |");
    for (const row of informational) {
      const value = typeof row.value === "number" ? row.value.toFixed(2) : "n/a";
      const basis = row.n > 0 ? `${row.good} of ${row.n} ${row.unit}${row.note ? `; ${row.note}` : ""}` : row.none ?? "none";
      out.push(`| ${row.label} | ${value} | ${basis} |`);
    }
    out.push("");
  }

  const failedCases = list.filter((s) =>
    s.kind === "flawed" || s.kind === "loaded" ? s.caught === false : s.kind === "sound" ? s.falseAlarm === true : false,
  );

  if (failedCases.length > 0) {
    out.push("## Failed cases", "");
    for (const s of failedCases) {
      const expected =
        s.kind === "sound"
          ? `verdict in [${(s.expect?.verdict_in ?? []).join(", ")}], max severity ${s.expect?.max_severity ?? "?"}`
          : `a challenge targeting one of: ${(s.expect?.must_target ?? []).join(" | ")}`;
      const got =
        s.verdict === null
          ? "no usable result (verdict null)"
          : `verdict=${s.verdict}, challenges=[${s.challengeSummary.map((c) => `${c.severity}/${c.kind}`).join(", ")}]`;
      // Tells a phrasing miss (Jev saw the flaw named in other words) from a real one.
      const semantic =
        s.semanticCaught === true
          ? "; Jev: a challenge does identify the planted flaw"
          : s.semanticCaught === false
            ? "; Jev: no challenge identifies it either"
            : "";
      out.push(`- **${s.id}** — expected ${expected}; got ${got}${semantic}`);
    }
    out.push("");
  } else {
    out.push("_No case failures._", "");
  }

  if (regressions.length > 0) {
    out.push("## Threshold regressions", "");
    for (const r of regressions) out.push(`- ${r}`);
    out.push("");
  }

  return out.join("\n");
}
