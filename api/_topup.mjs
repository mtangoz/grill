// Prepaid check packs for a hosted account. Off unless GRILL_TOPUPS=on.
// One-time Stripe Checkout. The webhook credits checks and raises the router key.
// The pack's internal budget is never put in a page or a chat reply.
import { isStripeCustomerId, proClients, setMonthlyLimit, UpstreamError } from "./_pro.mjs";
import { redisCommand } from "./_account.mjs";
import {
  autoTopupAttemptKey,
  autoTopupCeilingCents,
  autoTopupEnabled,
  autoTopupLockKey,
  autoTopupSpentKey,
  hostedAccountKey,
  isoMonth,
  keyLimitWithTopup,
  serviceRevenueKey,
  topupBalanceKey,
  topupPaymentKey,
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
const PI_RE = /^pi_[A-Za-z0-9]{8,80}$/;
const PM_RE = /^pm_[A-Za-z0-9_]{8,80}$/;

/** A price a person pays, from integer cents. "$5" or "$5.50". */
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

/** A Stripe error code or type. Never a key, and never the error message. */
function stripeErrorCode(body, status) {
  const error = body?.error;
  for (const value of [error?.code, error?.type, status ? String(status) : ""]) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!/^[a-z0-9_]{1,80}$/.test(text)) continue;
    if (text.includes("sk_") || text.includes("rk_") || text.includes("whsec")) continue;
    return text;
  }
  return "";
}

function stripeFailure(res, what) {
  const error = new UpstreamError(`${what} (${res?.status || 0})`);
  error.stripeCode = stripeErrorCode(res?.body, res?.status);
  return error;
}

/**
 * Start a one-time Checkout for one pack. Card only, so Apple Pay and Google Pay
 * still show, and Link, Klarna, Cash App and Amazon Pay do not. Saves that card
 * for a later off-session pack only when auto-add is ticked. Sets `account.stripeCustomerId` when it creates
 * a customer. The caller stores the account.
 * A restricted key needs write on Checkout Sessions, Customers, and PaymentIntents
 * (`payment_intent_data[setup_future_usage]`). A failure carries `stripeCode` only.
 * @returns {Promise<{state: "off"|"mode"|"unconfigured"|"redirect", url?: string, sessionId?: string}>}
 */
export async function startTopupCheckout({ env, fetch: fetchImpl, account, origin, autoTopup = false }) {
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
    if (!made.ok || !isStripeCustomerId(customerId)) throw stripeFailure(made, "Stripe didn't save the customer");
    account.stripeCustomerId = customerId;
  }
  const home = checkoutOrigin(origin);
  const created = await stripe.post("/v1/checkout/sessions", {
    mode: "payment",
    customer: customerId,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "payment_method_types[0]": "card",
    ...(autoTopup ? { "payment_intent_data[setup_future_usage]": "off_session" } : {}),
    success_url: `${home}/account?topup=ok&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${home}/account?topup=cancel`,
    "metadata[grill_topup]": "1",
    "metadata[grill_account]": account.id,
    ...(autoTopupEnabled(env) ? { "metadata[grill_auto_topup]": autoTopup ? "1" : "0" } : {}),
  });
  const url = created.body?.url;
  if (!created.ok || typeof url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    throw stripeFailure(created, "Stripe didn't start checkout");
  }
  const sessionId = SESSION_RE.test(String(created.body?.id || "")) ? created.body.id : "";
  return { state: "redirect", url, sessionId };
}

async function release(command, eventKey, sessionKey) {
  await command(["DEL", eventKey]).catch(() => {});
  if (sessionKey) await command(["DEL", sessionKey]).catch(() => {});
}

function paymentMethodId(pi) {
  const method = pi?.payment_method;
  if (typeof method === "string" && PM_RE.test(method)) return method;
  if (method && typeof method.id === "string" && PM_RE.test(method.id)) return method.id;
  return "";
}

function cardLast4(pi) {
  const method = pi?.payment_method;
  const fromMethod = method && typeof method === "object" ? method.card?.last4 : "";
  const charge = Array.isArray(pi?.charges?.data) ? pi.charges.data[0] : pi?.latest_charge;
  const fromCharge = charge && typeof charge === "object" ? charge.payment_method_details?.card?.last4 : "";
  const last4 = /^\d{4}$/.test(fromMethod) ? fromMethod : fromCharge;
  return /^\d{4}$/.test(last4) ? last4 : "";
}

function failureCode(body) {
  const code = String(body?.error?.code || body?.error?.decline_code || "");
  if (code === "authentication_required" || code === "card_declined") return code;
  if (body?.status === "requires_action" || body?.error?.payment_intent?.status === "requires_action") return "authentication_required";
  return "failed";
}

function rememberCard(account, pi) {
  const methodObj = pi?.payment_method && typeof pi.payment_method === "object" ? pi.payment_method : null;
  if (methodObj?.type && methodObj.type !== "card") return;
  const method = paymentMethodId(pi);
  const last4 = cardLast4(pi);
  if (methodObj?.type !== "card" && !last4) return;
  if (method) account.stripePaymentMethodId = method;
  if (last4) account.cardLast4 = last4;
}

