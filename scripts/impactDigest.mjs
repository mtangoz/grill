/**
 * The Monday impact note. A separate template from the launch list and from sign-in.
 * Counting matches grillImpact: a Yes, an after mark, or a supersedes line. A verdict is not a change.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { grillImpact, hasLookback, impactDetailLine, isoDay } from "./hostedCore.mjs";
import { shortDecision } from "./reflection.mjs";

export const IMPACT_EMAIL_SUBJECT = "Did Grill change your call?";
// The test ends on people reached, not weeks. See docs/experiments/weekly-email.md.
export const IMPACT_PILOT_START = "2026-11-09";
export const IMPACT_PILOT_LAST = "2027-01-25";
export const IMPACT_DECISION = Object.freeze({ recipients: 30, sends: 60, unsubscribeShare: 0.1 });
export const IMPACT_EXP_PREFIX = "grill:exp:weekly-email";
export const IMPACT_RETURN_KINDS = Object.freeze(["grill", "lookback", "tap"]);
export const IMPACT_LOOKBACKS_KEY = "grill:metric:impact_email_lookbacks";
export const IMPACT_UNSUB_KEY = "grill:metric:impact_email_unsubscribes";

const DAY_MS = 24 * 60 * 60 * 1000;

/** On unless this account turned it off. No address means there is nobody to mail. */
export function impactEmailOn(account) {
  const email = String(account?.email || "").trim();
  if (!email) return false;
  return account.impactEmail !== false;
}

export function impactSentKey(email, weekKey) {
  const hash = createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex");
  return `grill:hosted:impact-sent:${hash}:${weekKey}`;
}

/** A pilot Monday at or after 14:00 UTC, from the start through the backstop. */
export function impactDigestWeek(now = Date.now()) {
  const date = new Date(now);
  if (date.getUTCDay() !== 1 || date.getUTCHours() < 14) return null;
  const key = isoDay(now);
  if (key < IMPACT_PILOT_START || key > IMPACT_PILOT_LAST) return null;
  const index = Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${IMPACT_PILOT_START}T00:00:00Z`)) / (7 * DAY_MS));
  const endMs = Date.parse(`${key}T00:00:00Z`);
  return { key, index, startMs: endMs - 7 * DAY_MS, endMs };
}

function instantOf(row) {
  const created = Date.parse(row?.createdAt || "");
  if (Number.isFinite(created)) return created;
  const day = String(row?.date || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return Date.parse(`${day}T00:00:00Z`);
  return NaN;
}

export function weekGrills(rows, startMs, endMs) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const at = instantOf(row);
    return Number.isFinite(at) && at >= startMs && at < endMs;
  });
}

/** Review day inside this week, and not looked back yet. An older overdue date stays out. */
export function newlyDueLookbacks(rows, startMs, endMs) {
  const startDay = isoDay(startMs);
  const endDay = isoDay(endMs);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const review = String(row?.review || "");
      return /^\d{4}-\d{2}-\d{2}$/.test(review) && review >= startDay && review < endDay && !hasLookback(row);
    })
    .sort((a, b) => (a.review < b.review ? -1 : a.review > b.review ? 1 : String(a.id).localeCompare(String(b.id))));
}

export function outcomeConfirmUrl(origin, id, value) {
  const url = new URL("/decisions", origin);
  url.searchParams.set("confirm", "outcome");
  url.searchParams.set("id", id);
  url.searchParams.set("value", value);
  url.searchParams.set("from", "email");
  return url.toString();
}

/** The note body. A zero count is left out. No verdict text. The detail line matches Your grills. */
export function impactDigestText({ changed, count, unknown = 0, doubted, flagged, lookbacks, decisionsUrl, unsubscribeUrl, settingsUrl }) {
  const lines = [];
  if (count > 0) lines.push(`This week: ${changed} of ${count} grills changed your call.`);
  const detail = impactDetailLine({ unknown: Number(unknown) || 0, doubted: Number(doubted) || 0, flagged: Number(flagged) || 0 });
  if (detail) lines.push(detail);
  for (const item of lookbacks || []) {
    if (lines.length) lines.push("");
    lines.push(`Look-back due: ${item.label}`);
    lines.push(`Held up: ${item.held}`);
    lines.push(`Didn't: ${item.no}`);
    lines.push(`Mixed: ${item.mixed}`);
  }
  lines.push("");
  lines.push(`Your grills → ${decisionsUrl}`);
  lines.push("");
  lines.push(`Unsubscribe: ${unsubscribeUrl}`);
  lines.push(`Email settings: ${settingsUrl}`);
  return `${lines.join("\n")}\n`;
}

/**
 * One account's note for this week, or null when there is nothing new to say.
 * The counts are grillImpact on this week's grills only.
 */
export function digestForAccount(rows, window, urls) {
  const grills = weekGrills(rows, window.startMs, window.endMs);
  const due = newlyDueLookbacks(rows, window.startMs, window.endMs);
  if (!grills.length && !due.length) return null;
  const summary = grillImpact(grills);
  const text = impactDigestText({
    changed: summary.changed,
    count: summary.count,
    unknown: summary.unknown,
    doubted: summary.doubted,
    flagged: summary.flagged,
    lookbacks: due.map((item) => ({
      label: shortDecision(item.title || ""),
      held: urls.outcome(item.id, "held"),
      no: urls.outcome(item.id, "no"),
      mixed: urls.outcome(item.id, "mixed"),
    })),
    decisionsUrl: urls.decisions,
    unsubscribeUrl: urls.unsubscribe,
    settingsUrl: urls.settings,
  });
  return { subject: IMPACT_EMAIL_SUBJECT, text };
}

