// Account form posts, as iPhone Safari sends them: urlencoded body, Origin, and
// the cookies Clerk sets on this host. A signed-in POST must run the action.
// A POST with no session must go to sign-in. A rejected action must show on the page.
import { createSign, randomBytes } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, resetHostedCaches } from "../api/_hosted.mjs";
import { createMemoryRedis } from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const PRICE = "price_testpack1";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";

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

function sessionJwt(expSeconds = 60) {
  return signJwt({
    iss: "https://clerk.example.test",
    sub: "user_tester",
    exp: Math.floor(Date.now() / 1000) + expSeconds,
  });
}

/** Cookie header the way a browser sends the cookies Clerk sets on this host. */
function clerkCookies(jwt = sessionJwt()) {
  const uat = Math.floor(Date.now() / 1000);
  return `__session=${jwt}; __client_uat=${uat}`;
}

function world({ stripeStatus = 200, stripeBody, key = "rk_live_restricted_for_tests" } = {}) {
  const memory = createMemoryRedis();
  const stripe = { calls: [] };
  const env = {
    GRILL_HOSTED: "on",
    GRILL_TOPUPS: "on",
    GRILL_TOPUP_PRICE_ID: PRICE,
    VERCEL_ENV: "production",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-made-up-0000",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: "tester@example.com",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    STRIPE_SECRET_KEY: key,
    STRIPE_WEBHOOK_SECRET: "whsec_topup_test",
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === env.UPSTASH_REDIS_REST_URL) {
      const args = JSON.parse(init.body);
      return Response.json({ result: memory.command(args) });
    }
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      if (init.method === "DELETE") return new Response("{}", { status: 200 });
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
      if (init.method === "DELETE") return new Response("{}", { status: 200 });
      return Response.json({ data: { hash: "hash_tester_1", limit: 5, usage: 0, usage_monthly: 0, disabled: false } });
    }
    if (u.startsWith("https://api.stripe.com/")) {
      const params = new URLSearchParams(init.body || "");
      stripe.calls.push({ url: u, method: init.method || "GET", params, auth: init.headers?.Authorization || "" });
      if (stripeStatus !== 200) return Response.json(stripeBody ?? { error: { message: "no" } }, { status: stripeStatus });
      if (u === "https://api.stripe.com/v1/customers" && init.method === "POST") return Response.json({ id: "cus_topuptester" });
      if (u === "https://api.stripe.com/v1/checkout/sessions" && init.method === "POST") {
        return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_topup" });
      }
      return Response.json({ error: { message: "unexpected stripe call" } }, { status: 404 });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory, stripe };
}

function safariInit(method, cookie, body) {
  const headers = {
    "user-agent": SAFARI,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    referer: "https://grillyour.ai/account",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "navigate",
    "sec-fetch-dest": "document",
    cookie,
  };
  if (method === "POST") {
    headers.origin = "https://grillyour.ai";
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  return { method, headers, body: method === "POST" ? body : undefined };
}

function accountUrl(path = "/account") {
  return `https://grillyour.ai${path}`;
}

function formsIn(html) {
  const forms = [];
  const re = /<form method="post" action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/g;
  let match;
  while ((match = re.exec(html))) {
    const inner = match[2];
    const fields = {};
    for (const input of inner.matchAll(/<input\b[^>]*>/g)) {
      const tag = input[0];
      if (!/\btype="hidden"/.test(tag)) continue;
      const name = tag.match(/\bname="([^"]+)"/)?.[1];
      const value = tag.match(/\bvalue="([^"]*)"/)?.[1] ?? "";
      if (name) fields[name] = value;
    }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((button) => ({
      name: button[1].match(/\bname="([^"]+)"/)?.[1] || "",
      value: button[1].match(/\bvalue="([^"]*)"/)?.[1] || "",
      label: button[2].trim(),
    }));
    forms.push({ action: match[1], fields, buttons });
  }
  return forms;
}

function formBody(form, button) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form.fields)) params.set(name, value);
  if (button.name) params.set(button.name, button.value);
  return params.toString();
}

function storedAccount(ctx) {
  const scan = ctx.memory.command(["SCAN", "0", "MATCH", "grill:hosted:acct:*", "COUNT", "100"]);
  const key = scan[1][0];
  return key ? JSON.parse(ctx.memory.command(["GET", key])) : null;
}

