/**
 * Counts of outside use, and the readout that reads them.
 *
 * "Outside" means an account that is not on the operator's private list of maintainer, test,
 * reviewer and agent addresses (GRILL_INTERNAL_EMAILS). The list is never in the repo and never
 * logged. While it is unset nothing here counts: every function that returns counter writes
 * returns none.
 *
 * Each counter is a Redis hash of whole numbers. A field is a UTC day, or an app name from a
 * fixed list. No title, no text, no verdict, no account id and no time of day.
 *
 * This file is pure: no network, no clock and no environment of its own. api/_hosted.mjs runs
 * the writes inside the person's own request, when the event happens. scripts/outside-loop.mjs
 * reads the hashes. Nothing here opens a kept record, and nothing runs on a schedule.
 */

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const OUTSIDE_PREFIX = "grill:metric:outside:";

/** One hash each. Every field is a UTC day, except firstGrillApp, whose fields are app names. */
export const OUTSIDE_KEYS = Object.freeze({
  firstGrills: `${OUTSIDE_PREFIX}first_grills`,
  firstGrillApp: `${OUTSIDE_PREFIX}first_grill_app`,
  cameBack: `${OUTSIDE_PREFIX}came_back`,
  recordsOn: `${OUTSIDE_PREFIX}records_on`,
  recordsOff: `${OUTSIDE_PREFIX}records_off`,
  choices: `${OUTSIDE_PREFIX}choices`,
  lookbacksDue: `${OUTSIDE_PREFIX}lookbacks_due`,
  lookbackPeople: `${OUTSIDE_PREFIX}lookback_people`,
  lookbacksDone7d: `${OUTSIDE_PREFIX}lookbacks_done_7d`,
  lookbacksDone14d: `${OUTSIDE_PREFIX}lookbacks_done_14d`,
});

/** A plain string: the UTC day the server first ran with the internal list set. */
export const OUTSIDE_LIVE_KEY = `${OUTSIDE_PREFIX}live`;

/** The apps a first grill is filed under. Anything else is "other". */
export const OUTSIDE_APPS = Object.freeze(["claude", "claude-code", "chatgpt", "grok", "gemini", "muse", "cursor", "other"]);

/** A person came back when a later grill got a verdict this long after their first. */
export const CAME_BACK_AFTER_MS = 20 * 60 * 60 * 1000;

// The kill threshold for the record bet, as docs/STRATEGY.md states it. Set 2026-11-13.
export const THRESHOLD_SET_DAY = "2026-11-13";
export const COHORT_SIZE = 30;
export const MIN_PEOPLE = 5;
export const KILL_BELOW = 8;
export const KEEP_FROM = 15;
export const DONE_DAYS = 14;
export const DONE_SHORT_DAYS = 7;
export const BACKSTOP_DAY = "2027-02-28";
export const LAST_EMAIL_DAY = "2027-01-25";
export const CAME_BACK_AGE_DAYS = 14;

export const NOT_COUNTED_LINE = "not counted: internal list not set";
export const NOT_TESTED = "not tested: the constraint is reach";

// ── Days ─────────────────────────────────────────────────────────────────────

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayStart(day) {
  return Date.parse(`${day}T00:00:00Z`);
}

export function isDay(value) {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const ms = dayStart(value);
  return Number.isFinite(ms) && utcDay(ms) === value;
}

export function addDays(day, count) {
  return utcDay(dayStart(day) + count * DAY_MS);
}

function laterDay(a, b) {
  return a >= b ? a : b;
}

// ── Who is counted ───────────────────────────────────────────────────────────

/**
 * The operator's internal addresses, lower-cased, or null when the setting holds none.
 * Only entries with an @ count, so a value such as "on" or "none" is the same as unset.
 */
export function internalEmails(env = {}) {
  const raw = typeof env?.GRILL_INTERNAL_EMAILS === "string" ? env.GRILL_INTERNAL_EMAILS : "";
  const list = raw
    .split(/[,\n]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes("@"));
  return list.length ? new Set(list) : null;
}

