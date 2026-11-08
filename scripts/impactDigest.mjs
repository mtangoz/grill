/**
 * The Monday impact note. A separate template from the launch list and from sign-in.
 * Counting matches grillImpact: a Yes, an after mark, or a supersedes line. A verdict is not a change.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { grillImpact, hasLookback, isoDay } from "./hostedCore.mjs";
import { shortDecision } from "./reflection.mjs";

export const IMPACT_EMAIL_SUBJECT = "Did Grill change your call?";
export const IMPACT_PILOT_MONDAYS = Object.freeze(["2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
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

/** A pilot Monday at or after 14:00 UTC. Four weeks, then nothing. */
export function impactDigestWeek(now = Date.now()) {
  const date = new Date(now);
  if (date.getUTCDay() !== 1 || date.getUTCHours() < 14) return null;
  const key = isoDay(now);
  const index = IMPACT_PILOT_MONDAYS.indexOf(key);
  if (index < 0) return null;
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

function planLine(doubted, flagged) {
  const parts = [];
  if (doubted === 1) parts.push("1 plan flagged as not holding up");
  else if (doubted > 1) parts.push(`${doubted} plans flagged as not holding up`);
  if (flagged === 1) parts.push("1 grill with sources flagged");
  else if (flagged > 1) parts.push(`${flagged} grills with sources flagged`);
  return parts.join(" · ");
}

/** The note body. A zero plan count or a zero source count is left out. No verdict text. */
export function impactDigestText({ changed, count, doubted, flagged, lookbacks, decisionsUrl, unsubscribeUrl, settingsUrl }) {
  const lines = [];
  if (count > 0) lines.push(`This week: ${changed} of ${count} grills changed your call.`);
  const plans = planLine(Number(doubted) || 0, Number(flagged) || 0);
  if (plans) lines.push(plans);
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
