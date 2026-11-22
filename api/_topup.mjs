// Prepaid check packs for a hosted account. Off unless GRILL_TOPUPS=on.
// One-time Stripe Checkout. The webhook credits checks and raises the router key.
// The pack's internal budget is never put in a page or a chat reply.
import { isStripeCustomerId, proClients, setMonthlyLimit, UpstreamError } from "./_pro.mjs";
import { redisCommand } from "./_account.mjs";
import {
  hostedAccountKey,
  keyLimitWithTopup,
  topupBalanceKey,
  topupBudgetUsd,
  topupEventKey,
  topupPack,
  topupPriceId,
  topupSessionKey,
  topupsEnabled,
  toMicros,
} from "../scripts/hostedCore.mjs";

const EVENT_TTL_SECONDS = 40 * 24 * 60 * 60;
const ACCOUNT_RE = /^[A-Za-z0-9_-]{8,80}$/;
const EVENT_RE = /^evt_[A-Za-z0-9]{8,80}$/;
const SESSION_RE = /^cs_(?:test|live)_[A-Za-z0-9]{8,200}$/;

/** A price a person pays, from integer cents. "$4" or "$4.50". */
export function topupPriceLabel(cents) {
  const dollars = Number(cents) / 100;
  const text = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${text}`;
}

function stripeKeyMode(secret) {
  const value = typeof secret === "string" ? secret.trim() : "";
  if (value.startsWith("sk_test_") || value.startsWith("rk_test_")) return "test";
  if (value.startsWith("sk_live_") || value.startsWith("rk_live_")) return "live";
  return "";
}

/**
 * Preview and local development take a test key. Production takes a live key.
 * A restricted key is the same mode as the matching secret key (rk_test_, rk_live_).
 * An unset VERCEL_ENV (tests, a laptop) accepts either, so a fixture key still runs.
 */
export function stripeModeAllowed(env = {}) {
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  if (!mode) return false;
  const vercel = String(env.VERCEL_ENV ?? "").trim();
  if (vercel === "production") return mode === "live";
  if (vercel === "preview" || vercel === "development") return mode === "test";
  return true;
}

function checkoutOrigin(origin) {
  const value = String(origin || "").replace(/\/$/, "");
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(value) ? value : "https://grillyour.ai";
}

export function isTopupCheckout(event) {
  const session = event?.data?.object;
  return event?.type === "checkout.session.completed" && session?.mode === "payment" && session?.metadata?.grill_topup === "1";
}

/**
 * Start a one-time Checkout for one pack. Saves the card for a later pack.
 * Sets `account.stripeCustomerId` when it creates a customer. The caller stores the account.
 * @returns {Promise<{state: "off"|"mode"|"unconfigured"|"redirect", url?: string}>}
 */
export async function startTopupCheckout({ env, fetch: fetchImpl, account, origin }) {
  if (!topupsEnabled(env)) return { state: "off" };
  if (!stripeModeAllowed(env)) return { state: "mode" };
  const price = topupPriceId(env);
  if (!price || !account?.id || !ACCOUNT_RE.test(account.id)) return { state: "unconfigured" };
  const { stripe } = proClients(env, fetchImpl);
  let customerId = isStripeCustomerId(account.stripeCustomerId) ? account.stripeCustomerId : "";
  if (!customerId) {
    const made = await stripe.post("/v1/customers", {
      email: account.email || "",
      "metadata[grill_account]": account.id,
    });
    customerId = made.body?.id || "";
    if (!made.ok || !isStripeCustomerId(customerId)) throw new UpstreamError("Stripe didn't save the customer");
    account.stripeCustomerId = customerId;
  }
  const home = checkoutOrigin(origin);
  const created = await stripe.post("/v1/checkout/sessions", {
    mode: "payment",
    customer: customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "payment_intent_data[setup_future_usage]": "off_session",
    success_url: `${home}/account?topup=ok`,
    cancel_url: `${home}/account?topup=cancel`,
    "metadata[grill_topup]": "1",
    "metadata[grill_account]": account.id,
  });
  const url = created.body?.url;
  if (!created.ok || typeof url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    throw new UpstreamError(`Stripe didn't start checkout (${created.status})`);
  }
  return { state: "redirect", url };
}

