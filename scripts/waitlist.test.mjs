// Waitlist for someone without an invite code. Email and ?ref= only, confirmed by a second
// POST, stored in the existing Redis. No email is sent. Approval mints a single-use code
// and does not let them in until they redeem it. Made-up addresses only.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleDecisions, handleRedeem, resetHostedCaches } from "../api/_hosted.mjs";
import { WAITLIST_SIGNUPS, approveWaitlist, handleWaitlist, readWaitlist } from "../api/_waitlist.mjs";
import { createMemoryRedis, openSignup } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey).toString("base64url");
  return `${header}.${body}.${sig}`;
}

function hash(text) {
  return createHash("sha256").update(text).digest("hex");
}

function world() {
  const memory = createMemoryRedis();
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
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      return Response.json({
        id: "user_friend",
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "friend@example.com", verification: { status: "verified" } }],
        external_accounts: [],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && method === "POST") {
      return Response.json({ key: "sk-or-v1-made-up-friend-key-0001", data: { hash: "hash_friend_1", limit: 5, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/") && method === "PATCH") {
      return Response.json({ data: { hash: "hash_friend_1" } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      return Response.json({ data: { hash: "hash_friend_1", limit: 5, usage: 0, usage_monthly: 0, disabled: false } });
    }
    if (u.includes("resend") || u.startsWith("mailto:")) throw new Error(`email was sent: ${u}`);
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
  const redis = async (args) => memory.command(args);
  return { env, fetch: fetchImpl, redis, memory };
}

function post(ctx, fields, cookie = "") {
  const headers = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers.cookie = cookie;
  return handleWaitlist(
    new Request("https://grillyour.ai/waitlist", { method: "POST", headers, body: new URLSearchParams(fields).toString() }),
    ctx,
  );
}

describe("waitlist", () => {
  it("confirms on the server, stores only the email and ref, and sends no email", async () => {
    const ctx = world();
    const preview = await post(ctx, { email: "Friend@Example.com" }, "grill_ref=askgrill");
    assert.equal(preview.status, 200);
    const previewHtml = await preview.text();
    assert.match(previewHtml, /Join the waitlist\?/);
    assert.match(previewHtml, /friend@example\.com/);
    assert.match(previewHtml, /askgrill/);
    assert.equal(previewHtml.includes("<script"), false);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:waitlist:${hash("friend@example.com")}`]), null);
    assert.equal(ctx.memory.command(["GET", WAITLIST_SIGNUPS]), null);

    const saved = await post(ctx, { email: "friend@example.com", ref: "askgrill", confirm: "join" });
    assert.equal(saved.status, 303);
    assert.equal(saved.headers.get("location"), "https://grillyour.ai/waitlist?done=1");
    const row = JSON.parse(ctx.memory.command(["GET", `grill:hosted:waitlist:${hash("friend@example.com")}`]));
    assert.deepEqual({ email: row.email, ref: row.ref }, { email: "friend@example.com", ref: "askgrill" });
    assert.equal(row.codeHash, undefined);
    assert.equal(ctx.memory.command(["GET", WAITLIST_SIGNUPS]), "1");
    const again = await post(ctx, { email: "friend@example.com", confirm: "join" });
    assert.equal(again.status, 303);
    assert.equal(ctx.memory.command(["GET", WAITLIST_SIGNUPS]), "1");

    const thanks = await handleWaitlist(new Request("https://grillyour.ai/waitlist?done=1"), ctx);
    const thanksHtml = await thanks.text();
    assert.match(thanksHtml, /You're on the list/);
    assert.match(thanksHtml, /free option right away in your own AI chat/);
    assert.match(thanksHtml, /via the connector/);
    assert.match(thanksHtml, /<a href="\/start">here<\/a>/);
    assert.equal(thanksHtml.includes("<script"), false);
    const listed = await readWaitlist((args) => ctx.memory.command(args));
    assert.equal(listed.length, 1);
    assert.equal(listed[0].email, "friend@example.com");
  });

  it("does not let anyone in, and approval is a single-use code they still have to redeem", async () => {
    resetHostedCaches();
    const ctx = world();
    assert.equal(openSignup(ctx.env), false);
    await post(ctx, { email: "friend@example.com", ref: "askgrill", confirm: "join" });
    const cookie = `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_friend", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
    const wall = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie } }), ctx);
    const wallHtml = await wall.text();
    assert.match(wallHtml, /invite-only/);
    assert.match(wallHtml, /action="\/waitlist"/);
    assert.match(wallHtml, /href="\/redeem"/);
    assert.equal(wallHtml.includes("<script"), false);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:invite:grant:${hash("friend@example.com")}`]), null);

    const approved = await approveWaitlist((args) => ctx.memory.command(args), "friend@example.com");
    assert.equal(approved.ok, true);
    assert.equal(approved.number, 1);
    assert.match(approved.code, /^lead-[a-f0-9]+$/);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:invite:grant:${hash("friend@example.com")}`]), null);
    const second = await approveWaitlist((args) => ctx.memory.command(args), "friend@example.com");
    assert.equal(second.already, true);
    assert.equal(second.number, 1);
    assert.equal(second.code, undefined);
    assert.equal(ctx.memory.command(["GET", "grill:hosted:founding:count"]), "1");

    const stillOut = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie } }), ctx);
    assert.match(await stillOut.text(), /invite-only/);

    const redeem = await handleRedeem(
      new Request("https://grillyour.ai/redeem", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: `code=${approved.code}&confirm=redeem`,
      }),
      ctx,
    );
    assert.equal(redeem.status, 303);
    const inNow = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie } }), ctx);
    const inHtml = await inNow.text();
    assert.match(inHtml, /Your decisions/);
    assert.equal(inHtml.includes("invite-only"), false);
  });

  it("the start page offers the form with no script, and a missing store saves nothing", async () => {
    const start = readFileSync(join(ROOT, "site/start.html"), "utf8");
    assert.match(start, /action="\/waitlist"/);
    assert.match(start, /No invite code\?/);
    assert.equal(start.includes("<script"), false);
    assert.equal(/<button/i.test(start), false);
    const closed = await handleWaitlist(new Request("https://grillyour.ai/waitlist", { method: "POST", body: "email=friend@example.com&confirm=join" }), {
      env: {},
      fetch: async () => {
        throw new Error("no store");
      },
    });
    const closedHtml = await closed.text();
    assert.match(closedHtml, /isn't open/);
    assert.match(closedHtml, /Nothing was saved/);
  });
});
