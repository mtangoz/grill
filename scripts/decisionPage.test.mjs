// How one saved grill reads on Your grills. No network. Made-up records only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, isoDate, lookBack, recordBlock, REVIEW_DAYS, reviewDateFor, shortDecision } from "./reflection.mjs";
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
  impactDetailLine,
  impactLines,
  scorecardLine,
  LOOKBACK_LIST_MAX,
  PENDING_KEEP_DAYS,
  WAITING_GRILL_HOW,
  lookBackTargets,
  lookbackAskText,
  lookbackLabel,
  lookbackSavedText,
  lookbackSaves,
  lookbackWhichText,
  rowsNamed,
  setLookback,
  titledAnswers,
  waitingGrillLine,
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
    assert.equal(lines[1], "2 unknown (impact not confirmed) · 1 called out (not a confirmed change)");
    assert.equal(lines.length, 2);
    assert.equal(impactDetailLine({ unknown: 1, doubted: 0, flagged: 0 }), "1 unknown (impact not confirmed)");
    assert.equal(impactDetailLine({ unknown: 3, doubted: 1, flagged: 2 }), "3 unknown (impact not confirmed) · 1 called out (not a confirmed change) · 2 flagged (not proof)");
    assert.equal(impactDetailLine({ unknown: 0, doubted: 0, flagged: 0 }), "");
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
    assert.equal(impactLines([open])[1], "1 called out (not a confirmed change)");
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
    assert.equal(lines.at(-1), "4 unknown (impact not confirmed) · 3 flagged (not proof)");
    assert.equal(lines.some((line) => /wrong|incorrect|proven/i.test(line)), false);
    assert.equal(impactLines([flagged]).at(-1), "1 unknown (impact not confirmed) · 1 flagged (not proof)");
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

describe("the Your grills list row", () => {
  it("shows the whole title, never cut short", async () => {
    const { renderDecisionsForTest } = await import("../api/_hosted.mjs");
    const title = "Switch onboarding to a single-question flow before the verdict is shown to new users on mobile, and keep the old flow for desktop for two weeks";
    const html = renderDecisionsForTest({ records: "keep" }, [{ id: "a1", title, block: `version: 1\ndate: 2026-10-01\ntitle: ${title}\nverdict: solid\nreview: 2026-12-01` }], { now: Date.parse("2026-11-08T12:00:00Z") });
    assert.ok(html.includes(`>${title}</a>`), "full title in the list");
    assert.equal(html.includes("…</a>"), false);
  });

  it("keeps the learning line inside the impact block, under the short count", async () => {
    const { renderDecisionsForTest } = await import("../api/_hosted.mjs");
    const title = "Keep the full decision title on the list even when the impact block also shows the learning line";
    const block = (name, verdict) => `version: 1\ndate: 2026-10-01\ntitle: ${name}\nverdict: ${verdict}\nreview: 2026-12-01`;
    const rows = [
      { id: "a1", title, verdict: "shaky", block: block(title, "shaky") },
      { id: "a2", title: "Called out plan", verdict: "doesn't hold up", block: block("Called out plan", "doesn't hold up") },
      { id: "a3", title: "Flagged source", verdict: "solid", challengeKinds: ["unsupported-claim"], block: block("Flagged source", "solid") },
    ];
    const html = renderDecisionsForTest({ records: "keep" }, rows, { now: Date.parse("2026-11-08T12:00:00Z") });
    const impactStart = html.indexOf('<section id="impact">');
    const impactEnd = html.indexOf("</section>", impactStart);
    const impact = html.slice(impactStart, impactEnd);
    assert.match(impact, /2 unknown \(impact not confirmed\) · 1 called out \(not a confirmed change\) · 1 flagged \(not proof\)/);
    assert.match(impact, /3 decisions · 0% looked back/);
    assert.ok(impact.indexOf("2 unknown") < impact.indexOf("3 decisions · 0% looked back"), "the learning line is under the impact count");
    assert.equal((html.match(/3 decisions · 0% looked back/g) || []).length, 1);
    assert.ok(html.includes(`>${title}</a>`));
    assert.equal(html.includes(">Held up<"), false, "outcome taps stay on the record, not the list");
    const empty = renderDecisionsForTest({ records: "keep" }, [], { now: Date.parse("2026-11-08T12:00:00Z") });
    assert.equal(empty.includes("What Grill changed"), false);
    assert.equal(empty.includes("looked back"), false);
  });
});

