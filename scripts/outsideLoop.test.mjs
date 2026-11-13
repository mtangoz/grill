// The outside counters and the readout that reads them. Made-up accounts and numbers.
// No network: Redis is a stubbed fetch, and the rules are pure functions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPACT_PILOT_LAST } from "./impactDigest.mjs";
import * as core from "./outsideLoopCore.mjs";
import {
  BACKSTOP_DAY,
  LAST_EMAIL_DAY,
  NOT_COUNTED_LINE,
  NOT_TESTED,
  OUTSIDE_APPS,
  OUTSIDE_KEYS,
  OUTSIDE_LIVE_KEY,
  OUTSIDE_PREFIX,
  OUTSIDE_SEEN_KEY,
  addDays,
  cameBackOps,
  choiceOps,
  cohortOf,
  countsAsOutside,
  firstGrillOps,
  firstGrillTime,
  hashCounts,
  internalEmails,
  killThreshold,
  lookbackDateChange,
  lookbackDoneOps,
  lookbackPeopleChange,
  outsideApp,
  outsideLines,
  outsideReading,
  recordsAnswerOps,
} from "./outsideLoopCore.mjs";
import { NOT_CONFIGURED_LINE, outsideLoopLines, readOutsideCounters } from "./outside-loop.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIST = { GRILL_INTERNAL_EMAILS: "owner@grill.example, Tester@Grill.example ,agent@grill.example" };
const OUTSIDER = { id: "g_1f0c-outsider", email: "pat@elsewhere.example" };
const HOUR = 60 * 60 * 1000;
const at = (iso) => Date.parse(iso);

/** Apply counter writes to plain objects, the way HINCRBY would. */
function apply(hashes, ops) {
  for (const [key, field, by] of ops) {
    hashes[key] = hashes[key] || {};
    hashes[key][field] = (hashes[key][field] || 0) + by;
  }
  return hashes;
}

/** Every write a counted account could cause, for one made-up afternoon. */
function everyWrite(env, account) {
  const now = at("2026-12-01T15:00:00Z");
  return [
    ...firstGrillOps(env, account, { firstAt: now, app: "claude" }),
    ...cameBackOps(env, account, { firstAt: now - 30 * HOUR, now }),
    ...recordsAnswerOps(env, account, { keep: true, now }),
    ...recordsAnswerOps(env, account, { keep: false, now }),
    ...choiceOps(env, account, { now }),
    ...lookbackDateChange(env, account, { counted: "", review: "2026-12-15", done: false, now }).ops,
    ...lookbackDoneOps(env, account, { first: true, counted: "2026-12-15", now }),
    ...lookbackPeopleChange(env, account, { mark: "", days: ["2026-12-15"], left: "", now }).ops,
  ];
}

/** The reply shapes the reader gets: one object per counter, as field to number. */
function counters(extra = {}) {
  return {
    firstGrills: {},
    firstGrillApp: {},
    cameBack: {},
    recordsOn: {},
    recordsOff: {},
    choices: {},
    lookbacksDue: {},
    lookbackPeople: {},
    lookbacksDone7d: {},
    lookbacksDone14d: {},
    live: "2026-11-20",
    seen: "2026-12-19",
    ...extra,
  };
}

const lineOf = (lines, start) => lines.find((line) => line.startsWith(start)) || "";

describe("outside counters: who is counted", () => {
  it("unset list writes nothing", () => {
    for (const env of [{}, { GRILL_INTERNAL_EMAILS: "" }, { GRILL_INTERNAL_EMAILS: " , ," }, { GRILL_INTERNAL_EMAILS: "on" }, { GRILL_INTERNAL_EMAILS: "none" }, undefined]) {
      assert.equal(internalEmails(env), null, JSON.stringify(env));
      assert.equal(countsAsOutside(OUTSIDER, env), false);
      assert.deepEqual(everyWrite(env, OUTSIDER), [], "fail closed: no outside write of any kind");
      // A look-back date change leaves the day a record is counted under as it was.
      assert.deepEqual(lookbackDateChange(env, OUTSIDER, { counted: "", review: "2026-12-15", now: at("2026-12-01T15:00:00Z") }), { ops: [], counted: "" });
      assert.deepEqual(lookbackPeopleChange(env, OUTSIDER, { mark: "", days: ["2026-12-15"], now: at("2026-12-01T15:00:00Z") }), { ops: [], mark: "" });
    }
    // With the list set, the same afternoon writes to every counter.
    const keys = new Set(everyWrite(LIST, OUTSIDER).map(([key]) => key));
    assert.deepEqual([...keys].sort(), Object.values(OUTSIDE_KEYS).sort());
  });

  it("leaves out an account on the internal list, by its own address or its person's", () => {
    assert.equal(countsAsOutside(OUTSIDER, LIST), true);
    assert.equal(countsAsOutside({ id: "g_2", email: "OWNER@grill.example" }, LIST), false);
    assert.equal(countsAsOutside({ id: "g_3", email: "tester@grill.example" }, LIST), false, "the list is matched lower-case");
    // An agent signs in with its own address and acts for a person. Either address on the list is enough.
    assert.equal(countsAsOutside({ id: "g_4", email: "bot@agents.example", human: "owner@grill.example" }, LIST), false);
    assert.equal(countsAsOutside({ id: "g_5", email: "agent@grill.example", human: "pat@elsewhere.example" }, LIST), false);
    assert.equal(countsAsOutside({ id: "g_6", email: "bot@agents.example", human: "pat@elsewhere.example" }, LIST), true);
    // No address to check is not "outside".
    assert.equal(countsAsOutside({ id: "g_7" }, LIST), false);
    assert.equal(countsAsOutside(null, LIST), false);
    assert.deepEqual(everyWrite(LIST, { id: "g_2", email: "owner@grill.example" }), []);
  });

  it("holds a day or an app name and a whole number: no title, text, verdict, account id or time of day", () => {
    const account = { id: "g_1f0c-outsider", email: "pat@elsewhere.example", human: "pat@elsewhere.example" };
    const writes = everyWrite(LIST, account);
    assert.ok(writes.length >= 10);
    for (const [key, field, by] of writes) {
      assert.ok(key.startsWith(OUTSIDE_PREFIX), key);
      assert.ok(Object.values(OUTSIDE_KEYS).includes(key), key);
      if (key === OUTSIDE_KEYS.firstGrillApp) assert.ok(OUTSIDE_APPS.includes(field), field);
      else assert.match(field, /^\d{4}-\d{2}-\d{2}$/, `${key} ${field}`);
      assert.ok(by === 1 || by === -1);
    }
    const flat = JSON.stringify(writes);
    assert.equal(flat.includes(account.id), false);
    assert.equal(flat.includes("elsewhere"), false);
    assert.doesNotMatch(flat, /T\d\d:|verdict|title|decision/);
    assert.doesNotMatch(Object.values(OUTSIDE_KEYS).join(" "), /decision|title|verdict/);
  });
});

