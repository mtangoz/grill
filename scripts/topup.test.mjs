// Prepaid check packs for hosted accounts. Off unless GRILL_TOPUPS=on.
// The pack price is on the account page only. Chat text names no price, plan, or subscription.
// Made-up keys and made-up Stripe ids. No live charge.
import { createHmac, createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { applyTopupEvent } from "../api/_topup.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_WEB_REDIRECT,
  capBlock,
  createMemoryRedis,
  isoMonth,
  keyLimitWithTopup,
  personSpendKey,
  serviceSpendKey,
  splitCharge,
  topupBalanceKey,
  topupBudgetUsd,
  topupPack,
  topupsEnabled,
  toMicros,
  userAllowanceUsedText,
  userMonthlyCapUsd,
  USER_CAP_TEXT,
} from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const RESOURCE = "https://mcp.example/mcp";
const PRICE = "price_testpack1";
const SECRET = "whsec_topup_test";
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

function world(extra = {}) {
  const memory = createMemoryRedis();
  const router = { creates: [], patches: [], usage: 0.03, limit: 5 };
  const stripe = { calls: [] };
  const env = {
    GRILL_HOSTED: "on",
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
      const body = JSON.parse(init.body);
      router.creates.push(body);
      router.limit = body.limit;
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: body.limit, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "PATCH") {
        const body = JSON.parse(init.body);
        router.patches.push(body);
        if (Number.isFinite(body.limit)) router.limit = body.limit;
        return Response.json({ data: { hash: "hash_tester_1" } });
      }
      return Response.json({ data: { hash: "hash_tester_1", limit: router.limit, usage: router.usage, usage_monthly: router.usage, disabled: false } });
    }
    if (u.startsWith("https://api.stripe.com/")) {
      const params = new URLSearchParams(init.body || "");
      stripe.calls.push({ url: u, method: init.method || "GET", params });
      if (u === "https://api.stripe.com/v1/customers" && init.method === "POST") {
        return Response.json({ id: "cus_topuptester" });
      }
      if (u === "https://api.stripe.com/v1/checkout/sessions" && init.method === "POST") {
        return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_topup" });
      }
      return Response.json({ error: { message: "unexpected stripe call" } }, { status: 404 });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  const redis = (args) => memory.command(args);
  return { env, fetch: fetchImpl, redis, memory, router, stripe };
}

const cookie = () => `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_tester", exp: Math.floor(Date.now() / 1000) + 3600 })}`;

function accountRequest(method, { body = "", query = "" } = {}) {
  return new Request(`https://grillyour.ai/account${query}`, {
    method,
    headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? body : undefined,
  });
}

async function storedAccount(ctx) {
  const scan = await ctx.redis(["SCAN", "0", "MATCH", "grill:hosted:acct:*", "COUNT", "100"]);
  const key = scan[1][0];
  return key ? JSON.parse(await ctx.redis(["GET", key])) : null;
}

function signStripe(payload, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return { t, header: `t=${t},v1=${v1}` };
}

function paidEvent(accountId, { id = "evt_topup12345678", session = "cs_test_topupsession1", amount = 500, currency = "usd" } = {}) {
  return {
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: session,
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        currency,
        amount_total: amount,
        metadata: { grill_topup: "1", grill_account: accountId },
      },
    },
  };
}

