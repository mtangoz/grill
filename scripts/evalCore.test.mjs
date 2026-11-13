// Unit tests for evalCore.mjs — the pure half of the judge's self-improvement measurement
// loop. node:test + node:assert only, no dependencies, no network, no live model.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { actionsRunOf, caseProblems, countRun, publicRunBlock, renderSummary, scoreCase, summarize } from "./evalCore.mjs";
import { JUDGE_COMPANY_IDS, isCommitHash, isIsoDate, validateRegressionRun } from "./resultsCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "..", "evals", "cases");
const RESULTS_PATH = join(HERE, "..", "data", "results.json");
const FIRST_RUN_PATH = join(HERE, "fixtures", "eval-run-43354935479.json");

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

// A write-up states a figure the inputs do not support, and states it with confidence.
// The case passes only when the verdict, or a Checked for you blockquote or objection, states
// the corrected figure. Quoting the wrong figure is not enough. Denying the correction is not
// enough. Your call does not count.
describe("scoreCase — a confident wrong figure (checked-or-verdict)", () => {
  const figureCase = {
    id: "figure",
    kind: "flawed",
    why: "the lines add to $2,450",
    expect: {
      must_target: ["costs $2,900"],
      verdict_not: ["holds"],
      catch_in: "checked-or-verdict",
      correction: ["$2,450", "50%"],
    },
  };

  it("passes when the verdict states a corrected figure", () => {
    const s = scoreCase(figureCase, usableResult({ verdictReason: "The three lines add to $2,450.", challenges: [] }));
    assert.equal(s.caught, true);
    assert.equal(s.matchedPhrase, "$2,450");
    assert.equal(JSON.stringify(s).includes("The three lines"), false);
  });

  it("does not pass when the verdict only repeats the wrong figure", () => {
    const s = scoreCase(
      figureCase,
      usableResult({ verdict: "holds", verdictReason: "The weekend costs $2,900, and that total holds.", challenges: [] }),
    );
    assert.equal(s.caught, false);
  });

  it("does not treat 50% as present inside 150%", () => {
    const missed = scoreCase(figureCase, usableResult({ verdictReason: "Replies jumped 150% in July.", challenges: [] }));
    assert.equal(missed.caught, false);
    const hit = scoreCase(figureCase, usableResult({ verdictReason: "The relative change is 50%.", challenges: [] }));
    assert.equal(hit.caught, true);
    assert.equal(hit.matchedPhrase, "50%");
  });

  it("does not pass when a Checked for you challenge quotes the wrong total but objects to the rain", () => {
    const s = scoreCase(
      figureCase,
      usableResult({
        challenges: [
          challenge({
            call: "checked",
            severity: "serious",
            target: "the weekend costs $2,900",
            challenge: "Rain may cut the cups.",
          }),
        ],
      }),
    );
    assert.equal(s.caught, false);
  });

  it("does not pass when the verdict denies the corrected figure and endorses the wrong one", () => {
    const s = scoreCase(
      figureCase,
      usableResult({ verdictReason: "The total is not $2,450; $2,900 is correct.", challenges: [] }),
    );
    assert.equal(s.caught, false);
  });

  it("does not pass when the market-total verdict rejects the correction or only supposes it", () => {
    const market = JSON.parse(readFileSync(join(CASES_DIR, "wrong-figure-market-total.json"), "utf8"));
    for (const verdictReason of ["$2,450 is incorrect; $2,900 is correct", "If the total were $2,450…"]) {
      const s = scoreCase(market, usableResult({ verdictReason, challenges: [] }));
      assert.equal(s.caught, false, verdictReason);
    }
  });

  it("compares the market total by numeric value", () => {
    const market = JSON.parse(readFileSync(join(CASES_DIR, "wrong-figure-market-total.json"), "utf8"));
    for (const verdictReason of ["The lines add to $2,450.", "The correct total is $2,450.00."]) {
      const hit = scoreCase(market, usableResult({ verdictReason, challenges: [] }));
      assert.equal(hit.caught, true, verdictReason);
      assert.equal(hit.matchedPhrase, "$2,450");
    }
    assert.equal(
      scoreCase(market, usableResult({ verdictReason: "The lines add to $2,450,000.", challenges: [] })).caught,
      false,
    );
  });

  it("does not count a figure in a hedged or hypothetical clause", () => {
    const market = JSON.parse(readFileSync(join(CASES_DIR, "wrong-figure-market-total.json"), "utf8"));
    for (const verdictReason of [
      "The total might be $2,450.",
      "The total may be $2,450.",
      "The total could be $2,450.",
      "Perhaps the total is $2,450.",
      "The total is possibly $2,450.",
      "If the total is $2,450.",
      "Suppose the total is $2,450.",
      "The total would be $2,450.",
      "Were the total $2,450, the stall would clear.",
    ]) {
      assert.equal(scoreCase(market, usableResult({ verdictReason, challenges: [] })).caught, false, verdictReason);
    }
    const later = scoreCase(
      market,
      usableResult({ verdictReason: "Rain might cut the cups. The lines add to $2,450.", challenges: [] }),
    );
    assert.equal(later.caught, true);
  });

  it("does not treat a fall as the same direction as a 50% increase", () => {
    const rate = JSON.parse(readFileSync(join(CASES_DIR, "wrong-figure-reply-rate.json"), "utf8"));
    const fell = scoreCase(rate, usableResult({ verdictReason: "The reply rate fell by 50%.", challenges: [] }));
    assert.equal(fell.caught, false);
    const rose = scoreCase(rate, usableResult({ verdictReason: "The reply rate rose by 50%.", challenges: [] }));
    assert.equal(rose.caught, true);
  });

  it("passes when the verdict states the relative increase as 50%", () => {
    const s = scoreCase(figureCase, usableResult({ verdictReason: "The increase is 50%.", challenges: [] }));
    assert.equal(s.caught, true);
    assert.equal(s.matchedPhrase, "50%");
  });

  it("does not pass when the verdict denies 50%", () => {
    const s = scoreCase(figureCase, usableResult({ verdictReason: "The increase is not 50%.", challenges: [] }));
    assert.equal(s.caught, false);
    const equal = scoreCase(figureCase, usableResult({ verdictReason: "The total is not equal to $2,450.", challenges: [] }));
    assert.equal(equal.caught, false);
    const add = scoreCase(figureCase, usableResult({ verdictReason: "The lines do not add to $2,450.", challenges: [] }));
    assert.equal(add.caught, false);
  });

  it("still passes when the corrected figure is stated and the wrong one is denied after it", () => {
    const s = scoreCase(
      figureCase,
      usableResult({ verdictReason: "The lines add to $2,450, not $2,900.", challenges: [] }),
    );
    assert.equal(s.caught, true);
    assert.equal(s.matchedPhrase, "$2,450");
  });

  it("does not pass when only the falsifier or the premise states the corrected figure", () => {
    const falsifier = scoreCase(
      figureCase,
      usableResult({
        challenges: [
          challenge({
            call: "checked",
            severity: "serious",
            target: "Saturday rain",
            challenge: "Rain may cut the cups.",
            falsifier: "A dry Saturday, and the lines add to $2,450.",
          }),
        ],
      }),
    );
    const premise = scoreCase(
      figureCase,
      usableResult({
        challenges: [
          challenge({
            call: "checked",
            severity: "serious",
            target: "Saturday rain",
            challenge: "Rain may cut the cups.",
            what_would_have_to_be_true: "The lines add to $2,450.",
          }),
        ],
      }),
    );
    assert.equal(falsifier.caught, false);
    assert.equal(premise.caught, false);
  });

  it("does not pass when only the falsifier repeats the wrong claim", () => {
    const s = scoreCase(
      figureCase,
      usableResult({
        challenges: [
          challenge({
            call: "checked",
            severity: "serious",
            target: "Saturday rain",
            challenge: "Rain may cut the cups.",
            falsifier: "A dry Saturday, and the weekend costs $2,900.",
          }),
        ],
      }),
    );
    assert.equal(s.caught, false);
  });

  it("passes when a Checked for you challenge states the corrected figure", () => {
    const s = scoreCase(
      figureCase,
      usableResult({
        challenges: [
          challenge({
            call: "checked",
            severity: "moderate",
            target: "the weekend cost",
            challenge: "Those lines add to $2,450. SECRET-CHALLENGE-BODY",
          }),
        ],
      }),
    );
    assert.equal(s.caught, true);
    assert.equal(s.matchedPhrase, "$2,450");
    assert.equal(JSON.stringify(s).includes("SECRET-CHALLENGE-BODY"), false);
  });

  it("does not pass on a Your call challenge, a missing call, or a minor Checked for you note", () => {
    const yours = scoreCase(
      figureCase,
      usableResult({
        challenges: [challenge({ call: "yours", severity: "fatal", target: "costs $2,900", challenge: "The lines add to $2,450." })],
      }),
    );
    const missing = scoreCase(
      figureCase,
      usableResult({ challenges: [challenge({ severity: "fatal", target: "costs $2,900", challenge: "The lines add to $2,450." })] }),
    );
    const minor = scoreCase(
      figureCase,
      usableResult({
        challenges: [challenge({ call: "checked", severity: "minor", target: "costs $2,900", challenge: "The lines add to $2,450." })],
      }),
    );
    assert.equal(yours.caught, false);
    assert.equal(missing.caught, false);
    assert.equal(minor.caught, false);
  });

  it("does not read the steelman or the fix-one-thing line", () => {
    const s = scoreCase(
      figureCase,
      usableResult({
        verdictReason: "The plan is attractive.",
        steelman: "Even so the lines add to $2,450.",
        strongestObjection: "Use $2,450.",
        challenges: [],
      }),
    );
    assert.equal(s.caught, false);
  });

  it("still counts a null verdict as a miss", () => {
    assert.equal(scoreCase(figureCase, { verdict: null, verdictReason: "The lines add to $2,450." }).caught, false);
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

  function scored({ kind, caught = null, falseAlarm = null, decorrelated = true, schemaIssues = 0, costUsd = 0, latencyMs = 100, expect = {} }) {
    return { id: `${kind}-${Math.random()}`, kind, caught, falseAlarm, decorrelated, schemaIssues, costUsd, servedModel: "x", latencyMs, expect };
  }

  it("keeps the old catch-rate floor and requires every wrong-figure case", () => {
    const legacy = (caught, n) => Array.from({ length: n }, () => scored({ kind: "flawed", caught }));
    const figure = (caught) => scored({ kind: "flawed", caught, expect: { catch_in: "checked-or-verdict" } });
    const thresholds = { catchRate: 0.67, figureCatchRate: 1 };
    // Nine of the original fifteen is below 0.67. Four new catches must not lift that floor.
    const hidden = summarize([...legacy(true, 9), ...legacy(false, 6), ...Array.from({ length: 4 }, () => figure(true))], thresholds);
    assert.ok(Math.abs(hidden.metrics.catchRate - 9 / 15) < 1e-9);
    assert.equal(hidden.metrics.figureCatchRate, 1);
    assert.ok(hidden.regressions.some((r) => r.startsWith("catchRate")));
    assert.ok(!hidden.regressions.some((r) => r.startsWith("figureCatchRate")));
    // All fifteen original cases caught, one of the four wrong-figure cases missed.
    const missed = summarize([...legacy(true, 15), figure(true), figure(true), figure(true), figure(false)], thresholds);
    assert.equal(missed.metrics.catchRate, 1);
    assert.equal(missed.metrics.figureCatchRate, 0.75);
    assert.ok(missed.regressions.some((r) => r.startsWith("figureCatchRate")));
    assert.ok(!missed.regressions.some((r) => r.startsWith("catchRate")));
  });

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

  it("finds the full committed set: 19 flawed, 6 sound, 4 loaded", () => {
    const byKind = { flawed: 0, sound: 0, loaded: 0 };
    for (const f of files) {
      const c = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"));
      byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    }
    assert.deepEqual(byKind, { flawed: 19, sound: 6, loaded: 4 });
  });

  it("a cheap reversible try with no data must not be shaky just for lack of data", () => {
    const id = "sound-cheap-revert-subject-line";
    const c = JSON.parse(readFileSync(join(CASES_DIR, `${id}.json`), "utf8"));
    assert.equal(c.kind, "sound");
    assert.deepEqual(c.expect.verdict_in, ["holds", "holds-with-conditions"]);
    assert.equal(c.expect.max_severity, "moderate");
    for (const banned of ["weak", "refuted"]) assert.equal(c.expect.verdict_in.includes(banned), false);
    assert.match(c.subject, /no past test/);
    assert.match(c.subject, /switch back/);
    assert.match(c.subject, /not claiming the short line works/);
    assert.match(c.why, /not grounds for shaky/);
    assert.deepEqual(caseProblems(c, `${id}.json`), []);
  });

  it("an irreversible hazard can still say stop, and an unsupported A-beats-B claim can still be shaky", () => {
    const stop = JSON.parse(readFileSync(join(CASES_DIR, "missing-failure-mode-unlabeled-pecan-glaze.json"), "utf8"));
    assert.equal(stop.kind, "flawed");
    assert.ok(stop.expect.verdict_not.includes("holds"));
    assert.match(stop.subject, /does not undo that serving/);
    assert.match(stop.why, /can still say stop/);
    assert.deepEqual(caseProblems(stop, "missing-failure-mode-unlabeled-pecan-glaze.json"), []);
    const beats = JSON.parse(readFileSync(join(CASES_DIR, "unsupported-claim-short-line-beats-long.json"), "utf8"));
    assert.equal(beats.kind, "flawed");
    assert.ok(beats.expect.verdict_not.includes("holds"));
    assert.match(beats.subject, /short line beats the long one/);
    assert.match(beats.why, /can still be shaky/);
    assert.deepEqual(caseProblems(beats, "unsupported-claim-short-line-beats-long.json"), []);
  });

  // An earlier turn names a hard limit. The later plan does the thing that limit rules out,
  // and does not say it is dropping the limit. The clash is a consistency check, so the
  // judge should file it under Checked for you. The phrase-match gate still scores the catch.
  const MUST_HAVE_BROKEN = [
    "must-have-broken-lemonade-sunday",
    "must-have-broken-bookstore-textbooks",
    "must-have-broken-tutoring-lock",
    "must-have-broken-kiln-insurance",
  ];

  it("the must-have-broken cases state an earlier limit the plan then drops", () => {
    for (const id of MUST_HAVE_BROKEN) {
      const c = JSON.parse(readFileSync(join(CASES_DIR, `${id}.json`), "utf8"));
      assert.equal(c.id, id);
      assert.equal(c.kind, "flawed");
      assert.match(c.subject, /Earlier in the chat/);
      assert.match(c.subject, /must-have/);
      assert.match(c.why, /does not say it is dropping that must-have/);
      assert.ok(c.expect.verdict_not.includes("holds"));
      assert.ok(c.expect.must_target.length >= 2);
      assert.deepEqual(caseProblems(c, `${id}.json`), []);
    }
  });

  // The write-up gives the inputs, then a total, a percentage, or a date those inputs do not
  // support, and it states that figure with confidence. The corrected figure is not in the
  // write-up. The case passes only from the verdict or from Checked for you.
  const WRONG_FIGURE = [
    "wrong-figure-market-total",
    "wrong-figure-reply-rate",
    "wrong-figure-popup-dates",
    "wrong-figure-cake-order",
  ];

  it("the wrong-figure cases state a confident figure the inputs do not support", () => {
    const loaded = Object.fromEntries(
      WRONG_FIGURE.map((id) => {
        const c = JSON.parse(readFileSync(join(CASES_DIR, `${id}.json`), "utf8"));
        assert.equal(c.id, id);
        assert.equal(c.kind, "flawed");
        assert.equal(c.expect.catch_in, "checked-or-verdict");
        assert.ok(c.expect.verdict_not.includes("holds"));
        assert.ok(c.expect.must_target.length >= 2);
        assert.ok(c.expect.correction.length >= 2);
        assert.match(c.subject, /confidence/);
        assert.match(c.why, /confidence/);
        const shown = `${c.subject}\n${c.question}`.toLowerCase();
        for (const phrase of c.expect.correction) {
          assert.equal(shown.includes(phrase.toLowerCase()), false, `${id} already shows ${phrase}`);
        }
        assert.deepEqual(caseProblems(c, `${id}.json`), []);
        return [id, c];
      }),
    );

    const market = loaded["wrong-figure-market-total"];
    assert.match(market.subject, /\$1,200/);
    assert.match(market.subject, /\$800/);
    assert.match(market.subject, /\$450/);
    assert.match(market.subject, /\$2,900/);
    assert.ok(market.expect.correction.some((phrase) => phrase.replace(/[$,]/g, "") === "2450"));

    const rate = loaded["wrong-figure-reply-rate"];
    assert.match(rate.subject, /10%/);
    assert.match(rate.subject, /15%/);
    assert.match(rate.subject, /25%/);
    assert.ok(rate.expect.correction.some((phrase) => /50 percent|50%/.test(phrase)));
    assert.ok(rate.expect.correction.some((phrase) => /5 percentage points/.test(phrase)));

    const popup = loaded["wrong-figure-popup-dates"];
    assert.match(popup.subject, /Monday 6 April 2026/);
    assert.match(popup.subject, /Monday 20 April 2026/);
    assert.match(popup.subject, /ten-day/);
    const inclusive = (Date.UTC(2026, 3, 20) - Date.UTC(2026, 3, 6)) / 86400000 + 1;
    assert.equal(inclusive, 15);
    assert.equal(new Date(Date.UTC(2026, 3, 6)).getUTCDay(), 1);
    assert.equal(new Date(Date.UTC(2026, 3, 20)).getUTCDay(), 1);
    assert.match(popup.subject, /open on every one of these dates/);
    const listed = popup.subject.match(/these dates: ([^.]+)\./);
    assert.ok(listed, "the subject lists the operating dates");
    const days = listed[1].match(/\d+/g).map(Number);
    assert.deepEqual(days, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.equal(popup.subject.includes("not a stall day"), false);
    assert.ok(popup.expect.correction.includes("15 days"));
    assert.equal(popup.expect.correction.some((phrase) => /14/.test(phrase)), false);

    const cake = loaded["wrong-figure-cake-order"];
    assert.match(cake.subject, /forty/);
    assert.match(cake.subject, /\$18/);
    assert.match(cake.subject, /\$900/);
    assert.ok(cake.expect.correction.some((phrase) => phrase.replace(/[$,]/g, "") === "720"));
  });

  for (const f of files) {
    it(`${f} parses as JSON and satisfies its kind's schema`, () => {
      const c = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")); // throws (and fails the test) on invalid JSON
      assert.deepEqual(caseProblems(c, f), []);
      assert.notEqual(c.heldOut, true, "a held-out case never lives in this public repository");
    });
  }
});

describe("caseProblems: one home for the case format", () => {
  const words = (n) => Array.from({ length: n }, (_, i) => (i === 3 ? "a hidden fee" : `w${i}`)).join(" ");
  const flawed = () => ({
    id: "c1",
    kind: "flawed",
    subject: words(150),
    question: "Should we?",
    why: "plants a hidden fee",
    expect: { must_target: ["hidden fee"], verdict_not: ["holds"] },
  });

  it("passes a well-formed case, held out or not", () => {
    assert.deepEqual(caseProblems(flawed(), "c1.json"), []);
    assert.deepEqual(caseProblems({ ...flawed(), heldOut: true }, "c1.json"), []);
    const sound = { ...flawed(), kind: "sound", expect: { verdict_in: ["holds"], max_severity: "moderate" } };
    assert.deepEqual(caseProblems(sound, "c1.json"), []);
    const loaded = { ...flawed(), kind: "loaded", question: "Since it works, shouldn't we ship it?", expect: { must_target: ["since it works"] } };
    assert.deepEqual(caseProblems(loaded, "c1.json"), []);
  });

  it("names each broken rule", () => {
    const has = (c, re, file = "c1.json") => assert.ok(caseProblems(c, file).some((p) => re.test(p)), JSON.stringify(caseProblems(c, file)));
    has(null, /not a JSON object/);
    has({ ...flawed(), id: "" }, /id must be/);
    has(flawed(), /filename must be c1\.json/, "other.json");
    has({ ...flawed(), kind: "maybe" }, /unknown kind/);
    has({ ...flawed(), subject: words(50) }, /word count 52 out of \[120, 300\]/);
    has({ ...flawed(), question: "" }, /question must be/);
    has({ ...flawed(), why: "" }, /why must be/);
    has({ ...flawed(), heldOut: "yes" }, /heldOut/);
    has({ ...flawed(), expect: undefined }, /expect must be an object/);
    has({ ...flawed(), expect: { must_target: ["not in the text"], verdict_not: ["holds"] } }, /"not in the text" not found in subject/);
    has({ ...flawed(), expect: { must_target: ["hidden fee"] } }, /verdict_not must include "holds"/);
    has({ ...flawed(), kind: "sound", expect: { max_severity: "moderate" } }, /verdict_in/);
    has({ ...flawed(), kind: "loaded", expect: { must_target: ["hidden fee"] } }, /"hidden fee" not found in question/);
    has({ ...flawed(), expect: { ...flawed().expect, catch_in: "anywhere" } }, /catch_in must be/);
    has({ ...flawed(), expect: { ...flawed().expect, catch_in: "checked-or-verdict", correction: [] } }, /correction needs/);
    has({ ...flawed(), expect: { ...flawed().expect, catch_in: "checked-or-verdict", correction: ["no"] } }, /at least 3 characters/);
    has(
      { ...flawed(), expect: { ...flawed().expect, catch_in: "checked-or-verdict", correction: ["hidden fee"] } },
      /must not appear in the subject or question/,
    );
    has(
      { ...flawed(), question: "Is $2,450 the total?", expect: { ...flawed().expect, catch_in: "checked-or-verdict", correction: ["$2,450"] } },
      /must not appear in the subject or question/,
    );
    has(
      { ...flawed(), kind: "sound", expect: { verdict_in: ["holds"], max_severity: "moderate", catch_in: "checked-or-verdict", correction: ["$2,450"] } },
      /only for a flawed case/,
    );
  });

  it("accepts a wrong-figure case whose correction is not already in the write-up", () => {
    const c = flawed();
    c.expect = { ...c.expect, catch_in: "checked-or-verdict", correction: ["$2,450"] };
    assert.deepEqual(caseProblems(c, "c1.json"), []);
  });
});

describe("renderSummary: a held-out run shows rates, never a case", () => {
  const scores = [
    { id: "secret-flawed-case", kind: "flawed", verdict: "holds", caught: false, expect: { must_target: ["a private phrase"] }, challengeSummary: [], decorrelated: true, schemaIssues: 0, costUsd: 0.01, latencyMs: 5 },
    { id: "secret-sound-case", kind: "sound", verdict: "weak", falseAlarm: true, expect: { verdict_in: ["holds"], max_severity: "moderate" }, challengeSummary: [{ severity: "serious", kind: "unsupported-claim" }], decorrelated: true, schemaIssues: 0, costUsd: 0.01, latencyMs: 5 },
  ];
  const thresholds = { catchRate: 0.67, falseAlarmRate: 0.34, decorrelatedRate: 1.0, schemaViolationRate: 0.1 };

  it("keeps the ids, phrases and per-case results out, and still reports the rates and the failure count", () => {
    const md = renderSummary(summarize(scores, thresholds), scores, { heldOut: true });
    assert.match(md, /# Grill self-eval results \(held-out set\)/);
    assert.match(md, /Catch rate \(flawed\) \| 0\.00/);
    assert.match(md, /2 of 2 cases failed/);
    assert.match(md, /## Threshold regressions/);
    for (const secret of ["secret-flawed-case", "secret-sound-case", "a private phrase", "unsupported-claim", "## Failed cases"]) {
      assert.ok(!md.includes(secret), `held-out report leaked ${secret}`);
    }
  });

  it("describes a wrong-figure miss as a verdict or Checked for you catch", () => {
    const scores = [
      {
        id: "wrong-figure-market-total",
        kind: "flawed",
        verdict: "holds",
        caught: false,
        expect: { must_target: ["costs $2,900"], correction: ["$2,450"], catch_in: "checked-or-verdict", verdict_not: ["holds"] },
        challengeSummary: [],
        decorrelated: true,
        schemaIssues: 0,
      },
    ];
    const md = renderSummary(summarize(scores, { catchRate: 0 }), scores);
    assert.match(md, /the verdict or a Checked for you objection stating one of: \$2,450/);
  });

  it("keeps an ordinary flawed miss on the challenge-target line", () => {
    const scores = [
      {
        id: "ordinary",
        kind: "flawed",
        verdict: "holds",
        caught: false,
        expect: { must_target: ["hidden fee"], verdict_not: ["holds"] },
        challengeSummary: [],
      },
    ];
    const md = renderSummary({ metrics: { n: 1 }, regressions: [], checks: [] }, scores);
    assert.match(md, /a challenge targeting one of: hidden fee/);
    assert.doesNotMatch(md, /Checked for you/);
  });

  it("leaves the public report as it was", () => {
    const md = renderSummary(summarize(scores, thresholds), scores);
    assert.match(md, /^# Grill self-eval results\n/);
    assert.match(md, /## Failed cases/);
    assert.match(md, /secret-flawed-case/);
  });
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

// ---------------------------------------------------------------------------
// One run as counts. These rows are shaped like scoreCase's output, cut to what a count reads.
const answered = (over) => ({ verdict: "weak", decorrelated: true, schemaIssues: 0, servedModel: "openai/gpt-6.1-sol", challengeSummary: [], ...over });
const unanswered = (over) => ({ verdict: null, decorrelated: false, schemaIssues: 0, servedModel: null, challengeSummary: [], ...over });
const MIXED_RUN = [
  answered({ kind: "flawed", caught: true, semanticCaught: true, grounding: { checked: 3, found: 2 } }),
  answered({ kind: "flawed", caught: false, semanticCaught: true, servedModel: "google/gemini-4-carbon", grounding: { checked: 2, found: 2 } }),
  answered({ kind: "flawed", caught: true, semanticCaught: null, expect: { catch_in: "checked-or-verdict" }, servedModel: "moonshotai/kimi-k3.1-pro" }),
  answered({ kind: "loaded", caught: true, semanticCaught: false, servedModel: "some-new-lab/model-1", schemaIssues: 2 }),
  answered({ kind: "sound", falseAlarm: true, servedModel: "openai/gpt-6.1-terra" }),
  answered({ kind: "sound", falseAlarm: false, servedModel: "claude-opus-5", decorrelated: false }),
  answered({ kind: "sound", falseAlarm: false, servedModel: null }),
  unanswered({ kind: "flawed", caught: false, semanticCaught: null }),
  unanswered({ kind: "sound", falseAlarm: true, servedModel: "openai/gpt-5.3-codex" }),
];

describe("countRun: one run as whole numbers", () => {
  it("counts each kind, and keeps the wrong-figure cases apart from the other flawed cases", () => {
    const c = countRun(MIXED_RUN);
    assert.equal(c.cases, 9);
    assert.deepEqual(c.flawed, { caught: 1, of: 3 });
    assert.deepEqual(c.wrongFigure, { caught: 1, of: 1 });
    assert.deepEqual(c.loaded, { caught: 1, of: 1 });
    assert.deepEqual(c.sound, { falseAlarms: 2, of: 4 });
    assert.deepEqual(c.schemaViolations, { k: 1, of: 9 });
    assert.deepEqual(c.differentCompany, { k: 6, of: 9 });
    assert.deepEqual(c.quotes, { found: 4, of: 5 });
    assert.deepEqual(c.semantic, { caught: 2, of: 3, phraseCaught: 2 });
  });

  it("counts a case as reaching a judge only when a verdict came back", () => {
    assert.equal(countRun(MIXED_RUN).reachedJudge, 7);
    // A model that answered in prose, with no verdict, did not judge the case.
    assert.equal(countRun([unanswered({ kind: "sound", falseAlarm: true, servedModel: "openai/gpt-5.3-codex" })]).reachedJudge, 0);
    assert.equal(countRun([answered({ kind: "sound", falseAlarm: false })]).reachedJudge, 1);
  });

  it("files each answered case under its judge's company, in order of first appearance, and what it cannot place under other", () => {
    const { byCompany, reachedJudge } = countRun(MIXED_RUN);
    assert.deepEqual(byCompany, [
      { company: "openai", cases: 2, planted: 1, caught: 1, sound: 1, falseAlarms: 1 },
      { company: "google", cases: 1, planted: 1, caught: 0, sound: 0, falseAlarms: 0 },
      { company: "moonshotai", cases: 1, planted: 1, caught: 1, sound: 0, falseAlarms: 0 },
      { company: "other", cases: 2, planted: 1, caught: 1, sound: 1, falseAlarms: 0 },
      { company: "anthropic", cases: 1, planted: 0, caught: 0, sound: 1, falseAlarms: 0 },
    ]);
    assert.equal(byCompany.reduce((sum, row) => sum + row.cases, 0), reachedJudge, "a case with no verdict is in no row");
    for (const row of byCompany) assert.ok(JUDGE_COMPANY_IDS.includes(row.company), row.company);
  });

  it("survives an empty run, a non-array and a hole in the list", () => {
    for (const nothing of [[], null, undefined, "scores"]) {
      const c = countRun(nothing);
      assert.equal(c.cases, 0);
      assert.equal(c.reachedJudge, 0);
      assert.deepEqual(c.byCompany, []);
    }
    assert.equal(countRun([null, answered({ kind: "sound", falseAlarm: false })]).cases, 1);
  });
});

// ---------------------------------------------------------------------------
describe("summarize and renderSummary: the counts beside the rates", () => {
  const thresholds = { catchRate: 0.67, figureCatchRate: 1, falseAlarmRate: 0.34, loadedCatchRate: 0.67, decorrelatedRate: 1.0, schemaViolationRate: 0.1 };

  it("carries the count behind each gated rate, and the run's counts", () => {
    const { checks, counts, metrics } = summarize(MIXED_RUN, thresholds);
    const behind = Object.fromEntries(checks.map((c) => [c.key, [c.k, c.of]]));
    assert.deepEqual(behind, {
      catchRate: [1, 3],
      figureCatchRate: [1, 1],
      falseAlarmRate: [2, 4],
      loadedCatchRate: [1, 1],
      decorrelatedRate: [6, 9],
      schemaViolationRate: [1, 9],
    });
    for (const c of checks) assert.equal(c.actual, c.k / c.of, c.key);
    assert.deepEqual(counts, countRun(MIXED_RUN));
    assert.equal(metrics.n, 9);
  });

  it("renders a Count column after Status, and keeps each row as it was before it", () => {
    const md = renderSummary(summarize(MIXED_RUN, thresholds), MIXED_RUN);
    assert.match(md, /^\| Metric \| Value \| Threshold \| Status \| Count \|$/m);
    assert.match(md, /^\| Catch rate \(flawed\) \| 0\.33 \| >= 0\.67 \| FAIL \| 1 of 3 \|$/m);
    assert.match(md, /^\| Catch rate \(wrong figure\) \| 1\.00 \| >= 1 \| PASS \| 1 of 1 \|$/m);
    assert.match(md, /^\| False alarm rate \(sound\) \| 0\.50 \| <= 0\.34 \| FAIL \| 2 of 4 \|$/m);
    assert.match(md, /^\| Schema violation rate \| 0\.11 \| <= 0\.1 \| FAIL \| 1 of 9 \|$/m);
  });

  it("names the routing check in plain words, not as a decorrelated rate", () => {
    const md = renderSummary(summarize(MIXED_RUN, thresholds), MIXED_RUN);
    assert.match(md, /^\| Judge from a different company than the declared author \| 0\.67 \| >= 1 \| FAIL \| 6 of 9 \|$/m);
    assert.doesNotMatch(md, /Decorrelated rate/);
  });

  it("says how many cases reached a judge, and that the rest are scored as misses or false alarms", () => {
    const md = renderSummary(summarize(MIXED_RUN, thresholds), MIXED_RUN);
    assert.match(md, /^Reached a judge: 7 of 9 cases\. 2 cases got no verdict\. They are scored below as misses or false alarms\.$/m);
    assert.ok(md.indexOf("Reached a judge:") < md.indexOf("| Metric | Value | Threshold |"), "before the table it qualifies");

    const all = MIXED_RUN.filter((s) => s.verdict !== null);
    assert.match(renderSummary(summarize(all, thresholds), all), /^Reached a judge: 7 of 7 cases\.$/m);
  });

  it("lists judge companies with counts only: no rate, no pass or fail, no model name", () => {
    const md = renderSummary(summarize(MIXED_RUN, thresholds), MIXED_RUN);
    const from = md.indexOf("## By judge company (counts, not gated)");
    assert.ok(from > md.indexOf("| Metric | Value | Threshold |"), "after the gated table");
    const section = md.slice(from, md.indexOf("## Failed cases"));
    assert.deepEqual(
      section.split("\n").filter((line) => line.startsWith("| ")),
      [
        "| Judge company | Cases | Planted flaws caught | False alarms on sound cases |",
        "| --- | --- | --- | --- |",
        "| openai | 2 | 1 of 1 | 1 of 1 |",
        "| google | 1 | 0 of 1 | 0 of 0 |",
        "| moonshotai | 1 | 1 of 1 | 0 of 0 |",
        "| other | 2 | 1 of 1 | 0 of 1 |",
        "| anthropic | 1 | 0 of 0 | 0 of 1 |",
      ],
    );
    assert.match(section, /_One run\. Too few cases to compare companies\. 2 cases got no verdict and are in no row\._/);
    assert.doesNotMatch(section, /PASS|FAIL|\d\.\d\d|%|gpt|gemini|kimi|claude|\$/);
  });

  it("a held-out run shows the company counts and still no case", () => {
    const scores = [
      answered({ id: "secret-flawed-case", kind: "flawed", verdict: "holds", caught: false, expect: { must_target: ["a private phrase"] }, challengeSummary: [] }),
      answered({ id: "secret-sound-case", kind: "sound", falseAlarm: true, expect: { verdict_in: ["holds"], max_severity: "moderate" }, challengeSummary: [{ severity: "serious", kind: "unsupported-claim" }] }),
    ];
    const md = renderSummary(summarize(scores, thresholds), scores, { heldOut: true });
    assert.match(md, /^Reached a judge: 2 of 2 cases\.$/m);
    assert.match(md, /^\| openai \| 2 \| 0 of 1 \| 1 of 1 \|$/m);
    for (const secret of ["secret-flawed-case", "secret-sound-case", "a private phrase", "unsupported-claim", "gpt-6.1"]) {
      assert.ok(!md.includes(secret), `held-out report leaked ${secret}`);
    }
  });

  it("a summary that carries no counts renders no reached line and no company table", () => {
    const old = { metrics: { n: 1 }, regressions: [], checks: [{ key: "catchRate", direction: "atLeast", threshold: 0.67, actual: 1, pass: true }] };
    const md = renderSummary(old, []);
    assert.doesNotMatch(md, /Reached a judge|By judge company/);
    assert.match(md, /^\| Catch rate \(flawed\) \| 1\.00 \| >= 0\.67 \| PASS \|  \|$/m);
  });

  it("omits the company table when no case reached a judge", () => {
    const none = [unanswered({ kind: "flawed", caught: false })];
    const md = renderSummary(summarize(none, thresholds), none);
    assert.match(md, /^Reached a judge: 0 of 1 cases\. 1 case got no verdict\. It is scored below as a miss or a false alarm\.$/m);
    assert.doesNotMatch(md, /By judge company/);
  });
});

// ---------------------------------------------------------------------------
describe("publicRunBlock: the run as data/results.json keeps it", () => {
  const firstRun = JSON.parse(readFileSync(FIRST_RUN_PATH, "utf8"));
  const identity = { date: firstRun.date, runId: firstRun.run_id, commit: firstRun.commit };

  it("the fixture of the first measured run holds only the fields a count is made from", () => {
    assert.equal(firstRun.scores.length, 29);
    const allowed = ["caught", "decorrelated", "expect", "falseAlarm", "grounding", "kind", "schemaIssues", "semanticCaught", "servedModel", "verdict"];
    for (const row of firstRun.scores) {
      for (const key of Object.keys(row)) assert.ok(allowed.includes(key), `unexpected field ${key}`);
      if (row.expect) assert.deepEqual(row.expect, { catch_in: "checked-or-verdict" });
      assert.deepEqual(Object.keys(row.grounding).sort(), ["checked", "found"]);
    }
  });

  it("the first measured run's block equals the run recorded in data/results.json", () => {
    const recorded = JSON.parse(readFileSync(RESULTS_PATH, "utf8")).regression.runs.find((run) => run.run_id === 43354935479);
    assert.ok(recorded, "data/results.json records run 43354935479");
    const text = JSON.stringify(publicRunBlock(firstRun.scores, identity), null, 2);
    assert.deepEqual(validateRegressionRun(JSON.parse(text)), recorded);
  });

  it("gives the counts the first-run note in evals/README.md states", () => {
    const block = publicRunBlock(firstRun.scores, identity);
    assert.equal(block.flawed.caught + block.wrong_figure.caught, 19);
    assert.equal(block.flawed.of + block.wrong_figure.of, 19);
    assert.deepEqual(block.loaded, { caught: 4, of: 4 });
    assert.deepEqual(block.sound, { false_alarms: 2, of: 6 });
    assert.deepEqual(block.schema_violations, { k: 0, of: 29 });
    assert.deepEqual(block.different_company, { k: 29, of: 29 });
    assert.deepEqual(block.quotes, { found: 84, of: 94 });
    assert.deepEqual(block.semantic, { caught: 22, of: 23 });
    assert.deepEqual(Object.fromEntries(block.by_company.map((row) => [row.company, row.cases])), { google: 8, openai: 14, deepseek: 3, minimax: 2, moonshotai: 2 });
  });

  it("holds only whole numbers, one date, one short hash and company ids from the fixed list", () => {
    const block = publicRunBlock(MIXED_RUN, { date: "2026-11-16", runId: 7, commit: "abcdef0" });
    const leaves = [];
    const walk = (value, key) => {
      if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
      else leaves.push([key, value]);
    };
    walk(block, "");
    for (const [key, value] of leaves) {
      if (key === "date") assert.ok(isIsoDate(value));
      else if (key === "commit") assert.ok(isCommitHash(value));
      else if (key === "company") assert.ok(JUDGE_COMPANY_IDS.includes(value), String(value));
      else assert.ok(Number.isSafeInteger(value) && value >= 0, `${key} is a whole number`);
    }
    assert.deepEqual(block.by_company, [
      { company: "openai", cases: 2 },
      { company: "google", cases: 1 },
      { company: "moonshotai", cases: 1 },
      { company: "other", cases: 2 },
      { company: "anthropic", cases: 1 },
    ]);
    assert.equal(block.reached_judge, 7);
    validateRegressionRun(JSON.parse(JSON.stringify(block)));
  });

  it("cannot make a valid block without a run number and a commit", () => {
    assert.throws(() => validateRegressionRun(JSON.parse(JSON.stringify(publicRunBlock(MIXED_RUN, { date: "2026-11-16" })))), /run_id|commit/);
    assert.throws(() => validateRegressionRun(JSON.parse(JSON.stringify(publicRunBlock(MIXED_RUN, { date: "2026-11-16", runId: 7 })))), /commit/);
    assert.throws(() => validateRegressionRun(JSON.parse(JSON.stringify(publicRunBlock(MIXED_RUN)))), /date|run_id|commit/);
  });
});

describe("actionsRunOf: the run number and commit a public block needs", () => {
  const SHA = "303A77F0123456789abcdef0123456789abcdef0";

  it("reads the run number as a whole number and cuts the commit to seven lowercase characters", () => {
    assert.deepEqual(actionsRunOf({ GITHUB_RUN_ID: "43354935479", GITHUB_SHA: SHA }), { runId: 43354935479, commit: "303a77f" });
    assert.deepEqual(actionsRunOf({ GITHUB_RUN_ID: " 12 ", GITHUB_SHA: "abcdef0" }), { runId: 12, commit: "abcdef0" });
  });

  it("is null when either is missing or is not what Actions sets", () => {
    for (const env of [
      {},
      null,
      { GITHUB_RUN_ID: "43354935479" },
      { GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: "0", GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: "-3", GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: "12.5", GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: "99999999999999999999", GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: "local", GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: 12, GITHUB_SHA: SHA },
      { GITHUB_RUN_ID: "12", GITHUB_SHA: "main" },
      { GITHUB_RUN_ID: "12", GITHUB_SHA: "abc" },
      { GITHUB_RUN_ID: "12", GITHUB_SHA: `${SHA}0` },
    ]) {
      assert.equal(actionsRunOf(env), null, JSON.stringify(env));
    }
  });
});

// ---------------------------------------------------------------------------
// evals/README.md states figures. These pins tie them to the recorded run, the thresholds and
// the committed cases, so the note cannot drift from what was measured.
describe("evals/README.md: the first measured run, as counts and with its limits", () => {
  const readme = readFileSync(join(HERE, "..", "evals", "README.md"), "utf8");
  const run = JSON.parse(readFileSync(RESULTS_PATH, "utf8")).regression.runs.find((r) => r.run_id === 43354935479);
  const between = (from, to) => {
    assert.ok(readme.includes(from), `evals/README.md has "${from}"`);
    assert.ok(readme.includes(to), `evals/README.md has "${to}"`);
    return readme.slice(readme.indexOf(from), readme.indexOf(to));
  };
  const note = between("**The first measured run was on", "**The false-alarm gate will flap.**");

  it("states the counts recorded in data/results.json, with the run, its date and its commit", () => {
    assert.ok(note.includes(`**The first measured run was on ${run.date}.**`));
    assert.ok(note.includes(`Actions run ${run.run_id} on commit ${run.commit}, got a verdict on all`));
    assert.equal(run.reached_judge, run.cases);
    assert.match(note.replace(/\s+/g, " "), new RegExp(`got a verdict on all ${run.cases} cases`));
    const flawedCaught = run.flawed.caught + run.wrong_figure.caught;
    const flawedOf = run.flawed.of + run.wrong_figure.of;
    for (const row of [
      `| Flawed cases caught | ${flawedCaught} of ${flawedOf} (${run.flawed.caught} of ${run.flawed.of} plain flawed, ${run.wrong_figure.caught} of ${run.wrong_figure.of} wrong figure) |`,
      `| Loaded questions caught | ${run.loaded.caught} of ${run.loaded.of} |`,
      `| Sound cases that got a false alarm | ${run.sound.false_alarms} of ${run.sound.of} |`,
      `| Cases whose answer broke the output rules | ${run.schema_violations.k} of ${run.schema_violations.of} |`,
      `| Cases served by a model from outside Anthropic | ${run.different_company.k} of ${run.different_company.of} |`,
      `| Quoted targets found in the write-up | ${run.quotes.found} of ${run.quotes.of} |`,
      `| Planted flaw named in other words, as scored by the quality check (Jev) | ${run.semantic.caught} of ${run.semantic.of} |`,
      `| Cases by judge company | ${run.by_company.map((row) => `${row.company} ${row.cases}`).join(", ")} |`,
    ]) {
      assert.ok(note.includes(`${row}\n`), row);
    }
    assert.ok(note.replace(/\s+/g, " ").includes(`${run.quotes.of - run.quotes.found} of the ${run.quotes.of} quoted targets were not found`));
  });

  it("gives no percentage and no rate for that run", () => {
    assert.doesNotMatch(note, /%|percent|\b\d\.\d+\b/i);
  });

  it("carries the two honest readings, and says the routing count is only a routing check", () => {
    const flat = note.replace(/\s+/g, " ");
    assert.ok(flat.includes("These 29 cases were used to write the judge's instructions, so a full catch score says nothing about how good the judge is."));
    assert.ok(flat.includes("It cannot rank one critic against another."));
    assert.ok(flat.includes(`**${run.sound.false_alarms} of the ${run.sound.of} sound plans got a false alarm.** That is one sound plan in three, on a sample of six.`));
    assert.ok(flat.includes("is a routing check."));
    assert.ok(flat.includes("It is not a measure of whether the judge's errors differ from the writer's."));
  });

  it("the false-alarm gate note matches the threshold, the six sound cases and the arithmetic", () => {
    const flap = between("**The false-alarm gate will flap.**", "**Each measured run in GitHub Actions also writes its counts.**").replace(/\s+/g, " ");
    const ceiling = JSON.parse(readFileSync(join(HERE, "..", "evals", "thresholds.json"), "utf8")).falseAlarmRate;
    const sound = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json") && JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")).kind === "sound").length;
    let allowed = 0;
    while ((allowed + 1) / sound <= ceiling) allowed += 1;
    assert.ok(flap.includes(`With ${sound} sound cases, the ${ceiling} ceiling allows ${allowed} false alarms, and the first measured run had exactly ${run.sound.false_alarms}.`));
    assert.equal(allowed, run.sound.false_alarms);
    // The chance of more than `allowed` false alarms in one run when each sound case alarms one time in three.
    const choose = (n, k) => { let c = 1; for (let i = 0; i < k; i += 1) c = (c * (n - i)) / (i + 1); return c; };
    let withinGate = 0;
    for (let k = 0; k <= allowed; k += 1) withinGate += choose(sound, k) * (1 / 3) ** k * (2 / 3) ** (sound - k);
    const red = 1 - withinGate;
    assert.ok(red > 0.28 && red < 0.38, `the gate goes red with probability ${red.toFixed(3)}, which is about one in three`);
    assert.ok(flap.includes("If one in three is the real rate, the gate goes red by chance about one week in three."));
    assert.ok(flap.includes("It is not proof the judge got worse."));
  });

  it("says who measures: a fork skips, and the weekly and manual runs have measured since 2026-11-13", () => {
    const flat = between("**The eval gates only run with a key.**", "**The first measured run was on").replace(/\s+/g, " ");
    assert.ok(flat.includes("A pull request from a fork gets no key, so there the eval prints `SKIPPED: no judge ran` and does not report a score."));
    assert.ok(flat.includes("The repository has had a key since 2026-11-13, so the weekly run and a manual run measure."));
    assert.ok(flat.includes("If the key is missing they fail and say `Not measured`."));
    assert.ok(flat.includes("`Not measured: 0 of N cases reached a judge.`"));
    assert.ok(!readme.includes("CI has no OpenRouter key"));
  });

  it("names the pull request triggers the workflow has", () => {
    const flat = readme.replace(/\s+/g, " ");
    assert.ok(
      flat.includes(
        "A pull request from this repository runs the eval only when it changes `scripts/judge.mjs`, `scripts/judgeCore.mjs`, `scripts/checkCore.mjs`, a file under `cases/` or `thresholds.json`.",
      ),
    );
    const yml = readFileSync(join(HERE, "..", ".github", "workflows", "eval.yml"), "utf8");
    for (const path of ["scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "evals/cases/**", "evals/thresholds.json"]) {
      assert.ok(yml.includes(`      - ${path}\n`), path);
    }
  });

  it("uses no em dash or en dash in what was written on 2026-11-13", () => {
    assert.doesNotMatch(between("**The eval gates only run with a key.**", "**A held-out set keeps the score honest.**"), new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
  });
});
