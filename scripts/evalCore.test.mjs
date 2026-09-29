// Unit tests for evalCore.mjs — the pure half of the judge's self-improvement measurement
// loop. node:test + node:assert only, no dependencies, no network, no live model.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderSummary, scoreCase, summarize } from "./evalCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "..", "evals", "cases");

/** A minimal challenge satisfying the shape scoreCase reads. */
function challenge(over = {}) {
  return { kind: "unsupported-claim", severity: "serious", target: "the exact quoted words", ...over };
}

/** A minimal usable judge result. */
function usableResult(over = {}) {
  return { verdict: "weak", challenges: [], rejected: [], decorrelated: true, costUsd: 0.01, servedModel: "openai/gpt-5.6-sol", ...over };
}

// ---------------------------------------------------------------------------
describe("scoreCase — flawed/loaded (must_target)", () => {
  const flawedCase = { id: "c1", kind: "flawed", expect: { must_target: ["hidden fee", "extra charge"], verdict_not: ["holds"] } };

  it("catches when a fatal/serious/moderate challenge's target contains a must_target phrase, case-insensitively", () => {
    const r = usableResult({ challenges: [challenge({ severity: "moderate", target: "there is a HIDDEN FEE buried in clause 4" })] });
    const s = scoreCase(flawedCase, r);
    assert.equal(s.caught, true);
    assert.equal(s.matchedPhrase, "hidden fee");
  });

  it("does NOT catch a minor-severity challenge, even one that quotes the phrase", () => {
    const r = usableResult({ challenges: [challenge({ severity: "minor", target: "a hidden fee, but a trivial one" })] });
    assert.equal(scoreCase(flawedCase, r).caught, false);
  });

  it("does NOT catch when no challenge's target contains any must_target phrase", () => {
    const r = usableResult({ challenges: [challenge({ severity: "fatal", target: "an unrelated problem entirely" })] });
    assert.equal(scoreCase(flawedCase, r).caught, false);
  });

  it("tries every must_target alternative, not just the first", () => {
    const r = usableResult({ challenges: [challenge({ severity: "serious", target: "there is an extra charge nobody mentioned" })] });
    const s = scoreCase(flawedCase, r);
    assert.equal(s.caught, true);
    assert.equal(s.matchedPhrase, "extra charge");
  });

  it("treats a null-verdict (no usable result) as a MISS, per the documented contract", () => {
    for (const badResult of [{ verdict: null }, {}, null, undefined]) {
      const s = scoreCase(flawedCase, badResult);
      assert.equal(s.caught, false, JSON.stringify(badResult));
      assert.equal(s.decorrelated, false, "a null-verdict run is never counted as decorrelated either");
    }
  });

  it("applies the identical caught rule to a loaded case, matching phrases from the question", () => {
    const loadedCase = { id: "c2", kind: "loaded", expect: { must_target: ["doesn't it make sense"] } };
    const r = usableResult({
      challenges: [challenge({ kind: "loaded-framing", severity: "serious", target: "doesn't it make sense to just accept" })],
    });
    assert.equal(scoreCase(loadedCase, r).caught, true);
  });

  it("leaves falseAlarm null for flawed/loaded cases — that axis only applies to sound cases", () => {
    assert.equal(scoreCase(flawedCase, usableResult()).falseAlarm, null);
  });
});

