/**
 * Anonymous paid-intent counts, and a later free-to-paid link.
 * Counts are numbers only. They are written while paid plans are off.
 * The checkout link is an account id already on the session, not an email and not a decision.
 * No new service. Prices are not changed here.
 */
import { redisCommand } from "./_account.mjs";
import { billingMode, checkoutClientReference } from "./_pro.mjs";

export const PAID_INTENT_KEYS = Object.freeze({
  pricing: "grill:metric:paid_intent_pricing",
  checkout: "grill:metric:paid_intent_checkout",
  notify: "grill:metric:paid_intent_notify",
});

export const FREE_TO_PAID_KEY = "grill:metric:free_to_paid";

export function linkedCheckoutKey(id) {
  const safe = checkoutClientReference(id);
  return safe ? `grill:checkout:linked:${safe}` : "";
}

function configured(env) {
  return Boolean(env?.UPSTASH_REDIS_REST_URL && env?.UPSTASH_REDIS_REST_TOKEN);
}

/** One anonymous count. Off when paid plans are on, and a miss never blocks the page. */
export async function recordPaidIntent(env, fetchImpl, kind) {
  if (billingMode(env) === "subscription") return false;
  const key = PAID_INTENT_KEYS[kind];
  if (!key || !configured(env)) return false;
  try {
    await redisCommand(env, fetchImpl)(["INCR", key]);
    return true;
  } catch {
    return false;
  }
}

/**
 * A completed checkout named an account. Count that account once toward free-to-paid.
 * This does not turn billing on and does not change a price.
 */
export async function noteFreeToPaid(env, fetchImpl, clientReferenceId) {
  const key = linkedCheckoutKey(clientReferenceId);
  if (!key || !configured(env)) return false;
  const command = redisCommand(env, fetchImpl);
  const claimed = await command(["SET", key, "1", "NX"]);
  if (!claimed) return false;
  await command(["INCR", FREE_TO_PAID_KEY]);
  return true;
}