describe("top-up pack config", () => {
  it("is off unless GRILL_TOPUPS is on, and the pack defaults to 100 checks for $5", () => {
    assert.equal(topupsEnabled({}), false);
    assert.equal(topupsEnabled({ GRILL_TOPUPS: "yes" }), false);
    assert.equal(topupsEnabled({ GRILL_TOPUPS: "on" }), true);
    const pack = topupPack({ GRILL_TOPUPS: "on" });
    assert.equal(pack.checks, 100);
    assert.equal(pack.priceCents, 500);
    assert.equal(pack.priceId, "");
    assert.equal(pack.budgetUsd, topupBudgetUsd({}));
    assert.ok(pack.budgetUsd > 0);
    const custom = topupPack({ GRILL_TOPUP_CHECKS: "50", GRILL_TOPUP_PRICE_CENTS: "250", GRILL_TOPUP_BUDGET_USD: "1.5", GRILL_TOPUP_PRICE_ID: PRICE });
    assert.deepEqual({ checks: custom.checks, priceCents: custom.priceCents, budgetUsd: custom.budgetUsd, priceId: custom.priceId }, {
      checks: 50,
      priceCents: 250,
      budgetUsd: 1.5,
      priceId: PRICE,
    });
  });

  it("keeps the free allowance at $5 and adds prepaid budget only while top-ups are on", () => {
    assert.equal(userMonthlyCapUsd({}), 5);
    assert.equal(keyLimitWithTopup({}, 3), 5);
    assert.equal(keyLimitWithTopup({ GRILL_TOPUPS: "on" }, 3), 8);
    assert.deepEqual(splitCharge(4_000_000, 1_500_000, 5_000_000), { freePart: 1_000_000, paidPart: 500_000 });
    assert.equal(topupBalanceKey("tester@example.com").includes(isoMonth()), false);
  });

  it("lets prepaid budget cover spend past the free allowance, and carries that room with no month key", () => {
    const env = { GRILL_TOPUPS: "on" };
    const budget = toMicros(topupBudgetUsd(env));
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 5_000_000, env }).text, userAllowanceUsedText("https://grillyour.ai"));
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 5_000_000, env, topupChecks: 100, topupBudgetMicros: budget, origin: "https://preview.example" }), null);
    assert.match(userAllowanceUsedText("https://preview.example"), /https:\/\/preview\.example\/account/);
    assert.doesNotMatch(userAllowanceUsedText("https://grillyour.ai"), /\$|Pro|subscription/i);
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 5_000_000, topupChecks: 100, topupBudgetMicros: budget }).text, USER_CAP_TEXT);
    assert.equal(capBlock({ serviceMicros: toMicros(20), userMicros: 5_000_000, env, topupChecks: 40, topupBudgetMicros: budget }), null);
    assert.equal(capBlock({ serviceMicros: toMicros(20), userMicros: 0 }).text.startsWith("Grill has hit"), true);
  });
});

