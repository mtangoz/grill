// How one saved grill reads on Your grills. No network. Made-up records only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, isoDate, REVIEW_DAYS, reviewDateFor, shortDecision } from "./reflection.mjs";
import {
  calendarFeed,
  decisionSource,
  decisionSourceId,
  decisionGroup,
  decisionTakeaways,
  decisionType,
  decisionTypeId,
  dueForLookBack,
  earlyRead,
  hasLookback,
  HOSTED_INSTRUCTIONS,
  lookbackOffer,
  lookbackStatus,
  outcomeLine,
  recordsForLookBack,
  challengeKindList,
  grillImpact,
  impactLines,
  scorecardLine,
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

  it("nudges only when it would change what you do, and never repeats a due look-back", () => {
    const due = decisionTakeaways([{ block: block("shaky"), review: "2026-01-15" }], { now: FEB });
    assert.deepEqual(due.nudges, []);
    const filtered = decisionTakeaways([{ block: block("shaky", ""), review: "2026-03-01" }], { waiting: 4, now: FEB, filtered: true });
    assert.deepEqual(filtered.nudges, ["Add how sure you were. A rough percent is enough."]);
    const both = decisionTakeaways([{ block: block("shaky", "") }], { waiting: 2, now: FEB });
    assert.deepEqual(both.nudges, ["Log your choice after a grill so it counts."]);
  });
});

describe("the list reads as a loop, not an archive", () => {
  const block = (verdict, confidence = "60%") =>
    `version: 1\ndate: 2026-01-01\ntitle: T\nverdict: ${verdict}\nconfidence: ${confidence}\nreview: 2026-01-15`;
  const row = (over = {}) => ({
    title: over.title || "Hire a contractor",
    date: over.date || "2026-01-01",
    review: over.review || "2026-01-15",
    verdict: over.verdict || "shaky",
    block: over.block || block(over.verdict || "shaky"),
    lookback: over.lookback || null,
    sourceApp: over.sourceApp || "claude",
  });

  it("groups a record as due, open, or closed", () => {
    assert.equal(decisionGroup(row(), FEB), "due");
    assert.equal(decisionGroup(row({ review: "2026-02-15" }), FEB), "open");
    assert.equal(decisionGroup(row({ lookback: { happened: "came_true: no" } }), FEB), "closed");
    assert.equal(outcomeLine(row(), FEB), "Due");
    assert.equal(outcomeLine(row({ review: "2026-02-15" }), FEB), "Look back 15 Feb");
    assert.equal(outcomeLine(row({ lookback: { happened: "came_true: yes\nhappened: It shipped." } }), FEB), "Held up");
    assert.equal(outcomeLine(row({ lookback: { happened: "came_true: no happened: It missed." } }), FEB), "Didn't");
  });

  it("hides the scorecard under three records, and the held-up clause under three look-backs", () => {
    const open = row({ review: "2026-03-01" });
    assert.equal(scorecardLine([open, open]), "");
    assert.equal(scorecardLine([open, open, open]), "3 decisions · 0% looked back");
    const held = (verdict, came) =>
      row({
        verdict,
        block: block(verdict),
        lookback: { happened: `came_true: ${came}\nhappened: Noted.` },
      });
    const three = [held("shaky", "no"), held("solid", "yes"), held("solid", "no")];
    assert.equal(scorecardLine(three), "3 decisions · 100% looked back · verdict held up in 2 of 3");
    assert.equal(scorecardLine(three, { type: "work" }), "Work · 3 decisions · 100% looked back · verdict held up in 2 of 3");
    const two = [held("shaky", "no"), held("solid", "yes"), open];
    assert.equal(scorecardLine(two), "3 decisions · 67% looked back");
  });
});

describe("a look-back date follows the decision when it names one", () => {
  const sun = new Date("2026-11-08T15:00:00Z");

  it("uses 14 days when the words name no day", () => {
    assert.equal(reviewDateFor("Hire a contractor", sun), "2026-11-22");
    assert.equal(reviewDateFor("", sun), "2026-11-22");
  });

  it("uses a named weekday, and the morning after a slate", () => {
    assert.equal(reviewDateFor("Ship the billing rewrite Friday", sun), "2026-11-13");
    assert.equal(reviewDateFor("Look after Friday's launch", sun), "2026-11-14");
    assert.equal(reviewDateFor("Captain Ja'Marr this Sunday", sun), "2026-11-09");
    assert.equal(reviewDateFor("Waiver add this gameweek", sun), "2026-11-10");
  });

  it("uses a calendar date when it is still ahead, and ignores one that has passed", () => {
    assert.equal(reviewDateFor("Switch payroll before 15 Nov", sun), "2026-11-15");
    assert.equal(reviewDateFor("The mover comes on November 20", sun), "2026-11-20");
    assert.equal(reviewDateFor("We shipped on 2026-11-01", sun), "2026-11-22");
  });
});

