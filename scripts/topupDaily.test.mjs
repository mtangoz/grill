// Prepaid balance uses the higher daily cap from proDailyLimit. Free accounts stay at 30.
// The chat sentence names no price and no plan. Made-up fixtures only.
import { createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_WEB_REDIRECT,
  DAILY_GRILL_LIMIT,
  createMemoryRedis,
  dailyCheckKey,
  isoDay,
  proDailyLimit,
  topupBalanceKey,
  toMicros,
} from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const RESOURCE = "https://mcp.example/mcp";
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
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: body.limit, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "PATCH") return Response.json({ data: { hash: "hash_tester_1" } });
      return Response.json({ data: { hash: "hash_tester_1", limit: 5, usage: 0.03, usage_monthly: 0.03, disabled: false } });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory };
}

async function accountId(ctx) {
  const scan = await ctx.redis(["SCAN", "0", "MATCH", "grill:hosted:acct:*", "COUNT", "100"]);
  const key = scan[1][0];
  return key ? JSON.parse(await ctx.redis(["GET", key])).id : "";
}

describe("prepaid balance and the daily cap", () => {
  it("uses proDailyLimit once the free 30 are done, and stays at 30 without a balance", async () => {
    assert.equal(DAILY_GRILL_LIMIT, 30);
    assert.equal(proDailyLimit({}), 100);
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world({ GRILL_TOPUPS: "on", GRILL_PRO_DAILY_LIMIT: "100" });
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
      const id = await accountId(ctx);
      const day = dailyCheckKey(id, isoDay());
      await ctx.redis(["SET", day, "30"]);
      resetHostedCaches();
      const before = fake.seen.chat.length;
      const blocked = await call(2, "Decision: a different shed colour.");
      const blockedText = (await blocked.json()).result.content[0].text;
      assert.match(blockedText, /today's daily limit of 30 checks/);
      assert.equal(fake.seen.chat.length, before);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "checks", "4"]);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "budget_micros", String(toMicros(1))]);
      resetHostedCaches();
      const allowed = await call(3, "Decision: keep the door blue.");
      const allowedJson = await allowed.json();
      assert.equal(allowedJson.result.isError, false, allowedJson.result?.content?.[0]?.text);
      await ctx.redis(["SET", day, "100"]);
      resetHostedCaches();
      const full = await call(4, "Decision: paint the frame white.");
      const fullText = (await full.json()).result.content[0].text;
      assert.match(fullText, /today's higher daily limit of 100 checks/);
      assert.doesNotMatch(fullText, /\$|\bPro\b|subscription|200 checks/i);
    } finally {
      await fake.close();
    }
  });

  it("ignores a balance while top-ups are off", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const token = signJwt({ iss: "https://clerk.example.test", sub: "user_daily_off", aud: RESOURCE, exp: Math.floor(Date.now() / 1000) + 3600, redirect_uri: CLAUDE_WEB_REDIRECT });
      const deps = { ...ctx, judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL };
      const opened = await handleMcp(
        new Request(RESOURCE, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: Repaint the shed\nI'm 60% sure.", keep_records: false, quality_check: false } } }),
        }),
        deps,
      );
      assert.equal((await opened.json()).result.isError, false);
      const id = await accountId(ctx);
      await ctx.redis(["SET", dailyCheckKey(id, isoDay()), "30"]);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "checks", "10"]);
      await ctx.redis(["HSET", topupBalanceKey("tester@example.com"), "budget_micros", String(toMicros(1))]);
      resetHostedCaches();
      const blocked = await handleMcp(
        new Request(RESOURCE, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: a different shed colour.", keep_records: false, quality_check: false } } }),
        }),
        deps,
      );
      assert.match((await blocked.json()).result.content[0].text, /today's daily limit of 30 checks/);
    } finally {
      await fake.close();
    }
  });
});
