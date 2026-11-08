// Contract for the pages a person sees. No browser: these assert on the HTML the handlers return.
import { createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAccount, handleCalendar, handleDecisions, handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import { CLAUDE_WEB_REDIRECT, createMemoryRedis, FUNNEL_KEYS } from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCE = "https://mcp.example/mcp";
let privateKey;
let jwk;
before(async () => {
  ({ privateKey, jwk } = await testSigningKey());
});

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
  it("puts what needs you now above the records switch and export", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const due = html.indexOf("decision due for a look-back");
      const records = html.indexOf("Keep my decision records");
      const exported = html.indexOf(">Export<");
      assert.ok(due > html.indexOf("<h1>"), "due list is missing");
      assert.ok(due < records && due < exported);
      assert.match(html, /Chose: Go with Hire contractor\. · <strong>shaky<\/strong> · Due/);
      assert.doesNotMatch(html, /of use each month|left this month|judge spend/);
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
      assert.match(html, /<a class="record-title" href="\/decisions\?id=[^"]+">iPhone launch<\/a>/);
      assert.match(html, /\.record-title \{[^}]*display:\s*block/);
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
      assert.match(html, /Chose: Go with Hire contractor\./);
      assert.equal(html.includes("2026-01-15"), false);
      const href = html.match(/href="(\/decisions\?id=[^"#]+)"/)?.[1];
      const detail = await getPage(ctx, href, { now: FEB });
      assert.match(detail.html, /15 Jan/);
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
      assert.equal(html.includes("Delete this chain"), false, "the list does not delete");
      const ids = [...new Set([...html.matchAll(/href="(\/decisions\?id=[^"#]+)"/g)].map((match) => match[1]))];
      let chains = 0;
      for (const href of ids) chains += ((await getPage(ctx, href, { now: FEB })).html.match(/Delete this chain/g) || []).length;
      assert.equal(chains, 2);
    } finally {
      await fake.close();
    }
  });
});

// /decisions has one job: see your decisions. Records come before the settings, a single record
// or a chain is deleted only from a page that asks first, and an empty page says what to do.
// Made-up fixtures only.
describe("the decisions page layout", () => {
  it("puts records before the settings, export and calendar, with settings at the bottom under Manage", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const record = html.indexOf('class="record-title"');
      const exported = html.indexOf(">Export<");
      const recordsSwitch = html.indexOf("Keep my decision records");
      const calendar = html.indexOf("Look-back reminders in your calendar");
      assert.ok(record > 0, "a record row is shown");
      assert.ok(exported > record, "export follows the records");
      assert.ok(recordsSwitch > exported && calendar > recordsSwitch, "settings sit under the list");
      assert.match(html, /href="\/decisions\?confirm=delete-all">Delete all</);
      assert.equal(html.includes("<h2>Manage</h2>"), false);
      assert.equal(html.includes("Share verdict"), false);
      assert.equal(html.includes("Delete this record"), false);
      assert.doesNotMatch(html, /of use each month|left this month/);
      assert.equal(html.includes('type="hidden" name="confirm"'), false);
    } finally {
      await fake.close();
    }
  });

  it("links each record's delete to a page that asks first, and deletes only after confirm", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      assert.equal(html.includes("Delete this record"), false, "the list does not delete");
      const open = html.match(/href="(\/decisions\?id=[^"#]+)"/)?.[1];
      const detail = await getPage(ctx, open, { now: FEB });
      assert.equal(/<input type="hidden" name="action" value="delete">/.test(detail.html), false, "no one-tap delete form");
      const href = detail.html.match(/href="(\/decisions\?confirm=delete&amp;id=[^"]+)"/)?.[1];
      assert.ok(href, "a delete link to a confirm page");
      const id = decodeURIComponent(href.split("id=")[1]);
      const ask = await getPage(ctx, href.replace(/&amp;/g, "&"), { now: FEB });
      assert.match(ask.html, /<h1>Delete this record\?<\/h1>/);
      assert.match(ask.html, /Hire contractor/);
      assert.match(ask.html, /<button type="submit" name="confirm" value="delete">Delete this record<\/button>/);
      assert.match(ask.html, /<a href="\/decisions">Keep it<\/a>/);
      assert.equal(ask.html.includes("<script"), false);
      const exportJson = async () =>
        JSON.parse(await (await handleDecisions(new Request("https://grillyour.ai/decisions?export=json", { headers: { cookie: cookieHeader() } }), { ...ctx, now: FEB })).text());
      const unconfirmed = await postForm(ctx, `action=delete&id=${encodeURIComponent(id)}`, FEB);
      assert.equal(unconfirmed.status, 303);
      assert.equal((await exportJson()).length, 1, "a post without confirm deletes nothing");
      const confirmed = await postForm(ctx, `action=delete&id=${encodeURIComponent(id)}&confirm=delete`, FEB);
      assert.equal(confirmed.status, 303);
      assert.equal((await exportJson()).length, 0);
    } finally {
      await fake.close();
    }
  });

  it("asks before deleting a chain, and says how many records it removes", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      await decide(ctx, fake, "Delay the beta", FEB, { supersedes: "2026-01-01 Hire contractor", changed: "evidence the trial slipped" });
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      assert.equal(html.includes("Delete this chain"), false, "the list does not delete a chain");
      const ids = [...new Set([...html.matchAll(/href="(\/decisions\?id=[^"#]+)"/g)].map((match) => match[1]))];
      let href = "";
      for (const id of ids) {
        const found = (await getPage(ctx, id, { now: FEB })).html.match(/href="(\/decisions\?confirm=delete-chain&amp;id=[^"]+)"/)?.[1];
        if (found) href = found;
      }
      assert.ok(href, "a chain delete link on the record");
      const ask = await getPage(ctx, href.replace(/&amp;/g, "&"), { now: FEB });
      assert.match(ask.html, /<h1>Delete this chain\?<\/h1>/);
      assert.match(ask.html, /2 records/);
      assert.match(ask.html, /<button type="submit" name="confirm" value="delete">Delete this chain<\/button>/);
    } finally {
      await fake.close();
    }
  });

  it("sends a confirm link for a record that isn't yours back to the list", async () => {
    resetHostedCaches();
    const ctx = world();
    const { res } = await getPage(ctx, "/decisions?confirm=delete&id=not-a-record", { now: FEB });
    assert.equal(res.status, 303);
  });

  it("opens a grill from its title, with the verdict, choice, confidence and look-back", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const token = signJwt({
        iss: "https://clerk.example.test",
        sub: "user_invitee",
        aud: RESOURCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
        redirect_uri: CLAUDE_WEB_REDIRECT,
      });
      const deps = { judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL, now: JAN };
      const send = async (id, name, args, now = JAN) => {
        const res = await handleMcp(
          new Request(RESOURCE, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
          }),
          { ...ctx, ...deps, now },
        );
        return res.json();
      };
      await send(1, "grill", { subject: "Decision: Hire contractor\nI'm 60% sure.", keep_records: true, quality_check: false });
      await send(2, "grill_decided", { decided: "Hire the contractor.", confidence: "60%" });
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const href = html.match(/href="(\/decisions\?id=[^"#]+)"/)?.[1];
      assert.ok(href, "the title links to the record");
      assert.ok(html.includes(`<a class="record-title" href="${href}">Hire contractor</a>`));
      assert.match(html, /Chose: Hire the contractor\. · <strong>shaky<\/strong> · Due/);
      assert.equal(html.includes('name="happened"'), false, "the page does not post a look-back");
      const detail = await getPage(ctx, `${href}#look-back`, { now: FEB });
      assert.equal(detail.res.status, 200);
      assert.match(detail.html, /<h1 class="record-title[^"]*">Hire contractor<\/h1>/);
      assert.match(detail.html, /Verdict: <strong>shaky<\/strong>/);
      assert.match(detail.html, /You chose: Hire the contractor\. 60%\./);
      assert.match(detail.html, /id="look-back"/);
      assert.match(detail.html, /What happened\?/);
      assert.match(detail.html, />Held up</);
      assert.match(detail.html, />Didn't</);
      assert.match(detail.html, />Mixed</);
      assert.match(detail.html, /name="note"/);
      assert.match(detail.html, /No look-back/);
      assert.match(detail.html, /Due for a look-back since 15 Jan\. Not looked back\./);
      assert.match(detail.html, /Share verdict/);
      assert.match(detail.html, /<a href="\/decisions">Your grills<\/a>/);
      assert.equal(detail.html.includes("<script"), false);
      assert.equal(detail.html.includes("<textarea"), false);
      assert.equal(detail.html.includes('name="happened"'), false);
      assert.equal(detail.html.includes("came_true:"), false);
      const missing = await getPage(ctx, "/decisions?id=not-a-record", { now: FEB });
      assert.equal(missing.res.status, 303);
      const looked = await send(3, "grill_look_back", { happened: "came_true: no\nhappened: The contractor left after a week." }, FEB);
      assert.equal(looked.result.isError, false, looked.result?.content?.[0]?.text || "");
      const after = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(after.html, /Didn(?:'|&#39;)t/);
      assert.equal(after.html.includes('class="happened"'), false);
      assert.equal(after.html.includes("came_true:"), false);
      const again = await getPage(ctx, href, { now: FEB });
      assert.match(again.html, /It did not come true\. The contractor left after a week\./);
    } finally {
      await fake.close();
    }
  });

  it("filters the list by a type taken from the stored words", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire a contractor", JAN);
      await decide(ctx, fake, "Price the workshop at $180", JAN);
      const all = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(all.html, /2 decisions due for a look-back/);
      assert.match(all.html, /A look-back is due 14 days after you choose/);
      assert.doesNotMatch(all.html, /\d+ decisions · \d+% looked back/);
      assert.equal((all.html.match(/class="filters"/g) || []).length, 1);
      assert.match(all.html, /aria-current="page">All</);
      assert.match(all.html, /href="\/decisions\?type=work">Work</);
      assert.match(all.html, /href="\/decisions\?type=money">Money</);
      assert.equal(all.html.includes("Fantasy sports"), false);
      assert.equal(all.html.includes(">Claude<"), false, "a source filter with one value stays hidden");
      assert.match(all.html, /\.chip \{[^}]*min-height:\s*44px/);
      assert.match(all.html, /@media \(max-width: 390px\)/);
      assert.match(all.html, /--ink:#1c1b19/);
      assert.match(all.html, /--paper:#f7f4ef/);
      assert.match(all.html, /prefers-color-scheme: dark/);
      assert.equal(all.html.includes("<script"), false);
      assert.doesNotMatch(all.html, /of use each month|left this month|judge spend/);
      const money = await getPage(ctx, "/decisions?type=money", { now: FEB });
      assert.match(money.html, /Price the workshop at \$180/);
      assert.equal(money.html.includes("Hire a contractor"), false);
      assert.match(money.html, /aria-current="page">Money</);
      assert.equal(money.html.includes("Delete all"), false);
      const work = await getPage(ctx, "/decisions?type=work", { now: FEB });
      assert.match(work.html, /Hire a contractor/);
      assert.equal(work.html.includes("Price the workshop"), false);
      const junk = await getPage(ctx, "/decisions?type=%3Cscript%3E", { now: FEB });
      assert.match(junk.html, /Hire a contractor/);
      assert.match(junk.html, /Price the workshop at \$180/);
      assert.equal(junk.html.includes("<script"), false);
      const none = await getPage(ctx, "/decisions?type=personal", { now: FEB });
      assert.match(none.html, /No personal decisions yet\./);
      assert.match(none.html, /href="\/decisions\?type=work">Work</);
      assert.equal(all.html.includes(">ChatGPT<"), false);
      const fromClaude = await getPage(ctx, "/decisions?source=claude", { now: FEB });
      assert.match(fromClaude.html, /Hire a contractor/);
      assert.doesNotMatch(fromClaude.html, /\d+ decisions · \d+% looked back/);
      const otherClient = await getPage(ctx, "/decisions?source=chatgpt", { now: FEB });
      assert.match(otherClient.html, /No decisions from ChatGPT yet\./);
      assert.equal(otherClient.html.includes("Hire a contractor"), false);
      const both = await getPage(ctx, "/decisions?type=money&source=claude", { now: FEB });
      assert.match(both.html, /Price the workshop at \$180/);
      assert.equal(both.html.includes("Hire a contractor"), false);
      const crossed = await getPage(ctx, "/decisions?type=work&source=chatgpt", { now: FEB });
      assert.match(crossed.html, /No work decisions from ChatGPT yet\./);
    } finally {
      await fake.close();
    }
  });

  it("does not show a record to someone who is signed out", async () => {
    resetHostedCaches();
    const ctx = world();
    const res = await handleDecisions(new Request("https://grillyour.ai/decisions?id=any-record"), ctx);
    assert.equal(res.status, 302);
    assert.match(res.headers.get("location") || "", /sign-in/);
  });

  it("shows one scorecard line once three decisions are saved, without a held-up clause yet", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire a contractor", JAN);
      await decide(ctx, fake, "Price the workshop at $180", JAN);
      await decide(ctx, fake, "Ship the beta", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const due = html.indexOf("3 decisions due for a look-back");
      const impact = html.indexOf("What Grill changed");
      const score = html.indexOf("3 decisions · 0% looked back");
      const filters = html.indexOf('class="filters"');
      assert.ok(impact > 0 && due > impact && score > due && filters > score);
      assert.doesNotMatch(html, /verdict held up/);
      assert.doesNotMatch(html, /A look-back is due 14 days/);
      assert.equal((html.match(/class="filters"/g) || []).length, 1);
    } finally {
      await fake.close();
    }
  });

  it("offers a look-back after the verdict for a dated ship, and not for a hire with no date", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const sunday = Date.parse("2026-11-08T15:00:00Z");
      const token = signJwt({
        iss: "https://clerk.example.test",
        sub: "user_invitee",
        aud: RESOURCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
        redirect_uri: CLAUDE_WEB_REDIRECT,
      });
      const send = async (id, name, args) => {
        const res = await handleMcp(
          new Request(RESOURCE, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
          }),
          { ...ctx, judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL, now: sunday },
        );
        return res.json();
      };
      const ship = await send(1, "grill", { subject: "Decision: Ship the beta Friday\nI'm 60% sure.", keep_records: true, quality_check: false });
      const shipText = ship.result?.content?.[0]?.text || "";
      assert.equal(ship.result.isError, false, shipText);
      assert.match(shipText, /Look back on 13 Nov\. One tap when it is due\./);
      assert.ok(shipText.indexOf("**") < shipText.indexOf("Look back on 13 Nov"), shipText);
      const hire = await send(2, "grill", { subject: "Decision: Hire a contractor\nI'm 60% sure.", keep_records: true, quality_check: false });
      const hireText = hire.result?.content?.[0]?.text || "";
      assert.equal(hire.result.isError, false, hireText);
      assert.doesNotMatch(hireText, /Look back on/);
    } finally {
      await fake.close();
    }
  });

  it("records an early read before the due date, then keeps only the later outcome", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const early = Date.parse("2026-01-05T15:00:00Z");
      await decide(ctx, fake, "Ship the beta", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: early });
      const id = new URL(`https://grillyour.ai${html.match(/href="(\/decisions\?id=[^"#]+)"/)[1]}`).searchParams.get("id");
      await postForm(ctx, `action=outcome&id=${encodeURIComponent(id)}&value=no`, early);
      const first = await getPage(ctx, `/decisions?id=${encodeURIComponent(id)}`, { now: early });
      assert.match(first.html, /Early read/);
      assert.match(first.html, /Didn't/);
      await postForm(ctx, `action=outcome&id=${encodeURIComponent(id)}&value=held`, early);
      await postForm(ctx, `action=note&id=${encodeURIComponent(id)}&note=Two teams used it`, early);
      const second = await getPage(ctx, `/decisions?id=${encodeURIComponent(id)}`, { now: early });
      assert.match(second.html, /Held up/);
      assert.match(second.html, /value="Two teams used it"/);
      assert.doesNotMatch(second.html, /It did not hold up/);
      const due = await getPage(ctx, `/decisions?id=${encodeURIComponent(id)}`, { now: FEB });
      assert.doesNotMatch(due.html, /Early read/);
      assert.match(due.html, /Held up/);
      assert.equal(ctx.memory.command(["GET", FUNNEL_KEYS.lookbacksDone]) || null, null);
    } finally {
      await fake.close();
    }
  });

  it("closes a due look-back in one tap, and a later tap replaces it", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const id = new URL(`https://grillyour.ai${html.match(/href="(\/decisions\?id=[^"#]+)"/)[1]}`).searchParams.get("id");
      const detail = await getPage(ctx, `/decisions?id=${encodeURIComponent(id)}`, { now: FEB });
      assert.match(detail.html, /Held up/);
      assert.match(detail.html, /Didn't/);
      assert.match(detail.html, /Mixed/);
      const junk = await postForm(ctx, `action=outcome&id=${encodeURIComponent(id)}&value=maybe`, FEB);
      assert.equal(junk.status, 303);
      const still = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(still.html, /decision due for a look-back/);
      assert.equal(ctx.memory.command(["GET", FUNNEL_KEYS.grills]), "1");
      assert.equal(ctx.memory.command(["GET", FUNNEL_KEYS.choices]), "1");
      assert.equal(ctx.memory.command(["GET", FUNNEL_KEYS.lookbacksSet]), "1");
      assert.equal(ctx.memory.command(["GET", FUNNEL_KEYS.lookbacksDone]) || null, null);
      assert.equal(Object.values(FUNNEL_KEYS).some((key) => key.includes("Hire")), false);
      const tapped = await postForm(ctx, `action=outcome&id=${encodeURIComponent(id)}&value=no`, FEB);
      assert.equal(tapped.status, 303);
      const after = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(after.html, /Didn(?:'|&#39;)t/);
      assert.equal(after.html.includes("decision due for a look-back"), false);
      const replaced = await postForm(ctx, `action=outcome&id=${encodeURIComponent(id)}&value=held`, FEB);
      assert.equal(replaced.status, 303);
      const kept = await getPage(ctx, `/decisions?id=${encodeURIComponent(id)}`, { now: FEB });
      assert.match(kept.html, /Held up/);
      assert.match(kept.html, /Changed /);
      assert.doesNotMatch(kept.html, /It did not hold up/);
      assert.equal(ctx.memory.command(["GET", FUNNEL_KEYS.lookbacksDone]), "1");
    } finally {
      await fake.close();
    }
  });

  it("uses a named day for the look-back, and lets the record change or drop it", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const sunday = Date.parse("2026-11-08T15:00:00Z");
      await decide(ctx, fake, "Ship the beta Friday", sunday);
      const { html } = await getPage(ctx, "/decisions", { now: sunday });
      assert.match(html, /Look back 13 Nov|13 Nov/);
      assert.equal(html.includes("22 Nov"), false);
      const href = html.match(/href="(\/decisions\?id=[^"#]+)"/)?.[1];
      const detail = await getPage(ctx, href, { now: sunday });
      assert.match(detail.html, /type="date"/);
      assert.match(detail.html, /value="2026-11-13"/);
      assert.match(detail.html, /No look-back/);
      const id = new URL(`https://grillyour.ai${href}`).searchParams.get("id");
      const moved = await postForm(ctx, `action=review&id=${encodeURIComponent(id)}&value=set&review=2026-12-01`, sunday);
      assert.equal(moved.status, 303);
      assert.match(moved.headers.get("location") || "", /id=/);
      const later = await getPage(ctx, href, { now: sunday });
      assert.match(later.html, /value="2026-12-01"/);
      const dropped = await postForm(ctx, `action=review&id=${encodeURIComponent(id)}&value=off`, sunday);
      assert.equal(dropped.status, 303);
      const none = await getPage(ctx, href, { now: sunday });
      assert.match(none.html, /Add a look-back/);
      assert.equal(none.html.includes("due for a look-back"), false);
      const back = await postForm(ctx, `action=review&id=${encodeURIComponent(id)}&value=on`, sunday);
      assert.equal(back.status, 303);
      const restored = await getPage(ctx, href, { now: sunday });
      assert.match(restored.html, /type="date"/);
      const junk = await postForm(ctx, `action=review&id=${encodeURIComponent(id)}&value=set&review=2026-02-31`, sunday);
      assert.equal(junk.status, 303);
      const kept = await getPage(ctx, href, { now: sunday });
      assert.doesNotMatch(kept.html, /2026-02-31/);
    } finally {
      await fake.close();
    }
  });

  it("says what to do when there are no records yet", async () => {
    resetHostedCaches();
    const ctx = world();
    const { html } = await getPage(ctx, "/decisions", { now: FEB });
    assert.match(html, /No decisions saved yet\./);
    assert.match(html, /Say “grill this: …” in your AI\. When you tell it your call, it’s saved here\./);
    assert.match(html, /A look-back is due 14 days after you choose/);
    assert.doesNotMatch(html, /\d+ decisions · \d+% looked back/);
    assert.equal(html.includes("What Grill changed"), false);
    assert.equal(html.includes("Delete all"), false, "nothing to delete on an empty page");
  });

  it("leads with grill impact from the first saved grill, and the Yes or No tap stays on the record", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const impact = html.indexOf("What Grill changed");
      const due = html.indexOf("decision due for a look-back");
      const records = html.indexOf("Keep my decision records");
      assert.ok(impact > html.indexOf("<h1>") && impact < due && due < records);
      assert.match(html, /No grill is marked as changing a call yet/);
      assert.match(html, /1 is still unknown\. On a decision, one tap says whether the call moved\./);
      assert.match(html, /1 flagged a source, fact or figure\. A flag is not proof\./);
      assert.doesNotMatch(html, /not holding up/);
      assert.doesNotMatch(html, /Did this grill change your call/);
      assert.doesNotMatch(html, /of use each month|left this month|judge spend/);
      const href = html.match(/href="(\/decisions\?id=[^"#]+)"/)?.[1];
      const detail = await getPage(ctx, href, { now: FEB });
      const verdictAt = detail.html.indexOf("Verdict:");
      const ask = detail.html.indexOf("Did this grill change your call?");
      const happened = detail.html.indexOf("What happened?");
      const held = detail.html.indexOf(">Held up<");
      assert.ok(verdictAt > 0 && verdictAt < ask && ask < happened && happened < held);
      assert.match(detail.html, /<h1 class="record-title[^"]*">Hire contractor<\/h1>/);
      assert.match(detail.html, /name="action" value="impact"/);
      assert.match(detail.html, />Yes</);
      assert.match(detail.html, />No</);
      assert.match(detail.html, />Didn't</);
      assert.match(detail.html, />Mixed</);
      assert.equal(detail.html.includes("<script"), false);
      const id = new URL(`https://grillyour.ai${href}`).searchParams.get("id");
      const exported = await getPage(ctx, "/decisions?export=json", { now: FEB });
      const saved = JSON.parse(exported.html);
      assert.equal(saved[0].challenge_kinds[0], "unsupported-claim");
      const yes = await postForm(ctx, `action=impact&id=${encodeURIComponent(id)}&value=changed`, FEB);
      assert.equal(yes.status, 303);
      assert.match(yes.headers.get("location") || "", /id=/);
      const said = await getPage(ctx, href, { now: FEB });
      assert.match(said.html, /You said this one changed the call\./);
      assert.match(said.html, />Held up</);
      const counted = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(counted.html, /1 of 1 grill changed the call\./);
      assert.doesNotMatch(counted.html, /still unknown/);
      assert.match(counted.html, /1 flagged a source, fact or figure\. A flag is not proof\./);
      const no = await postForm(ctx, `action=impact&id=${encodeURIComponent(id)}&value=kept`, FEB);
      assert.equal(no.status, 303);
      const quiet = await getPage(ctx, "/decisions", { now: FEB });
      assert.match(quiet.html, /No grill is marked as changing a call yet/);
      assert.doesNotMatch(quiet.html, /kept/);
      assert.doesNotMatch(quiet.html, /still unknown/);
      const record = await getPage(ctx, href, { now: FEB });
      assert.match(record.html, /You said you kept the call\./);
      assert.match(record.html, />Held up</);
      const junk = await postForm(ctx, `action=impact&id=${encodeURIComponent(id)}&value=maybe`, FEB);
      assert.equal(junk.status, 303);
      const unchanged = await getPage(ctx, href, { now: FEB });
      assert.match(unchanged.html, /You said you kept the call\./);
    } finally {
      await fake.close();
    }
  });

  it("shows a short details line: the verdict in bold, the look-back date in words, no unknown app", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire contractor", JAN);
      const { html } = await getPage(ctx, "/decisions", { now: FEB });
      const row = html.slice(html.indexOf('class="record-title"'), html.indexOf("</li>"));
      assert.match(row, /Chose: Go with Hire contractor\. · <strong>shaky<\/strong> · Due/);
      assert.equal(row.includes("unknown"), false);
      assert.equal(html.includes("2026-01-"), false);
    } finally {
      await fake.close();
    }
  });
});

describe("the public pages name where saved grills are", () => {
  it("the FAQ tells the truth, and the shared nav links to Your grills", () => {
    const faq = readFileSync(join(ROOT, "site/faq.html"), "utf8");
    const about = readFileSync(join(ROOT, "site/about.html"), "utf8");
    assert.doesNotMatch(faq, /Saved history and look-back reminders are coming later/);
    assert.match(faq, /saved at <a href="\/decisions">grillyour\.ai\/decisions<\/a> \(Your grills\)/);
    assert.match(faq, /14-day look-back/);
    assert.match(faq, /optional calendar link/);
    assert.match(faq, /say "look back" in chat/);
    assert.match(faq, /off until you opt in/);
    const nav = (html) => html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0] || "";
    assert.equal(nav(faq), nav(about));
    assert.match(nav(faq), /<a href="\/decisions">Your grills<\/a>/);
  });
});