describe("a list title stays on a word", () => {
  it("keeps a short sentence and cuts a long one on a word", () => {
    assert.equal(shortDecision("Hire a contractor"), "Hire a contractor");
    assert.equal(shortDecision("Ship it Friday. Then rewrite billing from scratch over the following month."), "Ship it Friday.");
    const long = "Ship the billing rewrite on Friday if activation is still under the line we set with the team last month";
    const shown = shortDecision(long);
    const body = shown.slice(0, -1);
    assert.ok(shown.endsWith("…"));
    assert.ok(body.length <= 90);
    assert.ok(long.startsWith(body));
    assert.equal(long[body.length], " ");
  });
});

describe("an early read does not count until the look-back is due", () => {
  const block = "version: 1\ndate: 2026-01-01\ntitle: Ship the beta\nverdict: solid\nconfidence: 60%\nreview: 2026-01-15";
  const row = (happened, at) => ({
    block,
    review: "2026-01-15",
    verdict: "solid",
    lookback: { at, happened },
  });
  const before = Date.parse("2026-01-10T15:00:00Z");
  const after = Date.parse("2026-02-01T15:00:00Z");

  it("keeps an early read out of the held-up count, then counts only the latest outcome", () => {
    const first = row("came_true: no\nhappened: It did not hold up.", "2026-01-10T12:00:00.000Z");
    assert.equal(earlyRead(first, before), true);
    const early = decisionTakeaways([first, first, first], { now: before });
    assert.equal(early.looked, 0);
    assert.equal(early.scored, 0);
    assert.equal(early.held, 0);
    const latest = row("came_true: yes\nhappened: Held up.", "2026-02-01T12:00:00.000Z");
    assert.equal(earlyRead(latest, after), false);
    const counted = decisionTakeaways([latest, latest, latest], { now: after });
    assert.equal(counted.looked, 3);
    assert.equal(counted.scored, 3);
    assert.equal(counted.held, 3);
    assert.match(scorecardLine([latest, latest, latest], {}), /verdict held up in 3 of 3/);
    const passed = decisionTakeaways([first, first, first], { now: after });
    assert.equal(passed.held, 0);
    assert.equal(passed.scored, 3);
  });
});

describe("the look-back offer stays after the verdict, and only for a call worth one", () => {
  const sun = new Date("2026-11-08T15:00:00Z");

  it("offers a ship, a price, a near forecast, a slate, and a hire with a date", () => {
    assert.equal(lookbackOffer("Ship the beta Friday", { now: sun }), "Look back on 13 Nov. One tap when it is due.");
    assert.equal(lookbackOffer("Price the workshop at $180", { now: sun }), "Look back on 22 Nov. One tap when it is due.");
    assert.equal(lookbackOffer("Forecast seats sold by Friday", { now: sun }), "Look back on 13 Nov. One tap when it is due.");
    assert.equal(lookbackOffer("Captain Ja'Marr this Sunday", { now: sun }), "Look back on 9 Nov. One tap when it is due.");
    assert.equal(lookbackOffer("Switch payroll before 15 Nov", { now: sun }), "Look back on 15 Nov. One tap when it is due.");
  });

  it("stays quiet for a hire with no date, a life choice, a check, a quick take, and a burst", () => {
    assert.equal(lookbackOffer("Hire a contractor", { now: sun }), "");
    assert.equal(lookbackOffer("Renew the apartment lease", { now: sun }), "");
    assert.equal(lookbackOffer("Forecast 400 signups in March", { now: sun }), "");
    assert.equal(lookbackOffer("Is this migration SQL safe", { now: sun }), "");
    assert.equal(lookbackOffer("Ship the beta Friday", { now: sun, thin: true }), "");
    assert.equal(lookbackOffer("Ship the beta Friday", { now: sun, burst: true }), "");
  });

  it("tells the assistant to show the line, and does not put it in the judge prompt", () => {
    assert.match(HOSTED_INSTRUCTIONS, /When the note has a line that starts with Look back on/);
    assert.match(HOSTED_INSTRUCTIONS, /It is optional/);
    const judge = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../prompts/grill.md"), "utf8");
    assert.doesNotMatch(judge, /Look back on/);
    assert.doesNotMatch(judge, /One tap when it is due/);
  });
});