/**
 * Whether this account's events are counted. Fails closed: false while the list is unset, and
 * false for an account with no address to check. The account's own email and the email of the
 * person it acts for are both checked.
 */
export function countsAsOutside(account, env = {}) {
  const list = internalEmails(env);
  if (!list) return false;
  const own = [account?.email, account?.human].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (!own.length) return false;
  return !own.some((email) => list.has(email));
}

/** The app name a first grill is filed under. */
export function outsideApp(sourceApp) {
  const app = String(sourceApp || "").trim().toLowerCase();
  return OUTSIDE_APPS.includes(app) ? app : "other";
}

// ── What to write, as [key, field, by] ──────────────────────────────────────

/**
 * The time of a person's first grill that got a verdict. It is now, unless the account's own
 * log already holds an older grill: an account that grilled before counting began is filed
 * under the day it really started.
 */
export function firstGrillTime(now, oldestLogged) {
  const old = Date.parse(String(oldestLogged || ""));
  return Number.isFinite(old) && old < now ? old : now;
}

/** A person's first grill with a verdict. The caller runs this once per account. */
export function firstGrillOps(env, account, { firstAt, app }) {
  if (!countsAsOutside(account, env) || !Number.isFinite(firstAt)) return [];
  return [
    [OUTSIDE_KEYS.firstGrills, utcDay(firstAt), 1],
    [OUTSIDE_KEYS.firstGrillApp, outsideApp(app), 1],
  ];
}

/** A later grill with a verdict. Counts only 20 hours or more after the first. Once per account. */
export function cameBackOps(env, account, { firstAt, now }) {
  if (!countsAsOutside(account, env) || !Number.isFinite(firstAt) || !Number.isFinite(now)) return [];
  if (now - firstAt < CAME_BACK_AFTER_MS) return [];
  return [[OUTSIDE_KEYS.cameBack, utcDay(firstAt), 1]];
}

/** The first answer to the records question. A later switch on a page is not an answer. */
export function recordsAnswerOps(env, account, { keep, now }) {
  if (!countsAsOutside(account, env)) return [];
  return [[keep ? OUTSIDE_KEYS.recordsOn : OUTSIDE_KEYS.recordsOff, utcDay(now), 1]];
}

/** A stated choice was saved. */
export function choiceOps(env, account, { now }) {
  if (!countsAsOutside(account, env)) return [];
  return [[OUTSIDE_KEYS.choices, utcDay(now), 1]];
}

/**
 * A look-back date was set, moved or switched off on one record.
 *
 * `counted` is the day this record's look-back is counted under now ("" when it is not counted).
 * `review` is the new look-back date ("" when it was switched off). `done` is whether the record
 * already has a first look-back answer.
 *
 * A look-back cannot fall due before it was set, so it is counted under the later of its date
 * and today. Until that day comes, a move moves the count and switching it off takes it out.
 * From that day on nothing here changes it: a look-back that came due stays counted as due.
 * Deleting a record is not an event here at all, so a deleted look-back stays counted too.
 * An answer given early moves with its look-back, and still counts as done.
 */
export function lookbackDateChange(env, account, { counted = "", review = "", done = false, now }) {
  const held = isDay(counted) ? counted : "";
  if (!countsAsOutside(account, env)) return { ops: [], counted: held };
  const today = utcDay(now);
  if (held && held <= today) return { ops: [], counted: held };
  const next = isDay(review) ? laterDay(review, today) : "";
  if (next === held) return { ops: [], counted: held };
  const ops = [];
  const move = (day, by) => {
    ops.push([OUTSIDE_KEYS.lookbacksDue, day, by]);
    if (done) {
      ops.push([OUTSIDE_KEYS.lookbacksDone7d, day, by]);
      ops.push([OUTSIDE_KEYS.lookbacksDone14d, day, by]);
    }
  };
  if (held) move(held, -1);
  if (next) move(next, 1);
  return { ops, counted: next };
}