// The pure pieces behind a look-back answered in chat. Made-up records only.
describe("a look-back answered in chat, when more than one saved decision is in view", () => {
  const row = (id, title, extra = {}) => {
    const fields = { date: "2026-01-01", title, prediction: "", verdict: "shaky", falsifier: "none named", confidence: "60%", review: "2026-01-15", ...extra };
    return { id, title, date: fields.date, review: fields.review, block: recordBlock(fields), lookback: extra.lookback ?? null };
  };
  const LONG = "Move the whole support team to the new office in the spring because the lease on the old one runs out in May and the new one is cheaper";

  it("names a decision by its title as the list shows it, and the day it fell due", () => {
    assert.equal(lookbackLabel(row("a", "Hire contractor")), "Hire contractor (due 15 Jan)");
    assert.equal(lookbackLabel(row("a", "Hire contractor", { review: "" })), "Hire contractor");
    assert.equal(lookbackLabel(row("a", LONG)), `${shortDecision(LONG)} (due 15 Jan)`);
    assert.ok(shortDecision(LONG).endsWith("…"));
  });

  it("matches a name only when it is the title, the label, or the date and title", () => {
    const rows = [row("a", "Hire contractor"), row("b", "Hire contractor for the launch"), row("c", LONG), row("d", "Cut prices.", { date: "2026-01-03" })];
    const ids = (name) => rowsNamed(rows, name).map((item) => item.id);
    assert.deepEqual(ids("Hire contractor"), ["a"]);
    assert.deepEqual(ids("  hire   CONTRACTOR. "), ["a"]);
    assert.deepEqual(ids("Hire contractor (due 15 Jan)"), ["a"]);
    assert.deepEqual(ids("2026-01-01 Hire contractor"), ["a"]);
    assert.deepEqual(ids("Hire contractor for the launch"), ["b"]);
    assert.deepEqual(ids(LONG), ["c"]);
    assert.deepEqual(ids(shortDecision(LONG)), ["c"], "the cut-off title the list showed");
    assert.deepEqual(ids(lookbackLabel(rows[2])), ["c"]);
    assert.deepEqual(ids("Cut prices"), ["d"]);
    assert.deepEqual(ids("2026-01-03 Cut prices."), ["d"]);
    // A near miss is not a match: an answer must not land on the wrong decision.
    for (const miss of ["Hire", "contractor", "the contractor hire", "Hire contractor (due 16 Jan)", "2026-01-02 Hire contractor", "", "   "]) {
      assert.deepEqual(ids(miss), [], miss);
    }
    // Two decisions with one title: the title fits both, the label fits one.
    const twins = [row("x", "Weekly stock order"), row("y", "Weekly stock order", { date: "2026-01-08", review: "2026-01-22" })];
    assert.deepEqual(rowsNamed(twins, "Weekly stock order").map((item) => item.id), ["x", "y"]);
    assert.deepEqual(rowsNamed(twins, "Weekly stock order (due 22 Jan)").map((item) => item.id), ["y"]);
  });

  it("splits an answer at its title lines, and leaves untitled lines with no decision", () => {
    assert.deepEqual(titledAnswers("came_true: yes\nhappened: It went fine."), []);
    assert.deepEqual(titledAnswers("came_true: yes\ntitle: Hire contractor\ncame_true: no\n\nhappened: Left.\n- Title:  Move office \n* happened: Still packing."), [
      { title: "Hire contractor", text: "came_true: no\nhappened: Left." },
      { title: "Move office", text: "happened: Still packing." },
    ]);
    assert.deepEqual(titledAnswers("title:\ncame_true: yes"), [], "a title line with no title names nothing");
    assert.deepEqual(titledAnswers(""), []);
  });

  it("saves the whole answer on one decision, and on several only what each title says", () => {
    const a = row("a", "Hire contractor");
    const b = row("b", "Move office");
    const plain = "came_true: yes\nhappened:   It went fine.";
    assert.deepEqual(lookbackSaves([a], plain), { saves: [{ row: a, happened: "came_true: yes happened: It went fine.", lines: plain }], unmatched: [] });
    assert.deepEqual(lookbackSaves([a, b], plain), { saves: [], unmatched: [] }, "no title, two decisions: saved on neither");
    assert.deepEqual(lookbackSaves([a, b], "   "), { saves: [], unmatched: [] });
    assert.deepEqual(lookbackSaves([], plain), { saves: [], unmatched: [] });
    const titled = lookbackSaves([a, b], "came_true: yes\ntitle: Move office\ncame_true: no\nhappened: Took four weekends.\ntitle: Open a shop\ncame_true: yes\ntitle: Move office\ncame_true: yes");
    assert.deepEqual(titled.saves.map((save) => [save.row.id, save.happened]), [["b", "came_true: no happened: Took four weekends."]], "the first answer for a decision stands");
    assert.deepEqual(titled.unmatched, ["Open a shop"]);
    // A title with nothing under it is not an answer.
    assert.deepEqual(lookbackSaves([a, b], "title: Move office"), { saves: [], unmatched: [] });
    // A long answer is cut where a single one always was.
    assert.equal(lookbackSaves([a], "x".repeat(5000)).saves[0].happened.length, 2000);
    assert.equal(lookbackSaves([a, b], `title: Hire contractor\n${"x".repeat(5000)}`).saves[0].happened.length, 2000);
  });

  it("picks the decisions a call is about: due, named exactly, or matched by a paste", () => {
    const a = row("a", "Hire contractor");
    const b = row("b", "Hire contractor for the launch");
    const now = Date.parse("2026-02-01T12:00:00Z");
    const due = recordsForLookBack([a, b], { now });
    assert.deepEqual(lookBackTargets([a, b], due).map((item) => item.id), ["a", "b"]);
    // The loose match finds both. The exact title picks one.
    const named = recordsForLookBack([a, b], { records: "Hire contractor", now });
    assert.deepEqual(named.rows.map((item) => item.id), ["a", "b"]);
    assert.deepEqual(lookBackTargets([a, b], named, "Hire contractor").map((item) => item.id), ["a"]);
    const loose = recordsForLookBack([a, b], { records: "contractor", now });
    assert.deepEqual(lookBackTargets([a, b], loose, "contractor").map((item) => item.id), ["a", "b"], "a loose name leaves both in view, so the chat asks which");
    const pasted = recordsForLookBack([a, b], { records: b.block, now });
    assert.deepEqual(lookBackTargets([a, b], pasted).map((item) => item.id), ["b"]);
    assert.deepEqual(lookBackTargets([a], pasted), [], "a pasted record that is not saved has nowhere to be saved");
  });

  it("lists at most five by name, then says where the rest are", () => {
    const rows = Array.from({ length: 7 }, (_, index) => row(`r${index}`, `Call ${index + 1}`, { confidence: "", prediction: index === 0 ? "sales to double" : "" }));
    const lines = lookbackAskText(rows).split("\n");
    assert.equal(LOOKBACK_LIST_MAX, 5);
    assert.equal(lines.length, 7);
    assert.equal(lines[0], "Call 1 (due 15 Jan): You predicted sales to double. What happened?");
    assert.equal(lines[4], "Call 5 (due 15 Jan): You didn't write a prediction. What happened?");
    assert.equal(lines[5], "2 more are on https://grillyour.ai/decisions");
    assert.equal(lines[6], "Say which one, and what happened.");
    assert.equal(lookbackAskText(rows.slice(0, 6)).split("\n")[5], "1 more is on https://grillyour.ai/decisions");
    const which = lookbackWhichText(rows.slice(0, 2)).split("\n");
    assert.equal(which[0], "Nothing was saved. That answer did not name one of these decisions. Which one is it about?");
    assert.equal(which.length, 3);
    for (const text of [lookbackAskText(rows), lookbackWhichText(rows)]) assert.doesNotMatch(text, /[\u2013\u2014]/);
  });

  it("never says nothing is stored in a reply that says an answer was saved", () => {
    const a = row("a", "Hire contractor");
    const b = row("b", "Move office");
    const scored = lookBack({ records: a.block, happened: "title: Hire contractor\ncame_true: yes" });
    const unscored = lookBack({ records: a.block, happened: "title: Hire contractor\nhappened: Still going." });
    assert.match(scored, /Nothing is stored\. This reading stays in the chat\./, "the paste route's reading says it, and it is true there");
    assert.match(unscored, /Nothing is stored\. Those notes did not say/);
    for (const reading of [scored, unscored]) {
      for (const pasted of [false, true]) {
        const text = lookbackSavedText({ reading, saved: [a], remaining: [b], pasted });
        assert.doesNotMatch(text, /Nothing is stored/, text);
        assert.match(text, /Saved with your decision record:\nHire contractor/);
      }
    }
    assert.match(lookbackSavedText({ reading: scored, saved: [a], remaining: [b] }), /\n\nStill to answer:\nMove office \(due 15 Jan\): You were 60% sure\. What happened\?$/);
    assert.equal(lookbackSavedText({ reading: scored, saved: [a] }).includes("Still to answer"), false);
  });
});

