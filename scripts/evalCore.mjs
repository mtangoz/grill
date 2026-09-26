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

/** Severities ranked so "no more severe than X" is a numeric comparison. Mirrors judgeCore's SEVERITIES. */
const SEVERITY_RANK = Object.freeze({ minor: 0, moderate: 1, serious: 2, fatal: 3 });

/** The severities a challenge must clear to count as having "caught" a planted flaw. A minor challenge is real but not what these cases are testing for. */
const CAUGHT_SEVERITIES = new Set(["fatal", "serious", "moderate"]);

function lower(v) {
  return typeof v === "string" ? v.toLowerCase() : "";
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
 * Roll a list of `scoreCase` results (each optionally carrying a `latencyMs` eval.mjs measured
 * around the subprocess call — a timing concern that belongs to the I/O layer, not here) up
 * into the metrics table and a pass/fail check against `thresholds`.
 *
 * Returns `{metrics, regressions, checks}`. `metrics` is the flat table of actual values.
 * `regressions` is human-readable strings, one per failed threshold, suitable for a CI
 * annotation or an issue body — this is what `eval.mjs` uses to decide its exit code.
 * `checks` echoes the threshold actually applied to each metric alongside the outcome, purely
 * so `renderSummary` — which receives no separate `thresholds` argument — can render a
 * pass/fail table without recomputing or re-parsing anything.
 */
export function summarize(scores, thresholds) {
  const list = Array.isArray(scores) ? scores : [];
  const n = list.length;

  const flawed = list.filter((s) => s.kind === "flawed");
  const loaded = list.filter((s) => s.kind === "loaded");
  const sound = list.filter((s) => s.kind === "sound");

  const metrics = {
    catchRate: rate(flawed.filter((s) => s.caught === true).length, flawed.length, "catchRate"),
    falseAlarmRate: rate(sound.filter((s) => s.falseAlarm === true).length, sound.length, "falseAlarmRate"),
    loadedCatchRate: rate(loaded.filter((s) => s.caught === true).length, loaded.length, "loadedCatchRate"),
    decorrelatedRate: rate(list.filter((s) => s.decorrelated === true).length, n, "decorrelatedRate"),
    schemaViolationRate: rate(list.filter((s) => (s.schemaIssues || 0) > 0).length, n, "schemaViolationRate"),
    totalCostUsd: list.reduce((sum, s) => sum + (typeof s.costUsd === "number" ? s.costUsd : 0), 0),
    meanLatencyMs: (() => {
      const known = list.map((s) => s.latencyMs).filter((v) => typeof v === "number");
      return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    })(),
    n,
  };

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

  return { metrics, regressions, checks };
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
  const { metrics = {}, regressions = [], checks = [] } = summary ?? {};
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
      out.push(`- **${s.id}** — expected ${expected}; got ${got}`);
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