describe("outside counters: grills, records and choices", () => {
  it("files a first grill under its UTC day and its app, and an app off the list as other", () => {
    const first = at("2026-12-01T23:30:00Z");
    assert.deepEqual(firstGrillOps(LIST, OUTSIDER, { firstAt: first, app: "chatgpt" }), [
      [OUTSIDE_KEYS.firstGrills, "2026-12-01", 1],
      [OUTSIDE_KEYS.firstGrillApp, "chatgpt", 1],
    ]);
    assert.deepEqual(OUTSIDE_APPS, ["claude", "claude-code", "chatgpt", "grok", "gemini", "muse", "cursor", "other"]);
    for (const app of OUTSIDE_APPS) assert.equal(outsideApp(app), app);
    for (const app of ["unknown", "", undefined, "Some New Client", "meta"]) assert.equal(outsideApp(app), "other");
    assert.equal(outsideApp("Claude-Code"), "claude-code");
  });

  it("counts a come-back only 20 hours or more after the first grill, under the first-grill day", () => {
    const first = at("2026-12-01T23:30:00Z");
    assert.deepEqual(cameBackOps(LIST, OUTSIDER, { firstAt: first, now: first + 19 * HOUR + 59 * 60 * 1000 }), []);
    assert.deepEqual(cameBackOps(LIST, OUTSIDER, { firstAt: first, now: first }), []);
    assert.deepEqual(cameBackOps(LIST, OUTSIDER, { firstAt: first, now: first + 20 * HOUR }), [[OUTSIDE_KEYS.cameBack, "2026-12-01", 1]]);
    assert.deepEqual(cameBackOps(LIST, OUTSIDER, { firstAt: first, now: first + 40 * 24 * HOUR }), [[OUTSIDE_KEYS.cameBack, "2026-12-01", 1]]);
  });

  it("files an account that grilled before counting began under the day it started", () => {
    const now = at("2026-12-01T15:00:00Z");
    assert.equal(firstGrillTime(now, "2026-11-05T09:12:00.000Z"), at("2026-11-05T09:12:00.000Z"));
    // A new account's log holds only the grill that just finished, a moment after the request began.
    assert.equal(firstGrillTime(now, "2026-12-01T15:00:41.000Z"), now);
    assert.equal(firstGrillTime(now, ""), now);
    assert.equal(firstGrillTime(now, "not a time"), now);
  });

  it("files a records answer and a choice under the day they were given", () => {
    const now = at("2026-12-02T00:10:00Z");
    assert.deepEqual(recordsAnswerOps(LIST, OUTSIDER, { keep: true, now }), [[OUTSIDE_KEYS.recordsOn, "2026-12-02", 1]]);
    assert.deepEqual(recordsAnswerOps(LIST, OUTSIDER, { keep: false, now }), [[OUTSIDE_KEYS.recordsOff, "2026-12-02", 1]]);
    assert.deepEqual(choiceOps(LIST, OUTSIDER, { now }), [[OUTSIDE_KEYS.choices, "2026-12-02", 1]]);
  });
});

