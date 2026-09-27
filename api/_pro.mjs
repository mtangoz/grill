/**
 * Grill Pro: the only code Grill runs on a server, and it never sees a decision.
 *
 * It does four things:
 *   1. starts a Stripe checkout for Grill Pro, applying the early-access coupon when one is configured;
 *   2. checks a Stripe checkout session was paid;
 *   3. creates the buyer a spending-capped key on Grill's model-router account and shows it once;
 *   4. switches that key off or on when their subscription changes.
 * The buyer's write-ups still go straight from their Claude to the router, using that key.
 *
 * Stripe is the billing record. Each key's hash is stored on the Stripe customer as its own
 * metadata entry, so two browser tabs racing each other both leave a tracked key (never an
 * orphan the cancel path can't reach). Pro accounts, which exist only for people on Pro,
 * live in api/_account.mjs. They store the hash again, never the key.
 *
 * Files in api/ whose names start with "_" are not deployed as functions; api/checkout.js,
 * api/welcome.js and api/stripe-webhook.js import this one. Nothing here is shipped in the
 * Desktop extension.
 *
 * Early access is GRILL_PRO_COUPON: a Stripe coupon id (50% off, duration forever). Set, checkout
 * applies it and the built site says so. Unset, or not a plain coupon id, checkout charges full
 * price and the site does not mention the offer. No database: Stripe keeps the discount on the
 * subscription for as long as that subscription lasts. Ending the offer is unsetting the variable
 * and redeploying; people who already subscribed keep what they started with.
 * GRILL_PRO_PRICE_MONTH and GRILL_PRO_PRICE_YEAR are the Stripe price ids ($9/month, $90/year).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API = "https://api.stripe.com";
export const ROUTER_API = "https://openrouter.ai/api/v1";
export const DEFAULT_LIMIT_USD = 3;
export const DEFAULT_STARTER_USD = 0.5;
export const LINK_TTL_SECONDS = 24 * 60 * 60;
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const CONTACT = "support@grillyour.ai";
export const DOWNLOAD_URL = "https://github.com/mtangoz/grill/releases/latest/download/grill.mcpb";
export const SITE_URL = "https://grillyour.ai";
export const COUPON_ENV = "GRILL_PRO_COUPON";

/** List price, and the early-access price (half). The Stripe Price objects carry the real amounts. */
export const PLANS = Object.freeze({
  month: { env: "GRILL_PRO_PRICE_MONTH", list: "$9", offer: "$4.50" },
  year: { env: "GRILL_PRO_PRICE_YEAR", list: "$90", offer: "$45" },
});

const COUPON_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PRICE_RE = /^price_[A-Za-z0-9]{8,80}$/;

const KEY_FIELD_PREFIX = "grill_key_"; // + the first 24 characters of the hash: Stripe keys max 40
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]); // past_due keeps working while Stripe retries the card
const SESSION_RE = /^cs_(live|test)_[A-Za-z0-9]{10,200}$/;
const CUSTOMER_RE = /^cus_[A-Za-z0-9]{6,64}$/;

/** Something upstream (Stripe or the router) failed; the caller shows "try again", never a key. */
export class UpstreamError extends Error {}

/** The monthly allowance per paid key, in dollars. GRILL_PRO_KEY_LIMIT overrides it, within reason. */
export function limitUsd(env = {}) {
  const n = Number(env.GRILL_PRO_KEY_LIMIT);
  return Number.isFinite(n) && n > 0 && n <= 50 ? n : DEFAULT_LIMIT_USD;
}

/**
 * Dollars of judge spend on a free starter key. It does not refill.
 * GRILL_STARTER_ALLOWANCE_USD overrides it. A bad value keeps the default.
 */
export function starterAllowanceUsd(env = {}) {
  const raw = env.GRILL_STARTER_ALLOWANCE_USD;
  if (raw == null || String(raw).trim() === "") return DEFAULT_STARTER_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 50 ? Math.round(n * 100) / 100 : DEFAULT_STARTER_USD;
}

/** "subscription" shows the paywall. Anything else, including unset, is off. */
export function billingMode(env = {}) {
  return String(env.GRILL_PRO_BILLING ?? "").trim() === "subscription" ? "subscription" : "off";
}