describe("the first look-back time on a record", () => {
  const T1 = Date.parse("2026-02-01T15:00:00Z");
  const T2 = Date.parse("2026-02-03T09:30:00Z");
  const iso = (ms) => new Date(ms).toISOString();

  it("is set at the first answer and left alone by every later one", () => {
    const row = { id: "a", lookback: null };
    assert.equal(setLookback(row, "came_true: yes", T1), true, "the first time");
    assert.deepEqual(row.lookback, { at: iso(T1), happened: "came_true: yes" });
    assert.equal(row.lookbackFirstAt, iso(T1));
    assert.equal(setLookback(row, "came_true: no", T2), false, "a later answer is not a first time");
    assert.deepEqual(row.lookback, { at: iso(T2), happened: "came_true: no" }, "the edit keeps its own time");
    assert.equal(row.lookbackFirstAt, iso(T1));
  });

  it("lets a note keep the time already there, and survives a cleared note", () => {
    const row = { id: "a", lookback: null };
    assert.equal(setLookback(row, "note: half done", T1, { keepAt: true }), true);
    assert.equal(row.lookback.at, iso(T1));
    assert.equal(setLookback(row, "note: nearly done", T2, { keepAt: true }), false);
    assert.equal(row.lookback.at, iso(T1), "a note does not move the time of the tap it sits beside");
    assert.equal(setLookback(row, "", T2, { keepAt: true }), false);
    assert.equal(row.lookback, null);
    assert.equal(hasLookback(row), false);
    assert.equal(row.lookbackFirstAt, iso(T1));
    assert.equal(setLookback(row, "came_true: yes", T2), false, "looked back once already, so this is not the first");
    assert.equal(row.lookbackFirstAt, iso(T1));
  });

  it("gives a record looked back before this field existed the only time it has", () => {
    const old = { id: "a", lookback: { at: iso(T1), happened: "came_true: yes" } };
    assert.equal(setLookback(old, "came_true: no", T2), false, "it was already looked back");
    assert.equal(old.lookbackFirstAt, iso(T1));
    assert.equal(old.lookback.at, iso(T2));
    // An old look-back with no time of its own: it still is not a first time now.
    const bare = { id: "c", lookback: { happened: "it held" } };
    assert.equal(setLookback(bare, "came_true: yes", T2), false);
    assert.equal(bare.lookbackFirstAt, iso(T2), "the earliest time anyone can state");
    assert.equal(setLookback(bare, "came_true: no", T2 + 60_000), false);
    assert.equal(bare.lookbackFirstAt, iso(T2));
    // A blank note was never a look-back, so the first answer after it is the first.
    const blank = { id: "b", lookback: { at: iso(T1), happened: "   " } };
    assert.equal(setLookback(blank, "came_true: yes", T2), true);
    assert.equal(blank.lookbackFirstAt, iso(T2));
  });
});

