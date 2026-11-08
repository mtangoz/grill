// How one saved grill reads on Your grills. No network. Made-up records only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decisionTakeaways, decisionType, decisionTypeId, lookbackStatus } from "./hostedCore.mjs";

const FEB = Date.parse("2026-02-01T15:00:00Z");

describe("look-back status", () => {
  it("reads a one-line note as plain words", () => {
    const status = lookbackStatus(
      { review: "2026-01-15", lookback: { happened: "came_true: no happened: The contractor left after a week." } },
      FEB,
    );
    assert.equal(status.state, "done");
    assert.equal(status.text, "It did not come true. The contractor left after a week.");
  });

  it("says when a look-back is due and not done", () => {
    const status = lookbackStatus({ review: "2026-01-15", lookback: null }, FEB);
    assert.equal(status.state, "due");
    assert.equal(status.text, "Due for a look-back since 15 Jan. Not looked back.");
  });

  it("keeps a future look-back as not yet", () => {
    const status = lookbackStatus({ review: "2026-02-15", lookback: null }, FEB);
    assert.equal(status.state, "waiting");
    assert.equal(status.text, "Look back on 15 Feb. Not yet.");
  });

  it("leaves a sentence that is not a score as the sentence", () => {
    const status = lookbackStatus({ lookback: { happened: "The office closed." } }, FEB);
    assert.equal(status.text, "The office closed.");
  });
});

describe("decision type", () => {
  const row = (title, extra = "") => ({ title, block: `version: 1\ndate: 2026-01-01\ntitle: ${title}\nverdict: shaky\n${extra}` });

  it("reads the title first, then the rest of the record", () => {
    assert.equal(decisionType(row("Hire a contractor for the office move")), "work");
    assert.equal(decisionType(row("Price the Saturday workshop at $180")), "money");
    assert.equal(decisionType(row("Ship the beta this Friday")), "product");
    assert.equal(decisionType(row("Start Ja'Marr or sit him, fantasy football")), "fantasy");
    assert.equal(decisionType(row("Move to a new apartment")), "personal");
    assert.equal(decisionType(row("What should I have for lunch")), "other");
    assert.equal(decisionType(row("Ship the beta", "prediction: it costs $180")), "product");
    assert.equal(decisionType(row("A note", "decided: hire the contractor")), "work");
  });

  it("ignores a type that is not one of the categories", () => {
    assert.equal(decisionTypeId("work"), "work");
    assert.equal(decisionTypeId("Work"), "work");
    assert.equal(decisionTypeId("<script>"), "");
    assert.equal(decisionTypeId("sports"), "");
  });
});

describe("takeaways", () => {
  const block = (verdict, confidence = "60%") =>
    `version: 1\ndate: 2026-01-01\ntitle: T\nverdict: ${verdict}\nconfidence: ${confidence}\nreview: 2026-01-15`;

  it("counts look-backs and whether the verdict matched what happened", () => {
    const rows = [
      { block: block("shaky"), review: "2026-01-15", lookback: { happened: "came_true: no happened: It missed." } },
      { block: block("solid"), review: "2026-01-15", lookback: { happened: "came_true: no\nhappened: It missed." } },
      { block: block("shaky", ""), review: "2026-03-01" },
    ];
    const summary = decisionTakeaways(rows, { waiting: 2, now: FEB });
    assert.equal(summary.count, 3);
    assert.equal(summary.looked, 2);
    assert.equal(summary.scored, 2);
    assert.equal(summary.held, 1);
    assert.equal(summary.dueOpen, 0);
    assert.deepEqual(summary.nudges, ["Log your choice after a grill so it counts."]);
  });

  it("nudges a due look-back, and skips the choice nudge on a filtered set", () => {
    const due = decisionTakeaways([{ block: block("shaky"), review: "2026-01-15" }], { now: FEB });
    assert.deepEqual(due.nudges, ["1 decision is due for a look-back."]);
    const filtered = decisionTakeaways([{ block: block("shaky", ""), review: "2026-03-01" }], { waiting: 4, now: FEB, filtered: true });
    assert.deepEqual(filtered.nudges, ["Add how sure you were. A rough percent is enough."]);
  });
});