describe("outside counters: look-backs", () => {
  const now = at("2026-12-01T15:00:00Z");

  it("counts a look-back under its due day when the date is set", () => {
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "", review: "2026-12-15", done: false, now }), {
      ops: [[OUTSIDE_KEYS.lookbacksDue, "2026-12-15", 1]],
      counted: "2026-12-15",
    });
    // No date, nothing to count.
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "", review: "", now }), { ops: [], counted: "" });
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "", review: "2026-02-31", now }), { ops: [], counted: "" });
    // A date already past cannot fall due before it was set: it is counted under today.
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "", review: "2026-11-01", now }), {
      ops: [[OUTSIDE_KEYS.lookbacksDue, "2026-12-01", 1]],
      counted: "2026-12-01",
    });
  });

  it("moved before due moves the bucket, and switched off before due takes it out", () => {
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "2026-12-15", review: "2026-12-20", now }), {
      ops: [
        [OUTSIDE_KEYS.lookbacksDue, "2026-12-15", -1],
        [OUTSIDE_KEYS.lookbacksDue, "2026-12-20", 1],
      ],
      counted: "2026-12-20",
    });
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "2026-12-15", review: "", now }), {
      ops: [[OUTSIDE_KEYS.lookbacksDue, "2026-12-15", -1]],
      counted: "",
    });
    // The same date again is not a move.
    assert.deepEqual(lookbackDateChange(LIST, OUTSIDER, { counted: "2026-12-15", review: "2026-12-15", now }), { ops: [], counted: "2026-12-15" });
  });

  it("is never decremented from its due day on: moved, switched off or set again, it stays where it came due", () => {
    for (const today of ["2026-12-15T00:00:00Z", "2026-12-15T23:59:00Z", "2026-12-29T10:00:00Z"]) {
      for (const review of ["2027-01-10", "", "2026-12-15", "2026-12-01"]) {
        assert.deepEqual(
          lookbackDateChange(LIST, OUTSIDER, { counted: "2026-12-15", review, done: false, now: at(today) }),
          { ops: [], counted: "2026-12-15" },
          `${today} ${review}`,
        );
      }
    }
    // The day before it falls due it can still move.
    assert.equal(lookbackDateChange(LIST, OUTSIDER, { counted: "2026-12-15", review: "2027-01-10", now: at("2026-12-14T23:59:00Z") }).counted, "2027-01-10");
  });

  it("a second completion does not count", () => {
    const first = lookbackDoneOps(LIST, OUTSIDER, { first: true, counted: "2026-12-15", now: at("2026-12-16T09:00:00Z") });
    assert.deepEqual(first, [
      [OUTSIDE_KEYS.lookbacksDone7d, "2026-12-15", 1],
      [OUTSIDE_KEYS.lookbacksDone14d, "2026-12-15", 1],
    ]);
    // A second answer, a changed tap and a note after it: setLookback returned false.
    for (const again of [false, undefined, null, 0, 1, "yes"]) {
      assert.deepEqual(lookbackDoneOps(LIST, OUTSIDER, { first: again, counted: "2026-12-15", now: at("2026-12-17T09:00:00Z") }), []);
    }
    // A record whose look-back was never counted as due has nothing to be done against.
    assert.deepEqual(lookbackDoneOps(LIST, OUTSIDER, { first: true, counted: "", now }), []);
  });

  it("counts an answer within 7 and within 14 days of the due day, and an early answer for both", () => {
    const done = (day) => lookbackDoneOps(LIST, OUTSIDER, { first: true, counted: "2026-12-15", now: at(`${day}T12:00:00Z`) }).map(([key]) => key);
    const both = [OUTSIDE_KEYS.lookbacksDone7d, OUTSIDE_KEYS.lookbacksDone14d];
    assert.deepEqual(done("2026-12-02"), both, "an early answer counts as done");
    assert.deepEqual(done("2026-12-15"), both);
    assert.deepEqual(done("2026-12-21"), both, "the 7th day");
    assert.deepEqual(done("2026-12-22"), [OUTSIDE_KEYS.lookbacksDone14d], "the 8th day");
    assert.deepEqual(done("2026-12-28"), [OUTSIDE_KEYS.lookbacksDone14d], "the 14th day");
    assert.deepEqual(done("2026-12-29"), [], "the 15th day: the read day for a look-back due on the 15th");
  });

  it("moves an early answer with its look-back, and counts a record answered before it had a date", () => {
    const moved = lookbackDateChange(LIST, OUTSIDER, { counted: "2026-12-15", review: "2026-12-20", done: true, now });
    assert.deepEqual(apply({}, moved.ops), {
      [OUTSIDE_KEYS.lookbacksDue]: { "2026-12-15": -1, "2026-12-20": 1 },
      [OUTSIDE_KEYS.lookbacksDone7d]: { "2026-12-15": -1, "2026-12-20": 1 },
      [OUTSIDE_KEYS.lookbacksDone14d]: { "2026-12-15": -1, "2026-12-20": 1 },
    });
    const late = lookbackDateChange(LIST, OUTSIDER, { counted: "", review: "2026-12-20", done: true, now });
    assert.deepEqual(apply({}, late.ops), {
      [OUTSIDE_KEYS.lookbacksDue]: { "2026-12-20": 1 },
      [OUTSIDE_KEYS.lookbacksDone7d]: { "2026-12-20": 1 },
      [OUTSIDE_KEYS.lookbacksDone14d]: { "2026-12-20": 1 },
    });
  });

  it("a deleted record still counts as due", () => {
    // There is no rule for a deletion: nothing in this file can lower a count because a record went away.
    assert.deepEqual(
      Object.keys(core).filter((name) => /delet|remov/i.test(name)),
      [],
    );
    const hashes = apply({}, lookbackDateChange(LIST, OUTSIDER, { counted: "", review: "2026-12-15", now }).ops);
    apply(hashes, lookbackPeopleChange(LIST, OUTSIDER, { mark: "", days: ["2026-12-15"], now }).ops);
    // The person deletes the record on 5 December. No write follows, so the counters are as they were.
    const reading = outsideReading(
      counters({ lookbacksDue: hashes[OUTSIDE_KEYS.lookbacksDue], lookbackPeople: hashes[OUTSIDE_KEYS.lookbackPeople] }),
      "2026-12-29",
    );
    assert.equal(reading.threshold.counted, 1);
    assert.equal(reading.threshold.matured, 1);
    assert.equal(reading.threshold.done14, 0, "and it counts as not done");
    assert.equal(reading.threshold.people, 1);
  });

  it("files a person under the earliest day one of their look-backs is counted under", () => {
    // Their first look-back.
    assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "", days: ["2026-12-15"], left: "", now }), {
      ops: [[OUTSIDE_KEYS.lookbackPeople, "2026-12-15", 1]],
      mark: "2026-12-15",
    });
    // A second, later one changes nothing.
    assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "2026-12-15", days: ["2026-12-15", "2026-12-30"], left: "", now }), { ops: [], mark: "2026-12-15" });
    // A second, earlier one moves them earlier.
    assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "2026-12-15", days: ["2026-12-15", "2026-12-05"], left: "", now }), {
      ops: [
        [OUTSIDE_KEYS.lookbackPeople, "2026-12-15", -1],
        [OUTSIDE_KEYS.lookbackPeople, "2026-12-05", 1],
      ],
      mark: "2026-12-05",
    });
    // The look-back that held their day moved away before it fell due: they move with it.
    assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "2026-12-15", days: ["2026-12-20"], left: "2026-12-15", now }), {
      ops: [
        [OUTSIDE_KEYS.lookbackPeople, "2026-12-15", -1],
        [OUTSIDE_KEYS.lookbackPeople, "2026-12-20", 1],
      ],
      mark: "2026-12-20",
    });
    // It was switched off and they have no other: they are not counted as having a look-back.
    assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "2026-12-15", days: [""], left: "2026-12-15", now }), {
      ops: [[OUTSIDE_KEYS.lookbackPeople, "2026-12-15", -1]],
      mark: "",
    });
    // Another record moved, not the one that held their day. A deleted record may still hold it, so they stay.
    assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "2026-12-15", days: ["2026-12-28"], left: "2026-12-20", now }), { ops: [], mark: "2026-12-15" });
    // Once their day has come it never moves.
    for (const days of [["2026-12-20"], [""], ["2026-11-30"]]) {
      assert.deepEqual(lookbackPeopleChange(LIST, OUTSIDER, { mark: "2026-12-01", days, left: "2026-12-01", now }), { ops: [], mark: "2026-12-01" });
    }
  });
});