/**
 * The early-access coupon id, or "" when the offer is off.
 * Anything that isn't a plain coupon id is treated as unset, so a bad value can't change the price.
 */
export function couponId(env = {}) {
  const v = typeof env[COUPON_ENV] === "string" ? env[COUPON_ENV].trim() : "";
  return COUPON_RE.test(v) ? v : "";
}

/** The Stripe price id for "month" or "year", or "" when that plan isn't configured. */
export function priceId(plan, env = {}) {
  const spec = PLANS[plan];
  if (!spec) return "";
  const v = typeof env[spec.env] === "string" ? env[spec.env].trim() : "";
  return PRICE_RE.test(v) ? v : "";
}

/** Stripe must see the {CHECKOUT_SESSION_ID} braces literally; URLSearchParams would escape them. */
function formBody(form) {
  return new URLSearchParams(form).toString().replaceAll("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
}

/** Every key hash recorded on a Stripe customer's metadata. */
export function keyHashes(metadata) {
  if (!metadata || typeof metadata !== "object") return [];
  return Object.entries(metadata)
    .filter(([k, v]) => k.startsWith(KEY_FIELD_PREFIX) && typeof v === "string" && v)
    .map(([, v]) => v);
}

function clients(env, fetchImpl) {
  const need = (name) => {
    const v = typeof env[name] === "string" ? env[name].trim() : "";
    if (!v) throw new UpstreamError(`${name} is not set`);
    return v;
  };
  async function call(url, init, what) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, redirect: "error" });
    } catch (e) {
      throw new UpstreamError(`${what}: ${e.message}`);
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: res.status, ok: res.ok, body };
  }
  const stripeAuth = () => ({ Authorization: `Bearer ${need("STRIPE_SECRET_KEY")}` });
  const routerAuth = () => ({ Authorization: `Bearer ${need("OPENROUTER_MANAGEMENT_KEY")}`, "Content-Type": "application/json" });
  return {
    stripe: {
      get: (path) => call(`${STRIPE_API}${path}`, { headers: stripeAuth() }, `Stripe GET ${path.split("?")[0]}`),
      post: (path, form) =>
        call(
          `${STRIPE_API}${path}`,
          { method: "POST", headers: { ...stripeAuth(), "Content-Type": "application/x-www-form-urlencoded" }, body: formBody(form) },
          `Stripe POST ${path}`,
        ),
    },
    router: {
      create: (body) => call(`${ROUTER_API}/keys`, { method: "POST", headers: routerAuth(), body: JSON.stringify(body) }, "router: create key"),
      get: (hash) => call(`${ROUTER_API}/keys/${encodeURIComponent(hash)}`, { headers: routerAuth() }, "router: read key"),
      update: (hash, body) =>
        call(`${ROUTER_API}/keys/${encodeURIComponent(hash)}`, { method: "PATCH", headers: routerAuth(), body: JSON.stringify(body) }, "router: update key"),
      remove: (hash) => call(`${ROUTER_API}/keys/${encodeURIComponent(hash)}`, { method: "DELETE", headers: routerAuth() }, "router: delete key"),
    },
  };
}

/** Stripe and router calls. Account code uses the same clients, so the two can't drift. */
export function proClients(env, fetchImpl) {
  return clients(env, fetchImpl);
}

export function isStripeCustomerId(id) {
  return typeof id === "string" && CUSTOMER_RE.test(id);
}

/** Metadata key for one key hash. Stripe keys are at most 40 characters. */
export function keyMetadataField(hash) {
  return `${KEY_FIELD_PREFIX}${String(hash).slice(0, 24)}`;
}

/**
 * Start Grill Pro checkout and return Stripe's hosted page.
 * The coupon is applied only after Stripe confirms it is 50% off with duration forever,
 * so a mis-typed coupon can't advertise one price and charge another.
 * @returns {Promise<{state: "invalid"|"unconfigured"|"redirect", url?: string}>}
 */