describe("the waiting line on Your grills", () => {
  it("counts in plain words, and says nothing when nothing waits", () => {
    assert.equal(waitingGrillLine(0), "");
    assert.equal(waitingGrillLine(-2), "");
    assert.equal(waitingGrillLine("x"), "");
    assert.equal(waitingGrillLine(1), "1 grill is waiting for your call.");
    assert.equal(waitingGrillLine(3), "3 grills are waiting for your call.");
    assert.equal(PENDING_KEEP_DAYS, 14);
    assert.match(WAITING_GRILL_HOW, /A waiting grill is deleted after 14 days\.$/);
  });

  it("shows only while records are on and no filter is set, and replaces the empty line", async () => {
    const { renderDecisionsForTest } = await import("../api/_hosted.mjs");
    const now = Date.parse("2026-11-08T12:00:00Z");
    const waiting = renderDecisionsForTest({ records: "keep" }, [], { now, waiting: 2 });
    assert.match(waiting, /<strong>2 grills are waiting for your call\.<\/strong>/);
    assert.equal(waiting.includes("No decisions saved yet."), false);
    const none = renderDecisionsForTest({ records: "keep" }, [], { now, waiting: 0 });
    assert.match(none, /No decisions saved yet\./);
    assert.equal(none.includes('id="waiting"'), false);
    // Records off: a waiting grill cannot be saved, so the page does not tell the person to save it.
    const off = renderDecisionsForTest({ records: "off" }, [], { now, waiting: 2 });
    assert.equal(off.includes('id="waiting"'), false);
    assert.match(off, /No decisions saved yet\./);
    const filtered = renderDecisionsForTest({ records: "keep" }, [], { now, waiting: 2, type: "work" });
    assert.equal(filtered.includes('id="waiting"'), false);
  });
});
