// The signed-in header is one component on every server-rendered page that already
// has a session: the pitchfork and wordmark go home, and Your grills, Add checks,
// and Account stay on that row. /pricing uses it when the visitor is already
// signed in, and stays the public page otherwise. The homepage is a static file
// with no session, so it is not in this list.
import { createHash, createSign, randomBytes } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, handleDecisions, handleJudge, handleRedeem, resetHostedCaches } from "../api/_hosted.mjs";
import { handlePricing } from "../api/_pricing.mjs";
import { createMemoryRedis, encryptString, keyFromEnv } from "./hostedCore.mjs";
import { recordBlock } from "./reflection.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const EMAIL = "tester@example.com";
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

function cookie() {
  return `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_tester", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
}

function world() {
  const memory = createMemoryRedis();
  const env = {
    GRILL_HOSTED: "on",
    GRILL_TOPUPS: "on",
    GRILL_TOPUP_PRICE_ID: "price_testpack1",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-made-up-0000",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: EMAIL,
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    STRIPE_SECRET_KEY: "sk_test_topup_made_up",
    STRIPE_WEBHOOK_SECRET: "whsec_topup_test",
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      return Response.json({
        id: decodeURIComponent(u.split("/").pop()),
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: EMAIL, verification: { status: "verified" } }],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && init.method === "POST") {
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: 5, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      return Response.json({ data: { hash: "hash_tester_1", limit: 5, usage: 0, usage_monthly: 0, disabled: false } });
    }
    if (u.startsWith("https://api.stripe.com/")) return Response.json({ id: "cus_test" });
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory };
}

function headerOf(html) {
  return html.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0] || "";
}

/** Logo home, the three links, the current page, and the sticky phone bar. */
function assertSharedNav(html, { current, below } = {}) {
  const header = headerOf(html);
  assert.ok(header, "a shared site header");
  assert.equal((html.match(/<header class="site-header">/g) || []).length, 1);
  assert.match(header, /<a class="mark" href="\/"><img [^>]*alt=""[^>]*width="24"[^>]*>grill<\/a>/);
  assert.match(header, /<nav aria-label="Account">/);
  assert.match(header, /<a href="\/decisions"(?: aria-current="page")?>Your grills<\/a>/);
  assert.match(header, /<a href="\/account#checks">Add checks<\/a>/);
  assert.match(header, /<a href="\/account"(?: aria-current="page")?>Account<\/a>/);
  if (current === "decisions") assert.match(header, /<a href="\/decisions" aria-current="page">Your grills<\/a>/);
  if (current === "account") assert.match(header, /<a href="\/account" aria-current="page">Account<\/a>/);
  if (current === "other") assert.doesNotMatch(header, /aria-current/);
  assert.match(html, /\.site-header \{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*background:\s*var\(--paper\)/);
  assert.match(html, /env\(safe-area-inset-top\)/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /\.site-header nav a \{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/);
  assert.match(html, /@media \(max-width:\s*390px\)/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  const headerAt = html.indexOf('<header class="site-header">');
  const titleAt = html.search(/<h1[\s>]/);
  assert.ok(headerAt >= 0 && titleAt > headerAt, "the header sits above the page title");
  if (below) {
    const marker = html.indexOf(below);
    assert.ok(marker > headerAt, `${below} stays below the header`);
  }
}

async function open(handle, ctx, path) {
  const res = await handle(new Request(`https://grillyour.ai${path}`, { headers: { cookie: cookie() } }), ctx);
  const html = await res.text();
  assert.equal(res.status, 200, `${path} ${html.slice(0, 180)}`);
  return html;
}

async function plant(ctx) {
  await open(handleDecisions, ctx, "/decisions");
  const accountId = ctx.memory.command(["GET", `grill:hosted:person:${createHash("sha256").update(EMAIL).digest("hex")}`]);
  assert.equal(typeof accountId, "string");
  const dataKey = randomBytes(32);
  ctx.memory.command(["SET", `grill:hosted:rkey:${accountId}`, encryptString(dataKey.toString("base64"), keyFromEnv(ctx.env, "GRILL_RECORD_KEY"))]);
  const id = "workshop01";
  const block = recordBlock({
    date: "2026-04-04",
    title: "Saturday kiln workshop price",
    verdict: "Shaky.",
    falsifier: "Count paid seats the Thursday before.",
    review: "2026-05-02",
    decided: "Keep the Saturday price.",
  });
  const row = {
    id,
    createdAt: "2026-04-04T15:00:00.000Z",
    date: "2026-04-04",
    title: "Saturday kiln workshop price",
    verdict: "Shaky.",
    review: "2026-05-02",
    decided: "Keep the Saturday price.",
    block,
  };
  ctx.memory.command(["SET", `grill:hosted:record:${accountId}:${id}`, encryptString(JSON.stringify(row), dataKey)]);
  ctx.memory.command(["ZADD", `grill:hosted:records:${accountId}`, Date.parse(row.createdAt), id]);
  return id;
}