describe("grill impact", () => {
  const block = (over = {}) =>
    [
      "version: 1",
      "date: 2026-01-01",
      `title: ${over.title || "Ship the beta"}`,
      `verdict: ${over.verdict || "shaky"}`,
      over.decided ? `decided: ${over.decided}` : "",
      over.supersedes ? `supersedes: ${over.supersedes}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  const row = (over = {}) => ({
    title: over.title || "Ship the beta",
    verdict: over.verdict || "shaky",
    decided: over.decided || "",
    supersedes: over.supersedes || "",
    impact: over.impact || "",
    challengeKinds: over.challengeKinds || [],
    block: over.block || block(over),
  });

  it("keeps the judge's kind, and drops one it does not know", () => {
    assert.deepEqual(
      challengeKindList([
        { kind: "Unsupported-Claim" },
        { kind: "nope" },
        { kind: "evidence-mismatch" },
      ]),
      ["unsupported-claim", ""],
    );
    assert.deepEqual(challengeKindList(["1. A line"]), [""]);
    assert.deepEqual(challengeKindList(null), []);
  });

  it("counts a stated change, and leaves a bare verdict out of that count", () => {
    const changed = row({ decided: "Trial two weeks first. | after challenge 1" });
    const replaced = row({ supersedes: "2026-01-01 Ship the beta", decided: "Delay the ship." });
    const doubted = row({ verdict: "doesn't hold up" });
    const shaky = row({ verdict: "shaky" });
    const solid = row({ verdict: "solid" });
    const summary = grillImpact([changed, replaced, doubted, shaky, solid]);
    assert.equal(summary.count, 5);
    assert.equal(summary.changed, 2);
    assert.equal(summary.doubted, 1);
    assert.equal(summary.unknown, 2);
    assert.equal(summary.kept, 0);
    assert.equal(summary.flagged, 0);
    const lines = impactLines([changed, replaced, doubted, shaky, solid]);
    assert.equal(lines[0], "2 of 5 grills changed the call.");
    assert.equal(lines[1], "1 plan was called out as not holding up. That counts only if you say the call moved.");
    assert.equal(lines[2], "2 are still unknown. On a decision, one tap says whether the call moved.");
    assert.equal(lines.includes("Wrong sources or figures: not counted. Nothing saved marks those."), false);
    assert.equal(lines.some((line) => /kept/i.test(line)), false);
  });

  it("counts a doesn't-hold verdict only after Yes, and stays silent on No", () => {
    const yes = row({ verdict: "doesn't hold up", impact: "changed" });
    const no = row({ verdict: "doesn't hold up", impact: "kept", decided: "Go. | after challenge 1", supersedes: "2026-01-01 Old call" });
    const open = row({ verdict: "doesn't hold up" });
    assert.equal(grillImpact([yes]).changed, 1);
    assert.equal(grillImpact([yes]).doubted, 0);
    assert.equal(grillImpact([no]).changed, 0);
    assert.equal(grillImpact([no]).doubted, 0);
    assert.equal(grillImpact([no]).unknown, 0);
    assert.equal(grillImpact([no]).kept, 1);
    assert.equal(impactLines([no])[0], "No grill is marked as changing a call yet.");
    assert.equal(impactLines([no]).length, 1);
    assert.equal(impactLines([open])[0], "No grill is marked as changing a call yet.");
    assert.match(impactLines([open])[1], /1 plan was called out as not holding up/);
    assert.equal(impactLines([yes])[0], "1 of 1 grill changed the call.");
    assert.equal(impactLines([]).length, 0);
  });

  it("shows a source, fact or figure kind as flagged, never as a change", () => {
    const flagged = row({ challengeKinds: ["unsupported-claim", "hidden-assumption"] });
    const figure = row({ verdict: "solid", challengeKinds: ["evidence-mismatch"] });
    const cost = row({ challengeKinds: ["wrong-cost-model"] });
    const other = row({ challengeKinds: ["loaded-framing", "not-a-kind"] });
    const summary = grillImpact([flagged, figure, cost, other]);
    assert.equal(summary.flagged, 3);
    assert.equal(summary.changed, 0);
    const lines = impactLines([flagged, figure, cost, other]);
    assert.equal(lines[0], "No grill is marked as changing a call yet.");
    assert.equal(lines.at(-1), "3 flagged a source, fact or figure. A flag is not proof.");
    assert.equal(lines.some((line) => /wrong|incorrect|proven/i.test(line)), false);
    assert.equal(impactLines([flagged]).at(-1), "1 flagged a source, fact or figure. A flag is not proof.");
  });

  it("does not ask the judge whether the call changed", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    for (const file of ["prompts/grill.md", "skills/grill/paste-prompt.md", "scripts/judgeCore.mjs"]) {
      const text = readFileSync(join(root, file), "utf8");
      assert.doesNotMatch(text, /Did this grill change your call/, file);
    }
    assert.doesNotMatch(HOSTED_INSTRUCTIONS, /Did this grill change your call/);
  });
});
