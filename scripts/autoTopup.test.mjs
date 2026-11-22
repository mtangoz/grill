// Automatic pack charges. Off unless GRILL_AUTO_TOPUP=on. The checkbox on /account is ticked.
// Chat text names no price, plan, or subscription. Made-up keys. No live charge.
import { createHmac, createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { applyAutoTopupPayment, applyTopupEvent } from "../api/_topup.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_WEB_REDIRECT,
  autoTopupFailedText,
  autoTopupSpentKey,
  createMemoryRedis,
  isoMonth,
  personSpendKey,
  topupBalanceKey,
  toMicros,
} from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const RESOURCE = "https://mcp.example/mcp";
const PRICE = "price_testpack1";
const SECRET = "whsec_autotopup_test";
let privateKey;
let jwk;
before(async () => {
  ({ privateKey, jwk } = await testSigningKey());
});

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}

function world(extra = {}, stripeReply) {
  const memory = createMemoryRedis();
  const stripe = { calls: [] };
  const router = { patches: [], usage: 0.03, limit: 5 };
  const env = {
    GRILL_HOSTED: "on",
    GRILL_TOPUPS: "on",
    GRILL_AUTO_TOPUP: "on",
    GRILL_TOPUP_PRICE_ID: PRICE,
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-made-up-0000",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: "tester@example.com",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    STRIPE_SECRET_KEY: "sk_test_topup_made_up",
    STRIPE_WEBHOOK_SECRET: SECRET,
    ...extra,
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      return Response.json({
        id: decodeURIComponent(u.split("/").pop()),
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "tester@example.com", verification: { status: "verified" } }],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && init.method === "POST") {
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: 5, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "PATCH") {
        router.patches.push(JSON.parse(init.body));
        router.limit = JSON.parse(init.body).limit;
        return Response.json({ data: { hash: "hash_tester_1" } });
      }
      return Response.json({ data: { hash: "hash_tester_1", limit: router.limit, usage: router.usage, usage_monthly: router.usage, disabled: false } });
    }
    if (u.startsWith("https://api.stripe.com/")) {
      const params = new URLSearchParams(init.body || "");
      stripe.calls.push({ url: u, method: init.method || "GET", params, headers: init.headers });
      if (typeof stripeReply === "function") return stripeReply(u, init, params);
      if (u === "https://api.stripe.com/v1/customers" && init.method === "POST") return Response.json({ id: "cus_topuptester" });
      if (u === "https://api.stripe.com/v1/checkout/sessions" && init.method === "POST") return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_topup" });
      if (u.startsWith("https://api.stripe.com/v1/payment_intents/pi_") && (init.method || "GET") === "GET") {
        return Response.json({ id: u.split("/").pop(), payment_method: "pm_savedcard1", charges: { data: [{ payment_method_details: { card: { last4: "4242" } } }] } });
      }
      return Response.json({ error: { message: "unexpected stripe call" } }, { status: 404 });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory, stripe, router };
}

const cookie = () => `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_tester", exp: Math.floor(Date.now() / 1000) + 3600 })}`;

function accountRequest(method, { body = "", origin } = {}) {
  const headers = { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" };
  if (origin !== undefined) headers.origin = origin;
  return new Request("https://grillyour.ai/account", { method, headers, body: method === "POST" ? body : undefined });
}

async function storedAccount(ctx) {
  const scan = await ctx.redis(["SCAN", "0", "MATCH", "grill:hosted:acct:*", "COUNT", "100"]);
  const key = scan[1][0];
  return key ? JSON.parse(await ctx.redis(["GET", key])) : null;
}

function paidSession(accountId, { auto = "1", pi = "pi_checkoutpack1" } = {}) {
  return {
    id: "evt_autopack123456",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_autopacksession",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        currency: "usd",
        amount_total: 500,
        payment_intent: pi,
        metadata: { grill_topup: "1", grill_account: accountId, grill_auto_topup: auto },
      },
    },
  };
}