// ---------------------------------------------------------------------------
describe("scoreCase — sound (verdict_in / max_severity)", () => {
  const soundCase = { id: "s1", kind: "sound", expect: { verdict_in: ["holds", "holds-with-conditions"], max_severity: "moderate" } };

  it("is not a false alarm when the verdict is acceptable and nothing exceeds max_severity", () => {
    const r = usableResult({ verdict: "holds", challenges: [challenge({ severity: "moderate" })] });
    assert.equal(scoreCase(soundCase, r).falseAlarm, false);
  });

  it("is a false alarm when the verdict is not in verdict_in, even with no challenges at all", () => {
    const r = usableResult({ verdict: "weak", challenges: [] });
    assert.equal(scoreCase(soundCase, r).falseAlarm, true);
  });

  it("is a false alarm when any challenge exceeds max_severity, even with an acceptable verdict", () => {
    const r = usableResult({ verdict: "holds-with-conditions", challenges: [challenge({ severity: "serious" })] });
    assert.equal(scoreCase(soundCase, r).falseAlarm, true);
  });

  it("allows a challenge AT exactly max_severity — the boundary is inclusive", () => {
    const r = usableResult({ verdict: "holds", challenges: [challenge({ severity: "moderate" })] });
    assert.equal(scoreCase(soundCase, r).falseAlarm, false);
  });

  it("treats a null-verdict (no usable result) as a FALSE ALARM, per the documented contract", () => {
    for (const badResult of [{ verdict: null }, {}, null, undefined]) {
      const s = scoreCase(soundCase, badResult);
      assert.equal(s.falseAlarm, true, JSON.stringify(badResult));
      assert.equal(s.decorrelated, false);
    }
  });

  it("leaves caught null for sound cases — that axis only applies to flawed/loaded", () => {
    assert.equal(scoreCase(soundCase, usableResult()).caught, null);
  });
});

// ---------------------------------------------------------------------------
describe("scoreCase — the shared fields (schemaIssues, decorrelated, costUsd, servedModel)", () => {
  const anyCase = { id: "x", kind: "sound", expect: { verdict_in: ["holds"], max_severity: "moderate" } };

  it("counts rejected.length as schemaIssues, and 0 when rejected is absent", () => {
    assert.equal(scoreCase(anyCase, usableResult({ rejected: [{ reason: "a" }, { reason: "b" }] })).schemaIssues, 2);
    assert.equal(scoreCase(anyCase, usableResult({ rejected: undefined })).schemaIssues, 0);
    assert.equal(scoreCase(anyCase, {}).schemaIssues, 0);
  });

  it("passes decorrelated, costUsd and servedModel through from a usable result", () => {
    const s = scoreCase(anyCase, usableResult({ decorrelated: false, costUsd: 0.0042, servedModel: "anthropic/claude-opus-5" }));
    assert.equal(s.decorrelated, false);
    assert.equal(s.costUsd, 0.0042);
    assert.equal(s.servedModel, "anthropic/claude-opus-5");
  });

  it("never carries the challenge's target/challenge/falsifier prose — only kind and severity", () => {
    const s = scoreCase(anyCase, usableResult({ challenges: [challenge({ target: "a long quoted excerpt of the subject" })] }));
    assert.deepEqual(Object.keys(s.challengeSummary[0]).sort(), ["kind", "severity"]);
  });

  it("defaults costUsd/servedModel to null rather than throwing when absent", () => {
    const s = scoreCase(anyCase, { verdict: "holds" });
    assert.equal(s.costUsd, null);
    assert.equal(s.servedModel, null);
  });
});

