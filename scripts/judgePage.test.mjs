// /judge: a signed-in page that prefills a decision and runs a hosted grill only on POST.
// node --test scripts/judgePage.test.mjs
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { esc } from "../api/_pro.mjs";
import { handleJudge, resetHostedCaches } from "../api/_hosted.mjs";
import { JUDGE_PACKET_MAX, USER_CAP_TEXT, createMemoryRedis, isoMonth } from "./hostedCore.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key";
jwk.alg = "RS256";
jwk.use = "sig";

const FEB = Date.parse("2026-02-01T15:00:00Z");
const PACKET = "Decision: Keep the maple stand on Pine Street.\nI'm 60% sure. The other option is to close it in November.";

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${sig}`;
}

function session() {
  return signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
}

function world() {
  const memory = createMemoryRedis();
  const env = {
    GRILL_HOSTED: "on",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-do-not-leak-9999",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: "invitee@example.com",
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
        email_addresses: [{ id: "idn_1", email_address: "invitee@example.com", verification: { status: "verified" } }],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && init.method === "POST") {
      return Response.json({ key: "sk-or-v1-hosted-user-key-never-shown-0001", data: { hash: "hash_hosted_1", limit: 1, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      return Response.json({ data: { hash: "hash_hosted_1", limit: 1, usage: 0, usage_monthly: 0, disabled: false } });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: async (args) => memory.command(args), memory };
}

function cookieHeader() {
  return `__session=${session()}`;
}

function judgeDeps(fake, extra = {}) {
  return {
    judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL,
    judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL,
    waitMs: 20_000,
    now: FEB,
    ...extra,
  };
}

async function open(ctx, fake, path, { method = "GET", body, cookie = cookieHeader() } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body != null) headers["content-type"] = "application/x-www-form-urlencoded";
  const res = await handleJudge(new Request(`https://grillyour.ai${path}`, { method, headers, body }), { ...ctx, ...judgeDeps(fake) });
  return { res, html: await res.text() };
}

