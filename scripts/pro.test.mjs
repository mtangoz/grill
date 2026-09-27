// Grill Pro's server side (api/): payment check, key creation, key switch-off, signatures, and
// the welcome page. Stripe and the router are faked at the fetch boundary; no network, no keys.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkSession,
  couponId,
  DOWNLOAD_URL,
  handleEvent,
  issueKey,
  keyHashes,
  billingMode,
  createCappedKey,
  limitUsd,
  priceId,
  starterAllowanceUsd,
  renderCheckoutError,
  renderWelcome,
  ROUTER_API,
  startCheckout,
  statusFor,
  STRIPE_API,
  UpstreamError,
  verifyStripeSignature,
  WELCOME_HEADERS,
} from "../api/_pro.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = { STRIPE_SECRET_KEY: "sk_test_fake", OPENROUTER_MANAGEMENT_KEY: "mgmt_fake" };
const NOW = Date.UTC(2026, 8, 26, 20, 0, 0);
const SESSION = "cs_test_a1B2c3D4e5F6g7H8i9J0";
const CUSTOMER = "cus_ABC123def";
const HASH = "ab".repeat(32);
const KEY = "sk-or-v1-fake-test-key-not-real"; // deliberately not key-shaped, so secret scanning stays quiet
const FIELD = `grill_key_${HASH.slice(0, 24)}`;

const paidSession = (over = {}) => ({
  id: SESSION,
  mode: "subscription",
  status: "complete",
  payment_status: "paid",
  customer: CUSTOMER,
  created: Math.floor(NOW / 1000) - 60,
  ...over,
});