/**
 * A record got a look-back answer. Only the first answer on a record counts (`first`), so a
 * second answer, a changed tap and a note after it add nothing. `counted` is the day the
 * look-back is counted under. A look-back falls due at the start of that day (UTC), so "within
 * 14 days" means before the 15th day begins. An early answer counts for both.
 */
export function lookbackDoneOps(env, account, { first, counted = "", now }) {
  if (first !== true || !isDay(counted) || !countsAsOutside(account, env)) return [];
  const answered = utcDay(now);
  const ops = [];
  if (answered < addDays(counted, DONE_SHORT_DAYS)) ops.push([OUTSIDE_KEYS.lookbacksDone7d, counted, 1]);
  if (answered < addDays(counted, DONE_DAYS)) ops.push([OUTSIDE_KEYS.lookbacksDone14d, counted, 1]);
  return ops;
}

/**
 * Which day a person is counted under as someone with a look-back: the earliest day any of
 * their look-backs is counted under. `mark` is the day they are counted under now. `days` are
 * the days their records are counted under after this change. `left` is the day the changed
 * record was counted under before it.
 *
 * Once that day has come it never moves. Before then it moves earlier when an earlier
 * look-back appears, and later only when the record that held it moved away.
 */
export function lookbackPeopleChange(env, account, { mark = "", days = [], left = "", now }) {
  const held = isDay(mark) ? mark : "";
  if (!countsAsOutside(account, env)) return { ops: [], mark: held };
  const today = utcDay(now);
  const counted = (days || []).filter(isDay).sort();
  const earliest = counted[0] || "";
  if (!held) return earliest ? { ops: [[OUTSIDE_KEYS.lookbackPeople, earliest, 1]], mark: earliest } : { ops: [], mark: "" };
  if (held <= today) return { ops: [], mark: held };
  if (earliest === held) return { ops: [], mark: held };
  const movesEarlier = earliest && earliest < held;
  const holderLeft = left === held && !counted.includes(held);
  if (!movesEarlier && !holderLeft) return { ops: [], mark: held };
  const ops = [[OUTSIDE_KEYS.lookbackPeople, held, -1]];
  if (earliest) ops.push([OUTSIDE_KEYS.lookbackPeople, earliest, 1]);
  return { ops, mark: earliest };
}

// ── Reading the hashes ───────────────────────────────────────────────────────

/** A hash reply as field to text. Upstash answers HGETALL with a flat list; an object is read too. */
export function hashFields(reply) {
  const out = {};
  if (Array.isArray(reply)) {
    for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = String(reply[i + 1]);
  } else if (reply && typeof reply === "object") {
    for (const [field, value] of Object.entries(reply)) out[field] = String(value);
  }
  return out;
}

/** A counter hash as field to a whole number, never below zero. */
export function hashCounts(reply) {
  const out = {};
  for (const [field, value] of Object.entries(hashFields(reply))) {
    const n = Math.floor(Number(value));
    if (Number.isFinite(n) && n > 0) out[field] = n;
  }
  return out;
}

function dayCounts(reply) {
  const out = {};
  for (const [field, n] of Object.entries(hashCounts(reply))) if (isDay(field)) out[field] = n;
  return out;
}

function total(counts, keep = () => true) {
  let sum = 0;
  for (const [field, n] of Object.entries(counts)) if (keep(field)) sum += n;
  return sum;
}

/**
 * The first 30 look-backs by due day, taking the whole day on which the 30th falls.
 * `after` starts the count on the day after it, for the next 30.
 */
export function cohortOf(due, { after = "" } = {}) {
  const days = Object.keys(due)
    .filter((day) => isDay(day) && due[day] > 0 && day > after)
    .sort();
  const picked = [];
  let size = 0;
  for (const day of days) {
    picked.push(day);
    size += due[day];
    if (size >= COHORT_SIZE) break;
  }
  return { days: picked, size, full: size >= COHORT_SIZE, firstDay: picked[0] || "", lastDay: picked[picked.length - 1] || "" };
}

