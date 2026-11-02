// Anonymous paid-intent counts while paid plans are off, and a checkout session stamped
// with an account id so a later payment can be tied to that account. Prices stay as they are.
// Made-up ids only. No live billing.
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signPayload } from "../api/_account.mjs";
import { FREE_TO_PAID_KEY, PAID_INTENT_KEYS, noteFreeToPaid, recordPaidIntent } from "../api/_paidIntent.mjs";
import { PLANS, checkoutClientReference, startCheckout } from "../api/_pro.mjs";

const ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  STRIPE_SECRET_KEY: "sk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_paid_intent",
  GRILL_PRO_PRICE_MONTH: "price_month1234",
  GRILL_SESSION_SECRET: "session-secret-at-least-16",
};

function memoryRedis() {
  const store = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), body: typeof init.body === "string" ? init.body : "" });
    if (String(url) !== ENV.UPSTASH_REDIS_REST_URL) {
      return new Response(JSON.stringify({ url: "https://checkout.stripe.com/c/pay/cs_test_paidintent" }), { status: 200 });
    }
    const args = JSON.parse(init.body);
    const [op, key, value] = args;
    if (op === "INCR") {
      const n = (Number(store.get(key)) || 0) + 1;
      store.set(key, String(n));
      return Response.json({ result: n });
    }
    if (op === "GET") return Response.json({ result: store.has(key) ? store.get(key) : null });
    if (op === "SET") {
      if (args.includes("NX") && store.has(key)) return Response.json({ result: null });
      store.set(key, String(value));
      return Response.json({ result: "OK" });
    }
    throw new Error(`unexpected redis ${op}`);
  };
  return { store, calls, fetchImpl };
}

