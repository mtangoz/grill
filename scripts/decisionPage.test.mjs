// How one saved grill reads on Your grills. No network. Made-up records only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decisionType, decisionTypeId, lookbackStatus } from "./hostedCore.mjs";

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