function cohortNumbers(counters, cohort, asOf) {
  const due = counters.lookbacksDue;
  // A missed write must not show more done than due on a day, or more within 7 days than within 14.
  const done14On = (day) => Math.min(counters.lookbacksDone14d[day] || 0, due[day] || 0);
  const done7On = (day) => Math.min(counters.lookbacksDone7d[day] || 0, done14On(day));
  const sum = (per, keep = () => true) => cohort.days.filter(keep).reduce((n, day) => n + per(day), 0);
  const afterEmail = (day) => day > LAST_EMAIL_DAY;
  return {
    matured: sum((day) => due[day], (day) => addDays(day, DONE_DAYS) <= asOf),
    done14: sum(done14On),
    done7: sum(done7On),
    afterEmail: sum((day) => due[day], afterEmail),
    afterEmailDone14: sum(done14On, afterEmail),
  };
}

/**
 * The kill threshold for the record bet, read from the counters on `today`.
 *
 * Read day: 14 days after the cohort's last due day, or 2027-02-28, whichever is first.
 *   1. Fewer than 30 look-backs have had a full 14 days on the read day, or they come from
 *      fewer than 5 people: "not tested: the constraint is reach". Never a kill.
 *   2. Otherwise kill if fewer than 8 of the cohort were done within 14 days.
 *   3. Otherwise keep going if 15 or more were done within 14 days.
 *   4. Otherwise change one thing about the reminder, read the next 30 once, then decide by
 *      rules 2 and 3. The next 30 are the first 30 that fall due after the read day.
 * Before the read day the rule shown is what a reading taken today would say. From the read day
 * on, the look-backs are judged as they stood on the read day, so the reading does not move.
 */
export function killThreshold(given, today) {
  const counters = { lookbacksDue: {}, lookbackPeople: {}, lookbacksDone7d: {}, lookbacksDone14d: {}, ...given };
  const due = counters.lookbacksDue;
  const cohort = cohortOf(due);
  const readDay = cohort.full && addDays(cohort.lastDay, DONE_DAYS) < BACKSTOP_DAY ? addDays(cohort.lastDay, DONE_DAYS) : BACKSTOP_DAY;
  const reached = today >= readDay;
  const numbers = cohortNumbers(counters, cohort, reached ? readDay : today);
  const people = total(counters.lookbackPeople, (day) => isDay(day) && cohort.lastDay !== "" && day <= cohort.lastDay);
  const tooFew = numbers.matured < COHORT_SIZE;
  const tooFewPeople = people < MIN_PEOPLE;
  let rule = 4;
  if (tooFew || tooFewPeople) rule = 1;
  else if (numbers.done14 < KILL_BELOW) rule = 2;
  else if (numbers.done14 >= KEEP_FROM) rule = 3;
  const out = {
    counted: total(due),
    firstDueDay: Object.keys(due).filter(isDay).sort()[0] || "",
    lastDueDay: Object.keys(due).filter(isDay).sort().pop() || "",
    cohort: { size: cohort.size, full: cohort.full, firstDay: cohort.firstDay, lastDay: cohort.lastDay },
    people,
    matured: numbers.matured,
    done14: numbers.done14,
    done7: numbers.done7,
    afterEmail: numbers.afterEmail,
    afterEmailDone14: numbers.afterEmailDone14,
    readDay,
    reached,
    rule,
    tooFew,
    tooFewPeople,
    next: null,
  };
  if (reached && rule === 4) {
    // The change to the reminder comes after the reading, so the next 30 are the first 30 that
    // fall due after the read day. A look-back due before then could not have been touched by it.
    const second = cohortOf(due, { after: readDay });
    const secondRead = second.full ? addDays(second.lastDay, DONE_DAYS) : "";
    const secondReached = Boolean(secondRead) && today >= secondRead;
    const secondNumbers = cohortNumbers(counters, second, secondReached ? secondRead : today);
    let decided = 0;
    if (secondReached && secondNumbers.done14 < KILL_BELOW) decided = 2;
    else if (secondReached && secondNumbers.done14 >= KEEP_FROM) decided = 3;
    out.next = {
      size: second.size,
      full: second.full,
      firstDay: second.firstDay,
      lastDay: second.lastDay,
      done14: secondNumbers.done14,
      done7: secondNumbers.done7,
      readDay: secondRead,
      reached: secondReached,
      rule: decided,
    };
  }
  return out;
}

