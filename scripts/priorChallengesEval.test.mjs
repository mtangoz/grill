import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { falseFixes, markAccuracy, parseCases, passesBar, priorsFrom, sha256, verdictAgreement } from "./priorChallengesEvalCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("prior-challenges eval", () => {
  it("never touches holdout v2: its checksum still matches", () => {
    const text = readFileSync(join(ROOT, "evals/verdict-quality/holdout-v2.jsonl"), "utf8");
    assert.equal(sha256(text), readFileSync(join(ROOT, "evals/verdict-quality/holdout-v2.sha256"), "utf8").trim());
  });

  it("its revision cases are separate, with one hand label per earlier challenge", () => {
    const cases = parseCases(readFileSync(join(ROOT, "evals/prior-challenges/cases.jsonl"), "utf8"));
    assert.ok(cases.length >= 6);
    for (const row of cases) {
      assert.equal(row.priors.length, row.expected.length, row.id);
      for (const label of row.expected) assert.ok(label === "fixed" || label === "open", row.id);
    }
  });

  it("takes earlier challenges from a judge result", () => {
    assert.deepEqual(priorsFrom({ challenges: [{ challenge: " A  b. " }, { falsifier: "x" }, { challenge: "C." }] }), ["A b.", "C."]);
  });

  it("scores agreement, shift, false fixes and accuracy", () => {
    const agree = verdictAgreement([["weak", "weak"], ["weak", "holds"], ["refuted", "nope"]]);
    assert.deepEqual([agree.n, agree.agree, agree.rate, agree.meanShift], [2, 1, 0.5, 1]);
    assert.deepEqual(falseFixes([[{ status: "open" }, { status: "fixed" }], [{ status: "unchecked" }]]), { marks: 3, fixed: 1, unchecked: 1, rate: 1 / 3 });
    const acc = markAccuracy([{ expected: ["fixed", "open"], marks: [{ status: "fixed" }, { status: "fixed" }] }]);
    assert.deepEqual([acc.right, acc.falseFixed, acc.rate], [1, 1, 0.5]);
  });

  it("the bar fails on false fixes, extra verdict movement, or weak marks", () => {
    const good = {
      holdout: { falseFixes: { rate: 0 }, baseline: { rate: 0.7 }, candidate: { rate: 0.68 } },
      revisions: { accuracy: { rate: 0.9 } },
    };
    assert.equal(passesBar(good).pass, true);
    assert.equal(passesBar({ ...good, holdout: { ...good.holdout, falseFixes: { rate: 0.2 } } }).pass, false);
    assert.equal(passesBar({ ...good, holdout: { ...good.holdout, candidate: { rate: 0.4 } } }).pass, false);
    assert.equal(passesBar({ ...good, revisions: { accuracy: { rate: 0.5 } } }).pass, false);
  });
});