async function release(command, eventKey, sessionKey) {
  await command(["DEL", eventKey]).catch(() => {});
  await command(["DEL", sessionKey]).catch(() => {});
}

/**
 * Credit one paid pack onto the account's prepaid balance and raise that account's router key
 * by the pack's internal budget. A second delivery of the same event or session does nothing.
 * The balance is not month-scoped, so unused checks stay.
 */
export async function applyTopupEvent(event, { env, fetch: fetchImpl, command }) {
  if (!isTopupCheckout(event)) return { action: "ignored" };
  if (!topupsEnabled(env)) return { action: "off" };
  const session = event.data.object ?? {};
  if (session.payment_status !== "paid" || session.status !== "complete") return { action: "unpaid" };
  const accountId = String(session.metadata?.grill_account || "");
  if (!ACCOUNT_RE.test(accountId)) return { action: "ignored" };
  const pack = topupPack(env);
  if (!pack.priceId) return { action: "unconfigured" };
  if (session.currency !== "usd" || Number(session.amount_total) !== pack.priceCents) return { action: "amount" };
  const eventId = String(event.id || "");
  const sessionId = String(session.id || "");
  if (!EVENT_RE.test(eventId) || !SESSION_RE.test(sessionId)) return { action: "ignored" };

  const redis = command || redisCommand(env, fetchImpl);
  const eventKey = topupEventKey(eventId);
  const sessionKey = topupSessionKey(sessionId);
  if ((await redis(["SET", eventKey, "1", "NX", "EX", String(EVENT_TTL_SECONDS)])) !== "OK") return { action: "duplicate" };
  if ((await redis(["SET", sessionKey, accountId, "NX", "EX", String(EVENT_TTL_SECONDS)])) !== "OK") return { action: "duplicate" };

  const raw = await redis(["GET", hostedAccountKey(accountId)]);
  if (typeof raw !== "string" || !raw) {
    await release(redis, eventKey, sessionKey);
    return { action: "no-account" };
  }
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    await release(redis, eventKey, sessionKey);
    return { action: "ignored" };
  }
  const person = account.human || account.email || account.id;
  const balanceKey = topupBalanceKey(person);
  const budgetMicros = toMicros(pack.budgetUsd);
  try {
    await redis(["HINCRBY", balanceKey, "checks", String(pack.checks)]);
    await redis(["HINCRBY", balanceKey, "budget_micros", String(budgetMicros)]);
  } catch (error) {
    await redis(["HINCRBY", balanceKey, "checks", String(-pack.checks)]).catch(() => {});
    await redis(["HINCRBY", balanceKey, "budget_micros", String(-budgetMicros)]).catch(() => {});
    await release(redis, eventKey, sessionKey);
    throw error;
  }
  if (account.keyHash) {
    const left = Number(await redis(["HGET", balanceKey, "budget_micros"])) || 0;
    const limit = keyLimitWithTopup(env, left / 1_000_000);
    try {
      await setMonthlyLimit(account.keyHash, limit, { env, fetch: fetchImpl });
    } catch (error) {
      await redis(["HINCRBY", balanceKey, "checks", String(-pack.checks)]).catch(() => {});
      await redis(["HINCRBY", balanceKey, "budget_micros", String(-budgetMicros)]).catch(() => {});
      await release(redis, eventKey, sessionKey);
      throw error;
    }
    account.keyLimitUsd = limit;
    account.keyReset = "monthly";
    await redis(["SET", hostedAccountKey(accountId), JSON.stringify(account)]);
  }
  return { action: "credited" };
}

export { topupBudgetUsd };