/**
 * Everything the readout prints, as numbers. `raw` holds one HGETALL reply per name in
 * OUTSIDE_KEYS, plus `live`, the day counting began.
 */
export function outsideReading(raw = {}, today) {
  const counters = {
    firstGrills: dayCounts(raw.firstGrills),
    cameBack: dayCounts(raw.cameBack),
    recordsOn: dayCounts(raw.recordsOn),
    recordsOff: dayCounts(raw.recordsOff),
    choices: dayCounts(raw.choices),
    lookbacksDue: dayCounts(raw.lookbacksDue),
    lookbackPeople: dayCounts(raw.lookbackPeople),
    lookbacksDone7d: dayCounts(raw.lookbacksDone7d),
    lookbacksDone14d: dayCounts(raw.lookbacksDone14d),
  };
  const apps = hashCounts(raw.firstGrillApp);
  const byApp = OUTSIDE_APPS.map((app) => [app, apps[app] || 0]).filter(([, n]) => n > 0);
  const live = isDay(raw.live) ? raw.live : "";
  const anything = Object.values(counters).some((hash) => total(hash) > 0) || byApp.length > 0;
  const oldEnough = (day) => addDays(day, CAME_BACK_AGE_DAYS) <= today;
  const grilledOld = total(counters.firstGrills, oldEnough);
  return {
    today,
    live,
    counting: Boolean(live) || anything,
    grilled: total(counters.firstGrills),
    grilledOld,
    // A missed write must not show more people back than people who started.
    cameBackOld: Math.min(total(counters.cameBack, oldEnough), grilledOld),
    recordsOn: total(counters.recordsOn),
    recordsOff: total(counters.recordsOff),
    choices: total(counters.choices),
    byApp,
    threshold: killThreshold(counters, today),
  };
}

function span(first, last) {
  if (!first) return "";
  return first === last ? ` (due ${first})` : ` (due ${first} to ${last})`;
}

function ruleLine(t) {
  if (t.rule === 1) {
    const why = [];
    if (t.tooFew) why.push(`Only ${t.matured} of the ${COHORT_SIZE} look-backs needed have had a full ${DONE_DAYS} days.`);
    if (t.tooFewPeople) why.push(`The look-backs come from ${t.people} ${t.people === 1 ? "person" : "people"}, and ${MIN_PEOPLE} are needed.`);
    // Before the read day this is what a reading taken today would say. Nothing is recorded yet.
    const verdict = t.reached ? `Record "${NOT_TESTED}".` : `Read today, this would be "${NOT_TESTED}".`;
    return `Rule that applies today: 1. ${verdict} ${why.join(" ")} This is never a kill.`;
  }
  if (t.rule === 2) {
    return `Rule that applies today: 2. Kill: fewer than ${KILL_BELOW} of the cohort were done within ${DONE_DAYS} days (${t.done14} of ${t.cohort.size}). Stop building on the solo record. The team pilot is the only record bet left.`;
  }
  if (t.rule === 3) {
    return `Rule that applies today: 3. Keep going: ${KEEP_FROM} or more were done within ${DONE_DAYS} days (${t.done14} of ${t.cohort.size}). Within ${DONE_SHORT_DAYS} days: ${t.done7} of ${t.cohort.size}.`;
  }
  return `Rule that applies today: 4. Change one thing about the reminder, read the next ${COHORT_SIZE} once, then decide by rules 2 and 3 (${t.done14} of ${t.cohort.size} done within ${DONE_DAYS} days).`;
}