describe("outside loop readout: the kill threshold", () => {
  /** `count` look-backs on each of the given due days. */
  const dueOn = (pairs) => Object.fromEntries(pairs);
  const thirty = dueOn([
    ["2026-12-01", 10],
    ["2026-12-05", 10],
    ["2026-12-10", 10],
  ]);
  const people = (n, day = "2026-12-01") => ({ [day]: n });
  const read = (extra, today) => killThreshold(extra, today);

  it("pins the numbers the strategy sets", () => {
    assert.equal(core.COHORT_SIZE, 30);
    assert.equal(core.MIN_PEOPLE, 5);
    assert.equal(core.KILL_BELOW, 8);
    assert.equal(core.KEEP_FROM, 15);
    assert.equal(core.DONE_DAYS, 14);
    assert.equal(core.DONE_SHORT_DAYS, 7);
    assert.equal(BACKSTOP_DAY, "2027-02-28");
    assert.equal(LAST_EMAIL_DAY, "2027-01-25");
    assert.equal(LAST_EMAIL_DAY, IMPACT_PILOT_LAST, "the last Monday email is the day the email test ends");
    assert.equal(core.THRESHOLD_SET_DAY, "2026-11-13");
    assert.equal(NOT_TESTED, "not tested: the constraint is reach");
    assert.equal(NOT_COUNTED_LINE, "not counted: internal list not set");
    assert.equal(core.CAME_BACK_AFTER_MS, 20 * HOUR);
  });

  it("ties on the 30th due day: the cohort takes the whole day on which the 30th falls", () => {
    const due = dueOn([
      ["2026-12-01", 12],
      ["2026-12-05", 15],
      ["2026-12-10", 8],
      ["2026-12-11", 4],
    ]);
    const cohort = cohortOf(due);
    // The 30th look-back falls on 10 December. All 8 due that day are in, so the cohort is 35.
    assert.deepEqual(cohort, { days: ["2026-12-01", "2026-12-05", "2026-12-10"], size: 35, full: true, firstDay: "2026-12-01", lastDay: "2026-12-10" });
    // Exactly 30 on the day stops there.
    assert.equal(cohortOf(thirty).size, 30);
    assert.equal(cohortOf(thirty).lastDay, "2026-12-10");
    // Fewer than 30 is every look-back so far, and not a full cohort.
    assert.deepEqual(cohortOf(dueOn([["2026-12-01", 29]])), { days: ["2026-12-01"], size: 29, full: false, firstDay: "2026-12-01", lastDay: "2026-12-01" });
    assert.deepEqual(cohortOf({}), { days: [], size: 0, full: false, firstDay: "", lastDay: "" });
    // The next 30 start the day after the cohort's last due day.
    assert.deepEqual(cohortOf(due, { after: "2026-12-10" }).days, ["2026-12-11"]);

    const t = read({ lookbacksDue: due, lookbackPeople: people(6), lookbacksDone14d: { "2026-12-10": 8, "2026-12-11": 4 } }, "2026-12-24");
    assert.equal(t.cohort.size, 35);
    assert.equal(t.readDay, "2026-12-24", "14 days after the cohort's last due day");
    assert.equal(t.done14, 8, "a look-back due after the cohort is not in it");
    assert.equal(t.rule, 4);
  });

  it("fewer than 5 people gives rule 1, whatever was done", () => {
    for (const done of [0, 7, 30]) {
      const t = read({ lookbacksDue: thirty, lookbackPeople: people(4), lookbacksDone14d: { "2026-12-01": Math.min(done, 10), "2026-12-05": Math.min(Math.max(done - 10, 0), 10), "2026-12-10": Math.max(done - 20, 0) } }, "2026-12-24");
      assert.equal(t.reached, true);
      assert.equal(t.matured, 30);
      assert.equal(t.people, 4);
      assert.equal(t.rule, 1, `done ${done}: fewer than 5 people is never a kill and never a keep`);
      assert.equal(t.tooFewPeople, true);
      assert.equal(t.tooFew, false);
    }
    // The fifth person makes it a test.
    assert.equal(read({ lookbacksDue: thirty, lookbackPeople: people(5) }, "2026-12-24").rule, 2);
    // A person whose first look-back falls after the cohort is not one of its people.
    assert.equal(read({ lookbacksDue: { ...thirty, "2026-12-20": 3 }, lookbackPeople: { "2026-12-01": 4, "2026-12-20": 3 } }, "2026-12-24").people, 4);
  });

  it("fewer than 30 look-backs with a full 14 days gives rule 1, before and on the read day", () => {
    // 29 look-backs: the cohort is not full, so the read day is the backstop.
    const few = read({ lookbacksDue: { "2026-12-01": 29 }, lookbackPeople: people(9) }, "2026-12-20");
    assert.equal(few.cohort.full, false);
    assert.equal(few.readDay, "2027-02-28");
    assert.equal(few.reached, false);
    assert.equal(few.rule, 1);
    assert.equal(few.tooFew, true);
    // 30 set, but the last 10 have not had their 14 days yet.
    const early = read({ lookbacksDue: thirty, lookbackPeople: people(9), lookbacksDone14d: { "2026-12-01": 10, "2026-12-05": 10 } }, "2026-12-23");
    assert.equal(early.readDay, "2026-12-24");
    assert.equal(early.reached, false);
    assert.equal(early.matured, 20);
    assert.equal(early.rule, 1, "20 done of 30 is still not a reading before the read day");
    // Nothing counted at all.
    const none = read({}, "2026-12-23");
    assert.equal(none.rule, 1);
    assert.equal(none.counted, 0);
    assert.equal(none.readDay, "2027-02-28");
  });

  it("applies rules 2, 3 and 4 in order once 30 look-backs from 5 people have had 14 days", () => {
    const spread = (done) => ({ "2026-12-01": Math.min(done, 10), "2026-12-05": Math.min(Math.max(done - 10, 0), 10), "2026-12-10": Math.max(done - 20, 0) });
    const rule = (done14, done7 = 0) => read({ lookbacksDue: thirty, lookbackPeople: people(5), lookbacksDone14d: spread(done14), lookbacksDone7d: spread(done7) }, "2026-12-24");
    assert.equal(rule(0).rule, 2);
    assert.equal(rule(7).rule, 2, "fewer than 8 is a kill");
    assert.equal(rule(8).rule, 4, "8 is not");
    assert.equal(rule(14).rule, 4);
    assert.equal(rule(15).rule, 3, "15 or more keeps going");
    assert.equal(rule(30).rule, 3);
    const kept = rule(16, 9);
    assert.equal(kept.done14, 16);
    assert.equal(kept.done7, 9, "the 7-day count is reported beside it");
  });

  it("reads 14 days after the cohort's last due day, or on 2027-02-28, whichever is first", () => {
    const late = dueOn([
      ["2027-01-20", 20],
      ["2027-02-20", 10],
    ]);
    // The 30th falls due on 20 February. 14 days later is 6 March, after the backstop.
    const before = read({ lookbacksDue: late, lookbackPeople: people(8, "2027-01-20"), lookbacksDone14d: { "2027-01-20": 20 } }, "2027-02-27");
    assert.equal(before.readDay, "2027-02-28");
    assert.equal(before.reached, false);
    const onDay = read({ lookbacksDue: late, lookbackPeople: people(8, "2027-01-20"), lookbacksDone14d: { "2027-01-20": 20 } }, "2027-02-28");
    assert.equal(onDay.reached, true);
    assert.equal(onDay.matured, 20, "the look-backs due on 20 February have not had a full 14 days");
    assert.equal(onDay.rule, 1, "so the backstop reads not tested, with 20 of 30 done");
    // Read again a month later, the reading taken on the read day still stands.
    const later = read({ lookbacksDue: late, lookbackPeople: people(8, "2027-01-20"), lookbacksDone14d: { "2027-01-20": 20, "2027-02-20": 10 } }, "2027-04-01");
    assert.equal(later.readDay, "2027-02-28");
    assert.equal(later.matured, 20);
    assert.equal(later.rule, 1);
    // A cohort whose last due day is 14 February has had its 14 days exactly on the backstop.
    const just = read({ lookbacksDue: { "2027-02-14": 30 }, lookbackPeople: people(5, "2027-02-14"), lookbacksDone14d: { "2027-02-14": 15 } }, "2027-02-28");
    assert.equal(just.readDay, "2027-02-28");
    assert.equal(just.matured, 30);
    assert.equal(just.rule, 3);
    assert.equal(addDays("2027-02-14", 14), "2027-02-28");
  });

  it("reports look-backs due after the last Monday email apart", () => {
    const due = dueOn([
      ["2027-01-20", 18],
      ["2027-01-25", 2],
      ["2027-01-26", 6],
      ["2027-02-01", 4],
    ]);
    const t = read({ lookbacksDue: due, lookbackPeople: people(7, "2027-01-20"), lookbacksDone14d: { "2027-01-20": 9, "2027-01-26": 3, "2027-02-01": 1 } }, "2027-02-15");
    assert.equal(t.cohort.size, 30);
    assert.equal(t.afterEmail, 10, "due on 25 January is not after it");
    assert.equal(t.afterEmailDone14, 4);
    assert.equal(t.done14, 13);
  });

  it("after rule 4, reads the next 30 once and decides by rules 2 and 3", () => {
    // The first 30 are read on 24 December. Three more fell due on the 20th, before that reading.
    const due = { ...thirty, "2026-12-20": 3, "2026-12-26": 20, "2026-12-28": 12, "2027-01-15": 9 };
    const first = { "2026-12-01": 5, "2026-12-05": 5 };
    const base = { lookbacksDue: due, lookbackPeople: people(6) };
    // Rule 4 on the first 30. The next 30 are the first that fall due after the read day:
    // 20 + 12 = 32, last due 28 December, read 11 January. The three due on the 20th are in neither.
    const waiting = read({ ...base, lookbacksDone14d: { ...first, "2026-12-20": 3, "2026-12-26": 4 } }, "2027-01-05");
    assert.equal(waiting.rule, 4);
    assert.equal(waiting.done14, 10);
    assert.deepEqual(
      { size: waiting.next.size, full: waiting.next.full, firstDay: waiting.next.firstDay, lastDay: waiting.next.lastDay, readDay: waiting.next.readDay, reached: waiting.next.reached, rule: waiting.next.rule, done14: waiting.next.done14 },
      { size: 32, full: true, firstDay: "2026-12-26", lastDay: "2026-12-28", readDay: "2027-01-11", reached: false, rule: 0, done14: 4 },
    );
    const kill = read({ ...base, lookbacksDone14d: { ...first, "2026-12-20": 3, "2026-12-26": 4, "2026-12-28": 3 } }, "2027-01-11");
    assert.equal(kill.next.reached, true);
    assert.equal(kill.next.done14, 7);
    assert.equal(kill.next.rule, 2);
    const keep = read({ ...base, lookbacksDone14d: { ...first, "2026-12-26": 10, "2026-12-28": 5 } }, "2027-01-11");
    assert.equal(keep.next.rule, 3);
    const between = read({ ...base, lookbacksDone14d: { ...first, "2026-12-26": 6, "2026-12-28": 4 } }, "2027-01-11");
    assert.equal(between.next.rule, 0, "rules 2 and 3 do not decide 8 to 14: there is no third read");
    // A look-back due on the read day itself is not one of the next 30.
    assert.equal(read({ ...base, lookbacksDue: { ...thirty, "2026-12-24": 40 }, lookbacksDone14d: first }, "2027-01-11").next.size, 0);
    // No next block unless the first reading was rule 4 on its read day.
    assert.equal(read({ ...base, lookbacksDone14d: { "2026-12-01": 10, "2026-12-05": 10 } }, "2027-01-11").next, null);
    assert.equal(read({ ...base, lookbacksDone14d: first }, "2026-12-23").next, null);
  });

  it("never shows more done than due on a day, or more within 7 days than within 14", () => {
    const t = read({ lookbacksDue: thirty, lookbackPeople: people(5), lookbacksDone14d: { "2026-12-01": 14 }, lookbacksDone7d: { "2026-12-01": 12, "2026-12-05": 3 } }, "2026-12-24");
    assert.equal(t.done14, 10);
    assert.equal(t.done7, 10);
  });
});

