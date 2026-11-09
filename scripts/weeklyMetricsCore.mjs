/**
 * Weekly counts that are not users. Paid-intent is views and Notify me clicks while paid
 * plans are off. Free-to-paid is accounts that reached a paid checkout, once each.
 * Waitlist is sign-ups. Founding members are how many of the 100 numbers are assigned. Start views and tagged /start?ref= counts are top-of-funnel, not users.
 * The keys are the same strings the writers use. This file does not
 * import those writers, so the report can ship on its own.
 */
import { redisCommand } from "../api/_account.mjs";
import { readEmailExperiment } from "./impactDigest.mjs";

export const PAID_INTENT_KEYS = Object.freeze({
  pricing: "grill:metric:paid_intent_pricing",
  checkout: "grill:metric:paid_intent_checkout",
  notify: "grill:metric:paid_intent_notify",
});
export const FREE_TO_PAID_KEY = "grill:metric:free_to_paid";
export const WAITLIST_SIGNUPS_KEY = "grill:metric:waitlist_signup";
export const FOUNDING_COUNT_KEY = "grill:hosted:founding:count";
export const FUNNEL_KEYS = Object.freeze({
  grills: "grill:metric:funnel_grills",
  choices: "grill:metric:funnel_choices",
  lookbacksSet: "grill:metric:funnel_lookbacks_set",
  lookbacksDone: "grill:metric:funnel_lookbacks_done",
});
export const IMPACT_EMAIL_KEYS = Object.freeze({
  lookbacks: "grill:metric:impact_email_lookbacks",
  unsubscribes: "grill:metric:impact_email_unsubscribes",
});
export const START_VIEWS_KEY = "grill:metric:start_views";
/** Fixed channel labels for /start?ref=. No SCAN. Unknown tags stay unread. */
export const START_REF_LABELS = Object.freeze(["home", "askgrill", "hn", "smithery", "demo", "x"]);

/** The weekly email test in two lines. Counts only. */
export function emailTestLines(test) {
  if (!test) return [];
  const rate = (row) => `${row.returned}/${row.weeks} returned (${row.activity} grill or look-back, ${row.tapOnly} tap only)`;
  return [
    `email test: ${test.recipients} people, ${test.sends} sends, ${test.ready ? "ready to decide" : "not ready"}, guardrail ${test.guardrail}, clicks ${test.clicks}`,
    `email test arms: sent ${rate(test.send)} · held out ${rate(test.holdout)}`,
  ];
}

export async function readWeeklyMetrics(env = {}, fetchImpl = globalThis.fetch) {
  const url = typeof env.UPSTASH_REDIS_REST_URL === "string" ? env.UPSTASH_REDIS_REST_URL.trim() : "";
  const token = typeof env.UPSTASH_REDIS_REST_TOKEN === "string" ? env.UPSTASH_REDIS_REST_TOKEN.trim() : "";
  if (!url || !token) {
    const err = new Error("not configured");
    err.code = "unconfigured";
    throw err;
  }
  const command = redisCommand(env, fetchImpl);
  const n = async (key) => Number(await command(["GET", key])) || 0;
  const startRefs = {};
  for (const label of START_REF_LABELS) {
    startRefs[label] = await n(`grill:metric:start_ref:${label}`);
  }
  return {
    label: "Weekly metrics",
    countsAsUsers: false,
    paidIntentPricing: await n(PAID_INTENT_KEYS.pricing),
    paidIntentCheckout: await n(PAID_INTENT_KEYS.checkout),
    paidIntentNotify: await n(PAID_INTENT_KEYS.notify),
    freeToPaid: await n(FREE_TO_PAID_KEY),
    waitlist: await n(WAITLIST_SIGNUPS_KEY),
    founding: await n(FOUNDING_COUNT_KEY),
    startViews: await n(START_VIEWS_KEY),
    startRefs,
    grills: await n(FUNNEL_KEYS.grills),
    choices: await n(FUNNEL_KEYS.choices),
    lookbacksSet: await n(FUNNEL_KEYS.lookbacksSet),
    lookbacksDone: await n(FUNNEL_KEYS.lookbacksDone),
    emailLookbacks: await n(IMPACT_EMAIL_KEYS.lookbacks),
    emailUnsubscribes: await n(IMPACT_EMAIL_KEYS.unsubscribes),
    emailTest: await readEmailExperiment(command).catch(() => null),
  };
}

function foundingShown(report) {
  const n = Math.floor(Number(report.founding) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

/** Channel tags with a non-zero count, for the weekly line. */
export function startRefLine(startRefs) {
  const parts = [];
  for (const label of START_REF_LABELS) {
    const n = Math.floor(Number(startRefs?.[label]) || 0);
    if (n > 0) parts.push(`${label} ${n}`);
  }
  return parts.length ? `start refs: ${parts.join(" · ")}` : "start refs: none";
}

/** The lines a person reads. The JSON line is the same numbers, for metrics.jsonl. */
export function weeklyMetricLines(report) {
  return [
    `paid-intent pricing: ${report.paidIntentPricing}`,
    `paid-intent checkout: ${report.paidIntentCheckout}`,
    `paid-intent notify: ${report.paidIntentNotify}`,
    `free-to-paid: ${report.freeToPaid}`,
    `waitlist: ${report.waitlist ?? 0}`,
    `founding members: ${foundingShown(report)}/100`,
    `start views: ${report.startViews ?? 0}`,
    startRefLine(report.startRefs),
    `grills: ${report.grills ?? 0}`,
    `choices logged: ${report.choices ?? 0}`,
    `look-backs set: ${report.lookbacksSet ?? 0}`,
    `look-backs done: ${report.lookbacksDone ?? 0}`,
    `email look-backs: ${report.emailLookbacks ?? 0}`,
    `email unsubscribes: ${report.emailUnsubscribes ?? 0}`,
    ...emailTestLines(report.emailTest),
    JSON.stringify(report),
  ];
}