function nextLines(next) {
  if (!next) return [];
  const lines = [
    next.full
      ? `Next ${COHORT_SIZE}, due after the read day: ${next.size} look-backs${span(next.firstDay, next.lastDay)}`
      : `Next ${COHORT_SIZE}, due after the read day: ${next.size} of ${COHORT_SIZE} so far${span(next.firstDay, next.lastDay)}`,
    `Next ${COHORT_SIZE}, done within ${DONE_DAYS} days: ${next.done14} of ${next.size}`,
    `Next ${COHORT_SIZE}, done within ${DONE_SHORT_DAYS} days: ${next.done7} of ${next.size}`,
  ];
  if (!next.reached) {
    lines.push(next.readDay ? `Next ${COHORT_SIZE}, read day: ${next.readDay}. Not read yet.` : `Next ${COHORT_SIZE}, read day: ${DONE_DAYS} days after its 30th look-back falls due. Not known yet.`);
  } else if (next.rule === 2) {
    lines.push(`Next ${COHORT_SIZE}, rule 2. Kill: fewer than ${KILL_BELOW} were done within ${DONE_DAYS} days. Stop building on the solo record.`);
  } else if (next.rule === 3) {
    lines.push(`Next ${COHORT_SIZE}, rule 3. Keep going: ${KEEP_FROM} or more were done within ${DONE_DAYS} days.`);
  } else {
    lines.push(`Next ${COHORT_SIZE}: between ${KILL_BELOW} and ${KEEP_FROM - 1} done within ${DONE_DAYS} days. Rules 2 and 3 do not decide this. It goes to the owner.`);
  }
  return lines;
}

/**
 * The readout, one fact per line. Whole numbers and "k of n" only, and no percentage, because
 * most of these counts will be under 10 for a long time. No account id, no email, no title.
 */
export function outsideLines(reading) {
  const head = `Outside loop readout (UTC day ${reading.today})`;
  if (!reading.counting) return [head, NOT_COUNTED_LINE];
  const t = reading.threshold;
  const apps = reading.byApp.length ? reading.byApp.map(([app, n]) => `${app} ${n}`).join(" · ") : "none";
  return [
    head,
    `Counting since: ${reading.live || "not recorded"}`,
    `Outside people who grilled: ${reading.grilled}`,
    `First grilled ${CAME_BACK_AGE_DAYS} or more days ago: ${reading.grilledOld}`,
    `Of those, came back: ${reading.cameBackOld} of ${reading.grilledOld}`,
    `Records question: yes ${reading.recordsOn}, no ${reading.recordsOff}`,
    `Choices logged: ${reading.choices}`,
    `First grills by app: ${apps}`,
    `Kill threshold for the record bet (set ${THRESHOLD_SET_DAY})`,
    `Look-backs counted: ${t.counted}${span(t.firstDueDay, t.lastDueDay)}`,
    t.cohort.full
      ? `Cohort: ${t.cohort.size} look-backs, the first ${COHORT_SIZE} by due day with the whole last day${span(t.cohort.firstDay, t.cohort.lastDay)}`
      : `Cohort: ${t.cohort.size} of the first ${COHORT_SIZE} so far${span(t.cohort.firstDay, t.cohort.lastDay)}`,
    `Cohort people: ${t.people}`,
    `Had a full ${DONE_DAYS} days: ${t.matured} of ${t.cohort.size}`,
    `Done within ${DONE_DAYS} days: ${t.done14} of ${t.cohort.size}`,
    `Done within ${DONE_SHORT_DAYS} days: ${t.done7} of ${t.cohort.size}`,
    `Due after ${LAST_EMAIL_DAY}, the last Monday email: ${t.afterEmail} of ${t.cohort.size}. Of those, done within ${DONE_DAYS} days: ${t.afterEmailDone14} of ${t.afterEmail}`,
    "Email arms: both count. These counters do not record which arm an account is in, so the arms are not shown apart.",
    `Read day: ${t.readDay}`,
    ruleLine(t),
    t.reached ? "Status: the read day has come. This reading stands." : `Status: not the read day yet. Nothing is decided before ${t.readDay}.`,
    ...nextLines(t.next),
  ];
}