describe("outside loop readout: what it prints", () => {
  it("prints that nothing is counted when the internal list was never set", () => {
    const lines = outsideLines(outsideReading(counters({ live: null, seen: null }), "2026-12-01"));
    assert.deepEqual(lines, ["Outside loop readout (UTC day 2026-12-01)", "not counted: internal list not set"]);
    assert.equal(lines[1], NOT_COUNTED_LINE);
    // The list is set and nobody outside has come yet: zeros, not "not counted".
    const quiet = outsideLines(outsideReading(counters({ seen: "2026-11-30" }), "2026-12-01"));
    assert.equal(quiet.includes(NOT_COUNTED_LINE), false);
    assert.equal(quiet[1], "Counting since: 2026-11-20");
    assert.equal(quiet[2], "Last day the server handled an event with the list set: 2026-11-30");
    assert.equal(quiet[3], "Outside people who grilled: 0");
    assert.equal(lineOf(quiet, "Of those, came back:"), "Of those, came back: 0 of 0");
    // Counts with no start day on file are still printed.
    const unmarked = outsideLines(outsideReading(counters({ live: null, seen: "2026-11-30", firstGrills: { "2026-11-21": 1 } }), "2026-12-01"));
    assert.equal(unmarked[1], "Counting since: not recorded");
    assert.equal(unmarked[3], "Outside people who grilled: 1");
  });

  it("prints the last day the server counted, and warns when that day is more than 7 days old", () => {
    const LAST = "Last day the server handled an event with the list set:";
    const top = (extra, today = "2026-12-20") => outsideLines(outsideReading(counters(extra), today)).slice(1, 5);
    // Today, yesterday and 7 days ago: the day is printed, with no warning.
    for (const seen of ["2026-12-20", "2026-12-19", "2026-12-13"]) {
      assert.deepEqual(top({ seen }).slice(0, 3), ["Counting since: 2026-11-20", `${LAST} ${seen}`, "Outside people who grilled: 0"], seen);
    }
    // 8 days ago. The readout reads the store, not the server, so it cannot say which of the two it is.
    assert.deepEqual(top({ seen: "2026-12-12" }), [
      "Counting since: 2026-11-20",
      `${LAST} 2026-12-12`,
      "Warning: that is 8 days ago. Either no account has used Grill since, or the internal list was unset on the server and nothing has been counted since. Check the list on the host before you read the numbers below.",
      "Outside people who grilled: 0",
    ]);
    assert.equal(top({ seen: "2026-11-20" })[2].startsWith("Warning: that is 30 days ago."), true);
    assert.equal(core.SEEN_STALE_DAYS, 7);
    assert.equal(outsideReading(counters({ seen: "2026-12-12" }), "2026-12-20").seenAge, 8);
    assert.equal(outsideReading(counters({ seen: "2026-12-12" }), "2026-12-20").seenStale, true);
    assert.equal(outsideReading(counters({ seen: "2026-12-13" }), "2026-12-20").seenStale, false);
    // Counts in the store and no such day: say so, and say what the readout cannot know.
    for (const seen of [null, "", "yesterday", "2026-13-40"]) {
      assert.deepEqual(top({ seen }), [
        "Counting since: 2026-11-20",
        `${LAST} not recorded`,
        "Warning: no such day is on file. This readout reads the store only. It cannot tell whether the internal list is still set on the server. Check the list on the host before you read the numbers below.",
        "Outside people who grilled: 0",
      ]);
    }
    // The day alone shows the list was set once: zeros and the day, not "not counted".
    const only = outsideLines(outsideReading(counters({ live: null, seen: "2026-12-19" }), "2026-12-20"));
    assert.equal(only.includes(NOT_COUNTED_LINE), false);
    assert.deepEqual(only.slice(1, 3), ["Counting since: not recorded", `${LAST} 2026-12-19`]);
    // The warning sits above the numbers and takes none of them away.
    const stale = outsideLines(outsideReading(counters({ seen: "2026-12-01", lookbacksDue: { "2026-12-05": 3 } }), "2026-12-20"));
    assert.equal(lineOf(stale, "Look-backs counted:"), "Look-backs counted: 3 (due 2026-12-05)");
    assert.equal(stale.filter((line) => line.startsWith("Warning:")).length, 1);
    assert.equal(OUTSIDE_SEEN_KEY, "grill:metric:outside:seen");
    assert.ok(OUTSIDE_SEEN_KEY.startsWith(OUTSIDE_PREFIX));
  });

  it("prints every line by name, as whole numbers and k of n", () => {
    const raw = counters({
      // Upstash answers HGETALL with a flat list of field, value. Both shapes are read.
      firstGrills: ["2026-11-21", "2", "2026-11-25", "1", "2026-12-10", "4"],
      firstGrillApp: { claude: "4", chatgpt: "2", other: "1", "not-an-app": "9" },
      cameBack: { "2026-11-21": 1, "2026-12-10": 2 },
      recordsOn: { "2026-11-21": 3, "2026-12-10": 2 },
      recordsOff: { "2026-11-25": 2 },
      choices: { "2026-11-22": 4, "2026-12-11": 5 },
      lookbacksDue: { "2026-12-05": 2, "2026-12-06": 1, "2026-12-25": 9 },
      lookbackPeople: { "2026-12-05": 2, "2026-12-25": 1 },
      lookbacksDone7d: { "2026-12-05": 1 },
      lookbacksDone14d: { "2026-12-05": 1, "2026-12-06": 1 },
    });
    const lines = outsideLines(outsideReading(raw, "2026-12-20"));
    assert.deepEqual(lines, [
      "Outside loop readout (UTC day 2026-12-20)",
      "Counting since: 2026-11-20",
      "Last day the server handled an event with the list set: 2026-12-19",
      "Outside people who grilled: 7",
      "First grilled 14 or more days ago: 3",
      "Of those, came back: 1 of 3",
      "Records question: yes 5, no 2",
      "Choices logged: 9",
      "First grills by app: claude 4 · chatgpt 2 · other 1",
      "Kill threshold for the record bet (set 2026-11-13)",
      "Look-backs counted: 12 (due 2026-12-05 to 2026-12-25)",
      "Cohort: 12 of the first 30 so far (due 2026-12-05 to 2026-12-25)",
      "Cohort people: 3",
      "Had a full 14 days: 3 of 12",
      "Done within 14 days: 2 of 12",
      "Done within 7 days: 1 of 12",
      "Due after 2027-01-25, the last Monday email: 0 of 12. Of those, done within 14 days: 0 of 0",
      "Email arms: both count. These counters do not record which arm an account is in, so the arms are not shown apart.",
      "Read day: 2027-02-28",
      'Rule that applies today: 1. Read today, this would be "not tested: the constraint is reach". Only 3 of the 30 look-backs needed have had a full 14 days. The look-backs come from 3 people, and 5 are needed. This is never a kill.',
      "Status: not the read day yet. Nothing is decided before 2027-02-28.",
    ]);
    for (const line of lines) {
      assert.doesNotMatch(line, /%|percent/i, "no percentage, whatever n is");
      assert.doesNotMatch(line, /@|g_[0-9a-f]/, "no email and no account id");
      assert.doesNotMatch(line, /[\u2013\u2014]/, "no dash");
    }
  });

  it("names the rule that applies on the read day, with the counts behind it", () => {
    const thirty = { "2026-12-01": 10, "2026-12-05": 10, "2026-12-10": 10 };
    const lines = (done14, done7, peopleCount, today = "2026-12-24") =>
      outsideLines(outsideReading(counters({ lookbacksDue: thirty, lookbackPeople: { "2026-12-01": peopleCount }, lookbacksDone14d: { "2026-12-01": Math.min(done14, 10), "2026-12-05": Math.max(done14 - 10, 0) }, lookbacksDone7d: { "2026-12-01": done7 } }), today));
    const kill = lines(7, 2, 5);
    assert.equal(lineOf(kill, "Cohort:"), "Cohort: 30 look-backs, the first 30 by due day with the whole last day (due 2026-12-01 to 2026-12-10)");
    assert.equal(lineOf(kill, "Read day:"), "Read day: 2026-12-24");
    assert.equal(
      lineOf(kill, "Rule that applies today:"),
      "Rule that applies today: 2. Kill: fewer than 8 of the cohort were done within 14 days (7 of 30). Stop building on the solo record. The team pilot is the only record bet left.",
    );
    assert.equal(lineOf(kill, "Status:"), "Status: the read day has come. This reading stands.");
    assert.equal(lineOf(lines(16, 9, 5), "Rule that applies today:"), "Rule that applies today: 3. Keep going: 15 or more were done within 14 days (16 of 30). Within 7 days: 9 of 30.");
    const change = lines(10, 4, 5);
    assert.equal(lineOf(change, "Rule that applies today:"), "Rule that applies today: 4. Change one thing about the reminder, read the next 30 once, then decide by rules 2 and 3 (10 of 30 done within 14 days).");
    assert.equal(lineOf(change, "Next 30, due after the read day:"), "Next 30, due after the read day: 0 of 30 so far");
    assert.equal(lineOf(change, "Next 30, read day:"), "Next 30, read day: 14 days after its 30th look-back falls due. Not known yet.");
    // Too few people is rule 1 even with nothing done, and the line says which half of the rule it was.
    assert.equal(lineOf(lines(0, 0, 4), "Rule that applies today:"), 'Rule that applies today: 1. Record "not tested: the constraint is reach". The look-backs come from 4 people, and 5 are needed. This is never a kill.');
    assert.equal(lineOf(lines(0, 0, 1), "Rule that applies today:"), 'Rule that applies today: 1. Record "not tested: the constraint is reach". The look-backs come from 1 person, and 5 are needed. This is never a kill.');
    // Before the read day the same cohort reads rule 1 for the other reason: its last 10 have not had 14 days.
    assert.equal(
      lineOf(lines(16, 9, 5, "2026-12-23"), "Rule that applies today:"),
      'Rule that applies today: 1. Read today, this would be "not tested: the constraint is reach". Only 20 of the 30 look-backs needed have had a full 14 days. This is never a kill.',
    );
    assert.equal(lineOf(lines(16, 9, 5, "2026-12-23"), "Status:"), "Status: not the read day yet. Nothing is decided before 2026-12-24.");
    assert.match(lineOf(lines(0, 0, 4), "Rule that applies today:"), new RegExp(NOT_TESTED));
  });

  it("prints the next 30 under their own names once rule 4 has been read", () => {
    const due = { "2026-12-01": 10, "2026-12-05": 10, "2026-12-10": 10, "2026-12-26": 20, "2026-12-28": 12 };
    const first = { "2026-12-01": 5, "2026-12-05": 5 };
    const lines = (done14, done7, today) =>
      outsideLines(outsideReading(counters({ lookbacksDue: due, lookbackPeople: { "2026-12-01": 6 }, lookbacksDone14d: { ...first, ...done14 }, lookbacksDone7d: done7 }), today)).slice(-4);
    assert.deepEqual(lines({ "2026-12-26": 4 }, { "2026-12-26": 1 }, "2027-01-05"), [
      "Next 30, due after the read day: 32 look-backs (due 2026-12-26 to 2026-12-28)",
      "Next 30, done within 14 days: 4 of 32",
      "Next 30, done within 7 days: 1 of 32",
      "Next 30, read day: 2027-01-11. Not read yet.",
    ]);
    assert.equal(lines({ "2026-12-26": 4, "2026-12-28": 3 }, {}, "2027-01-11")[3], "Next 30, rule 2. Kill: fewer than 8 were done within 14 days. Stop building on the solo record.");
    assert.equal(lines({ "2026-12-26": 12, "2026-12-28": 3 }, {}, "2027-01-11")[3], "Next 30, rule 3. Keep going: 15 or more were done within 14 days.");
    assert.equal(lines({ "2026-12-26": 6, "2026-12-28": 3 }, {}, "2027-01-11")[3], "Next 30: between 8 and 14 done within 14 days. Rules 2 and 3 do not decide this. It goes to the owner.");
  });

  it("reads counts as whole numbers and drops anything that is not one", () => {
    assert.deepEqual(hashCounts(["2026-12-01", "3", "2026-12-02", "-2", "2026-12-03", "x", "2026-12-04", "2.9", "2026-12-05", "0"]), { "2026-12-01": 3, "2026-12-04": 2 });
    assert.deepEqual(hashCounts(null), {});
    assert.deepEqual(hashCounts({ claude: 2 }), { claude: 2 });
    // A field that is not a day is not read as one.
    const reading = outsideReading(counters({ firstGrills: { "2026-12-01": 2, "someone@example.com": 5, "2026-13-40": 4 } }), "2026-12-20");
    assert.equal(reading.grilled, 2);
  });
});