describe("top-up webhook", () => {
  it("rejects a bad signature and does not credit", async () => {
    const ctx = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE });
    const payload = JSON.stringify(paidEvent("g_account1234"));
    const { POST } = await import("../api/stripe-webhook.js");
    const previous = globalThis.fetch;
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.GRILL_TOPUPS = "on";
    globalThis.fetch = ctx.fetch;
    try {
      const res = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body: payload, headers: { "stripe-signature": "t=1,v1=00" } }));
      assert.equal(res.status, 400);
      assert.equal(await ctx.redis(["HGET", topupBalanceKey("tester@example.com"), "checks"]), null);
    } finally {
      globalThis.fetch = previous;
      if (saved == null) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = saved;
      delete process.env.GRILL_TOPUPS;
    }
  });

  it("credits the pack once, raises the key, and ignores a replay or a mismatched amount", async () => {
    const ctx = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE });
    const account = {
      id: "g_account1234",
      email: "tester@example.com",
      keyHash: "hash_tester_1",
      keyLimitUsd: 5,
      keyReset: "monthly",
    };
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    const env = ctx.env;
    const first = await applyTopupEvent(paidEvent(account.id), { env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(first.action, "credited");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "budget_micros"])), toMicros(topupBudgetUsd(env)));
    assert.equal(ctx.router.patches.at(-1).limit, keyLimitWithTopup(env, topupBudgetUsd(env)));
    assert.equal(ctx.router.patches.at(-1).limit_reset, "monthly");
    const stored = JSON.parse(await ctx.redis(["GET", `grill:hosted:acct:${account.id}`]));
    assert.equal(stored.keyLimitUsd, keyLimitWithTopup(env, topupBudgetUsd(env)));
    const again = await applyTopupEvent(paidEvent(account.id), { env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(again.action, "duplicate");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    const otherEvent = await applyTopupEvent(paidEvent(account.id, { id: "evt_topup87654321" }), { env, fetch: ctx.fetch, command: ctx.redis });
    assert.equal(otherEvent.action, "duplicate");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    const wrong = await applyTopupEvent(paidEvent(account.id, { id: "evt_topupamount01", session: "cs_test_topupsession2", amount: 100 }), {
      env,
      fetch: ctx.fetch,
      command: ctx.redis,
    });
    assert.equal(wrong.action, "amount");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    const off = await applyTopupEvent(paidEvent(account.id, { id: "evt_topupwhenoff1", session: "cs_test_topupsession3" }), {
      env: { ...env, GRILL_TOPUPS: "" },
      fetch: ctx.fetch,
      command: ctx.redis,
    });
    assert.equal(off.action, "off");
    assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
  });

  it("accepts a signed webhook and credits through that route once", async () => {
    const ctx = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE });
    const account = { id: "g_account5678", email: "tester@example.com", keyHash: "hash_tester_1", keyLimitUsd: 5, keyReset: "monthly" };
    await ctx.redis(["SET", `grill:hosted:acct:${account.id}`, JSON.stringify(account)]);
    const payload = JSON.stringify(paidEvent(account.id, { id: "evt_signedtopup01", session: "cs_test_signedtopup1" }));
    const { header } = signStripe(payload);
    const { POST } = await import("../api/stripe-webhook.js");
    const previous = globalThis.fetch;
    const touched = Object.keys(ctx.env);
    const saved = Object.fromEntries(touched.map((key) => [key, process.env[key]]));
    Object.assign(process.env, ctx.env);
    globalThis.fetch = async (url, init = {}) => {
      if (String(url) === ctx.env.UPSTASH_REDIS_REST_URL) {
        const args = JSON.parse(init.body);
        return Response.json({ result: await ctx.redis(args) });
      }
      return ctx.fetch(url, init);
    };
    try {
      const res = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.action, "credited");
      const again = await POST(new Request("https://grillyour.ai/api/stripe-webhook", { method: "POST", body: payload, headers: { "stripe-signature": header } }));
      assert.equal((await again.json()).action, "duplicate");
      assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey(account.email), "checks"])), 100);
    } finally {
      globalThis.fetch = previous;
      for (const key of touched) {
        if (saved[key] == null) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

describe("the account page sells a pack", () => {
  it("shows no pack and no price while top-ups are off", async () => {
    resetHostedCaches();
    const ctx = world();
    const res = await handleAccount(accountRequest("GET"), ctx);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.doesNotMatch(html, /id="topup"|Add \d+ checks/);
    assert.match(html, /\$5 of use each month/);
  });

  it("starts a one-time checkout and saves the card for reuse", async () => {
    resetHostedCaches();
    const ctx = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE });
    const page = await handleAccount(accountRequest("GET"), ctx);
    const html = await page.text();
    assert.match(html, /Add 100 checks · \$5/);
    assert.match(html, /Prepaid checks left: 0/);
    assert.match(html, /Unused checks carry over/);
    assert.match(html, /Nothing is charged later on its own/);
    assert.doesNotMatch(html, /\bPro\b|subscription/i);
    const res = await handleAccount(accountRequest("POST", { body: "action=topup" }), ctx);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    const session = ctx.stripe.calls.find((call) => call.url.endsWith("/v1/checkout/sessions"));
    assert.equal(session.params.get("mode"), "payment");
    assert.equal(session.params.get("line_items[0][price]"), PRICE);
    assert.equal(session.params.get("payment_intent_data[setup_future_usage]"), "off_session");
    assert.equal(session.params.get("metadata[grill_topup]"), "1");
    assert.match(session.params.get("success_url"), /\/account\?topup=ok$/);
    assert.equal(session.params.get("customer"), "cus_topuptester");
    resetHostedCaches();
    const priced = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE, GRILL_TOPUP_PRICE_CENTS: "250" });
    const custom = await handleAccount(accountRequest("GET"), priced);
    assert.match(await custom.text(), /Add 100 checks · \$2\.50/);
    const account = await storedAccount(ctx);
    assert.equal(account.stripeCustomerId, "cus_topuptester");
    assert.equal(session.params.get("metadata[grill_account]"), account.id);
    ctx.stripe.calls.length = 0;
    const second = await handleAccount(accountRequest("POST", { body: "action=topup" }), ctx);
    assert.equal(second.status, 303);
    assert.equal(ctx.stripe.calls.some((call) => call.url.endsWith("/v1/customers")), false);
  });

  it("accepts a restricted key in the matching environment", async () => {
    resetHostedCaches();
    const live = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE, VERCEL_ENV: "production", STRIPE_SECRET_KEY: "rk_live_restricted_made_up" });
    const res = await handleAccount(accountRequest("POST", { body: "action=topup" }), live);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    resetHostedCaches();
    const preview = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE, VERCEL_ENV: "preview", STRIPE_SECRET_KEY: "rk_test_restricted_made_up" });
    const also = await handleAccount(accountRequest("POST", { body: "action=topup" }), preview);
    assert.equal(also.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
  });

  it("does not start checkout with a live key on a preview, or a test key in production", async () => {
    resetHostedCaches();
    const preview = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE, VERCEL_ENV: "preview", STRIPE_SECRET_KEY: "sk_live_not_for_preview" });
    const blocked = await handleAccount(accountRequest("POST", { body: "action=topup" }), preview);
    assert.equal(blocked.status, 303);
    assert.match(blocked.headers.get("location"), /topup=unready/);
    assert.equal(preview.stripe.calls.length, 0);
    resetHostedCaches();
    const production = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE, VERCEL_ENV: "production", STRIPE_SECRET_KEY: "sk_test_not_for_production" });
    const also = await handleAccount(accountRequest("POST", { body: "action=topup" }), production);
    assert.match(also.headers.get("location"), /topup=unready/);
    assert.equal(production.stripe.calls.length, 0);
  });

  it("counts a restricted key as live or test on preview and on production", async () => {
    const cases = [
      { vercel: "preview", key: "rk_live_not_for_preview", ready: false },
      { vercel: "preview", key: "rk_test_for_preview", ready: true },
      { vercel: "production", key: "rk_live_for_production", ready: true },
      { vercel: "production", key: "rk_test_not_for_production", ready: false },
    ];
    for (const item of cases) {
      resetHostedCaches();
      const ctx = world({ GRILL_TOPUPS: "on", GRILL_TOPUP_PRICE_ID: PRICE, VERCEL_ENV: item.vercel, STRIPE_SECRET_KEY: item.key });
      const res = await handleAccount(accountRequest("POST", { body: "action=topup" }), ctx);
      assert.equal(res.status, 303, `${item.vercel} ${item.key}`);
      if (item.ready) {
        assert.equal(res.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup", `${item.vercel} ${item.key}`);
        assert.equal(ctx.stripe.calls.some((call) => call.url.endsWith("/v1/checkout/sessions")), true, `${item.vercel} ${item.key}`);
      } else {
        assert.match(res.headers.get("location"), /topup=unready/, `${item.vercel} ${item.key}`);
        assert.equal(ctx.stripe.calls.length, 0, `${item.vercel} ${item.key}`);
      }
    }
  });
});