describe("automatic add on the account page", () => {
  it("shows a ticked checkbox and the pack price from config", async () => {
    resetHostedCaches();
    const ctx = world();
    const html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /type="checkbox" name="auto_topup" value="1" checked/);
    assert.match(html, /Automatically add another 100 checks \(\$5\) when I run out, up to \$20 a month\. You can turn this off anytime on this page\./);
    assert.doesNotMatch(html, /\bPro\b|subscription/i);
    assert.match(html, /Automatic add: Off/);
    assert.match(html, /Buy a pack to save a card/);
  });

  it("passes an untick as opt-out metadata and a tick as opt-in", async () => {
    resetHostedCaches();
    const ctx = world();
    await handleAccount(accountRequest("GET"), ctx);
    const off = await handleAccount(accountRequest("POST", { body: "action=topup", origin: "https://grillyour.ai" }), ctx);
    assert.equal(off.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    const unticked = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/checkout/sessions"));
    assert.equal(unticked.params.get("metadata[grill_auto_topup]"), "0");
    ctx.stripe.calls.length = 0;
    const on = await handleAccount(accountRequest("POST", { body: "action=topup&auto_topup=1", origin: "null" }), ctx);
    assert.equal(on.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    const ticked = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/checkout/sessions"));
    assert.equal(ticked.params.get("metadata[grill_auto_topup]"), "1");
    const bare = await handleAccount(accountRequest("POST", { body: "action=topup" }), ctx);
    assert.equal(bare.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
  });

  it("stores the choice, the customer and the card from the webhook", async () => {
    const ctx = world();
    const account = { id: "g_account1234", email: "tester@example.com", keyHash: "hash_tester_1", keyLimitUsd: 5, keyReset: "monthly" };
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    const optedOut = await applyTopupEvent(paidSession(account.id, { auto: "0" }), { env: ctx.env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(optedOut.action, "credited");
    const stored = JSON.parse(await ctx.redis(["GET", `grill:hosted:acct:${account.id}`]));
    assert.equal(stored.autoTopup, false);
    assert.equal(stored.stripePaymentMethodId, "pm_savedcard1");
    assert.equal(stored.cardLast4, "4242");
  });

  it("turns automatic add on and off, and only on when a card is saved", async () => {
    resetHostedCaches();
    const ctx = world();
    await handleAccount(accountRequest("GET"), ctx);
    const before = await storedAccount(ctx);
    before.stripePaymentMethodId = "pm_savedcard1";
    before.cardLast4 = "4242";
    before.autoTopup = false;
    await ctx.redis(["SET", `grill:hosted:acct:${before.id}`, JSON.stringify(before)]);
    resetHostedCaches();
    const on = await handleAccount(accountRequest("POST", { body: "action=auto-topup&value=on", origin: "https://grillyour.ai" }), ctx);
    assert.equal(on.status, 303);
    let html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /Automatic add: On/);
    assert.match(html, /Card ending 4242/);
    assert.match(html, />Turn off</);
    await handleAccount(accountRequest("POST", { body: "action=auto-ceiling&value=1000", origin: "https://grillyour.ai" }), ctx);
    html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /Up to \$10 a month/);
    await handleAccount(accountRequest("POST", { body: "action=auto-topup&value=off", origin: "https://grillyour.ai" }), ctx);
    html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /Automatic add: Off/);
    assert.match(html, />Turn on</);
    const noCard = await storedAccount(ctx);
    delete noCard.stripePaymentMethodId;
    noCard.autoTopup = false;
    await ctx.redis(["SET", `grill:hosted:acct:${noCard.id}`, JSON.stringify(noCard)]);
    resetHostedCaches();
    await handleAccount(accountRequest("POST", { body: "action=auto-topup&value=on", origin: "https://grillyour.ai" }), ctx);
    html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /Buy a pack to save a card/);
    assert.equal((await storedAccount(ctx)).autoTopup, false);
  });
});

