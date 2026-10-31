// Shareable invite codes for hosted Grill. A signed-in person who is not on the allowlist
// redeems a code on a plain page (a form, then a confirm page, no script). A valid code grants
// early-tester access: free, the existing $5 a month per person, and the $20 service cap stays.
// Codes come from GRILL_INVITE_CODES. Unset, the feature is off. Made-up fixtures only.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleDecisions, handleMcp, handleRedeem, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_WEB_REDIRECT,
  TESTER_MONTHLY_USD,
  createMemoryRedis,
  inviteCodesEnabled,
  inviteOnlyText,
  monthlyCapUsd,
  parseInviteCodes,
  userMonthlyCapUsd,
} from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCE = "https://mcp.example/mcp";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

const EMAILS = {
  user_friend: "friend@example.com",
  user_second: "second@example.com",
  user_third: "third@example.com",
  user_owner: "owner@example.com",
  user_fourth: "fourth@example.com",
  user_agent: "agent.one@inbox.example",
};

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}

function cookie(sub = "user_friend") {
  return `__session=${signJwt({ iss: "https://clerk.example.test", sub, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function grantKey(email) {
  return `grill:hosted:invite:grant:${hash(email)}`;
}

function usesKey(code) {
  return `grill:hosted:invite:uses:${hash(code)}`;
}

function world({ codes } = {}) {
  const memory = createMemoryRedis();
  const router = { creates: [], patches: [] };
  const env = {
    GRILL_HOSTED: "on",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-made-up-0000",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: "owner@example.com",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
  };
  if (codes !== undefined) env.GRILL_INVITE_CODES = codes;
  const writes = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.includes("/oauth_access_tokens/oauth_agentid")) {
      return Response.json({
        data: [{ token: "tok_made_up_agent", provider: "oauth_agentid", scopes: ["openid", "email", "profile", "owner_email"] }],
        total_count: 1,
      });
    }
    if (u === "https://auth.agentid.com/v0/userinfo") {
      return Response.json({ owner_email: "friend@example.com", owner_email_verified: true });
    }
    if (u.startsWith("https://api.clerk.com/v1/users/") && method === "GET") {
      const id = decodeURIComponent(u.split("/").pop());
      const email = EMAILS[id] || "friend@example.com";
      const agent = id === "user_agent";
      return Response.json({
        id,
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: email, verification: { status: "verified" } }],
        external_accounts: agent ? [{ provider: "oauth_agentid", verification: { strategy: "oauth_agentid", status: "verified" } }] : [],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && method === "POST") {
      const body = JSON.parse(init.body);
      router.creates.push(body);
      return Response.json({ key: "sk-or-v1-made-up-friend-key-0001", data: { hash: "hash_friend_1", limit: body.limit, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/") && method === "PATCH") {
      router.patches.push(JSON.parse(init.body));
      return Response.json({ data: { hash: "hash_friend_1" } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      return Response.json({ data: { hash: "hash_friend_1", limit: 5, usage: 0, usage_monthly: 0, disabled: false } });
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  const redis = async (args) => {
    writes.push(args.map((part) => String(part)));
    return memory.command(args);
  };
  return { env, fetch: fetchImpl, redis, memory, router, writes };
}

function mutations(ctx) {
  return ctx.writes.filter((row) => ["SET", "INCR", "INCRBY", "DEL"].includes(row[0]));
}

async function redeem(ctx, { method = "GET", body = "", sub = "user_friend", cookieHeader = cookie(sub) } = {}) {
  const headers = {};
  if (cookieHeader) headers.cookie = cookieHeader;
  if (body) headers["content-type"] = "application/x-www-form-urlencoded";
  return handleRedeem(
    new Request("https://grillyour.ai/redeem", { method, headers, body: body || undefined }),
    ctx,
  );
}

async function page(ctx, sub, body) {
  const res = await redeem(ctx, { method: body ? "POST" : "GET", body, sub });
  if (res.status === 303) {
    const next = await handleRedeem(new Request(res.headers.get("location"), { headers: { cookie: cookie(sub) } }), ctx);
    return { res, status: res.status, location: res.headers.get("location"), html: await next.text() };
  }
  return { res, status: res.status, location: res.headers.get("location") || "", html: await res.text() };
}

async function mcpText(ctx, fake, sub) {
  const token = signJwt({
    iss: "https://clerk.example.test",
    sub,
    aud: RESOURCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    redirect_uri: CLAUDE_WEB_REDIRECT,
  });
  const deps = fake ? { judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL } : {};
  const res = await handleMcp(
    new Request(RESOURCE, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "grill", arguments: { subject: "Decision: Repaint the shed\nI'm 60% sure.", keep_records: false, quality_check: false } },
      }),
    }),
    { ...ctx, ...deps },
  );
  const json = await res.json();
  return { json, text: json.result?.content?.[0]?.text || "" };
}

describe("invite codes", { concurrency: false }, () => {
  it("reads comma-separated codes with an optional max, and is off when unset", () => {
    assert.deepEqual(parseInviteCodes({}), []);
    assert.deepEqual(parseInviteCodes({ GRILL_INVITE_CODES: "   " }), []);
    assert.equal(inviteCodesEnabled({}), false);
    assert.equal(inviteCodesEnabled({ GRILL_INVITE_CODES: "" }), false);
    assert.equal(inviteCodesEnabled({ GRILL_INVITE_CODES: "friend-code" }), true);
    const tooLong = "a".repeat(81);
    assert.deepEqual(
      parseInviteCodes({
        GRILL_INVITE_CODES: ` Alpha , beta:2 , beta:9 , , gamma:0 , delta:x , :3 , epsilon:03 , ${tooLong} , code:-1 , big:1000001 , my code `,
      }),
      [
        { code: "alpha", max: null },
        { code: "beta", max: 2 },
        { code: "gamma", max: 0 },
        { code: "epsilon", max: 3 },
        { code: "my code", max: null },
      ],
    );
    assert.equal(monthlyCapUsd({}), 20);
    assert.equal(userMonthlyCapUsd({}), TESTER_MONTHLY_USD);
    assert.match(inviteOnlyText("https://preview.example"), /^Grill in chat is invite-only for now/);
    assert.match(inviteOnlyText("https://preview.example"), /https:\/\/preview\.example\/redeem/);
    assert.match(inviteOnlyText(""), /enter it at \/redeem/);
  });

  it("sends a signed-out visitor to sign-in, and answers 404 when hosted mode is off", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "friend-code" });
    const signedOut = await redeem(ctx, { cookieHeader: "" });
    assert.equal(signedOut.status, 302);
    const loc = new URL(signedOut.headers.get("location"));
    assert.equal(loc.origin, "https://accounts.example.test");
    assert.equal(loc.pathname, "/sign-in");
    assert.equal(loc.searchParams.get("redirect_url"), "https://grillyour.ai/redeem?from=signin");
    assert.equal(mutations(ctx).length, 0);
    ctx.env.GRILL_HOSTED = "off";
    const off = await redeem(ctx);
    assert.equal(off.status, 404);
  });

  it("routes /redeem through the hosted function", async () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.ok(config.rewrites.some((rule) => rule.source === "/redeem" && rule.destination === "/api/hosted?__route=redeem"));
    for (const route of config.routes) {
      if (typeof route.src === "string" && route.src.includes("account")) assert.match(route.src, /redeem/);
    }
    const saved = { hosted: process.env.GRILL_HOSTED, issuer: process.env.CLERK_ISSUER, fetch: globalThis.fetch };
    process.env.GRILL_HOSTED = "on";
    process.env.CLERK_ISSUER = "https://clerk.example.test";
    globalThis.fetch = async () => {
      throw new Error("sign-in redirect does not fetch");
    };
    try {
      const { GET } = await import("../api/hosted.js");
      const res = await GET(new Request("https://grillyour.ai/api/hosted?__route=redeem"));
      assert.equal(res.status, 302);
      assert.equal(new URL(res.headers.get("location")).searchParams.get("redirect_url"), "https://grillyour.ai/redeem?from=signin");
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.hosted === undefined) delete process.env.GRILL_HOSTED;
      else process.env.GRILL_HOSTED = saved.hosted;
      if (saved.issuer === undefined) delete process.env.CLERK_ISSUER;
      else process.env.CLERK_ISSUER = saved.issuer;
    }
  });

  it("is off when GRILL_INVITE_CODES is unset: no form, and a post grants nothing", async () => {
    resetHostedCaches();
    const ctx = world();
    const shown = await page(ctx, "user_friend");
    assert.equal(shown.status, 200);
    assert.match(shown.html, /Invite codes aren't on/);
    assert.equal(shown.html.includes("<form"), false);
    assert.equal(shown.html.includes("<script"), false);
    assert.match(shown.html, /href="\/">Back to Grill/);
    assert.doesNotMatch(shown.html, /GRILL_|Clerk|CLERK_|Upstash/);
    const posted = await page(ctx, "user_friend", "code=friend-code&confirm=redeem");
    assert.equal(posted.html.includes("<form"), false);
    assert.equal(ctx.memory.command(["GET", grantKey("friend@example.com")]), null);
    assert.equal(mutations(ctx).filter((row) => row[0] !== "GET").length, 0);
  });

  it("asks on a confirm page before a code is used, with no script", async () => {
    resetHostedCaches();
    const code = `a<b&c">d`;
    const ctx = world({ codes: code });
    const before = mutations(ctx).length;
    const shown = await page(ctx, "user_friend", `code=${encodeURIComponent(code)}`);
    assert.equal(shown.status, 200);
    assert.match(shown.html, /Use this invite code\?/);
    assert.match(shown.html, /name="confirm" value="redeem"/);
    assert.match(shown.html, /a&lt;b&amp;c&quot;&gt;d/);
    assert.equal(shown.html.includes("<script"), false);
    assert.equal(shown.html.includes("<b&"), false);
    assert.match(shown.html, /<form method="post" action="\/redeem">/);
    assert.match(shown.html, /min-height:\s*44px/);
    assert.match(shown.html, /free, \$5 of use each month/i);
    assert.doesNotMatch(shown.html, /GRILL_|Clerk|CLERK_|Upstash/);
    assert.equal(mutations(ctx).length, before);
    assert.equal(ctx.memory.command(["GET", grantKey("friend@example.com")]), null);
  });

  it("grants early-tester access only after confirm, and a second confirm does not use the code again", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "Friend-Code" });
    const bad = await page(ctx, "user_friend", "code=nope&confirm=redeem");
    assert.match(bad.html, /That code didn't work/);
    assert.equal(ctx.memory.command(["GET", grantKey("friend@example.com")]), null);

    const done = await page(ctx, "user_friend", "code=friend-code&confirm=redeem");
    assert.equal(done.status, 303);
    assert.equal(done.location, "https://grillyour.ai/redeem?done=1");
    assert.equal(done.location.includes("friend-code"), false);
    assert.match(done.html, /You're in/);
    assert.match(done.html, /Free for life: \$5 of use each month/);
    assert.match(done.html, /href="\/decisions"/);
    assert.equal(done.html.includes("<script"), false);
    assert.equal(ctx.memory.command(["GET", grantKey("friend@example.com")]), hash("friend-code"));
    assert.equal(ctx.memory.command(["GET", usesKey("friend-code")]), "1");
    assert.equal(JSON.stringify(ctx.writes).includes("friend-code"), false);
    assert.equal(JSON.stringify(ctx.writes).includes("friend@example.com"), false);

    const again = await page(ctx, "user_friend", "code=friend-code&confirm=redeem");
    assert.equal(again.status, 303);
    assert.equal(ctx.memory.command(["GET", usesKey("friend-code")]), "1");

    resetHostedCaches();
    const decisions = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), ctx);
    const html = await decisions.text();
    assert.match(html, /Your decisions/);
    assert.match(html, /Free for life: \$5 of use each month/);
    assert.equal(ctx.router.creates[0].limit, 5);
    assert.ok(ctx.router.patches.some((row) => row.limit_reset === "monthly"));
  });

  it("stops at the max, leaves an unlimited code open, and ignores a code of zero", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "once:1, open, none:0" });
    const first = await page(ctx, "user_friend", "code=once&confirm=redeem");
    assert.equal(first.status, 303);
    const second = await page(ctx, "user_second", "code=once&confirm=redeem");
    assert.match(second.html, /used up/);
    assert.equal(ctx.memory.command(["GET", usesKey("once")]), "1");
    assert.equal(ctx.memory.command(["GET", grantKey("second@example.com")]), null);

    const [a, b] = await Promise.all([
      redeem(ctx, { method: "POST", sub: "user_second", body: "code=open&confirm=redeem" }),
      redeem(ctx, { method: "POST", sub: "user_third", body: "code=open&confirm=redeem" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [303, 303]);
    assert.equal(ctx.memory.command(["GET", usesKey("open")]), "2");

    const zero = await page(ctx, "user_fourth", "code=none&confirm=redeem");
    assert.match(zero.html, /used up/);
    assert.equal(ctx.memory.command(["GET", usesKey("none")]), null);
    assert.equal(ctx.memory.command(["GET", grantKey("fourth@example.com")]), null);
  });

  it("does not let one code be used twice when two confirms race", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "once:1" });
    const [a, b] = await Promise.all([
      redeem(ctx, { method: "POST", sub: "user_friend", body: "code=once&confirm=redeem" }),
      redeem(ctx, { method: "POST", sub: "user_second", body: "code=once&confirm=redeem" }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 303]);
    assert.equal(ctx.memory.command(["GET", usesKey("once")]), "1");
    const grants = ["friend@example.com", "second@example.com"].filter((email) => ctx.memory.command(["GET", grantKey(email)]));
    assert.equal(grants.length, 1);
  });

  it("does not spend a code for someone who already has access", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "friend-code:1" });
    const shown = await page(ctx, "user_owner");
    assert.match(shown.html, /You're in/);
    assert.equal(shown.html.includes("<form"), false);
    const posted = await page(ctx, "user_owner", "code=friend-code&confirm=redeem");
    assert.equal(posted.status, 303);
    assert.equal(ctx.memory.command(["GET", usesKey("friend-code")]), null);
  });

  it("admits a redeemed email, and stops when the code list is unset or that code is removed", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "friend-code" });
    assert.match((await mcpText(ctx, null, "user_friend")).text, /https:\/\/mcp\.example\/redeem/);
    await page(ctx, "user_friend", "code=friend-code&confirm=redeem");
    resetHostedCaches();
    const open = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), ctx);
    assert.match(await open.text(), /Your decisions/);

    ctx.env.GRILL_INVITE_CODES = "other-code";
    resetHostedCaches();
    const removed = await mcpText(ctx, null, "user_friend");
    assert.match(removed.text, /invite-only/);
    assert.match(removed.text, /https:\/\/mcp\.example\/redeem/);
    assert.equal(removed.json.result.isError, true);

    ctx.env.GRILL_INVITE_CODES = "friend-code";
    resetHostedCaches();
    delete ctx.env.GRILL_INVITE_CODES;
    const off = await mcpText(ctx, null, "user_friend");
    assert.match(off.text, /invite-only/);
    assert.equal(off.json.result.isError, true);
  });

  it("points the invite-only page at the redeem page", async () => {
    resetHostedCaches();
    const ctx = world({ codes: "friend-code" });
    const invite = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), ctx);
    const html = await invite.text();
    assert.match(html, /invite-only/);
    assert.match(html, /href="\/redeem"/);
    assert.match(html, /href="\/">Back to Grill/);
    assert.equal(html.includes("<script"), false);
    assert.doesNotMatch(html, /GRILL_|Clerk|CLERK_/);
    const start = readFileSync(join(ROOT, "site/start.html"), "utf8");
    assert.match(start, /invite-only for now/);
    assert.match(start, /href="\/redeem"/);
  });

  it("keeps the $5 and $20 caps for someone who redeemed a code", async () => {
    assert.equal(userMonthlyCapUsd({}), 5);
    assert.equal(monthlyCapUsd({}), 20);
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world({ codes: "friend-code" });
      await page(ctx, "user_friend", "code=friend-code&confirm=redeem");
      const first = await mcpText(ctx, fake, "user_friend");
      assert.equal(first.json.result.isError, false, first.text);
      assert.equal(ctx.router.creates[0].limit, 5);
      const month = new Date().toISOString().slice(0, 7);
      const all = Number(ctx.memory.command(["GET", `grill:hosted:capspend:all:${month}`]));
      const person = Number(ctx.memory.command(["GET", `grill:hosted:capspend:person:${hash("friend@example.com")}:${month}`]));
      assert.ok(all > 0 && all < 20_000_000, `service spend ${all}`);
      assert.ok(person > 0 && person < 5_000_000, `person spend ${person}`);

      ctx.memory.command(["SET", `grill:hosted:capspend:person:${hash("friend@example.com")}:${month}`, "5000000"]);
      const userCap = await mcpText(ctx, fake, "user_friend");
      assert.match(userCap.text, /this month's free grills/);
      assert.match(userCap.text, /Nothing was charged to you/);

      ctx.memory.command(["SET", `grill:hosted:capspend:person:${hash("friend@example.com")}:${month}`, "0"]);
      ctx.memory.command(["SET", `grill:hosted:capspend:all:${month}`, "20000000"]);
      const serviceCap = await mcpText(ctx, fake, "user_friend");
      assert.match(serviceCap.text, /this month's free grills for everyone/);
      assert.match(serviceCap.text, /Nothing was charged to you/);
    } finally {
      await fake.close();
    }
  });

  it("lets an agent in when the owner's email redeemed a code", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world({ codes: "friend-code" });
      await page(ctx, "user_friend", "code=friend-code&confirm=redeem");
      resetHostedCaches();
      const text = (await mcpText(ctx, fake, "user_agent")).text;
      assert.equal(text.includes("invite-only"), false, text);
      assert.doesNotMatch(text, /isError|error code/i);
    } finally {
      await fake.close();
    }
  });

  it("documents the env var, the redeem page, and what is stored", () => {
    const hosted = readFileSync(join(ROOT, "docs/HOSTED.md"), "utf8");
    assert.match(hosted, /GRILL_INVITE_CODES/);
    assert.match(hosted, /\/redeem/);
    const ledger = readFileSync(join(ROOT, "docs/DATA-LEDGER.md"), "utf8");
    assert.match(ledger, /Invite-code redemption/);
    assert.match(ledger, /one-way hash of the code/);
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /invite code/i);
    const ux = readFileSync(join(ROOT, "docs/UX.md"), "utf8");
    assert.match(ux, /\/redeem/);
    assert.match(ux, /confirm page/);
  });
});