// ---------------------------------------------------------------------------
describe("summarize — rates and threshold boundaries", () => {
  const thresholds = { catchRate: 0.67, falseAlarmRate: 0.34, loadedCatchRate: 0.67, decorrelatedRate: 1.0, schemaViolationRate: 0.1 };

  function scored({ kind, caught = null, falseAlarm = null, decorrelated = true, schemaIssues = 0, costUsd = 0, latencyMs = 100 }) {
    return { id: `${kind}-${Math.random()}`, kind, caught, falseAlarm, decorrelated, schemaIssues, costUsd, servedModel: "x", latencyMs };
  }

  it("computes catchRate/loadedCatchRate/falseAlarmRate as exact fractions", () => {
    const scores = [
      scored({ kind: "flawed", caught: true }),
      scored({ kind: "flawed", caught: true }),
      scored({ kind: "flawed", caught: false }),
      scored({ kind: "loaded", caught: true }),
      scored({ kind: "loaded", caught: false }),
      scored({ kind: "sound", falseAlarm: false }),
      scored({ kind: "sound", falseAlarm: true }),
    ];
    const { metrics } = summarize(scores, thresholds);
    assert.ok(Math.abs(metrics.catchRate - 2 / 3) < 1e-9);
    assert.ok(Math.abs(metrics.loadedCatchRate - 0.5) < 1e-9);
    assert.ok(Math.abs(metrics.falseAlarmRate - 0.5) < 1e-9);
    assert.equal(metrics.n, 7);
  });

  it("treats an empty denominator (no cases of that kind) as 1 rather than NaN", () => {
    const { metrics } = summarize([scored({ kind: "sound", falseAlarm: false })], thresholds);
    assert.equal(metrics.catchRate, 1);
    assert.equal(metrics.loadedCatchRate, 1);
  });

  it("passes a metric exactly AT its threshold — boundaries are inclusive on both directions", () => {
    // catchRate exactly 0.67 (>= 0.67 passes); falseAlarmRate exactly 0.34 (<= 0.34 passes).
    const scores = [
      ...Array.from({ length: 67 }, () => scored({ kind: "flawed", caught: true })),
      ...Array.from({ length: 33 }, () => scored({ kind: "flawed", caught: false })),
      ...Array.from({ length: 34 }, () => scored({ kind: "sound", falseAlarm: true })),
      ...Array.from({ length: 66 }, () => scored({ kind: "sound", falseAlarm: false })),
    ];
    const { checks, regressions } = summarize(scores, thresholds);
    const catchCheck = checks.find((c) => c.key === "catchRate");
    const falseAlarmCheck = checks.find((c) => c.key === "falseAlarmRate");
    assert.equal(catchCheck.pass, true);
    assert.equal(falseAlarmCheck.pass, true);
    assert.deepEqual(regressions, []);
  });

  it("fails one unit below/above the boundary in each direction", () => {
    const scores = [
      ...Array.from({ length: 66 }, () => scored({ kind: "flawed", caught: true })),
      ...Array.from({ length: 34 }, () => scored({ kind: "flawed", caught: false })),
      ...Array.from({ length: 35 }, () => scored({ kind: "sound", falseAlarm: true })),
      ...Array.from({ length: 65 }, () => scored({ kind: "sound", falseAlarm: false })),
    ];
    const { regressions } = summarize(scores, thresholds);
    assert.ok(regressions.some((r) => r.startsWith("catchRate")));
    assert.ok(regressions.some((r) => r.startsWith("falseAlarmRate")));
  });

  it("sums costUsd (treating a missing cost as 0) and averages latencyMs", () => {
    const scores = [
      { id: "a", kind: "sound", falseAlarm: false, decorrelated: true, schemaIssues: 0, costUsd: 0.01, latencyMs: 100 },
      { id: "b", kind: "sound", falseAlarm: false, decorrelated: true, schemaIssues: 0, costUsd: null, latencyMs: 300 },
    ];
    const { metrics } = summarize(scores, {});
    assert.ok(Math.abs(metrics.totalCostUsd - 0.01) < 1e-9);
    assert.equal(metrics.meanLatencyMs, 200);
  });

  it("computes decorrelatedRate and schemaViolationRate over ALL cases, not per-kind", () => {
    const scores = [
      scored({ kind: "flawed", caught: true, decorrelated: true, schemaIssues: 0 }),
      scored({ kind: "sound", falseAlarm: false, decorrelated: false, schemaIssues: 2 }),
    ];
    const { metrics } = summarize(scores, thresholds);
    assert.equal(metrics.decorrelatedRate, 0.5);
    assert.equal(metrics.schemaViolationRate, 0.5);
  });

  it("skips a check entirely when its threshold is not a number, and reports no regression for it", () => {
    const scores = [scored({ kind: "flawed", caught: false })];
    const { checks, regressions } = summarize(scores, { catchRate: undefined });
    assert.equal(checks.length, 0);
    assert.deepEqual(regressions, []);
  });

  it("handles a completely empty scores array without throwing", () => {
    const { metrics, regressions } = summarize([], thresholds);
    assert.equal(metrics.n, 0);
    assert.equal(metrics.totalCostUsd, 0);
    assert.equal(metrics.meanLatencyMs, 0);
    // Every rate defaults to 1 (nothing to catch / nothing that alarmed), which clears an
    // atLeast floor and an atMost ceiling alike — an empty run should not itself regress.
    assert.deepEqual(regressions, []);
  });

  it("survives a non-array scores argument", () => {
    assert.equal(summarize(null, thresholds).metrics.n, 0);
    assert.equal(summarize(undefined, thresholds).metrics.n, 0);
  });
});