/** "card" can be charged. "no" is a confirmed non-card. "unknown" means the lookup itself failed. */
async function cardPaymentMethodState(stripe, id) {
  if (!PM_RE.test(String(id || ""))) return "no";
  const got = await stripe.get(`/v1/payment_methods/${id}`);
  if (!got.ok) return got.status === 404 ? "no" : "unknown";
  return got.body?.type === "card" ? "card" : "no";
}

async function loadPaymentIntent(stripe, id) {
  if (!PI_RE.test(String(id || ""))) return null;
  const got = await stripe.get(`/v1/payment_intents/${id}`);
  return got.ok ? got.body : null;
}

async function creditBalance(redis, { env, fetchImpl, account, pack }) {
  const person = account.human || account.email || account.id;
  const balanceKey = topupBalanceKey(person);
  const budgetMicros = toMicros(pack.budgetUsd);
  const revenueMicros = toMicros(pack.priceCents / 100);
  const revenueKey = serviceRevenueKey(isoMonth());
  const undo = async () => {
    await redis(["HINCRBY", balanceKey, "checks", String(-pack.checks)]).catch(() => {});
    await redis(["HINCRBY", balanceKey, "budget_micros", String(-budgetMicros)]).catch(() => {});
    await redis(["INCRBY", revenueKey, String(-revenueMicros)]).catch(() => {});
  };
  try {
    await redis(["HINCRBY", balanceKey, "checks", String(pack.checks)]);
    await redis(["HINCRBY", balanceKey, "budget_micros", String(budgetMicros)]);
    await redis(["INCRBY", revenueKey, String(revenueMicros)]);
    await redis(["EXPIRE", revenueKey, String(EVENT_TTL_SECONDS)]);
  } catch (error) {
    await undo();
    throw error;
  }
  if (account.keyHash) {
    const left = Number(await redis(["HGET", balanceKey, "budget_micros"])) || 0;
    const checksLeft = Number(await redis(["HGET", balanceKey, "checks"])) || 0;
    const limit = keyLimitWithTopup(env, left / 1_000_000, checksLeft);
    try {
      await setMonthlyLimit(account.keyHash, limit, { env, fetch: fetchImpl });
    } catch (error) {
      await undo();
      throw error;
    }
    account.keyLimitUsd = limit;
    account.keyReset = "monthly";
  }
  return undo;
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
  let undo = async () => {};
  try {
    undo = await creditBalance(redis, { env, fetchImpl, account, pack });
  } catch (error) {
    await undo();
    await release(redis, eventKey, sessionKey);
    throw error;
  }
  if (autoTopupEnabled(env)) {
    const choice = session.metadata?.grill_auto_topup;
    if (!account.autoTopupCeilingCents) account.autoTopupCeilingCents = autoTopupCeilingCents(account);
    if (choice === "1") {
      try {
        const { stripe } = proClients(env, fetchImpl);
        rememberCard(account, await loadPaymentIntent(stripe, session.payment_intent));
      } catch {
        // The pack is already paid. Auto-add stays off unless a card is actually saved.
      }
      const saved = typeof account.stripePaymentMethodId === "string" && account.stripePaymentMethodId.startsWith("pm_");
      account.autoTopup = saved;
    } else if (choice === "0") {
      account.autoTopup = false;
    }
  }
  await redis(["SET", hostedAccountKey(accountId), JSON.stringify(account)]);
  // After the balance write, so a page that sees this value is reading a committed credit.
  await redis(["SET", sessionKey, "credited", "EX", String(EVENT_TTL_SECONDS)]);
  return { action: "credited" };
}

export function isAutoTopupPayment(event) {
  const pi = event?.data?.object;
  return (event?.type === "payment_intent.succeeded" || event?.type === "payment_intent.payment_failed") && pi?.metadata?.grill_auto === "1" && pi?.metadata?.grill_topup === "1";
}

/** Credit an off-session pack, or turn automatic add off when the card did not pay. */
export async function applyAutoTopupPayment(event, { env, fetch: fetchImpl, command }) {
  if (!isAutoTopupPayment(event)) return { action: "ignored" };
  if (!topupsEnabled(env) || !autoTopupEnabled(env)) return { action: "off" };
  const pi = event.data.object ?? {};
  const accountId = String(pi.metadata?.grill_account || "");
  if (!ACCOUNT_RE.test(accountId) || !PI_RE.test(String(pi.id || ""))) return { action: "ignored" };
  const redis = command || redisCommand(env, fetchImpl);
  if (event.type === "payment_intent.payment_failed") {
    await disableAutoTopup(redis, accountId, failureCode(pi));
    return { action: "disabled" };
  }
  if (pi.status !== "succeeded" || pi.currency !== "usd" || Number(pi.amount_received ?? pi.amount) !== topupPack(env).priceCents) {
    return { action: "amount" };
  }
  return creditClaimedPayment(redis, { env, fetchImpl, accountId, pi });
}

