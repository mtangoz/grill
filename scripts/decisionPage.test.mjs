// How one saved grill reads on Your grills. No network. Made-up records only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDays, isoDate, REVIEW_DAYS } from "./reflection.mjs";
import {
  calendarFeed,
  decisionSource,
  decisionSourceId,
  decisionTakeaways,
  decisionType,
  decisionTypeId,
  dueForLookBack,
  hasLookback,
  lookbackStatus,
  recordsForLookBack,
} from "./hostedCore.mjs";

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

describe("due look-backs follow the 14-day rule", () => {
  const reviewFor = (date) => isoDate(addDays(new Date(`${date}T00:00:00Z`), REVIEW_DAYS));
  const row = (over = {}) => {
    const date = over.date || "2026-01-01";
    const review = over.review ?? reviewFor(date);
    const title = over.title || "Hire a contractor";
    return {
      id: over.id || "a",
      title,
      date,
      review,
      block: `version: 1\ndate: ${date}\ntitle: ${title}\nreview: ${review}`,
      lookback: over.lookback === undefined ? null : over.lookback,
    };
  };

  it("is due on the review day, 14 days after the decision, and not the day before", () => {
    assert.equal(REVIEW_DAYS, 14);
    const saved = row();
    assert.equal(saved.review, "2026-01-15");
    const leap = row({ id: "leap", date: "2024-02-20" });
    assert.equal(leap.review, "2024-03-05");
    const before = Date.parse("2026-01-14T23:59:59Z");
    const onDay = Date.parse("2026-01-15T00:00:00Z");
    assert.deepEqual(dueForLookBack([saved], before), []);
    assert.deepEqual(dueForLookBack([saved], onDay).map((item) => item.id), ["a"]);
    assert.equal(recordsForLookBack([saved], { now: before }).text, "");
    assert.equal(recordsForLookBack([saved], { now: onDay }).rows[0].id, "a");
    assert.deepEqual(dueForLookBack([leap], Date.parse("2024-03-04T23:59:59Z")), []);
    assert.equal(dueForLookBack([leap], Date.parse("2024-03-05T00:00:00Z"))[0].id, "leap");
  });

  it("leaves out a finished look-back, and keeps a blank note due", () => {
    const onDay = Date.parse("2026-01-15T00:00:00Z");
    const done = row({ lookback: { happened: "came_true: yes" } });
    const blank = row({ id: "b", lookback: { happened: "   " } });
    assert.equal(hasLookback(done), true);
    assert.equal(hasLookback(blank), false);
    assert.deepEqual(dueForLookBack([done], onDay), []);
    assert.deepEqual(dueForLookBack([blank], onDay).map((item) => item.id), ["b"]);
    const summary = decisionTakeaways([blank], { now: onDay });
    assert.equal(summary.looked, 0);
    assert.equal(summary.dueOpen, 1);
    assert.match(calendarFeed({ rows: [blank], now: onDay }), /DTSTART;VALUE=DATE:20260115/);
    assert.doesNotMatch(calendarFeed({ rows: [done], now: onDay }), /BEGIN:VEVENT/);
  });

  it("orders the oldest review first and skips a date that is not a day", () => {
    const now = Date.parse("2026-02-01T15:00:00Z");
    const older = row({ id: "old", review: "2026-01-10" });
    const newer = row({ id: "new", review: "2026-01-20" });
    const junk = row({ id: "junk", review: "soon" });
    const future = row({ id: "later", review: "2026-02-02" });
    assert.deepEqual(dueForLookBack([newer, junk, future, older], now).map((item) => item.id), ["old", "new"]);
  });

  it("reads a pasted record or a named title instead of only what is due", () => {
    const now = Date.parse("2026-01-14T12:00:00Z");
    const saved = row();
    const pasted = recordsForLookBack([saved], { records: saved.block, now });
    assert.equal(pasted.mode, "pasted");
    assert.equal(pasted.text, saved.block);
    const named = recordsForLookBack([saved], { records: "Hire a contractor", now });
    assert.equal(named.mode, "named");
    assert.equal(named.rows[0].id, "a");
    const missed = recordsForLookBack([saved], { records: "Move office", now });
    assert.deepEqual(missed.rows, []);
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

describe("decision source", () => {
  it("groups the stored client, and leaves a missing one unknown", () => {
    assert.equal(decisionSource({ sourceApp: "claude" }), "claude");
    assert.equal(decisionSource({ sourceApp: "claude-code" }), "claude");
    assert.equal(decisionSource({ sourceApp: "chatgpt" }), "chatgpt");
    assert.equal(decisionSource({ sourceApp: "cursor" }), "cursor");
    assert.equal(decisionSource({ sourceApp: "grok" }), "grok");
    assert.equal(decisionSource({ sourceApp: "gemini" }), "other");
    assert.equal(decisionSource({ sourceApp: "unknown" }), "unknown");
    assert.equal(decisionSource({}), "unknown");
    assert.equal(decisionSourceId("Grok"), "grok");
    assert.equal(decisionSourceId("<script>"), "");
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