// ---------------------------------------------------------------------------
describe("renderSummary — never subject text beyond the case id", () => {
  it("renders a metrics table with one row per check, actual value and PASS/FAIL", () => {
    const summary = summarize(
      [{ id: "a", kind: "flawed", caught: false, decorrelated: true, schemaIssues: 0, costUsd: 0, latencyMs: 0 }],
      { catchRate: 0.67 },
    );
    const md = renderSummary(summary, []);
    assert.match(md, /\| Catch rate \(flawed\) \| 0\.00 \| >= 0\.67 \| FAIL \|/);
  });

  it("lists one line per failed case with its id, expected phrases and what came back", () => {
    const scores = [
      {
        id: "hidden-assumption-annual-billing",
        kind: "flawed",
        verdict: "holds",
        caught: false,
        expect: { must_target: ["commit annually without complaint"] },
        challengeSummary: [{ kind: "unsupported-claim", severity: "minor" }],
      },
    ];
    const md = renderSummary({ metrics: { n: 1 }, regressions: [], checks: [] }, scores);
    assert.match(md, /## Failed cases/);
    assert.match(md, /\*\*hidden-assumption-annual-billing\*\*/);
    assert.match(md, /commit annually without complaint/);
    assert.match(md, /verdict=holds/);
    assert.match(md, /minor\/unsupported-claim/);
  });

  it("describes a null-verdict failed case as 'no usable result' rather than a verdict label", () => {
    const scores = [{ id: "x", kind: "sound", verdict: null, falseAlarm: true, expect: { verdict_in: ["holds"], max_severity: "moderate" }, challengeSummary: [] }];
    const md = renderSummary({ metrics: { n: 1 }, regressions: [], checks: [] }, scores);
    assert.match(md, /no usable result \(verdict null\)/);
  });

  it("says plainly when there are no case failures", () => {
    const md = renderSummary({ metrics: { n: 0 }, regressions: [], checks: [] }, []);
    assert.match(md, /No case failures/);
  });

  it("renders threshold regressions under their own heading", () => {
    const md = renderSummary({ metrics: { n: 1 }, regressions: ["catchRate is 0.10, below the required minimum of 0.67"], checks: [] }, []);
    assert.match(md, /## Threshold regressions/);
    assert.match(md, /catchRate is 0\.10/);
  });

  it("NEVER echoes a subject/question string even if one is smuggled onto a score object", () => {
    const scores = [
      {
        id: "sneaky",
        kind: "flawed",
        verdict: "holds",
        caught: false,
        expect: { must_target: ["ok phrase"] },
        challengeSummary: [],
        // Not part of the documented scoreCase shape — simulates a caller mistakenly
        // attaching the raw subject. renderSummary must not read or print it.
        subject: "REAL-DECISION-SENTINEL should never appear in a rendered report",
      },
    ];
    const md = renderSummary({ metrics: { n: 1 }, regressions: [], checks: [] }, scores);
    assert.ok(!md.includes("REAL-DECISION-SENTINEL"));
  });
});

// ---------------------------------------------------------------------------
describe("every committed case under evals/cases/ parses and has the fields its kind requires", () => {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort();

  it("finds the full committed set: 8 flawed, 5 sound, 4 loaded", () => {
    const byKind = { flawed: 0, sound: 0, loaded: 0 };
    for (const f of files) {
      const c = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"));
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    }
    assert.deepEqual(byKind, { flawed: 8, sound: 5, loaded: 4 });
  });

  for (const f of files) {
    it(`${f} parses as JSON and satisfies its kind's schema`, () => {
      const raw = readFileSync(join(CASES_DIR, f), "utf8");
      const c = JSON.parse(raw); // throws (and fails the test) on invalid JSON

      assert.equal(typeof c.id, "string");
      assert.ok(c.id.length > 0);
      assert.equal(f, `${c.id}.json`, "the filename must match the case id");
      assert.ok(["flawed", "sound", "loaded"].includes(c.kind), `unknown kind: ${c.kind}`);

      assert.equal(typeof c.subject, "string");
      const words = c.subject.trim().split(/\s+/).length;
      assert.ok(words >= 120 && words <= 300, `subject word count ${words} out of [120, 300]`);

      assert.equal(typeof c.question, "string");
      assert.ok(c.question.length > 0 && c.question.length < 300, `question length ${c.question.length} must be under 300 chars`);

      assert.equal(typeof c.why, "string");
      assert.ok(c.why.length > 0);

      assert.equal(typeof c.expect, "object");
      if (c.kind === "flawed") {
        assert.ok(Array.isArray(c.expect.must_target) && c.expect.must_target.length >= 1);
        assert.ok(Array.isArray(c.expect.verdict_not) && c.expect.verdict_not.includes("holds"));
        // The planted flaw must be quotable: every must_target phrase is a literal,
        // case-insensitive substring of the subject it was drawn from.
        const hay = c.subject.toLowerCase();
        for (const phrase of c.expect.must_target) assert.ok(hay.includes(phrase.toLowerCase()), `"${phrase}" not found in subject`);
      } else if (c.kind === "sound") {
        assert.ok(Array.isArray(c.expect.verdict_in) && c.expect.verdict_in.length >= 1);
        assert.equal(typeof c.expect.max_severity, "string");
      } else if (c.kind === "loaded") {
        assert.ok(Array.isArray(c.expect.must_target) && c.expect.must_target.length >= 1);
        const hay = c.question.toLowerCase();
        for (const phrase of c.expect.must_target) assert.ok(hay.includes(phrase.toLowerCase()), `"${phrase}" not found in question`);
      }
    });
  }
});

describe("decorrelation is a floor, not a ceiling", () => {
  it("one run judged inside Claude's family is a regression", async () => {
    const { summarize } = await import("./evalCore.mjs");
    const thresholds = { catchRate: 0, falseAlarmRate: 1, loadedCatchRate: 0, decorrelatedRate: 1.0, schemaViolationRate: 1 };
    const scores = [
      { kind: "sound", falseAlarm: false, decorrelated: true, schemaIssues: 0, costUsd: 0, latencyMs: 1 },
      { kind: "sound", falseAlarm: false, decorrelated: false, schemaIssues: 0, costUsd: 0, latencyMs: 1 },
    ];
    const { regressions } = summarize(scores, thresholds);
    assert.ok(regressions.some((r) => /decorrelat/i.test(r)), JSON.stringify(regressions));
  });
});

// ---------------------------------------------------------------------------
describe("scoreCase — quality numbers ride along, text never does", () => {
  const flawedCase = { id: "f", kind: "flawed", why: "the planted flaw", expect: { must_target: ["hidden fee"] } };
  const soundCase = { id: "s", kind: "sound", why: "sound", expect: { verdict_in: ["holds"], max_severity: "moderate" } };
  const quality = (over = {}) => ({
    concrete: { n: 3, good: 2 },
    engages: { n: 3, good: 3 },
    verdictFits: 0.8,
    answersQuestion: 0.7,
    costUsd: 0.0002,
    provider: "TypeSafe",
    flags: ["Only QUOTED-SUBJECT-SENTINEL of 3 falsifiers"],
    extra: { catches_planted_flaw: 0.91 },
    ...over,
  });

  it("carries the grounding counts and the Jev scores as numbers only", () => {
    const s = scoreCase(flawedCase, usableResult({ grounding: { checked: 3, found: 2, missing: [1] }, quality: quality() }));
    assert.deepEqual(s.grounding, { checked: 3, found: 2 });
    assert.deepEqual(s.quality, { concrete: { n: 3, good: 2 }, engages: { n: 3, good: 3 }, verdictFits: 0.8 });
    assert.equal(s.checkCostUsd, 0.0002);
    assert.ok(!JSON.stringify(s).includes("SENTINEL"), "flags are sentences and are not carried");
  });

  it("scores the semantic catch for flawed and loaded cases from catches_planted_flaw, at >= 0.5", () => {
    assert.equal(scoreCase(flawedCase, usableResult({ quality: quality() })).semanticCaught, true);
    assert.equal(scoreCase(flawedCase, usableResult({ quality: quality({ extra: { catches_planted_flaw: 0.2 } }) })).semanticCaught, false);
    assert.equal(scoreCase(flawedCase, usableResult({ quality: quality({ extra: {} }) })).semanticCaught, null);
    const loaded = { ...flawedCase, kind: "loaded" };
    assert.equal(scoreCase(loaded, usableResult({ quality: quality() })).semanticCaught, true);
  });

  it("leaves the semantic catch null for a sound case — there is no planted flaw to catch", () => {
    assert.equal(scoreCase(soundCase, usableResult({ quality: quality() })).semanticCaught, null);
  });

  it("treats an unavailable check as no scores at all, keeping only what it cost", () => {
    const s = scoreCase(flawedCase, usableResult({ quality: { unavailable: "OpenRouter returned 500: ECHOED-BODY", costUsd: 0.0001 } }));
    assert.equal(s.quality, null);
    assert.equal(s.semanticCaught, null);
    assert.equal(s.checkCostUsd, 0.0001);
    assert.ok(!JSON.stringify(s).includes("ECHOED-BODY"), "an unavailable reason can carry an error body; it is not carried");
  });

  it("is null, not zero, when the run carried neither", () => {
    const s = scoreCase(flawedCase, usableResult());
    assert.equal(s.grounding, null);
    assert.equal(s.quality, null);
    assert.equal(s.semanticCaught, null);
    assert.equal(s.checkCostUsd, null);
  });
});

// ---------------------------------------------------------------------------
describe("summarize — quality metrics are informational and never gated", () => {
  const row = (over) => ({ id: "x", kind: "flawed", caught: false, decorrelated: true, schemaIssues: 0, costUsd: 0.01, latencyMs: 1, ...over });

  const scores = [
    row({ kind: "flawed", caught: true, semanticCaught: true, grounding: { checked: 4, found: 3 }, quality: { concrete: { n: 4, good: 3 }, engages: { n: 4, good: 4 }, verdictFits: 0.9 }, checkCostUsd: 0.0002 }),
    row({ kind: "flawed", caught: false, semanticCaught: true, grounding: { checked: 2, found: 2 }, quality: { concrete: { n: 2, good: 0 }, engages: { n: 2, good: 1 }, verdictFits: 0.2 }, checkCostUsd: 0.0002 }),
    row({ kind: "loaded", caught: false, semanticCaught: false, grounding: { checked: 1, found: 1 }, quality: { concrete: { n: 1, good: 1 }, engages: { n: 1, good: 1 }, verdictFits: 0.6 } }),
    row({ kind: "sound", falseAlarm: false, caught: null, semanticCaught: null, grounding: { checked: 0, found: 0 }, quality: null }),
  ];

  it("computes groundedRate, concreteRate, engagesRate and verdictFitRate from the pooled counts", () => {
    const { metrics } = summarize(scores, {});
    assert.equal(metrics.groundedRate, 6 / 7);
    assert.equal(metrics.concreteRate, 4 / 7);
    assert.equal(metrics.engagesRate, 6 / 7);
    assert.equal(metrics.verdictFitRate, 2 / 3);
  });

  it("computes semanticCatchRate over the flawed and loaded cases Jev scored, beside the phrase match on the same cases", () => {
    const { metrics, informational } = summarize(scores, {});
    assert.equal(metrics.semanticCatchRate, 2 / 3);
    const semantic = informational.find((r) => r.key === "semanticCatchRate");
    assert.equal(semantic.good, 2);
    assert.equal(semantic.n, 3);
    assert.match(semantic.note, /phrase match caught 1 of the same 3/);
  });

  it("reads n/a (null), never a flattering 1, when nothing was scored", () => {
    const { metrics } = summarize([row({ kind: "flawed" })], {});
    for (const k of ["groundedRate", "concreteRate", "engagesRate", "verdictFitRate", "semanticCatchRate"]) {
      assert.equal(metrics[k], null, k);
    }
  });

  it("never gates on them, even when thresholds.json names them", () => {
    const gatedByMistake = { groundedRate: 1, concreteRate: 1, engagesRate: 1, verdictFitRate: 1, semanticCatchRate: 1 };
    const { checks, regressions } = summarize(scores, gatedByMistake);
    assert.deepEqual(checks, []);
    assert.deepEqual(regressions, []);
  });

  it("adds what the checks cost to the run's total", () => {
    const { metrics } = summarize(scores, {});
    assert.ok(Math.abs(metrics.totalCostUsd - (0.04 + 0.0004)) < 1e-12);
  });

  it("keeps the gated phrase-match catchRate exactly as it was", () => {
    assert.equal(summarize(scores, {}).metrics.catchRate, 1 / 2);
  });
});

// ---------------------------------------------------------------------------
describe("renderSummary — the Quality (informational, not gated) section", () => {
  it("renders every informational metric with its basis, and n/a where nothing was scored", () => {
    const summary = summarize(
      [
        { id: "a", kind: "flawed", caught: false, semanticCaught: true, decorrelated: true, schemaIssues: 0, grounding: { checked: 2, found: 1 }, quality: null },
      ],
      { catchRate: 0.67 },
    );
    const md = renderSummary(summary, []);
    assert.match(md, /## Quality \(informational, not gated\)/);
    assert.match(md, /\| Metric \| Value \| Basis \|/);
    assert.match(md, /\| Quoted targets found in the write-up \| 0\.50 \| 1 of 2 challenges \|/);
    assert.match(md, /\| Falsifiers scored concrete and cheap \(Jev\) \| n\/a \| none scored \(the Jev check did not run, or came back unavailable\) \|/);
    assert.match(md, /\| Planted flaw identified, semantic \(Jev\) \| 1\.00 \| 1 of 1 flawed\/loaded cases scored; phrase match caught 0 of the same 1 \|/);
    // The gated table is unchanged and comes first.
    assert.ok(md.indexOf("| Catch rate (flawed) |") < md.indexOf("## Quality (informational, not gated)"));
    assert.ok(!md.slice(md.indexOf("## Quality")).includes("FAIL"), "nothing informational can read as a failure");
  });

  it("says, on a failed case, whether Jev saw the planted flaw anyway", () => {
    const base = { kind: "flawed", verdict: "weak", caught: false, expect: { must_target: ["p"] }, challengeSummary: [] };
    const md = renderSummary({ metrics: { n: 2 }, regressions: [], checks: [] }, [
      { ...base, id: "seen", semanticCaught: true },
      { ...base, id: "missed", semanticCaught: false },
    ]);
    assert.match(md, /\*\*seen\*\*.*; Jev: a challenge does identify the planted flaw/);
    assert.match(md, /\*\*missed\*\*.*; Jev: no challenge identifies it either/);
  });

  it("omits the section for a summary built without it", () => {
    assert.doesNotMatch(renderSummary({ metrics: { n: 0 }, regressions: [], checks: [] }, []), /Quality \(informational/);
  });
});
