/**
 * Weekly counts that are not users. Paid-intent is views and Notify me clicks while paid
 * plans are off. Free-to-paid is accounts that reached a paid checkout, once each.
 * Waitlist is sign-ups. The keys are the same strings the writers use. This file does not
 * import those writers, so the report can ship on its own.
 */
import { redisCommand } from "../api/_account.mjs";

export const PAID_INTENT_KEYS = Object.freeze({
  pricing: "grill:metric:paid_intent_pricing",
  checkout: "grill:metric:paid_intent_checkout",
  notify: "grill:metric:paid_intent_notify",
});
export const FREE_TO_PAID_KEY = "grill:metric:free_to_paid";
export const WAITLIST_SIGNUPS_KEY = "grill:metric:waitlist_signup";

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
  return {
    label: "Weekly metrics",
    countsAsUsers: false,
    paidIntentPricing: await n(PAID_INTENT_KEYS.pricing),
    paidIntentCheckout: await n(PAID_INTENT_KEYS.checkout),
    paidIntentNotify: await n(PAID_INTENT_KEYS.notify),
    freeToPaid: await n(FREE_TO_PAID_KEY),
    waitlist: await n(WAITLIST_SIGNUPS_KEY),
  };
}

/** The lines a person reads. The JSON line is the same numbers, for metrics.jsonl. */
export function weeklyMetricLines(report) {
  return [
    `paid-intent pricing: ${report.paidIntentPricing}`,
    `paid-intent checkout: ${report.paidIntentCheckout}`,
    `paid-intent notify: ${report.paidIntentNotify}`,
    `free-to-paid: ${report.freeToPaid}`,
    `waitlist: ${report.waitlist ?? 0}`,
    JSON.stringify(report),
  ];
}
