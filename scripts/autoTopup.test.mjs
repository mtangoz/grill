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

function cardMethodResponse(url, init) {
  const u = String(url);
  if (!u.includes("/v1/payment_methods/pm_") || (init.method || "GET") === "POST") return null;
  const id = u.split("/").pop().split("?")[0];
  return Response.json({ id, type: id.includes("link") ? "link" : "card" });
}

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
      const card = cardMethodResponse(u, init);
      if (card) return card;
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
  it("leaves the pack checkbox unticked while automatic add is off", async () => {
    resetHostedCaches();
    const ctx = world();
    const html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    const checks = html.indexOf('id="checks"');
    const records = html.indexOf('name="action" value="records"');
    assert.ok(checks > 0 && checks < records, "the checks box, including automatic add, sits above records");
    const box = html.slice(checks, records);
    const checkbox = html.match(/<input type="checkbox" name="auto_topup"[^>]*>/)?.[0] || "";
    assert.equal(checkbox, '<input type="checkbox" name="auto_topup" value="1">');
    assert.match(box, /Add 100 checks · \$5/);
    assert.match(html, /Auto-add with this pack<\/span> <span class="pack-switch"><input type="checkbox" name="auto_topup" value="1"><span class="state when-off" data-state="off">Off<\/span><span class="state when-on" data-state="on">On<\/span>/);
    assert.match(html, /\.pack-switch input:checked ~ \.when-on \{ display: inline; \}/);
    const consentAt = html.indexOf("Automatically add another 100 checks ($5) when I run out, up to $20 a month.");
    const buttonAt = html.indexOf("Add 100 checks · $5");
    assert.ok(consentAt > 0 && consentAt < buttonAt);
    assert.match(html, /Automatically add another 100 checks \(\$5\) when I run out, up to \$20 a month\. You can turn this off anytime on this page\./);
    assert.doesNotMatch(html, /\bPro\b|subscription/i);
    assert.doesNotMatch(html, /Auto-add when I run out/);
    assert.doesNotMatch(html, /Buy a pack to save a card/);
    assert.equal(html.includes('class="ceiling"'), false);
  });

  it("passes an untick as opt-out metadata and a tick as opt-in", async () => {
    resetHostedCaches();
    const ctx = world();
    const html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    const token = html.match(/name="page" value="([^"]+)"/)?.[1] || "";
    assert.ok(token);
    const off = await handleAccount(accountRequest("POST", { body: "action=topup", origin: "https://grillyour.ai" }), ctx);
    assert.equal(off.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    const unticked = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/checkout/sessions"));
    assert.equal(unticked.params.get("metadata[grill_auto_topup]"), "0");
    assert.equal(unticked.params.get("payment_intent_data[setup_future_usage]"), null);
    ctx.stripe.calls.length = 0;
    const on = await handleAccount(
      accountRequest("POST", { body: `page=${encodeURIComponent(token)}&action=topup&auto_topup=1`, origin: "null" }),
      ctx,
    );
    assert.equal(on.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    const ticked = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/checkout/sessions"));
    assert.equal(ticked.params.get("metadata[grill_auto_topup]"), "1");
    assert.equal(ticked.params.get("payment_intent_data[setup_future_usage]"), "off_session");
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
    assert.equal(stored.stripePaymentMethodId, undefined);
    assert.equal(stored.cardLast4, undefined);
    const optedIn = paidSession(account.id, { auto: "1", pi: "pi_checkoutpack2" });
    optedIn.id = "evt_autopack223456";
    optedIn.data.object.id = "cs_test_autopack2";
    const kept = await applyTopupEvent(optedIn, { env: ctx.env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(kept.action, "credited");
    const withCard = JSON.parse(await ctx.redis(["GET", `grill:hosted:acct:${account.id}`]));
    assert.equal(withCard.autoTopup, true);
    assert.equal(withCard.stripePaymentMethodId, "pm_savedcard1");
    assert.equal(withCard.cardLast4, "4242");
  });

  it("leaves auto-add off when the card cannot be read, and still shows Turn off if it is on without a card", async () => {
    resetHostedCaches();
    const ctx = world();
    await handleAccount(accountRequest("GET"), ctx);
    const account = await storedAccount(ctx);
    const failing = async (url, init) => {
      if (String(url).includes("/v1/payment_intents/")) return Response.json({ error: { code: "api_error" } }, { status: 500 });
      return ctx.fetch(url, init);
    };
    const event = paidSession(account.id, { auto: "1", pi: "pi_lookupfail1" });
    event.id = "evt_lookupfail12";
    event.data.object.id = "cs_test_lookupfail1";
    const result = await applyTopupEvent(event, { env: ctx.env, fetch: failing, command: ctx.redis });
    assert.equal(result.action, "credited");
    const stored = await storedAccount(ctx);
    assert.equal(stored.autoTopup, false);
    assert.equal(stored.stripePaymentMethodId, undefined);
    resetHostedCaches();
    const html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /Auto-add with this pack/);
    assert.doesNotMatch(html, /Auto-add when I run out · On/);
    assert.match(html, /<input type="checkbox" name="auto_topup" value="1">/);
    stored.autoTopup = true;
    delete stored.stripePaymentMethodId;
    await ctx.redis(["SET", `grill:hosted:acct:${stored.id}`, JSON.stringify(stored)]);
    resetHostedCaches();
    const stuck = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(stuck, /Auto-add when I run out · On/);
    assert.match(stuck, /name="value" value="off"[^>]*>Auto-add when I run out · On</);
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
    assert.match(html, /Auto-add when I run out · On/);
    assert.equal(html.match(/<input type="checkbox" name="auto_topup"[^>]*>/)?.[0], '<input type="checkbox" name="auto_topup" value="1" checked>');
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /<details class="ceiling" open>/);
    assert.match(html, /Card ending 4242/);
    assert.match(html, /name="value" value="off"[^>]*>Auto-add when I run out · On</);
    const ceiling = await handleAccount(accountRequest("POST", { body: "action=auto-ceiling&value=1000", origin: "https://grillyour.ai" }), ctx);
    assert.match(ceiling.headers.get("location"), /[?&]saved=ceiling-10$/);
    html = await (await handleAccount(new Request(ceiling.headers.get("location"), { headers: { cookie: cookie() } }), ctx)).text();
    assert.match(html, /Saved\. The monthly ceiling is \$10\./);
    assert.match(html, /Up to \$10 a month/);
    await handleAccount(accountRequest("POST", { body: "action=auto-topup&value=off", origin: "https://grillyour.ai" }), ctx);
    html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.match(html, /Auto-add when I run out · Off/);
    assert.equal(html.match(/<input type="checkbox" name="auto_topup"[^>]*>/)?.[0], '<input type="checkbox" name="auto_topup" value="1">');
    assert.match(html, /name="value" value="on"[^>]*>Auto-add when I run out · Off</);
    const noCard = await storedAccount(ctx);
    delete noCard.stripePaymentMethodId;
    noCard.autoTopup = false;
    await ctx.redis(["SET", `grill:hosted:acct:${noCard.id}`, JSON.stringify(noCard)]);
    resetHostedCaches();
    await handleAccount(accountRequest("POST", { body: "action=auto-topup&value=on", origin: "https://grillyour.ai" }), ctx);
    html = await (await handleAccount(accountRequest("GET"), ctx)).text();
    assert.doesNotMatch(html, /Auto-add when I run out/);
    assert.doesNotMatch(html, /Buy a pack to save a card/);
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
      const card = cardMethodResponse(url, init);
      if (card) return card;
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
    assert.equal(charged.params.get("payment_method_types[0]"), "card");
    assert.equal(charged.params.get("payment_method"), "pm_savedcard1");
    assert.equal([...charged.params.values()].includes("link"), false);
    assert.match(charged.headers["Idempotency-Key"], new RegExp(`^grill-auto-${account.id}-${isoMonth()}-1$`));
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    assert.equal(Number(await ctx.redis(["GET", autoTopupSpentKey(account.id, isoMonth())])), 500);
  });

  it("still charges a saved card when the payment-method lookup is forbidden or unavailable", async () => {
    for (const status of [403, 503]) {
      const ctx = world({}, async (url, init) => {
        if (String(url).includes("/v1/payment_methods/") && (init.method || "GET") !== "POST") {
          return Response.json({ error: { code: "more_permissions_required" } }, { status });
        }
        if (url.endsWith("/v1/payment_intents") && init.method === "POST") {
          return Response.json({
            id: `pi_autolookup${status}`,
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
      const account = readyAccount(`g_accountlookup${status}`);
      await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
      const { chargeAutoTopup } = await import("../api/_topup.mjs");
      const result = await chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account, command: ctx.redis });
      assert.equal(result.state, "credited", String(status));
      const charged = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/payment_intents"));
      assert.equal(charged.params.get("payment_method_types[0]"), "card", String(status));
      assert.equal([...charged.params.values()].includes("link"), false, String(status));
    }
  });

  it("does not charge a Link payment method off-session", async () => {
    const ctx = world();
    const account = readyAccount();
    account.stripePaymentMethodId = "pm_linkmethod1";
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    const { chargeAutoTopup } = await import("../api/_topup.mjs");
    const result = await chargeAutoTopup({ env: ctx.env, fetch: ctx.fetch, account, command: ctx.redis });
    assert.equal(result.state, "no-card");
    assert.equal(ctx.stripe.calls.some((call) => call.url.endsWith("/v1/payment_intents")), false);
    const looked = ctx.stripe.calls.find((call) => call.url.includes("/v1/payment_methods/"));
    assert.match(looked.url, /pm_linkmethod1$/);
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])) || 0, 0);
  });

  it("turns automatic add off when the card is declined, and the webhook does not credit twice", async () => {
    const ctx = world({}, async (url, init) => {
      const card = cardMethodResponse(url, init);
      if (card) return card;
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
      const card = cardMethodResponse(url, init);
      if (card) return card;
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