describe("chat stops at the free allowance", () => {
  it("links to the account page, and a balance lets the grill run without using the service cap", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world({ GRILL_TOPUPS: "on" });
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
      const firstJson = await first.json();
      assert.equal(firstJson.result.isError, false, firstJson.result?.content?.[0]?.text || "");
      const month = isoMonth();
      const person = personSpendKey("tester@example.com", month);
      const service = serviceSpendKey(month);
      const serviceAfterFree = Number(await ctx.redis(["GET", service])) || 0;
      await ctx.redis(["SET", person, String(toMicros(5))]);
      resetHostedCaches();
      const before = fake.seen.chat.length;
      const blocked = await call(2, "Decision: a different shed colour.");
      const blockedText = (await blocked.json()).result.content[0].text;
      assert.equal(blockedText, userAllowanceUsedText("https://mcp.example"));
      assert.doesNotMatch(blockedText, /\$|Pro|subscription/i);
      assert.equal(fake.seen.chat.length, before);
      const budget = toMicros(topupBudgetUsd(ctx.env));
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "checks", "100"]);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "budget_micros", String(budget)]);
      await ctx.redis(["SET", service, String(toMicros(20))]);
      resetHostedCaches();
      const paid = await call(3, "Decision: keep the door blue.");
      const paidJson = await paid.json();
      assert.equal(paidJson.result.isError, false, paidJson.result?.content?.[0]?.text || "");
      assert.equal(Number(await ctx.redis(["HGET", topupBalanceKey("tester@example.com"), "checks"])), 99);
      assert.ok(Number(await ctx.redis(["HGET", topupBalanceKey("tester@example.com"), "budget_micros"])) < budget);
      assert.equal(Number(await ctx.redis(["GET", service])), toMicros(20), "prepaid spend does not add to the free service cap");
      assert.equal(Number(await ctx.redis(["GET", person])) > toMicros(5), true);
      assert.equal(serviceAfterFree > 0, true);
    } finally {
      await fake.close();
    }
  });

  it("keeps the old sentence, and ignores a balance, while top-ups are off", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
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
      await call(1, "Decision: Repaint the shed\nI'm 60% sure.");
      await ctx.redis(["SET", personSpendKey("tester@example.com", isoMonth()), String(toMicros(5))]);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "checks", "100"]);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "budget_micros", String(toMicros(3))]);
      resetHostedCaches();
      const blocked = await call(2, "Decision: a different shed colour.");
      assert.equal((await blocked.json()).result.content[0].text, USER_CAP_TEXT);
    } finally {
      await fake.close();
    }
  });
});