describe("outside loop readout: the script", () => {
  const ENV = { UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "redis-token" };

  function fetchFor(values, seen = []) {
    return async (url, init) => {
      assert.equal(String(url), ENV.UPSTASH_REDIS_REST_URL);
      assert.equal(init.method, "POST");
      assert.equal(init.headers.Authorization, "Bearer redis-token");
      const [op, key, ...rest] = JSON.parse(init.body);
      seen.push([op, key]);
      assert.ok(op === "HGETALL" || op === "GET", `read only: ${op}`);
      assert.deepEqual(rest, []);
      assert.ok(key.startsWith(OUTSIDE_PREFIX), key);
      return Response.json({ result: values[key] ?? (op === "HGETALL" ? [] : null) });
    };
  }

  it("reads the ten counters and the start day, and writes nothing", async () => {
    const seen = [];
    const lines = await outsideLoopLines({
      env: ENV,
      now: Date.parse("2026-12-20T08:00:00Z"),
      fetch: fetchFor(
        {
          [OUTSIDE_LIVE_KEY]: "2026-11-20",
          [OUTSIDE_SEEN_KEY]: "2026-12-18",
          [OUTSIDE_KEYS.firstGrills]: ["2026-11-21", "2", "2026-12-10", "4"],
          [OUTSIDE_KEYS.firstGrillApp]: ["claude", "5", "cursor", "1"],
          [OUTSIDE_KEYS.cameBack]: ["2026-11-21", "1"],
          [OUTSIDE_KEYS.recordsOn]: ["2026-11-21", "4"],
          [OUTSIDE_KEYS.choices]: ["2026-11-22", "3"],
          [OUTSIDE_KEYS.lookbacksDue]: ["2026-12-05", "3"],
          [OUTSIDE_KEYS.lookbackPeople]: ["2026-12-05", "2"],
          [OUTSIDE_KEYS.lookbacksDone14d]: ["2026-12-05", "1"],
        },
        seen,
      ),
    });
    assert.deepEqual(seen, [...Object.values(OUTSIDE_KEYS).map((key) => ["HGETALL", key]), ["GET", OUTSIDE_LIVE_KEY], ["GET", OUTSIDE_SEEN_KEY]]);
    assert.equal(seen.length, 12);
    assert.deepEqual(lines.slice(0, 9), [
      "Outside loop readout (UTC day 2026-12-20)",
      "Counting since: 2026-11-20",
      "Last day the server handled an event with the list set: 2026-12-18",
      "Outside people who grilled: 6",
      "First grilled 14 or more days ago: 2",
      "Of those, came back: 1 of 2",
      "Records question: yes 4, no 0",
      "Choices logged: 3",
      "First grills by app: claude 5 · cursor 1",
    ]);
    assert.equal(lineOf(lines, "Done within 14 days:"), "Done within 14 days: 1 of 3");
    assert.equal(lineOf(lines, "Cohort people:"), "Cohort people: 2");
    // Every key the reader asks for is one the writers use.
    const raw = await readOutsideCounters(async ([op, key]) => (op === "GET" ? key : [key, "1"]));
    assert.deepEqual(Object.keys(raw).sort(), [...Object.keys(OUTSIDE_KEYS), "live", "seen"].sort());
    assert.equal(raw.seen, OUTSIDE_SEEN_KEY);
  });

  it("prints not counted when the store holds no outside key", async () => {
    const lines = await outsideLoopLines({ env: ENV, now: Date.parse("2026-12-20T08:00:00Z"), fetch: fetchFor({}) });
    assert.deepEqual(lines, ["Outside loop readout (UTC day 2026-12-20)", NOT_COUNTED_LINE]);
  });

  it("says so and exits 0 when the Upstash settings are missing, and fails when the store cannot be read", async () => {
    assert.equal(await outsideLoopLines({ env: {}, fetch: fetchFor({}) }), null);
    assert.equal(await outsideLoopLines({ env: { UPSTASH_REDIS_REST_URL: ENV.UPSTASH_REDIS_REST_URL }, fetch: fetchFor({}) }), null);
    const script = join(ROOT, "scripts/outside-loop.mjs");
    const bare = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH }, encoding: "utf8" });
    assert.equal(bare.status, 0, bare.stderr);
    assert.equal(bare.stdout, `${NOT_CONFIGURED_LINE}\n`);
    assert.equal(NOT_CONFIGURED_LINE, "Outside loop readout: the Upstash settings are not set here, so nothing was read.");
    await assert.rejects(
      outsideLoopLines({
        env: ENV,
        fetch: async () => {
          throw new Error("down");
        },
      }),
    );
    // A store that cannot be read is an error, not a quiet zero. This address cannot be parsed, so no request leaves.
    const down = spawnSync(process.execPath, [script], {
      env: { PATH: process.env.PATH, UPSTASH_REDIS_REST_URL: "not an address", UPSTASH_REDIS_REST_TOKEN: "x" },
      encoding: "utf8",
    });
    assert.equal(down.status, 1);
    assert.equal(down.stdout, "");
    assert.match(down.stderr, /couldn't be read/);
  });

  it("is two plain scripts: Node built-ins and this repo's own files, and no kept record is opened", () => {
    for (const file of ["scripts/outsideLoopCore.mjs", "scripts/outside-loop.mjs"]) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const match of src.matchAll(/^import .* from "([^"]+)";$/gm)) {
        assert.match(match[1], /^(node:|\.\/|\.\.\/)/, `${file} imports ${match[1]}`);
      }
      assert.doesNotMatch(src, /[\u2013\u2014]/, `${file} has a dash`);
      assert.doesNotMatch(src, /decrypt|GRILL_RECORD_KEY|grill:hosted:record/, `${file} must not open a kept record`);
    }
    const coreSrc = readFileSync(join(ROOT, "scripts/outsideLoopCore.mjs"), "utf8");
    assert.doesNotMatch(coreSrc, /^import /m, "the core imports nothing");
    assert.doesNotMatch(coreSrc, /fetch\(|process\.env|Date\.now\(\)|console\./, "the core is pure");
    // The readout is not on the scheduled route, and no workflow runs it.
    const entry = readFileSync(join(ROOT, "api/hosted.js"), "utf8");
    assert.doesNotMatch(entry, /outside/i);
    const digest = readFileSync(join(ROOT, "scripts/impactDigest.mjs"), "utf8");
    assert.doesNotMatch(digest, /outsideLoop|grill:metric:outside/);
  });
});