export function sealImpactToken(accountId, secret, exp) {
  const body = Buffer.from(JSON.stringify({ id: String(accountId), exp: Number(exp) })).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function openImpactToken(token, secret, now) {
  if (typeof token !== "string" || !secret) return null;
  const split = token.lastIndexOf(".");
  if (split <= 0) return null;
  const body = token.slice(0, split);
  const mac = token.slice(split + 1);
  const expected = createHmac("sha256", secret).update(body).digest();
  let got;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims.id !== "string" || !claims.id || typeof claims.exp !== "number") return null;
  if (!(claims.exp > now)) return null;
  return { id: claims.id };
}

/** A fixed split by account id: about one in four is held out and not sent. The same every week. */
export function impactArm(accountId) {
  const byte = createHash("sha256").update(`weekly-email-v1:${String(accountId)}`).digest()[0];
  return byte % 4 === 0 ? "holdout" : "send";
}

export function impactExpKey(weekKey, part) {
  return `${IMPACT_EXP_PREFIX}:${weekKey}:${part}`;
}

/** The pilot Monday (after the 14:00 UTC send) in the last seven days, or null. */
export function emailReturnWeek(now = Date.now()) {
  for (let back = 0; back < 8; back += 1) {
    const at = now - back * DAY_MS;
    const day = new Date(at);
    if (day.getUTCDay() !== 1) continue;
    const key = isoDay(at);
    const sendAt = Date.parse(`${key}T14:00:00Z`);
    if (now < sendAt || now - sendAt >= 7 * DAY_MS) continue;
    if (key < IMPACT_PILOT_START || key > IMPACT_PILOT_LAST) return null;
    return key;
  }
  return null;
}

function armRow(ids, sets) {
  const row = { weeks: 0, returned: 0, activity: 0, tapOnly: 0 };
  for (const id of ids) {
    row.weeks += 1;
    const active = sets.grill.has(id) || sets.lookback.has(id);
    const tapped = sets.tap.has(id);
    if (active || tapped) row.returned += 1;
    if (active) row.activity += 1;
    else if (tapped) row.tapOnly += 1;
  }
  return row;
}

function add(a, b) {
  return { weeks: a.weeks + b.weeks, returned: a.returned + b.returned, activity: a.activity + b.activity, tapOnly: a.tapOnly + b.tapOnly };
}

/**
 * The pre-set readout. Ready once 30 people and 60 sends are reached and a full week has passed
 * after that Monday, or a week after the backstop. A return is a grill, a look-back or a Yes/No tap
 * within 7 days of a Monday; activity (grill or look-back) is kept apart from a tap alone.
 */
export function experimentReadout(weeks, totals, now = Date.now()) {
  let send = { weeks: 0, returned: 0, activity: 0, tapOnly: 0 };
  let holdout = { ...send };
  let clicks = 0;
  for (const week of weeks || []) {
    const sets = { grill: new Set(week.grill || []), lookback: new Set(week.lookback || []), tap: new Set(week.tap || []) };
    send = add(send, armRow(week.send || [], sets));
    holdout = add(holdout, armRow(week.holdout || [], sets));
    clicks += Number(week.clicks) || 0;
  }
  const recipients = Number(totals?.recipients) || 0;
  const sends = Number(totals?.sends) || 0;
  const unsubscribes = Number(totals?.unsubscribes) || 0;
  const reached = recipients >= IMPACT_DECISION.recipients && sends >= IMPACT_DECISION.sends;
  const settleFrom = reached && totals?.lastSendWeek ? totals.lastSendWeek : reached ? null : IMPACT_PILOT_LAST;
  const ready = Boolean(settleFrom) && now >= Date.parse(`${settleFrom}T14:00:00Z`) + 7 * DAY_MS;
  const guardrail = recipients > 0 && unsubscribes / recipients > IMPACT_DECISION.unsubscribeShare ? "pause" : "ok";
  return { ready, reached, recipients, sends, unsubscribes, clicks, send, holdout, guardrail };
}

/** Every pilot Monday key up to now. */
export function pilotWeeksSoFar(now = Date.now()) {
  const keys = [];
  for (let at = Date.parse(`${IMPACT_PILOT_START}T14:00:00Z`); at <= now && isoDay(at) <= IMPACT_PILOT_LAST; at += 7 * DAY_MS) keys.push(isoDay(at));
  return keys;
}

/** Reads the test sets through a Redis command function, then the pre-set readout. Ids stay in memory. */
export async function readEmailExperiment(command, now = Date.now()) {
  const weeks = [];
  let lastSendWeek = null;
  const seen = new Set();
  let sends = 0;
  let reachedAt = null;
  for (const key of pilotWeeksSoFar(now)) {
    const list = async (part) => {
      const got = await command(["SMEMBERS", impactExpKey(key, part)]);
      return Array.isArray(got) ? got.map(String) : [];
    };
    const week = { key, send: await list("send"), holdout: await list("holdout"), grill: await list("grill"), lookback: await list("lookback"), tap: await list("tap") };
    week.clicks = Number(await command(["GET", impactExpKey(key, "clicks")])) || 0;
    weeks.push(week);
    for (const id of week.send) seen.add(id);
    sends += week.send.length;
    if (week.send.length) lastSendWeek = key;
    if (!reachedAt && seen.size >= IMPACT_DECISION.recipients && sends >= IMPACT_DECISION.sends) reachedAt = key;
  }
  const unsubscribes = Number(await command(["GET", IMPACT_UNSUB_KEY])) || 0;
  return experimentReadout(weeks, { recipients: seen.size, sends, unsubscribes, lastSendWeek: reachedAt || lastSendWeek }, now);
}