describe("the /judge page", { concurrency: false }, () => {
  it("shows a prefilled form and does not grill on GET", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const { res, html } = await open(ctx, fake, `/judge?q=${encodeURIComponent(PACKET)}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.match(html, /<form method="post" action="\/judge">/);
      assert.match(html, /name="q"/);
      assert.ok(html.includes("Keep the maple stand on Pine Street."));
      assert.match(html, /Keep a record of your decisions on your Grill account\?/);
      assert.match(html, /name="keep" value="yes"/);
      assert.match(html, /name="keep" value="no"/);
      assert.equal(html.includes(">Grill this</button>"), false);
      assert.equal(html.includes('id="verdict"'), false);
      assert.equal(html.includes("<script"), false);
      assert.equal(fake.seen.chat.length, 0);
      assert.equal(fake.seen.decisions.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("escapes the packet and accepts 4000 characters", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const marked = `Keep the <stand> & "quote". ${"a".repeat(JUDGE_PACKET_MAX - 28)}`;
      assert.equal([...marked].length, JUDGE_PACKET_MAX);
      const { html } = await open(ctx, fake, `/judge?q=${encodeURIComponent(marked)}`);
      assert.equal(html.includes("<stand>"), false);
      assert.ok(html.includes("&lt;stand&gt;"));
      assert.ok(html.includes("&amp;"));
      assert.equal(html.includes("<script"), false);
      assert.equal(fake.seen.chat.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("refuses a packet over 4000 characters and does not echo it", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const marker = "MAPLE-TOO-LONG";
      const huge = marker + "x".repeat(JUDGE_PACKET_MAX);
      assert.ok(huge.length > JUDGE_PACKET_MAX);
      const { html } = await open(ctx, fake, `/judge?q=${encodeURIComponent(huge)}`);
      assert.match(html, new RegExp(String(JUDGE_PACKET_MAX)));
      assert.equal(html.includes(marker), false);
      assert.equal(html.includes('id="verdict"'), false);
      assert.equal(fake.seen.chat.length, 0);
      const posted = await open(ctx, fake, "/judge", { method: "POST", body: new URLSearchParams({ q: huge, keep: "no" }).toString() });
      assert.equal(posted.html.includes(marker), false);
      assert.equal(posted.html.includes('id="verdict"'), false);
      assert.equal(fake.seen.chat.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("asks before the first send, then grills on the answer and not before", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const early = await open(ctx, fake, "/judge", {
        method: "POST",
        body: new URLSearchParams({ q: PACKET }).toString(),
      });
      assert.equal(early.res.status, 200);
      assert.match(early.html, /Keep a record of your decisions on your Grill account\?/);
      assert.equal(early.html.includes('id="verdict"'), false);
      assert.doesNotMatch(early.html, /call grill again/);
      assert.equal(early.html.includes("<script"), false);
      assert.equal(fake.seen.chat.length, 0);

      const grilled = await open(ctx, fake, "/judge", {
        method: "POST",
        body: new URLSearchParams({ q: PACKET, keep: "no" }).toString(),
      });
      assert.equal(grilled.res.status, 200);
      assert.match(grilled.html, /id="verdict"/);
      assert.match(grilled.html, /Say &#39;more&#39;, &#39;options&#39;, or your call\./);
      assert.match(grilled.html, /This goes to an outside judge from a different company/);
      assert.equal(grilled.html.includes("follow:"), false);
      assert.equal(grilled.html.includes("<script"), false);
      assert.match(grilled.html, />Grill this<\/button>/);
      assert.equal(grilled.html.includes('name="keep"'), false);
      const body = fake.seen.chat.at(-1).body;
      assert.equal(body.model, "openrouter/auto");
      assert.equal(body.models, undefined);
      assert.deepEqual(body.plugins[0].excluded_models, []);
      assert.ok(JSON.stringify(body).includes("maple stand on Pine Street"));
      const spent = Number(await ctx.memory.command(["GET", `grill:hosted:capspend:all:${isoMonth(FEB)}`])) || 0;
      assert.ok(spent > 0, "the hosted spend counter moved");

      const again = await open(ctx, fake, "/judge", {
        method: "POST",
        body: new URLSearchParams({ q: PACKET }).toString(),
      });
      assert.match(again.html, /id="verdict"/);
      assert.equal(again.html.includes('name="keep"'), false);
      assert.doesNotMatch(again.html, /This goes to an outside judge from a different company/);
      assert.equal(fake.seen.chat.length >= 2, true);
    } finally {
      await fake.close();
    }
  });

  it("stops at the per-person cap before any judge call", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      ctx.env.GRILL_USER_MONTHLY_CAP_USD = "0";
      const { html } = await open(ctx, fake, "/judge", {
        method: "POST",
        body: new URLSearchParams({ q: PACKET, keep: "no" }).toString(),
      });
      assert.ok(html.includes(esc(USER_CAP_TEXT)));
      assert.equal(fake.seen.chat.length, 0);
      assert.equal(fake.seen.decisions.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("sends a signed-out visitor through sign-in and back to this decision", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      ctx.env.CLERK_ISSUER = "https://clerk.grillyour.ai";
      const { res } = await open(ctx, fake, `/judge?q=${encodeURIComponent(PACKET)}`, { cookie: "" });
      assert.equal(res.status, 302);
      const loc = new URL(res.headers.get("location"));
      assert.equal(loc.origin, "https://accounts.grillyour.ai");
      assert.equal(loc.pathname, "/sign-in");
      const back = new URL(loc.searchParams.get("redirect_url"));
      assert.equal(back.pathname, "/judge");
      assert.equal(back.searchParams.get("q"), PACKET);
      assert.equal(back.searchParams.get("from"), "signin");
      assert.equal(fake.seen.chat.length, 0);

      const dropped = await open(ctx, fake, `/judge?q=${encodeURIComponent("Z".repeat(JUDGE_PACKET_MAX + 1))}`, { cookie: "" });
      const droppedBack = new URL(new URL(dropped.res.headers.get("location")).searchParams.get("redirect_url"));
      assert.equal(droppedBack.searchParams.get("q"), null);
      assert.equal(droppedBack.searchParams.get("over"), "1");
      assert.equal(dropped.res.headers.get("location").includes("ZZZZ"), false);
    } finally {
      await fake.close();
    }
  });

  it("does not apply a form posted with no session", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const { res } = await open(ctx, fake, `/judge?q=${encodeURIComponent("Keep the maple stand.")}`, {
        method: "POST",
        cookie: "",
        body: new URLSearchParams({ q: PACKET, keep: "no" }).toString(),
      });
      assert.equal(res.status, 303);
      const loc = new URL(res.headers.get("location"));
      assert.equal(loc.pathname, "/judge");
      assert.equal(loc.searchParams.get("q"), "Keep the maple stand.");
      assert.equal(fake.seen.chat.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("sends someone who is not invited to the redeem page and does not grill", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      ctx.env.GRILL_HOSTED_ALLOWLIST = "someone-else@example.com";
      const { res, html } = await open(ctx, fake, `/judge?q=${encodeURIComponent(PACKET)}`);
      assert.equal(res.status, 200);
      assert.match(html, /invite-only/);
      assert.match(html, /href="\/redeem"/);
      assert.equal(html.includes("<script"), false);
      assert.equal(html.includes("maple stand"), false);
      assert.equal(fake.seen.chat.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("stays dark until hosted Grill is on, and refuses DELETE", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      ctx.env.GRILL_HOSTED = "off";
      const off = await open(ctx, fake, `/judge?q=${encodeURIComponent(PACKET)}`);
      assert.equal(off.res.status, 404);
      ctx.env.GRILL_HOSTED = "on";
      const removed = await open(ctx, fake, "/judge", { method: "DELETE" });
      assert.equal(removed.res.status, 405);
      assert.equal(fake.seen.chat.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("routes /judge through the hosted function, and the markdown routes leave it alone", async () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.ok(config.rewrites.some((rule) => rule.source === "/judge" && rule.destination === "/api/hosted?__route=judge"));
    for (const route of config.routes) {
      if (typeof route.src === "string" && route.src.includes("account")) assert.match(route.src, /judge/);
    }
    const saved = { hosted: process.env.GRILL_HOSTED, issuer: process.env.CLERK_ISSUER, fetch: globalThis.fetch };
    process.env.GRILL_HOSTED = "on";
    process.env.CLERK_ISSUER = "https://clerk.grillyour.ai";
    globalThis.fetch = async () => {
      throw new Error("sign-in redirect does not fetch");
    };
    try {
      const { GET } = await import("../api/hosted.js");
      const res = await GET(new Request(`https://grillyour.ai/api/hosted?__route=judge&q=${encodeURIComponent("Keep the maple stand.")}`));
      assert.equal(res.status, 302);
      const back = new URL(new URL(res.headers.get("location")).searchParams.get("redirect_url"));
      assert.equal(back.pathname, "/judge");
      assert.equal(back.searchParams.get("q"), "Keep the maple stand.");
      assert.equal(back.searchParams.get("from"), "signin");
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.hosted === undefined) delete process.env.GRILL_HOSTED;
      else process.env.GRILL_HOSTED = saved.hosted;
      if (saved.issuer === undefined) delete process.env.CLERK_ISSUER;
      else process.env.CLERK_ISSUER = saved.issuer;
    }
  });
});