describe("automatic charges", () => {
  function readyAccount(id = "g_accountauto1") {
    return {
      id,
      email: "tester@example.com",
      keyHash: "hash_tester_1",
      keyLimitUsd: 5,
      keyReset: "monthly",
      stripeCustomerId: "cus_topuptester",
      stripePaymentMethodId: "pm_savedcard1",
      cardLast4: "4242",
      autoTopup: true,
      autoTopupCeilingCents: 2000,
    };
  }

  it("stops at the monthly ceiling and does not charge", async () => {
    const ctx = world();
    const account = readyAccount();
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    await ctx.redis(["SET", autoTopupSpentKey(account.id, isoMonth()), "1600"]);
    const { chargeAutoTopup } = await import("../api/_topup.mjs");
    const result = await chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account, command: ctx.redis });
    assert.equal(result.state, "ceiling");
    assert.equal(ctx.stripe.calls.some((call) => call.url.endsWith("/v1/payment_intents")), false);
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])) || 0, 0);
  });

  it("charges once under a lock, credits 100 checks, and a second call does not charge again", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let payments = 0;
    const ctx = world({}, async (url, init) => {
      if (url.endsWith("/v1/payment_intents") && init.method === "POST") {
        payments += 1;
        if (payments === 1) await gate;
        return Response.json({
          id: "pi_autocharge01",
          status: "succeeded",
          amount: 500,
          amount_received: 500,
          currency: "usd",
          payment_method: "pm_savedcard1",
          charges: { data: [{ payment_method_details: { card: { last4: "4242" } } }] },
        });
      }
      return Response.json({ error: { message: "unexpected" } }, { status: 404 });
    });
    const account = readyAccount();
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    const { chargeAutoTopup } = await import("../api/_topup.mjs");
    const first = chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account, command: ctx.redis });
    const second = chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account: { ...account }, command: ctx.redis });
    const busy = await second;
    assert.equal(busy.state, "busy");
    release();
    const done = await first;
    assert.equal(done.state, "credited");
    assert.equal(payments, 1);
    const charged = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/payment_intents"));
    assert.match(charged.headers["Idempotency-Key"], new RegExp(`^grill-auto-${account.id}-${isoMonth()}-1$`));
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    assert.equal(Number(await ctx.redis(["GET", autoTopupSpentKey(account.id, isoMonth())])), 500);
  });

  it("turns automatic add off when the card is declined, and the webhook does not credit twice", async () => {
    const ctx = world({}, async (url, init) => {
      if (url.endsWith("/v1/payment_intents") && init.method === "POST") {
        return Response.json({ error: { code: "card_declined", message: "Your card was declined." } }, { status: 402 });
      }
      return Response.json({ error: { message: "unexpected" } }, { status: 404 });
    });
    const account = readyAccount();
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    const { chargeAutoTopup } = await import("../api/_topup.mjs");
    const failed = await chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account, command: ctx.redis });
    assert.equal(failed.state, "failed");
    assert.equal(failed.code, "card_declined");
    const stored = JSON.parse(await ctx.redis(["GET", `grill:hosted:acct:${account.id}`]));
    assert.equal(stored.autoTopup, false);
    assert.equal(stored.autoTopupFailure.code, "card_declined");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])) || 0, 0);
    const retry = await chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account: stored, command: ctx.redis });
    assert.equal(retry.state, "opt-out");
    const event = {
      id: "evt_autofail123456",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_webhookcredit1",
          status: "succeeded",
          currency: "usd",
          amount: 500,
          amount_received: 500,
          payment_method: "pm_savedcard1",
          metadata: { grill_topup: "1", grill_auto: "1", grill_account: account.id, grill_month: isoMonth() },
        },
      },
    };
    stored.autoTopup = true;
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(stored)]);
    const credited = await applyAutoTopupPayment(event, { env: ctx.env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(credited.action, "credited");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    const duplicate = await applyAutoTopupPayment(event, { env: ctx.env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(duplicate.action, "duplicate");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
  });

  it("tells the chat the automatic add did not go through, with no price", async () => {
    const fake = await startFakeOpenRouter();
    const ctx = world({}, async (url, init) => {
      if (url.endsWith("/v1/payment_intents") && init.method === "POST") {
        return Response.json({ error: { code: "authentication_required" } }, { status: 402 });
      }
      return Response.json({ error: { message: "unexpected" } }, { status: 404 });
    });
    try {
      resetHostedCaches();
      const token = signJwt({ iss: "https://clerk.example.test", sub: "user_tester", aud: RESOURCE, exp: Math.floor(Date.now() / 1000) + 3600, redirect_uri: CLAUDE_WEB_REDIRECT });
      const deps = { ...ctx, judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL };
      const call = (id, subject) =>
        handleMcp(
          new Request(RESOURCE, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "grill", arguments: { subject, keep_records: false, quality_check: false } } }),
          }),
          deps,
        );
      const first = await call(1, "Decision: Repaint the shed\nI'm 60% sure.");
      assert.equal((await first.json()).result.isError, false);
      const account = await storedAccount(ctx);
      account.autoTopup = true;
      account.stripeCustomerId = "cus_topuptester";
      account.stripePaymentMethodId = "pm_savedcard1";
      await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
      await ctx.redis(["SET", personSpendKey("tester@example.com", isoMonth()), String(toMicros(5))]);
      resetHostedCaches();
      const blocked = await call(2, "Decision: keep the door blue.");
      const text = (await blocked.json()).result.content[0].text;
      assert.equal(text, autoTopupFailedText("https://mcp.example"));
      assert.match(text, /run out of checks/);
      assert.match(text, /automatic top-up didn't go through/);
      assert.match(text, /\/account/);
      assert.doesNotMatch(text, /\$|Pro|subscription/i);
    } finally {
      await fake.close();
    }
  });
});