export async function startCheckout(plan, { env, fetch: fetchImpl }) {
  if (!Object.hasOwn(PLANS, plan)) return { state: "invalid" };
  const price = priceId(plan, env);
  if (!price) return { state: "unconfigured" };
  const { stripe } = clients(env, fetchImpl);
  const form = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${SITE_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/#pro`,
  };
  const coupon = couponId(env);
  if (coupon) {
    const c = await stripe.get(`/v1/coupons/${encodeURIComponent(coupon)}`);
    if (!c.ok) throw new UpstreamError(`Stripe returned ${c.status} for the coupon`);
    const body = c.body ?? {};
    if (body.percent_off !== 50 || body.duration !== "forever" || body.valid === false) {
      throw new UpstreamError("the early-access coupon is not 50% off forever");
    }
    form["discounts[0][coupon]"] = coupon;
  }
  const created = await stripe.post("/v1/checkout/sessions", form);
  const url = created.body?.url;
  if (!created.ok || typeof url !== "string" || !/^https:\/\/checkout\.stripe\.com\//.test(url)) {
    throw new UpstreamError(`Stripe didn't start checkout (${created.status})`);
  }
  return { state: "redirect", url };
}

/**
 * Where a checkout session stands, without changing anything.
 * @returns {Promise<{state: "invalid"|"unpaid"|"expired"|"already"|"ready", customerId?: string}>}
 */
export async function checkSession(sessionId, { env, fetch: fetchImpl, now = Date.now() }) {
  if (typeof sessionId !== "string" || !SESSION_RE.test(sessionId)) return { state: "invalid" };
  const { stripe } = clients(env, fetchImpl);
  const s = await stripe.get(`/v1/checkout/sessions/${sessionId}`);
  if (s.status === 404) return { state: "invalid" };
  if (!s.ok) throw new UpstreamError(`Stripe returned ${s.status} for the checkout session`);
  const session = s.body ?? {};
  const paid = session.mode === "subscription" && session.status === "complete" && session.payment_status === "paid";
  if (!paid || typeof session.customer !== "string" || !CUSTOMER_RE.test(session.customer)) return { state: "unpaid" };
  if (!Number.isFinite(session.created) || now / 1000 - session.created > LINK_TTL_SECONDS) return { state: "expired" };
  const c = await stripe.get(`/v1/customers/${session.customer}`);
  if (!c.ok) throw new UpstreamError(`Stripe returned ${c.status} for the customer`);
  if (keyHashes(c.body?.metadata).length > 0) return { state: "already", customerId: session.customer };
  return { state: "ready", customerId: session.customer };
}

/**
 * Create one spending-capped key. The raw key is returned to the caller and stored nowhere.
 * Paid keys ask for a monthly reset. A starter key passes reset null, so the cap is the whole allowance.
 * @returns {Promise<{key: string, hash: string, limitUsd: number}>}
 */
export async function createCappedKey({ env, fetch: fetchImpl, name, limit, reset = "monthly" }) {
  const { router } = clients(env, fetchImpl);
  const cap = Number.isFinite(limit) && limit > 0 && limit <= 50 ? limit : limitUsd(env);
  const created = await router.create({ name, limit: cap });
  const key = created.body?.key;
  const data = created.body?.data;
  if (!created.ok || typeof key !== "string" || !key || typeof data?.hash !== "string" || !data.hash) {
    throw new UpstreamError(`the router didn't create a key (${created.status})`);
  }
  const hash = data.hash;
  if (reset === "monthly" && data.limit_reset !== "monthly") {
    const fixed = await router.update(hash, { limit_reset: "monthly" });
    if (!fixed.ok) {
      await router.remove(hash).catch(() => {});
      throw new UpstreamError(`the router didn't accept a monthly reset (${fixed.status})`);
    }
  }
  return { key, hash, limitUsd: cap };
}

/** Switch every listed key off. A key the router has already forgotten is fine. */
export async function disableManagedKeys(hashes, { env, fetch: fetchImpl }) {
  const { router } = clients(env, fetchImpl);
  await setKeys(router, hashes, true);
}

/** Delete a key we couldn't record. Failure here is swallowed by the caller. */
export async function removeManagedKey(hash, { env, fetch: fetchImpl }) {
  const { router } = clients(env, fetchImpl);
  await router.remove(hash);
}