async function openAccount(ctx, cookie, path = "/account") {
  const res = await handleAccount(new Request(accountUrl(path), safariInit("GET", cookie)), ctx);
  assert.equal(res.status, 200, path);
  return res.text();
}

describe("Safari account form posts", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  it("runs every account button from a signed-in Safari POST, including after Clerk's session minute", async () => {
    const ctx = world();
    const signedIn = clerkCookies();
    const markerOnly = `__client_uat=${Math.floor(Date.now() / 1000)}`;
    let html = await openAccount(ctx, signedIn);
    assert.match(html, /Keep my decision records/);
    assert.match(html, /Add 100 checks · \$5/);
    for (const form of formsIn(html)) {
      assert.ok(form.fields.page, `form ${form.action} ${form.buttons.map((b) => b.label).join(", ")} embeds a page token`);
    }

    async function press(label, { cookie, jar = signedIn } = {}) {
      const form = formsIn(html).find((item) => item.buttons.some((button) => button.label === label));
      assert.ok(form, `button on the page: ${label}`);
      const button = form.buttons.find((item) => item.label === label);
      const body = formBody(form, button);
      assert.match(body, /(^|&)action=/);
      const res = await handleAccount(new Request(accountUrl(form.action), safariInit("POST", cookie, body)), ctx);
      return { res, jar };
    }

    function setCookiePairs(res) {
      return (typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [])
        .map((cookie) => cookie.split(";")[0])
        .filter((pair) => pair && !pair.endsWith("="));
    }

    async function pressAndRead(label, cookie) {
      const { res } = await press(label, { cookie });
      assert.equal(res.status, 303, label);
      const location = res.headers.get("location");
      assert.equal(new URL(location).origin, "https://grillyour.ai", label);
      const jar = [signedIn, ...setCookiePairs(res)].filter(Boolean).join("; ");
      html = await openAccount(ctx, jar, `${new URL(location).pathname}${new URL(location).search}`);
      return html;
    }

    await pressAndRead("Keep my decision records", signedIn);
    assert.match(html, /Records: On/);
    assert.equal(storedAccount(ctx).records, "keep");

    await pressAndRead("Don't keep records", markerOnly);
    assert.match(html, /Records: Off/);
    assert.equal(storedAccount(ctx).records, "off");

    await pressAndRead("Turn off weekly email", signedIn);
    assert.match(html, /Weekly email: Off/);
    assert.equal(storedAccount(ctx).impactEmail, false);

    await pressAndRead("Turn on weekly email", markerOnly);
    assert.match(html, /Weekly email: On/);
    assert.equal(storedAccount(ctx).impactEmail, undefined);

    await pressAndRead("Get a calendar link", signedIn);
    assert.match(html, /shown only once/);
    assert.match(html, /Titles in the calendar: off/);

    await pressAndRead("Show titles", markerOnly);
    assert.match(html, /Titles in the calendar: on/);

    await pressAndRead("Hide titles", signedIn);
    assert.match(html, /Titles in the calendar: off/);

    const beforeReset = html;
    await pressAndRead("Get a new link", markerOnly);
    assert.match(html, /shown only once/);
    assert.notEqual(html, beforeReset);

    await pressAndRead("Turn off", signedIn);
    assert.match(html, /Get a calendar link/);

    const bought = await press("Add 100 checks · $5", { cookie: markerOnly });
    assert.equal(bought.res.status, 303);
    assert.equal(bought.res.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    assert.equal(ctx.stripe.calls.some((call) => call.url.endsWith("/v1/checkout/sessions")), true);

    html = await openAccount(ctx, signedIn, "/account?confirm=delete");
    const removed = await press("Delete this account", { cookie: markerOnly });
    assert.equal(removed.res.status, 303);
    assert.match(removed.res.headers.get("location"), /\/account\?deleted=1$/);
    const gone = await handleAccount(new Request(removed.res.headers.get("location"), safariInit("GET", "")), ctx);
    assert.match(await gone.text(), /account is deleted/);
    assert.equal(storedAccount(ctx), null);
  });

  it("sends an unauthenticated Safari POST to sign-in, through the hosted function", async () => {
    const ctx = world();
    const direct = await handleAccount(
      new Request(accountUrl(), safariInit("POST", "", "action=topup")),
      ctx,
    );
    assert.equal(direct.status, 302);
    const loc = new URL(direct.headers.get("location"));
    assert.equal(loc.origin, "https://accounts.example.test");
    assert.match(loc.pathname, /sign-in/);
    assert.equal(loc.searchParams.get("redirect_url"), "https://grillyour.ai/account?from=signin");
    assert.equal(ctx.stripe.calls.length, 0);

    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    Object.assign(process.env, ctx.env);
    globalThis.fetch = ctx.fetch;
    try {
      const { POST } = await import("../api/hosted.js");
      const viaHosted = await POST(
        new Request("https://grillyour.ai/api/hosted?__route=account", safariInit("POST", "", "action=topup")),
      );
      assert.equal(viaHosted.status, 302);
      assert.equal(new URL(viaHosted.headers.get("location")).origin, "https://accounts.example.test");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) {
        if (!(key in saved.env)) delete process.env[key];
      }
      Object.assign(process.env, saved.env);
    }
  });

  it("applies a signed-in Safari POST that arrives as the hosted rewrite, body included", async () => {
    const ctx = world();
    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    Object.assign(process.env, ctx.env);
    globalThis.fetch = ctx.fetch;
    try {
      const { POST } = await import("../api/hosted.js");
      const res = await POST(
        new Request(
          "https://grillyour.ai/api/hosted?__route=account",
          safariInit("POST", clerkCookies(), "action=records&value=keep"),
        ),
      );
      assert.equal(res.status, 303, await res.clone().text());
      assert.equal(new URL(res.headers.get("location")).pathname, "/account");
      assert.equal(storedAccount(ctx).records, "keep");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) {
        if (!(key in saved.env)) delete process.env[key];
      }
      Object.assign(process.env, saved.env);
    }
  });

  it("shows a message when an action is rejected, and does not drop the query", async () => {
    const ctx = world();
    const cookie = clerkCookies();
    const html = await openAccount(ctx, cookie);
    const token = formsIn(html)[0].fields.page;
    assert.ok(token);
    const missed = await handleAccount(
      new Request(accountUrl(), safariInit("POST", cookie, `page=${encodeURIComponent(token)}&action=nope`)),
      ctx,
    );
    assert.equal(missed.status, 303);
    assert.match(missed.headers.get("location"), /notice=missed/);
    const page = await openAccount(ctx, cookie, new URL(missed.headers.get("location")).pathname + new URL(missed.headers.get("location")).search);
    assert.match(page, /That did not go through/);
    assert.doesNotMatch(page, /\bPro\b|subscription/i);
    assert.equal(storedAccount(ctx).records, null);

    const evil = await handleAccount(
      new Request(accountUrl(), {
        ...safariInit("POST", cookie, `page=${encodeURIComponent(token)}&action=records&value=keep`),
        headers: { ...safariInit("POST", cookie, "").headers, origin: "https://evil.example" },
      }),
      ctx,
    );
    assert.match(evil.headers.get("location"), /notice=origin/);
    const warned = await openAccount(ctx, cookie, "/account?notice=origin");
    assert.match(warned, /did not come from this site/);
    assert.equal(storedAccount(ctx).records, null);
  });

  it("shows a payment-page failure and logs the Stripe error code, never the key", async () => {
    const ctx = world({
      stripeStatus: 403,
      stripeBody: {
        error: {
          code: "more_permissions_required",
          type: "invalid_request_error",
          message: "The provided key rk_live_secret_do_not_log lacks Checkout write",
        },
      },
    });
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.map(String).join(" "));
    try {
      const cookie = clerkCookies();
      const html = await openAccount(ctx, cookie);
      const form = formsIn(html).find((item) => item.buttons.some((button) => button.label.startsWith("Add ")));
      const res = await handleAccount(
        new Request(accountUrl(), safariInit("POST", cookie, formBody(form, form.buttons[0]))),
        ctx,
      );
      assert.equal(res.status, 303);
      assert.match(res.headers.get("location"), /topup=failed$/);
      const page = await openAccount(ctx, cookie, "/account?topup=failed");
      assert.match(page, /payment page did not open/);
      assert.match(page, /Nothing was charged/);
      assert.doesNotMatch(page, /\bPro\b|subscription/i);
      const logged = lines.join("\n");
      assert.match(logged, /topup-checkout more_permissions_required/);
      assert.doesNotMatch(logged, /rk_live_secret_do_not_log|sk_live_|whsec_/);
    } finally {
      console.error = original;
    }
  });
});
