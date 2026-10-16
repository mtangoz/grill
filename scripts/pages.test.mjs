// Contract for the pages a person sees. No browser: these assert on the HTML the handlers return.
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, handleCalendar, handleDecisions, handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import { CLAUDE_WEB_REDIRECT, createMemoryRedis } from "./hostedCore.mjs";

const RESOURCE = "https://mcp.example/mcp";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key";
jwk.alg = "RS256";
jwk.use = "sig";

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

function cookieHeader(extra = "") {
  return extra ? `__session=${session()}; ${extra}` : `__session=${session()}`;
}

async function getPage(ctx, path, { now, cookie = cookieHeader() } = {}) {
  const res = await handleDecisions(new Request(`https://grillyour.ai${path}`, { headers: { cookie } }), { ...ctx, now });
  return { res, html: await res.text() };
}

async function postForm(ctx, body, now) {
  return handleDecisions(
    new Request("https://grillyour.ai/decisions", {
      method: "POST",
      headers: { cookie: cookieHeader(), "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    { ...ctx, now },
  );
}

const JAN = Date.parse("2026-01-01T15:00:00Z");
const FEB = Date.parse("2026-02-01T15:00:00Z");

async function decide(ctx, fake, title, now, extra = {}) {
  const token = signJwt({
    iss: "https://clerk.example.test",
    sub: "user_invitee",
    aud: RESOURCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    redirect_uri: CLAUDE_WEB_REDIRECT,
  });
  const deps = { judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL, now };
  const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const send = async (body) => {
    const res = await handleMcp(new Request(RESOURCE, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), { ...ctx, ...deps });
    return res.json();
  };
  const grilled = await send(call(1, "grill", { subject: `Decision: ${title}\nI'm 60% sure.`, keep_records: true, quality_check: false, ...extra }));
  assert.equal(grilled.result.isError, false, grilled.result?.content?.[0]?.text || "");
  await send(call(2, "grill_decided", { decided: `Go with ${title}.` }));
}

describe("pages a person sees", () => {
  it("puts what needs you now above credit, the records switch and export", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const due = html.indexOf("Due for a look-back");
      const credit = html.indexOf("credit left");
      const records = html.indexOf("Keep my decision records");
      const exported = html.indexOf("Export as text");
      assert.ok(due > html.indexOf("<h1>"), "due list is missing");
      assert.ok(due < credit && due < records && due < exported);
    } finally {
      await fake.close();
    }
  });

  it("does not uppercase a record title", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "iPhone launch", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(html, /<p class="record-title">iPhone launch<\/p>/);
      assert.match(html, /\.record-title \{[^}]*text-transform:\s*none/);
      assert.equal(html.includes("<h2>iPhone launch</h2>"), false);
      assert.equal(html.includes("IPHONE LAUNCH"), false);
    } finally {
      await fake.close();
    }
  });

  it("asks on a page before deleting every record or the account", async () => {
    resetHostedCaches();
    const ctx = world();
    const { html } = await getPage(ctx, "/decisions", { now: FEB });
    assert.equal(html.includes('type="hidden" name="confirm"'), false);
    assert.match(html, /href="\/decisions\?confirm=delete-all"/);
    const ask = await getPage(ctx, "/decisions?confirm=delete-all", { now: FEB });
    assert.match(ask.html, /<h1>Delete all records\?<\/h1>/);
    assert.match(ask.html, /<button type="submit" name="confirm" value="delete">Delete all records<\/button>/);
    const account = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: cookieHeader() } }), { ...ctx, now: FEB });
    const accountHtml = await account.text();
    assert.match(accountHtml, /href="\/account\?confirm=delete"/);
    assert.equal(accountHtml.includes('type="hidden" name="confirm"'), false);
    const askAccount = await handleAccount(new Request("https://grillyour.ai/account?confirm=delete", { headers: { cookie: cookieHeader() } }), { ...ctx, now: FEB });
    const askHtml = await askAccount.text();
    assert.match(askHtml, /<button type="submit" name="confirm" value="delete">Delete this account<\/button>/);
  });

  it("answers 303 after a successful form and leaves a second identical post unchanged", async () => {
    resetHostedCaches();
    const ctx = world();
    await getPage(ctx, "/decisions", { now: FEB });
    const first = await postForm(ctx, "action=calendar&value=on", FEB);
    assert.equal(first.status, 303);
    assert.equal(await first.text(), "");
    const flash = first.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-grill_flash="));
    assert.match(flash, /HttpOnly/);
    const link = decodeURIComponent(flash.split(";")[0].slice("__Host-grill_flash=".length));
    const shown = await getPage(ctx, "/decisions", { now: FEB, cookie: cookieHeader(flash.split(";")[0]) });
    assert.match(shown.html, /shown only once/);
    assert.equal(shown.html.includes(link), true);
    const again = await getPage(ctx, "/decisions", { now: FEB });
    assert.equal(again.html.includes(link), false);
    const second = await postForm(ctx, "action=calendar&value=on", FEB);
    assert.equal(second.status, 303);
    assert.equal(second.headers.getSetCookie().some((cookie) => cookie.startsWith("__Host-grill_flash=") && !cookie.startsWith("__Host-grill_flash=;")), false);
    assert.equal((await handleCalendar(new Request(link), { ...ctx, now: FEB })).status, 200);
    const kept = await postForm(ctx, "action=records&value=keep", FEB);
    assert.equal(kept.status, 303);
    const repeat = await postForm(ctx, "action=records&value=keep", FEB);
    assert.equal(repeat.status, 303);
  });

  it("escapes a title instead of rendering it", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "<img src=x onerror=alert(1)>", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
      assert.equal(html.includes("<img src=x"), false);
    } finally {
      await fake.close();
    }
  });

  it("shows a calendar secret only on the one-time page", async () => {
    resetHostedCaches();
    const ctx = world();
    await getPage(ctx, "/decisions", { now: FEB });
    const first = await postForm(ctx, "action=calendar&value=on", FEB);
    const flash = first.headers.getSetCookie().find((cookie) => cookie.startsWith("__Host-grill_flash="));
    const link = decodeURIComponent(flash.split(";")[0].slice("__Host-grill_flash=".length));
    assert.equal((await first.text()).includes(link), false);
    const shown = await getPage(ctx, "/decisions", { now: FEB, cookie: cookieHeader(flash.split(";")[0]) });
    assert.equal(shown.html.includes(link), true);
    const later = await getPage(ctx, "/decisions", { now: FEB });
    assert.equal(later.html.includes("/decisions/calendar/"), false);
    const account = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: cookieHeader() } }), { ...ctx, now: FEB });
    assert.equal((await account.text()).includes("/decisions/calendar/"), false);
  });

  it("does not name operator settings on a person-facing page", async () => {
    resetHostedCaches();
    const ctx = world();
    const missed = await handleDecisions(new Request("https://grillyour.ai/decisions?from=signin&__grill_hs=done"), ctx);
    const missedHtml = await missed.text();
    const unknown = world();
    unknown.env.CLERK_ISSUER = "https://fapi.example.test";
    const unset = await handleAccount(new Request("https://grillyour.ai/account"), unknown);
    const unsetHtml = await unset.text();
    const deleted = await handleAccount(new Request("https://grillyour.ai/account?deleted=1"), ctx);
    const deletedHtml = await deleted.text();
    ctx.env.GRILL_HOSTED_ALLOWLIST = "someone-else@example.com";
    const invite = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookieHeader() } }), ctx);
    const inviteHtml = await invite.text();
    for (const html of [missedHtml, unsetHtml, deletedHtml, inviteHtml]) {
      assert.doesNotMatch(html, /Clerk|CLERK_|allowed origins/);
    }
  });

  it("gives every dead-end page a way back", async () => {
    resetHostedCaches();
    const ctx = world();
    const missed = await handleDecisions(new Request("https://grillyour.ai/decisions?from=signin&__grill_hs=done"), ctx);
    const unknown = world();
    unknown.env.CLERK_ISSUER = "https://fapi.example.test";
    const unset = await handleAccount(new Request("https://grillyour.ai/account"), unknown);
    const deleted = await handleAccount(new Request("https://grillyour.ai/account?deleted=1"), ctx);
    ctx.env.GRILL_HOSTED_ALLOWLIST = "someone-else@example.com";
    const invite = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookieHeader() } }), ctx);
    for (const res of [missed, unset, deleted, invite]) {
      const html = await res.text();
      assert.match(html, /href="\/">Back to Grill/);
      assert.match(html, /<html lang="en">/);
      assert.match(html, /name="viewport"/);
      assert.match(html, /noindex/);
      assert.match(html, /<title>[^<]+ · Grill<\/title>/);
    }
  });

  it("renders the decisions page with no script", async () => {
    resetHostedCaches();
    const ctx = world();
    const { html } = await getPage(ctx, "/decisions", { now: FEB });
    assert.equal(html.includes("<script"), false);
    const account = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: cookieHeader() } }), { ...ctx, now: FEB });
    assert.equal((await account.text()).includes("<script"), false);
  });

  it("wraps a long title inside the card style", async () => {
    resetHostedCaches();
    const ctx = world();
    const { html } = await getPage(ctx, "/decisions", { now: FEB });
    assert.match(html, /\.banner \{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("gives a button and an input a 44px tap target", async () => {
    resetHostedCaches();
    const ctx = world();
    const { html } = await getPage(ctx, "/decisions", { now: FEB });
    assert.match(html, /button, \.button \{[^}]*min-height:\s*44px/);
    assert.match(html, /input, select \{[^}]*min-height:\s*44px/);
  });

  it("shows dates the same way the chat does", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(html, /review 15 Jan/);
      assert.equal(html.includes("2026-01-15"), false);
    } finally {
      await fake.close();
    }
  });

  it("offers delete this chain only on a record that is in a chain", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const alone = await getPage(ctx, "/decisions", { now: FEB });
      assert.equal(alone.html.includes("Delete this chain"), false);
      const token = signJwt({
        iss: "https://clerk.example.test",
        sub: "user_invitee",
        aud: RESOURCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
        redirect_uri: CLAUDE_WEB_REDIRECT,
      });
      const deps = { judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL, now: FEB };
      const send = async (id, name, args) => {
        const res = await handleMcp(
          new Request(RESOURCE, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
          }),
          { ...ctx, ...deps },
        );
        return res.json();
      };
      await send(1, "grill", { subject: "Decision: Delay the beta\nI'm 60% sure.", keep_records: true, quality_check: false, supersedes: "2026-01-01 Hire contractor", changed: "evidence the trial slipped" });
      await send(2, "grill_decided", { decided: "Delay it." });
      const html = (await getPage(ctx, "/decisions", { now: FEB })).html;
      assert.equal((html.match(/Delete this chain/g) || []).length, 2);
    } finally {
      await fake.close();
    }
  });
});
