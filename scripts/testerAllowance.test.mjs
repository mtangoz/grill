// Early testers in chat are free for life: $5 of use each month, reset on the 1st (UTC), on the
// router key and on the per-person monthly counter. The whole-service cap stays $20 a month.
// Made-up fixtures only.
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAccount, handleDecisions, handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import { CLAUDE_WEB_REDIRECT, TESTER_MONTHLY_USD, createMemoryRedis, monthlyCapUsd, userMonthlyCapUsd } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCE = "https://mcp.example/mcp";
const ALLOWANCE_LINE = "Free for life: $5 of use each month, resets on the 1st.";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}

function world() {
  const memory = createMemoryRedis();
  const router = { creates: [], patches: [], usage: 0.03 };
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
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: body.limit, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "PATCH") {
        router.patches.push(JSON.parse(init.body));
        return Response.json({ data: { hash: "hash_tester_1" } });
      }
      return Response.json({ data: { hash: "hash_tester_1", limit: 5, usage: 7, usage_monthly: router.usage, disabled: false } });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  const accounts = new Set();
  const redis = async (args) => {
    if (String(args[0]).toUpperCase() === "SET" && String(args[1]).startsWith("grill:hosted:acct:")) accounts.add(String(args[1]));
    return memory.command(args);
  };
  return { env, fetch: fetchImpl, redis, memory, router, accounts };
}

const cookie = () => `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_tester", exp: Math.floor(Date.now() / 1000) + 3600 })}`;

async function grillOnce(ctx, fake) {
  const token = signJwt({ iss: "https://clerk.example.test", sub: "user_tester", aud: RESOURCE, exp: Math.floor(Date.now() / 1000) + 3600, redirect_uri: CLAUDE_WEB_REDIRECT });
  const res = await handleMcp(
    new Request(RESOURCE, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: Repaint the shed\nI'm 60% sure.", keep_records: false, quality_check: false } } }),
    }),
    { ...ctx, judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL },
  );
  const json = await res.json();
  assert.equal(json.result.isError, false, json.result?.content?.[0]?.text || "");
}

describe("the early-tester monthly allowance", () => {
  it("is $5 a month per person, and the whole-service cap stays $20", () => {
    assert.equal(TESTER_MONTHLY_USD, 5);
    assert.equal(userMonthlyCapUsd({}), 5);
    assert.equal(monthlyCapUsd({}), 20);
  });

  it("mints a tester's router key at $5 with a monthly reset", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await grillOnce(ctx, fake);
      assert.equal(ctx.router.creates.length, 1);
      assert.equal(ctx.router.creates[0].limit, 5);
      assert.ok(ctx.router.patches.some((p) => p.limit_reset === "monthly"), "the key resets monthly");
    } finally {
      await fake.close();
    }
  });

  it("moves an existing one-off starter key to the $5 monthly allowance", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await grillOnce(ctx, fake);
      // Make the stored account look like one made before this change: a $1 key with no reset.
      for (const key of ctx.accounts) {
        const account = JSON.parse(await ctx.redis(["GET", key]));
        account.keyLimitUsd = 1;
        delete account.keyReset;
        await ctx.redis(["SET", key, JSON.stringify(account)]);
      }
      ctx.router.patches.length = 0;
      resetHostedCaches();
      await (await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), ctx)).text();
      assert.deepEqual(ctx.router.patches, [{ limit: 5, limit_reset: "monthly" }]);
      resetHostedCaches();
      await (await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), ctx)).text();
      assert.equal(ctx.router.patches.length, 1, "moved once, not on every visit");
    } finally {
      await fake.close();
    }
  });

  it("says free for life, $5 a month, resets on the 1st on /decisions and /account, from this month's use", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await grillOnce(ctx, fake);
      resetHostedCaches();
      const decisions = await (await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), ctx)).text();
      const account = await (await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: cookie() } }), ctx)).text();
      for (const html of [decisions, account]) {
        assert.ok(html.includes(ALLOWANCE_LINE), "the allowance line is shown");
        assert.match(html, /\$4\.97 left this month\./, "worked out from this month's use, not the lifetime total");
        assert.doesNotMatch(html, /grills of credit left/);
      }
    } finally {
      await fake.close();
    }
  });

  it("says in the terms that early testers get $5 a month, and no longer says only that credit does not refill", () => {
    const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");
    assert.match(terms, /Early testers/);
    assert.ok(terms.includes("free for life: $5 of use each month, resets on the 1st"));
    for (const sentence of terms.match(/[^.]*does not refill[^.]*\./g) || []) {
      assert.match(sentence, /starter key/, `"does not refill" names the website starter key only: ${sentence}`);
    }
  });
});