/** Usage and cap for one key, from the management API. Null when the router has forgotten it. */
export async function readManagedKey(hash, { env, fetch: fetchImpl }) {
  const { router } = clients(env, fetchImpl);
  const r = await router.get(hash);
  if (r.status === 404) return null;
  if (!r.ok) throw new UpstreamError(`the router didn't return the key (${r.status})`);
  const d = r.body?.data ?? {};
  const monthly = Number(d.usage_monthly ?? d.usage ?? 0);
  const total = Number(d.usage ?? d.usage_monthly ?? 0);
  const limit = Number(d.limit);
  return {
    hash: typeof d.hash === "string" ? d.hash : hash,
    disabled: Boolean(d.disabled),
    limitUsd: Number.isFinite(limit) ? limit : null,
    usageUsd: Number.isFinite(monthly) ? monthly : 0,
    usageTotalUsd: Number.isFinite(total) ? total : 0,
  };
}

/**
 * Create the buyer's key, record it on their Stripe customer, and return it. The key string is
 * returned exactly once and never stored or logged anywhere.
 * @returns {Promise<{state: string, key?: string, hash?: string, limitUsd?: number, customerId?: string}>}
 */
export async function issueKey(sessionId, { env, fetch: fetchImpl, now = Date.now() }) {
  const checked = await checkSession(sessionId, { env, fetch: fetchImpl, now });
  if (checked.state !== "ready") return checked;
  const { stripe } = clients(env, fetchImpl);
  const made = await createCappedKey({ env, fetch: fetchImpl, name: `grill-pro-${checked.customerId}` });
  const saved = await stripe.post(`/v1/customers/${checked.customerId}`, {
    [`metadata[${keyMetadataField(made.hash)}]`]: made.hash,
    "metadata[grill_issued_at]": new Date(now).toISOString(), // outside the key prefix on purpose
  });
  if (!saved.ok) {
    // An unrecorded key is one the cancel path could never switch off, so it doesn't survive.
    await removeManagedKey(made.hash, { env, fetch: fetchImpl }).catch(() => {});
    throw new UpstreamError(`couldn't record the key on the customer (${saved.status})`);
  }
  return { state: "issued", key: made.key, hash: made.hash, limitUsd: made.limitUsd, customerId: checked.customerId };
}

/**
 * Verify a Stripe-Signature header: "t=<unix>,v1=<hex hmac-sha256 of `${t}.${payload}`>".
 */