describe("paid intent", () => {
  it("keeps the list prices", () => {
    assert.equal(PLANS.month.list, "$9");
    assert.equal(PLANS.year.list, "$90");
    assert.equal(PLANS.month.offer, "$4.50");
    assert.equal(PLANS.year.offer, "$45");
  });

  it("counts pricing and checkout views and notify clicks only while paid is off", async () => {
    const redis = memoryRedis();
    assert.equal(await recordPaidIntent({ ...ENV }, redis.fetchImpl, "pricing"), true);
    assert.equal(await recordPaidIntent({ ...ENV }, redis.fetchImpl, "checkout"), true);
    assert.equal(await recordPaidIntent({ ...ENV }, redis.fetchImpl, "notify"), true);
    assert.equal(redis.store.get(PAID_INTENT_KEYS.pricing), "1");
    assert.equal(redis.store.get(PAID_INTENT_KEYS.checkout), "1");
    assert.equal(redis.store.get(PAID_INTENT_KEYS.notify), "1");
    assert.equal(await recordPaidIntent({ ...ENV, GRILL_PRO_BILLING: "subscription" }, redis.fetchImpl, "pricing"), false);
    assert.equal(redis.store.get(PAID_INTENT_KEYS.pricing), "1");
    assert.equal(await recordPaidIntent({ STRIPE_SECRET_KEY: "sk_test_fake" }, redis.fetchImpl, "checkout"), false);
  });

  it("the pricing page is plain HTML, states the same prices, and logs a view and a notify click", async () => {
    const redis = memoryRedis();
    const saved = { ...process.env, fetch: globalThis.fetch };
    Object.assign(process.env, ENV);
    delete process.env.GRILL_PRO_BILLING;
    delete process.env.GRILL_PRO_COUPON;
    globalThis.fetch = redis.fetchImpl;
    try {
      const { GET, POST } = await import("../api/pricing.js");
      const page = await GET(new Request("https://grillyour.ai/pricing"));
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /\$9 a month/);
      assert.match(html, /\$90 a year/);
      assert.match(html, /Paid plans are off/);
      assert.match(html, /value="Notify me"/);
      assert.equal(html.includes("<script"), false);
      assert.equal(redis.store.get(PAID_INTENT_KEYS.pricing), "1");
      assert.equal(redis.calls.some((call) => call.url.includes("api.stripe.com")), false);

      const click = await POST(new Request("https://grillyour.ai/pricing", { method: "POST", body: "intent=notify" }));
      assert.equal(click.status, 303);
      assert.equal(click.headers.get("location"), "/notify");
      assert.equal(redis.store.get(PAID_INTENT_KEYS.notify), "1");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      delete process.env.fetch;
    }
  });

  it("stamps a signed-in account on the checkout session and ignores a bad id", async () => {
    const accountId = "acct_abcdef0123456789";
    assert.equal(checkoutClientReference(accountId), accountId);
    assert.equal(checkoutClientReference("friend@example.com"), "");
    assert.equal(checkoutClientReference("acct_short"), "");
    const redis = memoryRedis();
    const stamped = await startCheckout("month", { env: ENV, fetch: redis.fetchImpl, clientReferenceId: accountId });
    assert.equal(stamped.state, "redirect");
    const form = new URLSearchParams(redis.calls.at(-1).body);
    assert.equal(form.get("client_reference_id"), accountId);
    assert.equal(form.get("line_items[0][price]"), "price_month1234");
    const plain = memoryRedis();
    await startCheckout("month", { env: ENV, fetch: plain.fetchImpl, clientReferenceId: "not an id" });
    assert.equal(new URLSearchParams(plain.calls.at(-1).body).get("client_reference_id"), null);

    const saved = { ...process.env, fetch: globalThis.fetch };
    Object.assign(process.env, ENV);
    process.env.GRILL_PRO_BILLING = "subscription";
    globalThis.fetch = redis.fetchImpl;
    try {
      const { GET } = await import("../api/checkout.js");
      const token = signPayload({ t: "s", sub: accountId, exp: Math.floor(Date.now() / 1000) + 3600 }, ENV.GRILL_SESSION_SECRET);
      const res = await GET(new Request("https://grillyour.ai/checkout?plan=month", { headers: { cookie: `grill_pro=${token}` } }));
      assert.equal(res.status, 303);
      const session = redis.calls.filter((call) => call.url.includes("/v1/checkout/sessions")).at(-1);
      assert.equal(new URLSearchParams(session.body).get("client_reference_id"), accountId);
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      delete process.env.fetch;
    }
  });

  it("a checkout view while paid is off does not call Stripe", async () => {
    const redis = memoryRedis();
    const saved = { ...process.env, fetch: globalThis.fetch };
    Object.assign(process.env, ENV);
    delete process.env.GRILL_PRO_BILLING;
    globalThis.fetch = redis.fetchImpl;
    try {
      const { GET } = await import("../api/checkout.js");
      const res = await GET(new Request("https://grillyour.ai/checkout?plan=month"));
      assert.equal(res.status, 200);
      assert.match(await res.text(), /Paid plans are off/);
      assert.equal(redis.store.get(PAID_INTENT_KEYS.checkout), "1");
      assert.equal(redis.calls.some((call) => call.url.includes("api.stripe.com")), false);
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      delete process.env.fetch;
    }
  });

  it("records free-to-paid once when the webhook names an account", async () => {
    const redis = memoryRedis();
    const id = "cus_PaidIntent1";
    assert.equal(await noteFreeToPaid(ENV, redis.fetchImpl, id), true);
    assert.equal(await noteFreeToPaid(ENV, redis.fetchImpl, id), false);
    assert.equal(redis.store.get(FREE_TO_PAID_KEY), "1");
    assert.equal(await noteFreeToPaid(ENV, redis.fetchImpl, "friend@example.com"), false);

    const saved = { ...process.env, fetch: globalThis.fetch };
    Object.assign(process.env, ENV);
    globalThis.fetch = redis.fetchImpl;
    try {
      const body = JSON.stringify({
        type: "checkout.session.completed",
        data: { object: { client_reference_id: "acct_abcdef0123456789" } },
      });
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", ENV.STRIPE_WEBHOOK_SECRET).update(`${t}.${body}`).digest("hex");
      const { POST } = await import("../api/stripe-webhook.js");
      const res = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
      assert.equal(res.status, 200);
      const payload = await res.json();
      assert.equal(payload.action, "ignored");
      assert.equal(redis.store.get(FREE_TO_PAID_KEY), "2");
      const again = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body, headers: { "stripe-signature": `t=${t},v1=${sig}` } }));
      assert.equal(again.status, 200);
      assert.equal(redis.store.get(FREE_TO_PAID_KEY), "2");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      delete process.env.fetch;
    }
  });
});