describe("the shared signed-in header", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  it("is on account, top-up return, and delete-account, with Account current", async () => {
    const ctx = world();
    const account = await open(handleAccount, ctx, "/account");
    assertSharedNav(account, { current: "account" });
    assert.match(account, /id="checks"/);
    assert.equal(account.includes('id="low-checks"'), false);

    const paid = await open(handleAccount, ctx, "/account?topup=ok");
    assertSharedNav(paid, { current: "account" });
    assert.match(paid, /If you completed payment, your checks will appear shortly/);
    assert.equal((paid.match(/If you completed payment, your checks will appear shortly/g) || []).length, 1);
    assert.doesNotMatch(paid, /Payment received/);
    assert.equal(paid.includes('id="low-checks"'), false);

    const cancel = await open(handleAccount, ctx, "/account?topup=cancel");
    assertSharedNav(cancel, { current: "account" });
    assert.match(cancel, /Payment not completed\. Nothing was charged\./);
    assert.equal((cancel.match(/Payment not completed\. Nothing was charged\./g) || []).length, 1);

    const remove = await open(handleAccount, ctx, "/account?confirm=delete");
    assertSharedNav(remove, { current: "account" });
    assert.match(remove, /Delete this account\?/);
  });

  it("is on Your grills, a decision, settings, and the confirm pages, with Your grills current", async () => {
    const ctx = world();
    const id = await plant(ctx);
    const list = await open(handleDecisions, ctx, "/decisions");
    assertSharedNav(list, { current: "decisions" });
    assert.equal(list.includes('id="low-checks"'), false);
    const settings = list.indexOf('<details class="settings">');
    assert.ok(settings > list.indexOf('<header class="site-header">'), "settings stay on the page, under the header");

    const detail = await open(handleDecisions, ctx, `/decisions?id=${id}`);
    assertSharedNav(detail, { current: "decisions" });
    assert.match(detail, /Saturday kiln workshop price/);

    const one = await open(handleDecisions, ctx, `/decisions?confirm=delete&id=${id}`);
    assertSharedNav(one, { current: "decisions" });
    assert.match(one, /Delete this record\?/);

    const all = await open(handleDecisions, ctx, "/decisions?confirm=delete-all");
    assertSharedNav(all, { current: "decisions" });

    const share = await open(handleDecisions, ctx, `/decisions?confirm=share&id=${id}`);
    assertSharedNav(share, { current: "decisions" });

    const outcome = await open(handleDecisions, ctx, `/decisions?confirm=outcome&id=${id}&value=held`);
    assertSharedNav(outcome, { current: "decisions" });
    assert.match(outcome, /Record this look-back\?/);
  });

  it("is on /pricing when there is already a session, and absent when there is not", async () => {
    const ctx = world();
    const signed = await open(handlePricing, ctx, "/pricing");
    assertSharedNav(signed, { current: "other" });
    assert.match(signed, /<h1>Pricing<\/h1>/);
    assert.match(signed, /100 checks for \$5/);
    assert.doesNotMatch(signed, /Grill Pro|subscription|\$9|\$90/);

    const anon = await handlePricing(new Request("https://grillyour.ai/pricing"), ctx);
    const html = await anon.text();
    assert.equal(anon.status, 200);
    assert.equal(headerOf(html), "");
    assert.match(html, /<h1>Pricing<\/h1>/);
  });

  it("is on /judge and /redeem, with no link marked current", async () => {
    const ctx = world();
    const judge = await open(handleJudge, ctx, "/judge");
    assertSharedNav(judge, { current: "other" });
    assert.match(judge, /Grill this decision/);

    const redeem = await open(handleRedeem, ctx, "/redeem");
    assertSharedNav(redeem, { current: "other" });
    assert.match(redeem, /You're in/);
  });
});