/** A fetch that answers from a route table and records every call. Unrouted calls fail loudly. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, init });
    for (const [pattern, reply] of routes) {
      const [m, u] = pattern.split(" ");
      const hit = m === method && (u.endsWith("*") ? url.startsWith(u.slice(0, -1)) : url === u);
      if (hit) {
        const out = typeof reply === "function" ? reply({ url, init, calls }) : reply;
        return new Response(out.body === undefined ? "" : JSON.stringify(out.body), { status: out.status ?? 200 });
      }
    }
    return new Response(JSON.stringify({ error: `unrouted ${method} ${url}` }), { status: 599 });
  };
  fn.calls = calls;
  return fn;
}

const sessionRoute = (session) => [`GET ${STRIPE_API}/v1/checkout/sessions/${SESSION}`, { body: session }];
const customerRoute = (metadata = {}) => [`GET ${STRIPE_API}/v1/customers/${CUSTOMER}`, { body: { id: CUSTOMER, metadata } }];
const createRoute = (data = { hash: HASH, limit: 3, limit_reset: "monthly" }) => [`POST ${ROUTER_API}/keys`, { body: { data, key: KEY } }];
const saveRoute = (status = 200) => [`POST ${STRIPE_API}/v1/customers/${CUSTOMER}`, { status, body: { id: CUSTOMER } }];

const PRICE_ENV = { ...ENV, GRILL_PRO_PRICE_MONTH: "price_month1234", GRILL_PRO_PRICE_YEAR: "price_year12345" };
const COUPON = { id: "early50", percent_off: 50, duration: "forever", valid: true };
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4e5F6g7H8i9J0";
const couponRoute = (body = COUPON, status = 200) => [`GET ${STRIPE_API}/v1/coupons/early50`, { status, body }];
const sessionCreateRoute = (body = { url: CHECKOUT_URL }, status = 200) => [`POST ${STRIPE_API}/v1/checkout/sessions`, { status, body }];

describe("starting checkout", () => {
  it("ignores a bad plan or a missing price, and calls no one", async () => {
    const fetch = fakeFetch([]);
    assert.equal((await startCheckout("lifetime", { env: PRICE_ENV, fetch })).state, "invalid");
    assert.equal((await startCheckout("month", { env: ENV, fetch })).state, "unconfigured");
    assert.equal(priceId("month", { GRILL_PRO_PRICE_MONTH: "price_short" }), "");
    assert.equal(fetch.calls.length, 0);
  });

  it("charges full price when no coupon is set, and keeps the session placeholder literal", async () => {
    const fetch = fakeFetch([sessionCreateRoute()]);
    const out = await startCheckout("month", { env: PRICE_ENV, fetch });
    assert.deepEqual(out, { state: "redirect", url: CHECKOUT_URL });
    const post = fetch.calls[0];
    const form = new URLSearchParams(post.init.body.replaceAll("{CHECKOUT_SESSION_ID}", "SESSION"));
    assert.equal(form.get("mode"), "subscription");
    assert.equal(form.get("line_items[0][price]"), "price_month1234");
    assert.equal(form.get("line_items[0][quantity]"), "1");
    assert.equal(form.get("success_url"), "https://grillyour.ai/welcome?session_id=SESSION");
    assert.equal(form.get("cancel_url"), "https://grillyour.ai/#pro");
    assert.equal(form.get("discounts[0][coupon]"), null);
    assert.match(post.init.body, /session_id%3D\{CHECKOUT_SESSION_ID\}/);
    assert.ok(!post.init.body.includes("%7BCHECKOUT_SESSION_ID%7D"));
    assert.equal(post.init.headers.Authorization, "Bearer sk_test_fake");
  });

  it("applies a 50% forever coupon, and refuses one that isn't", async () => {
    assert.equal(couponId({ GRILL_PRO_COUPON: " early50 " }), "early50");
    for (const bad of ["", "  ", "has space", "a/b", "x".repeat(41)]) assert.equal(couponId({ GRILL_PRO_COUPON: bad }), "", JSON.stringify(bad));

    const ok = fakeFetch([couponRoute(), sessionCreateRoute()]);
    const out = await startCheckout("year", { env: { ...PRICE_ENV, GRILL_PRO_COUPON: "early50" }, fetch: ok });
    assert.equal(out.url, CHECKOUT_URL);
    const form = new URLSearchParams(ok.calls.at(-1).init.body);
    assert.equal(form.get("line_items[0][price]"), "price_year12345");
    assert.equal(form.get("discounts[0][coupon]"), "early50");

    for (const body of [
      { percent_off: 10, duration: "forever", valid: true },
      { percent_off: 50, duration: "once", valid: true },
      { percent_off: 50, duration: "forever", valid: false },
    ]) {
      const fetch = fakeFetch([couponRoute(body)]);
      await assert.rejects(startCheckout("month", { env: { ...PRICE_ENV, GRILL_PRO_COUPON: "early50" }, fetch }), UpstreamError);
      assert.ok(!fetch.calls.some((c) => c.method === "POST"), JSON.stringify(body));
    }
  });

  it("won't redirect anywhere but Stripe's own checkout", async () => {
    const fetch = fakeFetch([sessionCreateRoute({ url: "https://evil.example/pay" })]);
    await assert.rejects(startCheckout("month", { env: PRICE_ENV, fetch }), UpstreamError);
  });

  it("the error pages are plain, and the welcome page does not count visits", () => {
    for (const state of ["invalid", "unconfigured", "error"]) {
      const html = renderCheckoutError(state);
      assert.match(html, /<h1>[^<]+<\/h1>/, state);
      assert.ok(!html.includes("—"), state);
      assert.ok(!html.includes("_vercel/insights"), state);
    }
    assert.ok(!renderWelcome({ state: "ready" }, {}, SESSION).includes("_vercel/insights"));
  });
});

describe("checking a checkout session", () => {
  it("refuses a malformed session id without calling anyone", async () => {
    const fetch = fakeFetch([]);
    for (const id of ["", "cs_test_", "cus_123", "cs_live_abc/../../v1/customers", "cs_test_abc def", null, 42]) {
      assert.equal((await checkSession(id, { env: ENV, fetch, now: NOW })).state, "invalid");
    }
    assert.equal(fetch.calls.length, 0);
  });

  it("an unknown session is invalid; an unpaid one is unpaid; a day-old one has expired", async () => {
    const unknown = fakeFetch([[`GET ${STRIPE_API}/v1/checkout/sessions/${SESSION}`, { status: 404, body: {} }]]);
    assert.equal((await checkSession(SESSION, { env: ENV, fetch: unknown, now: NOW })).state, "invalid");
    for (const over of [{ payment_status: "unpaid" }, { status: "open" }, { mode: "payment" }, { customer: null }]) {
      const f = fakeFetch([sessionRoute(paidSession(over))]);
      assert.equal((await checkSession(SESSION, { env: ENV, fetch: f, now: NOW })).state, "unpaid", JSON.stringify(over));
    }
    const old = fakeFetch([sessionRoute(paidSession({ created: Math.floor(NOW / 1000) - 25 * 3600 })), customerRoute()]);
    assert.equal((await checkSession(SESSION, { env: ENV, fetch: old, now: NOW })).state, "expired");
  });

  it("a paid session is ready, or 'already' once a key is on the customer", async () => {
    const ready = fakeFetch([sessionRoute(paidSession()), customerRoute({ grill_issued_at: "2026-09-26T19:00:00Z" })]);
    assert.deepEqual(await checkSession(SESSION, { env: ENV, fetch: ready, now: NOW }), { state: "ready", customerId: CUSTOMER });
    const already = fakeFetch([sessionRoute(paidSession()), customerRoute({ [FIELD]: HASH })]);
    assert.equal((await checkSession(SESSION, { env: ENV, fetch: already, now: NOW })).state, "already");
  });

  it("uses the Stripe secret, and never follows a redirect", async () => {
    const f = fakeFetch([sessionRoute(paidSession()), customerRoute()]);
    await checkSession(SESSION, { env: ENV, fetch: f, now: NOW });
    for (const c of f.calls) {
      assert.equal(c.init.headers.Authorization, "Bearer sk_test_fake");
      assert.equal(c.init.redirect, "error");
    }
  });

  it("a missing secret is an upstream error, not a crash or a key", async () => {
    const f = fakeFetch([sessionRoute(paidSession()), customerRoute()]);
    await assert.rejects(checkSession(SESSION, { env: {}, fetch: f, now: NOW }), UpstreamError);
  });
});

describe("issuing a key", () => {
  it("creates one capped, monthly-reset key named for the customer, records it, and returns it once", async () => {
    const f = fakeFetch([sessionRoute(paidSession()), customerRoute(), createRoute(), saveRoute()]);
    const out = await issueKey(SESSION, { env: ENV, fetch: f, now: NOW });
    assert.deepEqual(out, { state: "issued", key: KEY, hash: HASH, limitUsd: 3, customerId: CUSTOMER });

    const create = f.calls.find((c) => c.method === "POST" && c.url === `${ROUTER_API}/keys`);
    assert.deepEqual(JSON.parse(create.init.body), { name: `grill-pro-${CUSTOMER}`, limit: 3 });
    assert.equal(create.init.headers.Authorization, "Bearer mgmt_fake");

    const save = f.calls.find((c) => c.method === "POST" && c.url === `${STRIPE_API}/v1/customers/${CUSTOMER}`);
    const form = new URLSearchParams(save.init.body);
    assert.equal(form.get(`metadata[${FIELD}]`), HASH);
    assert.ok(FIELD.length <= 40, "Stripe metadata keys are at most 40 characters");
    assert.ok(form.get("metadata[grill_issued_at]"));
    assert.ok(!save.init.body.includes(KEY), "the key itself is never stored");
  });

  it("does nothing new when the customer already has a key", async () => {
    const f = fakeFetch([sessionRoute(paidSession()), customerRoute({ [FIELD]: HASH })]);
    assert.equal((await issueKey(SESSION, { env: ENV, fetch: f, now: NOW })).state, "already");
    assert.ok(!f.calls.some((c) => c.url.startsWith(ROUTER_API)), "no router call");
  });

  it("sets the monthly reset afterwards if the router didn't take it on creation", async () => {
    const f = fakeFetch([
      sessionRoute(paidSession()),
      customerRoute(),
      createRoute({ hash: HASH, limit: 3, limit_reset: null }),
      [`PATCH ${ROUTER_API}/keys/${HASH}`, { body: { data: { hash: HASH, limit_reset: "monthly" } } }],
      saveRoute(),
    ]);
    assert.equal((await issueKey(SESSION, { env: ENV, fetch: f, now: NOW })).state, "issued");
    const patch = f.calls.find((c) => c.method === "PATCH");
    assert.deepEqual(JSON.parse(patch.init.body), { limit_reset: "monthly" });
  });

  it("deletes the new key if Stripe can't record it, so no untracked key survives", async () => {
    const f = fakeFetch([
      sessionRoute(paidSession()),
      customerRoute(),
      createRoute(),
      saveRoute(500),
      [`DELETE ${ROUTER_API}/keys/${HASH}`, { body: {} }],
    ]);
    await assert.rejects(issueKey(SESSION, { env: ENV, fetch: f, now: NOW }), UpstreamError);
    assert.ok(f.calls.some((c) => c.method === "DELETE" && c.url === `${ROUTER_API}/keys/${HASH}`));
  });

  it("a failed creation records nothing", async () => {
    const f = fakeFetch([sessionRoute(paidSession()), customerRoute(), [`POST ${ROUTER_API}/keys`, { status: 402, body: { error: "no credit" } }]]);
    await assert.rejects(issueKey(SESSION, { env: ENV, fetch: f, now: NOW }), UpstreamError);
    assert.ok(!f.calls.some((c) => c.method === "POST" && c.url.startsWith(`${STRIPE_API}/v1/customers`)));
  });

  it("the allowance defaults to $3, and GRILL_PRO_KEY_LIMIT can change it within reason", () => {
    assert.equal(limitUsd({}), 3);
    assert.equal(limitUsd({ GRILL_PRO_KEY_LIMIT: "5" }), 5);
    for (const bad of ["0", "-1", "abc", "500"]) assert.equal(limitUsd({ GRILL_PRO_KEY_LIMIT: bad }), 3, bad);
  });

  it("a starter allowance defaults to $0.50, and billing defaults to off", () => {
    assert.equal(starterAllowanceUsd({}), 0.5);
    assert.equal(starterAllowanceUsd({ GRILL_STARTER_ALLOWANCE_USD: "" }), 0.5);
    assert.equal(starterAllowanceUsd({ GRILL_STARTER_ALLOWANCE_USD: "  " }), 0.5);
    assert.equal(starterAllowanceUsd({ GRILL_STARTER_ALLOWANCE_USD: "1.25" }), 1.25);
    assert.equal(starterAllowanceUsd({ GRILL_STARTER_ALLOWANCE_USD: "1.234" }), 1.23);
    for (const bad of ["0", "-1", "abc", "500"]) assert.equal(starterAllowanceUsd({ GRILL_STARTER_ALLOWANCE_USD: bad }), 0.5, bad);
    assert.equal(billingMode({}), "off");
    assert.equal(billingMode({ GRILL_PRO_BILLING: "off" }), "off");
    assert.equal(billingMode({ GRILL_PRO_BILLING: "Subscription" }), "off");
    assert.equal(billingMode({ GRILL_PRO_BILLING: " subscription " }), "subscription");
    assert.equal(billingMode({ GRILL_PRO_BILLING: "subscription" }), "subscription");
  });

  it("a starter key is a one-time cap and does not ask for a monthly reset", async () => {
    const f = fakeFetch([[`POST ${ROUTER_API}/keys`, { body: { key: KEY, data: { hash: HASH, limit: 0.5, limit_reset: null } } }]]);
    const out = await createCappedKey({ env: ENV, fetch: f, name: "grill-pro-acct", limit: 0.5, reset: null });
    assert.deepEqual(out, { key: KEY, hash: HASH, limitUsd: 0.5 });
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: "grill-pro-acct", limit: 0.5 });
    assert.equal(f.calls.length, 1, "no monthly PATCH");
  });

  it("reads key hashes from the customer's metadata, and nothing else", () => {
    assert.deepEqual(keyHashes({ [FIELD]: HASH, grill_issued_at: "2026-09-26", other: "x" }), [HASH]);
    assert.deepEqual(keyHashes(null), []);
  });
});

describe("Stripe signatures", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const t = Math.floor(NOW / 1000);
  const sign = (p, ts = t, s = secret) => createHmac("sha256", s).update(`${ts}.${p}`).digest("hex");

  it("accepts a fresh, correct signature, including among several", () => {
    assert.ok(verifyStripeSignature(payload, `t=${t},v1=${sign(payload)}`, secret, t));
    assert.ok(verifyStripeSignature(payload, `t=${t},v1=${"0".repeat(64)},v1=${sign(payload)},v0=abc`, secret, t));
  });

  it("refuses a wrong secret, a tampered body, a stale or future timestamp, and junk", () => {
    assert.ok(!verifyStripeSignature(payload, `t=${t},v1=${sign(payload, t, "whsec_other")}`, secret, t));
    assert.ok(!verifyStripeSignature(`${payload} `, `t=${t},v1=${sign(payload)}`, secret, t));
    assert.ok(!verifyStripeSignature(payload, `t=${t - 301},v1=${sign(payload, t - 301)}`, secret, t));
    assert.ok(!verifyStripeSignature(payload, `t=${t + 301},v1=${sign(payload, t + 301)}`, secret, t));
    for (const h of [null, "", "v1=abc", `t=${t}`, "garbage"]) assert.ok(!verifyStripeSignature(payload, h, secret, t), String(h));
    assert.ok(!verifyStripeSignature(payload, `t=${t},v1=${sign(payload)}`, "", t), "no secret, no pass");
  });
});

describe("subscription changes", () => {
  const event = (type, object = { customer: CUSTOMER }) => ({ type, data: { object } });
  const subsRoute = (statuses) => [`GET ${STRIPE_API}/v1/subscriptions*`, { body: { data: statuses.map((status) => ({ status })) } }];
  const patches = (f) => f.calls.filter((c) => c.method === "PATCH").map((c) => [c.url.split("/").pop(), JSON.parse(c.init.body)]);
  const HASH2 = "cd".repeat(32);

  it("ignores events it doesn't handle, without calling anyone", async () => {
    const f = fakeFetch([]);
    for (const type of ["invoice.paid", "checkout.session.completed", undefined]) {
      assert.equal((await handleEvent(event(type), { env: ENV, fetch: f })).action, "ignored");
    }
    assert.equal(f.calls.length, 0);
  });

  it("switches every key off when no subscription is live, reading Stripe's current state", async () => {
    const f = fakeFetch([
      customerRoute({ [FIELD]: HASH, [`grill_key_${HASH2.slice(0, 24)}`]: HASH2 }),
      subsRoute(["canceled"]),
      [`PATCH ${ROUTER_API}/keys/*`, { body: {} }],
    ]);
    const out = await handleEvent(event("customer.subscription.deleted"), { env: ENV, fetch: f });
    assert.deepEqual(out, { action: "disabled", keys: 2 });
    assert.deepEqual(patches(f), [[HASH, { disabled: true }], [HASH2, { disabled: true }]]);
    assert.ok(f.calls.some((c) => c.url.startsWith(`${STRIPE_API}/v1/subscriptions?customer=${CUSTOMER}`)));
  });

  it("switches keys back on while any subscription is active, trialing or retrying a card", async () => {
    for (const status of ["active", "trialing", "past_due"]) {
      const f = fakeFetch([customerRoute({ [FIELD]: HASH }), subsRoute(["canceled", status]), [`PATCH ${ROUTER_API}/keys/*`, { body: {} }]]);
      assert.equal((await handleEvent(event("customer.subscription.updated"), { env: ENV, fetch: f })).action, "enabled", status);
      assert.deepEqual(patches(f), [[HASH, { disabled: false }]]);
    }
  });

  it("an event arriving out of order can't switch off a customer who is paying", async () => {
    // A late "deleted" for an old subscription, while a newer one is active.
    const f = fakeFetch([customerRoute({ [FIELD]: HASH }), subsRoute(["active", "canceled"]), [`PATCH ${ROUTER_API}/keys/*`, { body: {} }]]);
    assert.equal((await handleEvent(event("customer.subscription.deleted"), { env: ENV, fetch: f })).action, "enabled");
  });

  it("a customer without a key needs nothing; a deleted customer's keys go off from the event itself", async () => {
    const none = fakeFetch([customerRoute({})]);
    assert.equal((await handleEvent(event("customer.subscription.updated"), { env: ENV, fetch: none })).action, "no-key");
    assert.ok(!none.calls.some((c) => c.url.startsWith(ROUTER_API)));

    const gone = fakeFetch([[`PATCH ${ROUTER_API}/keys/*`, { body: {} }]]);
    const out = await handleEvent(event("customer.deleted", { id: CUSTOMER, metadata: { [FIELD]: HASH } }), { env: ENV, fetch: gone });
    assert.deepEqual(out, { action: "disabled", keys: 1 });
    assert.ok(!gone.calls.some((c) => c.url.startsWith(STRIPE_API)), "no Stripe call needed");
  });

  it("a key the router no longer has is fine; a router outage makes Stripe retry", async () => {
    const missing = fakeFetch([customerRoute({ [FIELD]: HASH }), subsRoute(["canceled"]), [`PATCH ${ROUTER_API}/keys/*`, { status: 404, body: {} }]]);
    assert.equal((await handleEvent(event("customer.subscription.deleted"), { env: ENV, fetch: missing })).action, "disabled");
    const down = fakeFetch([customerRoute({ [FIELD]: HASH }), subsRoute(["canceled"]), [`PATCH ${ROUTER_API}/keys/*`, { status: 503, body: {} }]]);
    await assert.rejects(handleEvent(event("customer.subscription.deleted"), { env: ENV, fetch: down }), UpstreamError);
  });
});

describe("the welcome page", () => {
  it("shows the key once, escaped, with the next steps and the download", () => {
    const html = renderWelcome({ state: "issued", key: "sk-or-v1-<b>&", limitUsd: 3 }, {});
    assert.match(html, /value="sk-or-v1-&lt;b&gt;&amp;"/);
    assert.ok(html.includes(DOWNLOAD_URL));
    assert.match(html, /Model router key/);
    assert.match(html, /up to \$3 of AI time a month/);
  });

  it("the 'ready' page asks before creating the key, and shows no key", () => {
    const html = renderWelcome({ state: "ready" }, {}, `${SESSION}"><script>`);
    assert.match(html, /<form method="post" action="\/welcome">/);
    assert.ok(!html.includes('"><script>'), "the session id is escaped");
    assert.ok(!html.includes("sk-or-"));
  });

  it("links the subscription page only when it's Stripe's own portal address", () => {
    const issued = { state: "issued", key: KEY, limitUsd: 3 };
    assert.ok(renderWelcome(issued, { GRILL_PORTAL_URL: "https://billing.stripe.com/p/login/abc123" }).includes("https://billing.stripe.com/p/login/abc123"));
    for (const bad of ["javascript:alert(1)", "https://evil.example/p/login", "http://billing.stripe.com/p/login/x"]) {
      assert.ok(!renderWelcome(issued, { GRILL_PORTAL_URL: bad }).includes(bad), bad);
    }
  });

  it("every state has a heading, a plain message and no em dash", () => {
    for (const state of ["ready", "issued", "already", "unpaid", "expired", "invalid", "error"]) {
      const html = renderWelcome({ state, key: KEY, limitUsd: 3 }, {});
      assert.match(html, /<h1>[^<]+<\/h1>/, state);
      assert.ok(!html.includes("—"), `${state} has an em dash`);
    }
  });

  it("is never cached, never leaks the link as a referrer, and only posts to itself", () => {
    assert.equal(WELCOME_HEADERS["Cache-Control"], "no-store");
    assert.equal(WELCOME_HEADERS["Referrer-Policy"], "no-referrer");
    assert.match(WELCOME_HEADERS["Content-Security-Policy"], /form-action 'self'/);
    assert.match(WELCOME_HEADERS["Content-Security-Policy"], /frame-ancestors 'none'/);
    assert.deepEqual([statusFor("issued"), statusFor("unpaid"), statusFor("expired"), statusFor("invalid"), statusFor("error")], [200, 402, 410, 400, 503]);
  });
});

describe("the endpoints", () => {
  it("the webhook refuses an unsigned request before parsing or calling anything", async () => {
    const saved = { fetch: globalThis.fetch, secret: process.env.STRIPE_WEBHOOK_SECRET };
    globalThis.fetch = () => assert.fail("no network call for an unsigned request");
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_endpoint_test";
    try {
      const { POST } = await import("../api/stripe-webhook.js");
      const res = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=00" } }));
      assert.equal(res.status, 400);

      const body = JSON.stringify({ type: "invoice.paid", data: { object: {} } });
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", "whsec_endpoint_test").update(`${t}.${body}`).digest("hex");
      const ok = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
      assert.equal(ok.status, 200);
      const payload = await ok.json();
      assert.equal(payload.received, true);
      assert.equal(payload.action, "ignored");
      assert.ok(payload.account === "no-store" || payload.account === "ignored");
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.secret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = saved.secret;
    }
  });

  it("the welcome page answers a bad link with a plain page and no network call", async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = () => assert.fail("no network call for a malformed session id");
    try {
      const { GET, POST } = await import("../api/welcome.js");
      const get = await GET(new Request("https://grillyour.ai/welcome?session_id=nope"));
      assert.equal(get.status, 400);
      assert.equal(get.headers.get("cache-control"), "no-store");
      assert.match(await get.text(), /doesn’t look right/);
      const post = await POST(new Request("https://grillyour.ai/welcome", { method: "POST", body: "session_id=nope" }));
      assert.equal(post.status, 400);
    } finally {
      globalThis.fetch = saved;
    }
  });

  it("/welcome and /checkout are routed to their functions, and the site build is what Vercel runs", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.deepEqual(config, {
      buildCommand: "node scripts/build-site.mjs",
      outputDirectory: "_site",
      rewrites: [
        { source: "/welcome", destination: "/api/welcome" },
        { source: "/checkout", destination: "/api/checkout" },
        { source: "/pro", destination: "/api/pro" },
        { source: "/pro/auth", destination: "/api/pro-auth" },
        { source: "/pro/try", destination: "/api/pro-try" },
        { source: "/pro/reports", destination: "/api/pro-reports" },
      ],
    });
  });

  it("checkout redirects to Stripe, and a bad plan never calls anyone", async () => {
    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    process.env.STRIPE_SECRET_KEY = "sk_test_endpoint";
    process.env.GRILL_PRO_PRICE_MONTH = "price_month1234";
    process.env.GRILL_PRO_BILLING = "subscription";
    delete process.env.GRILL_PRO_COUPON;
    delete process.env.GRILL_PRO_TEST_MODE;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ url: CHECKOUT_URL }), { status: 200 });
    };
    try {
      const { GET } = await import("../api/checkout.js");
      const res = await GET(new Request("https://grillyour.ai/checkout?plan=month"));
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("location"), CHECKOUT_URL);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const bad = await GET(new Request("https://grillyour.ai/checkout?plan=nope"));
      assert.equal(bad.status, 400);
      assert.match(await bad.text(), /doesn’t look right/);
      assert.equal(calls, 1, "the bad plan made no Stripe call");
      delete process.env.GRILL_PRO_BILLING;
      const off = await GET(new Request("https://grillyour.ai/checkout?plan=month"));
      assert.equal(off.status, 200);
      const offHtml = await off.text();
      assert.match(offHtml, /Paid plans are off/);
      assert.match(offHtml, /support@grillyour\.ai/);
      assert.equal(calls, 1, "billing off does not call Stripe");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const [k, v] of Object.entries(saved.env)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
    }
  });

  it("none of this ships in the Desktop extension", () => {
    const build = readFileSync(join(ROOT, "scripts/build-extension.mjs"), "utf8");
    assert.doesNotMatch(build.match(/const FILES = (\[[^\]]+\])/)[1], /api\//);
  });
});