async function disableAutoTopup(redis, accountId, code) {
  const raw = await redis(["GET", hostedAccountKey(accountId)]);
  if (typeof raw !== "string" || !raw) return;
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    return;
  }
  account.autoTopup = false;
  account.autoTopupFailure = {
    code: /^(card_declined|authentication_required|failed)$/.test(code) ? code : "failed",
    at: new Date().toISOString(),
  };
  await redis(["SET", hostedAccountKey(accountId), JSON.stringify(account)]);
}

async function creditClaimedPayment(redis, { env, fetchImpl, accountId, pi }) {
  const claim = topupPaymentKey(pi.id);
  if ((await redis(["SET", claim, accountId, "NX", "EX", String(EVENT_TTL_SECONDS)])) !== "OK") return { action: "duplicate" };
  const raw = await redis(["GET", hostedAccountKey(accountId)]);
  if (typeof raw !== "string" || !raw) {
    await redis(["DEL", claim]);
    return { action: "no-account" };
  }
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    await redis(["DEL", claim]);
    return { action: "ignored" };
  }
  const pack = topupPack(env);
  try {
    await creditBalance(redis, { env, fetchImpl, account, pack });
  } catch (error) {
    await redis(["DEL", claim]);
    throw error;
  }
  rememberCard(account, pi);
  account.autoTopupFailure = null;
  await redis(["SET", hostedAccountKey(accountId), JSON.stringify(account)]);
  const month = String(pi.metadata?.grill_month || isoMonth());
  const spentKey = autoTopupSpentKey(accountId, month);
  await redis(["INCRBY", spentKey, String(pack.priceCents)]);
  await redis(["EXPIRE", spentKey, String(EVENT_TTL_SECONDS)]);
  return { action: "credited" };
}

/**
 * Charge one pack off-session when an opted-in account has no checks left.
 * One lock per account, and a new idempotency key per attempt, so two grills cannot both charge.
 */
export async function chargeAutoTopup({ env, fetch: fetchImpl, account, command }) {
  if (!autoTopupEnabled(env) || !topupsEnabled(env)) return { state: "off" };
  if (account?.autoTopup !== true) return { state: "opt-out" };
  if (!stripeModeAllowed(env)) return { state: "mode" };
  if (!account?.id || !ACCOUNT_RE.test(account.id)) return { state: "unconfigured" };
  if (!isStripeCustomerId(account.stripeCustomerId) || !PM_RE.test(String(account.stripePaymentMethodId || ""))) return { state: "no-card" };
  const pack = topupPack(env);
  if (!pack.priceId) return { state: "unconfigured" };
  const redis = command || redisCommand(env, fetchImpl);
  const lockKey = autoTopupLockKey(account.id);
  if ((await redis(["SET", lockKey, "1", "NX", "EX", "60"])) !== "OK") return { state: "busy" };
  try {
    const month = isoMonth();
    const spentKey = autoTopupSpentKey(account.id, month);
    const spent = Number(await redis(["GET", spentKey])) || 0;
    const ceiling = autoTopupCeilingCents(account);
    if (spent + pack.priceCents > ceiling) return { state: "ceiling" };
    const { stripe } = proClients(env, fetchImpl);
    // A restricted key may not be allowed to read payment methods. A failed lookup is not proof
    // the saved method is Link, so the charge still goes out as a card. A confirmed non-card does not.
    if ((await cardPaymentMethodState(stripe, account.stripePaymentMethodId)) === "no") return { state: "no-card" };
    const attempt = Number(await redis(["INCR", autoTopupAttemptKey(account.id, month)]));
    await redis(["EXPIRE", autoTopupAttemptKey(account.id, month), String(EVENT_TTL_SECONDS)]);
    const created = await stripe.post(
      "/v1/payment_intents",
      {
        amount: String(pack.priceCents),
        currency: "usd",
        customer: account.stripeCustomerId,
        payment_method: account.stripePaymentMethodId,
        "payment_method_types[0]": "card",
        confirm: "true",
        off_session: "true",
        "metadata[grill_topup]": "1",
        "metadata[grill_auto]": "1",
        "metadata[grill_account]": account.id,
        "metadata[grill_month]": month,
        "metadata[grill_seq]": String(attempt),
      },
      { "Idempotency-Key": `grill-auto-${account.id}-${month}-${attempt}` },
    );
    const body = created.body ?? {};
    const pi = body.id ? body : body.error?.payment_intent;
    if (created.ok && body.status === "succeeded" && pi?.id) {
      const outcome = await creditClaimedPayment(redis, { env, fetchImpl, accountId: account.id, pi: { ...pi, metadata: { ...pi.metadata, grill_month: month } } });
      if (outcome.action === "credited" || outcome.action === "duplicate") {
        account.autoTopupFailure = null;
        return { state: "credited" };
      }
      return { state: outcome.action };
    }
    const code = failureCode(body);
    account.autoTopup = false;
    account.autoTopupFailure = { code, at: new Date().toISOString() };
    await disableAutoTopup(redis, account.id, code);
    return { state: "failed", code };
  } finally {
    try {
      await redis(["DEL", lockKey]);
    } catch {
      // The lock expires on its own if the store is already gone.
    }
  }
}

export { topupBudgetUsd };