export function verifyStripeSignature(payload, header, secret, nowSec = Math.floor(Date.now() / 1000)) {
  if (typeof payload !== "string" || typeof header !== "string" || typeof secret !== "string" || !secret) return false;
  let t = NaN;
  const candidates = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v);
    else if (k === "v1") candidates.push(v);
  }
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SECONDS || candidates.length === 0) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex"), "utf8");
  return candidates.some((c) => {
    const got = Buffer.from(c, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

async function setKeys(router, hashes, disabled) {
  for (const h of hashes) {
    const r = await router.update(h, { disabled });
    if (!r.ok && r.status !== 404) throw new UpstreamError(`the router didn't update a key (${r.status})`);
  }
}

/**
 * Act on a verified Stripe event. Keys follow the customer's subscriptions as they are NOW,
 * read back from Stripe, never the event alone: Stripe doesn't promise events arrive in order.
 */
export async function handleEvent(event, { env, fetch: fetchImpl }) {
  const type = event?.type;
  const object = event?.data?.object ?? {};
  const { stripe, router } = clients(env, fetchImpl);

  if (type === "customer.deleted") {
    const hashes = keyHashes(object.metadata);
    if (hashes.length === 0) return { action: "no-key" };
    await setKeys(router, hashes, true);
    return { action: "disabled", keys: hashes.length };
  }
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type)) {
    return { action: "ignored" };
  }
  const customerId = object.customer;
  if (typeof customerId !== "string" || !CUSTOMER_RE.test(customerId)) return { action: "ignored" };
  const c = await stripe.get(`/v1/customers/${customerId}`);
  if (c.status === 404) return { action: "ignored" };
  if (!c.ok) throw new UpstreamError(`Stripe returned ${c.status} for the customer`);
  const hashes = keyHashes(c.body?.metadata);
  if (hashes.length === 0) return { action: "no-key" };
  const subs = await stripe.get(`/v1/subscriptions?customer=${customerId}&status=all&limit=100`);
  if (!subs.ok) throw new UpstreamError(`Stripe returned ${subs.status} for the subscriptions`);
  const live = (subs.body?.data ?? []).some((s) => LIVE_STATUSES.has(s?.status));
  await setKeys(router, hashes, !live);
  return { action: live ? "enabled" : "disabled", keys: hashes.length };
}

// ── The welcome page ─────────────────────────────────────────────────────────

export const WELCOME_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

export const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/** The subscription-management link, only if it's Stripe's own customer-portal address. */
export function portalUrl(env) {
  const u = typeof env.GRILL_PORTAL_URL === "string" ? env.GRILL_PORTAL_URL.trim() : "";
  return /^https:\/\/billing\.stripe\.com\/[A-Za-z0-9/_-]+$/.test(u) ? u : "";
}

const STYLE = `
  :root { color-scheme: light; --paper:#f7f4ef; --ink:#1c1b19; --muted:#4a4742; --quiet:#6a655e; --rule:#ddd6cb; --code-bg:#ece6dc;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
  @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --paper:#161513; --ink:#ece7df; --muted:#b4ada2; --quiet:#938c81; --rule:#34312c; --code-bg:#24221f; } }
  html, body { background: var(--paper); }
  body { margin: 0; padding: 0 20px; color: var(--ink); font-family: var(--sans); line-height: 1.55; }
  main { max-width: 36rem; margin: 0 auto; padding: 2.5rem 0 3.5rem; }
  a { color: var(--ink); text-underline-offset: 3px; }
  .mark { font-weight: 700; font-size: 1.1rem; text-decoration: none; }
  h1 { font-size: clamp(1.8rem, 5vw, 2.4rem); line-height: 1.12; letter-spacing: -0.02em; margin: 2.4rem 0 0.8rem; }
  h2 { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--quiet); margin: 2rem 0 0.7rem; }
  p, li { color: var(--muted); }
  ol { padding-left: 1.25rem; } li { margin: 0.4rem 0; }
  .key { display: flex; gap: 8px; margin: 1.2rem 0; flex-wrap: wrap; }
  .key input { flex: 1 1 16rem; min-width: 0; font: 0.9rem var(--mono); padding: 10px 12px; border: 1px solid var(--rule); border-radius: 8px; background: var(--code-bg); color: var(--ink); }
  button, .button { font: 600 0.95rem var(--sans); padding: 10px 18px; border: 0; border-radius: 999px; background: var(--ink); color: var(--paper); cursor: pointer; text-decoration: none; display: inline-block; }
  .small { font-size: 0.9rem; color: var(--quiet); }
  label { display: block; font-weight: 600; margin: 1rem 0 0.35rem; }
  input[type="email"], input[type="text"], textarea, select { width: 100%; box-sizing: border-box; font: 0.95rem var(--sans); padding: 10px 12px; border: 1px solid var(--rule); border-radius: 8px; background: transparent; color: var(--ink); }
  textarea, pre.config { font-family: var(--mono); font-size: 0.82rem; white-space: pre-wrap; }
  textarea { min-height: 7rem; }
  pre.config { background: var(--code-bg); padding: 12px; border-radius: 8px; }
  fieldset { border: 1px solid var(--rule); border-radius: 8px; margin: 1rem 0; }
  .choice { font-weight: 400; margin: 0.35rem 0; }
  .banner { border: 1px solid var(--rule); border-radius: 8px; padding: 10px 12px; margin: 1rem 0; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 1rem 0; }
  :focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }`;

export function page(title, inner) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main><a class="mark" href="https://grillyour.ai/">grill</a>
${inner}
</main></body></html>`;
}

/**
 * The HTML for each state. "ready" shows a button that POSTs back, so the key is only created
 * when the buyer asks for it (a browser preloading the link can't create one).
 */
export function renderWelcome(result, env = {}, sessionId = "") {
  const help = `<p class="small">Questions? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`;
  const portal = portalUrl(env);
  const manage = portal ? `<p class="small">Manage or cancel anytime: <a href="${esc(portal)}">your subscription</a>.</p>` : "";
  switch (result?.state) {
    case "ready":
      return page(
        "Payment confirmed · Grill Pro",
        `<h1>Payment confirmed. Welcome to Grill Pro.</h1>
<p>Your personal key is ready. We only show it once, so have somewhere safe to keep it, like a password manager.</p>
<form method="post" action="/welcome"><input type="hidden" name="session_id" value="${esc(sessionId)}"><button type="submit">Show my key</button></form>
${help}`,
      );
    case "issued": {
      const dollars = Number.isInteger(result.limitUsd) ? `$${result.limitUsd}` : `$${Number(result.limitUsd).toFixed(2)}`;
      return page(
        "Your key · Grill Pro",
        `<h1>You’re in. Here’s your key.</h1>
<p>Copy it now and keep it somewhere safe. We only show it once, so nobody else can see it.</p>
<div class="key"><input id="k" type="text" readonly value="${esc(result.key)}" aria-label="Your Grill Pro key"><button type="button" id="copy">Copy</button></div>
<h2>Next</h2>
<ol>
<li><a href="${DOWNLOAD_URL}">Download Grill for Claude Desktop</a> and double-click it.</li>
<li>When Claude asks for a “Model router key”, paste this key.</li>
<li>In any chat, say “grill this” and tell it what you’re deciding.</li>
<li>Or open <a href="/pro">your Pro account</a> to pick a judge and copy a config for the assistant you use. Paste this key there if it asks. We don't keep a copy.</li>
</ol>
<p class="small">Your key includes up to ${dollars} of AI time a month, and a typical check costs about a cent. The allowance resets each month.</p>
${manage}${help}
<script>document.getElementById("copy").addEventListener("click",function(){var k=document.getElementById("k");k.select();(navigator.clipboard?navigator.clipboard.writeText(k.value):Promise.reject()).then(function(){document.getElementById("copy").textContent="Copied";},function(){document.execCommand("copy");document.getElementById("copy").textContent="Copied";});});</script>`,
      );
    }
    case "already":
      return page(
        "Key already shown · Grill Pro",
        `<h1>Your key has already been shown.</h1>
<p>For your safety, we only show each key once. Lost it? <a href="/pro">Sign in</a> and rotate it, or email <a href="mailto:${CONTACT}">${CONTACT}</a> from the address you paid with.</p>
${manage}`,
      );
    case "unpaid":
      return page(
        "Payment not found · Grill Pro",
        `<h1>We couldn’t find a finished payment.</h1>
<p>If you just paid, give it a minute and reload this page.</p>
${help}`,
      );
    case "expired":
      return page(
        "Link expired · Grill Pro",
        `<h1>This link has expired.</h1>
<p>For your safety, this page only works for a day after you pay. Email <a href="mailto:${CONTACT}">${CONTACT}</a> from the address you paid with, and we’ll sort it out.</p>`,
      );
    case "invalid":
      return page(
        "Link not recognised · Grill Pro",
        `<h1>This link doesn’t look right.</h1>
<p>Open the page you were sent to after paying, or email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
      );
    default:
      return page(
        "Something went wrong · Grill Pro",
        `<h1>Something went wrong on our side.</h1>
<p>Your payment is safe. Reload this page in a minute. If it keeps happening, email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
      );
  }
}

/** HTTP status for each welcome-page state. */
export function statusFor(state) {
  return { ready: 200, issued: 200, already: 200, unpaid: 402, expired: 410, invalid: 400 }[state] ?? 503;
}

/** Plain page when checkout can't start. No analytics: this isn't a public marketing page. */
export function renderCheckoutError(state) {
  if (state === "invalid") {
    return page(
      "Link not recognised · Grill Pro",
      `<h1>That link doesn’t look right.</h1>
<p>Go back to <a href="${SITE_URL}/#pro">Grill Pro</a>, or email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
    );
  }
  if (state === "unconfigured") {
    return page(
      "Pro isn’t ready · Grill",
      `<h1>Grill Pro isn’t taking payment yet.</h1>
<p>The free ways to use Grill are on <a href="${SITE_URL}/#setup">the site</a>. A starter key needs no card: <a href="${SITE_URL}/pro">sign in</a>. Questions? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
    );
  }
  if (state === "billing-off") {
    return page(
      "No card needed · Grill",
      `<h1>Paid plans are off.</h1>
<p>Sign in and get a starter key. No card. Bring your own key if you want unlimited checks. That stays free. Questions? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>
<p><a href="${SITE_URL}/pro">Get a starter key</a></p>`,
    );
  }
  return page(
    "Something went wrong · Grill Pro",
    `<h1>Something went wrong on our side.</h1>
<p>Your card hasn’t been charged. Try again from <a href="${SITE_URL}/#pro">the Pro section</a> in a minute. If it keeps happening, email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`,
  );
}
