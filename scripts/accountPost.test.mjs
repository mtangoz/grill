// Account form posts, as iPhone Safari sends them: urlencoded body, Origin, and
// the cookies Clerk sets on this host. A signed-in POST must run the action.
// A POST with no session must go to sign-in. A rejected action must show on the page.
import { createSign, randomBytes } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, handleDecisions, resetHostedCaches } from "../api/_hosted.mjs";
import { createMemoryRedis, freeChecksKey, isoMonth, monthlyCheckKey, topupBalanceKey } from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const PRICE = "price_testpack1";

function channel(hex, shift) {
  const value = (parseInt(hex.slice(1), 16) >> shift) & 255;
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function contrast(a, b) {
  const lum = (hex) => 0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}
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

function world({ stripeStatus = 200, stripeBody, key = "rk_live_restricted_for_tests", usage = 0 } = {}) {
  const memory = createMemoryRedis();
  const stripe = { calls: [] };
  const router = { usage };
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
      return Response.json({ data: { hash: "hash_tester_1", limit: 5, usage: router.usage, usage_monthly: router.usage, disabled: false } });
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
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory, stripe, router };
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
    assert.match(html, /<span class="setting-name">Decision records<\/span> <span class="state" data-state="unset">Not chosen<\/span>/);
    assert.match(html, /Turn records on/);
    const records = html.slice(html.indexOf('id="records"'), html.indexOf('id="calendar"'));
    assert.ok(records.indexOf("Don't keep records") > 0 && records.indexOf("Don't keep records") < records.indexOf("<summary>About decision records</summary>"));
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

    await pressAndRead("Turn records on", signedIn);
    assert.match(html, /Saved\. Decision records are on\./);
    assert.match(html, /<span class="setting-name">Decision records<\/span> <span class="state" data-state="on">On<\/span>/);
    assert.match(html, /Turn records off/);
    assert.doesNotMatch(html, /Turn records on|Don't keep records/);
    assert.equal(storedAccount(ctx).records, "keep");

    await pressAndRead("Turn records off", markerOnly);
    assert.match(html, /Saved\. Decision records are off\./);
    assert.match(html, /<span class="setting-name">Decision records<\/span> <span class="state" data-state="off">Off<\/span>/);
    assert.match(html, /Turn records on/);
    assert.doesNotMatch(html, /Turn records off/);
    assert.equal(storedAccount(ctx).records, "off");

    await pressAndRead("Turn off weekly email", signedIn);
    assert.match(html, /Saved\. Weekly email is off\./);
    assert.match(html, /<span class="setting-name">Weekly email<\/span> <span class="state" data-state="off">Off<\/span>/);
    assert.equal(storedAccount(ctx).impactEmail, false);

    await pressAndRead("Turn on weekly email", markerOnly);
    assert.match(html, /<span class="setting-name">Weekly email<\/span> <span class="state" data-state="on">On<\/span>/);
    assert.equal(storedAccount(ctx).impactEmail, undefined);

    await pressAndRead("Turn calendar on", signedIn);
    assert.match(html, /Saved\. Calendar reminders are on\./);
    assert.match(html, /<span class="setting-name">Calendar look-back reminders<\/span> <span class="state" data-state="on">On<\/span>/);
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

    await pressAndRead("Turn calendar off", signedIn);
    assert.match(html, /<span class="setting-name">Calendar look-back reminders<\/span> <span class="state" data-state="off">Off<\/span>/);
    assert.match(html, /Turn calendar on/);

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

    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.map(String).join(" "));
    let evil;
    try {
      evil = await handleAccount(
        new Request(accountUrl(), {
          method: "POST",
          headers: { ...safariInit("POST", cookie, "").headers, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
          body: "page=not-the-page-value&action=records&value=keep",
        }),
        ctx,
      );
    } finally {
      console.error = original;
    }
    assert.match(evil.headers.get("location"), /notice=origin/);
    const logged = lines.join("\n");
    assert.match(logged, /origin-reject/);
    assert.match(logged, /"origin":"https:\/\/evil\.example"/);
    assert.match(logged, /"site":"cross-site"/);
    assert.match(logged, /"host":"grillyour\.ai"/);
    assert.doesNotMatch(logged, /not-the-page-value|__session|sk_test|whsec_/);
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

function postHeaders(cookie, { origin, site, extra = {} } = {}) {
  const headers = { ...safariInit("POST", cookie, "").headers, ...extra };
  if (origin === null) delete headers.origin;
  else if (origin !== undefined) headers.origin = origin;
  if (site === null) delete headers["sec-fetch-site"];
  else if (site !== undefined) headers["sec-fetch-site"] = site;
  return headers;
}

function pageToken(html) {
  const token = formsIn(html)[0]?.fields?.page || "";
  if (!token) throw new Error("page token missing");
  return token;
}

function recordsBody(token, value = "keep") {
  return `page=${encodeURIComponent(token)}&action=records&value=${value}`;
}

describe("Safari same-site posts and the checks box", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  async function keepRecords(ctx, cookie, html, headers, url = accountUrl()) {
    const res = await handleAccount(new Request(url, { method: "POST", headers, body: recordsBody(pageToken(html)) }), ctx);
    assert.equal(res.status, 303, await res.clone().text());
    assert.equal(new URL(res.headers.get("location"), accountUrl()).pathname, "/account");
    assert.doesNotMatch(res.headers.get("location"), /notice=origin/);
    assert.equal(storedAccount(ctx).records, "keep");
    return res;
  }

  it("accepts Origin null from Safari when the form carries the signed page value", async () => {
    const ctx = world();
    const signedIn = clerkCookies();
    const markerOnly = `__client_uat=${Math.floor(Date.now() / 1000)}`;
    const html = await openAccount(ctx, signedIn);
    await keepRecords(ctx, signedIn, html, postHeaders(signedIn, { origin: "null", site: "same-origin" }));
    const again = await handleAccount(
      new Request(accountUrl(), { method: "POST", headers: postHeaders(markerOnly, { origin: "null", site: "same-origin" }), body: recordsBody(pageToken(html), "off") }),
      ctx,
    );
    assert.equal(again.status, 303);
    assert.doesNotMatch(again.headers.get("location"), /notice=origin/);
    assert.equal(storedAccount(ctx).records, "off");
  });

  it("accepts a missing Origin and Sec-Fetch-Site none or absent when the page value is valid", async () => {
    const ctx = world();
    const cookie = clerkCookies();
    const html = await openAccount(ctx, cookie);
    await keepRecords(ctx, cookie, html, postHeaders(cookie, { origin: null, site: "same-origin" }));
    const off = await handleAccount(
      new Request(accountUrl(), { method: "POST", headers: postHeaders(cookie, { origin: null, site: null }), body: recordsBody(pageToken(html), "off") }),
      ctx,
    );
    assert.equal(off.status, 303);
    assert.equal(storedAccount(ctx).records, "off");
    const none = await handleAccount(
      new Request(accountUrl(), { method: "POST", headers: postHeaders(cookie, { origin: "null", site: "none" }), body: recordsBody(pageToken(html), "keep") }),
      ctx,
    );
    assert.equal(none.status, 303);
    assert.equal(storedAccount(ctx).records, "keep");
  });

  it("treats www and the apex as the same site, including behind the hosted rewrite", async () => {
    const ctx = world();
    const cookie = clerkCookies();
    const html = await openAccount(ctx, cookie);
    await keepRecords(ctx, cookie, html, postHeaders(cookie, { origin: "https://www.grillyour.ai" }), accountUrl());

    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    Object.assign(process.env, ctx.env);
    globalThis.fetch = ctx.fetch;
    try {
      const { POST } = await import("../api/hosted.js");
      const res = await POST(
        new Request("https://grill-abc123.vercel.app/api/hosted?__route=account", {
          method: "POST",
          headers: postHeaders(cookie, {
            origin: "https://grillyour.ai",
            site: "same-origin",
            extra: { "x-forwarded-host": "www.grillyour.ai", "x-forwarded-proto": "https" },
          }),
          body: recordsBody(pageToken(html), "off"),
        }),
      );
      assert.equal(res.status, 303, await res.clone().text());
      assert.doesNotMatch(res.headers.get("location") || "", /notice=origin/);
      assert.equal(storedAccount(ctx).records, "off");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) {
        if (!(key in saved.env)) delete process.env[key];
      }
      Object.assign(process.env, saved.env);
    }
  });

  it("sends Add checks to Stripe from an Origin of null, on /account and the hosted rewrite", async () => {
    const ctx = world();
    const cookie = `__client_uat=${Math.floor(Date.now() / 1000)}`;
    const html = await openAccount(ctx, clerkCookies());
    const form = formsIn(html).find((item) => item.buttons.some((button) => button.label.startsWith("Add ")));
    assert.match(form.buttons[0].label, /Add 100 checks · \$/);
    const direct = await handleAccount(
      new Request(accountUrl(), { method: "POST", headers: postHeaders(cookie, { origin: "null", site: "same-origin" }), body: formBody(form, form.buttons[0]) }),
      ctx,
    );
    assert.equal(direct.status, 303);
    assert.equal(direct.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");

    const saved = { fetch: globalThis.fetch, env: { ...process.env } };
    Object.assign(process.env, ctx.env);
    globalThis.fetch = ctx.fetch;
    try {
      const { POST } = await import("../api/hosted.js");
      const via = await POST(
        new Request("https://grillyour.ai/api/hosted?__route=account", {
          method: "POST",
          headers: postHeaders(clerkCookies(), { origin: "null", site: "same-origin" }),
          body: formBody(form, form.buttons[0]),
        }),
      );
      assert.equal(via.status, 303);
      assert.equal(via.headers.get("location"), "https://checkout.stripe.com/c/pay/cs_test_topup");
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) {
        if (!(key in saved.env)) delete process.env[key];
      }
      Object.assign(process.env, saved.env);
    }
  });

  it("rejects Origin null without the signed page value, and a cross-site null Origin", async () => {
    const ctx = world();
    const cookie = clerkCookies();
    await openAccount(ctx, cookie);
    const lines = [];
    const original = console.error;
    console.error = (...args) => lines.push(args.map(String).join(" "));
    try {
      const bare = await handleAccount(
        new Request(accountUrl(), { method: "POST", headers: postHeaders(cookie, { origin: "null", site: "same-origin" }), body: "action=records&value=keep" }),
        ctx,
      );
      assert.match(bare.headers.get("location"), /notice=origin/);
      const crossed = await handleAccount(
        new Request(accountUrl(), {
          method: "POST",
          headers: postHeaders(cookie, { origin: "null", site: "cross-site" }),
          body: recordsBody(pageToken(await openAccount(ctx, cookie))),
        }),
        ctx,
      );
      assert.match(crossed.headers.get("location"), /notice=origin/);
    } finally {
      console.error = original;
    }
    const logged = lines.join("\n");
    assert.match(logged, /"origin":"null"/);
    assert.match(logged, /"site":"same-origin"/);
    assert.doesNotMatch(logged, /__session/);
    assert.equal(storedAccount(ctx).records, null);
  });

  it("accepts a foreign Origin when the signed page value matches this account", async () => {
    const ctx = world();
    const cookie = clerkCookies();
    const html = await openAccount(ctx, cookie);
    const res = await handleAccount(
      new Request(accountUrl(), {
        method: "POST",
        headers: postHeaders(cookie, { origin: "https://evil.example", site: "cross-site" }),
        body: recordsBody(pageToken(html)),
      }),
      ctx,
    );
    assert.equal(res.status, 303);
    assert.doesNotMatch(res.headers.get("location"), /notice=origin/);
    assert.equal(storedAccount(ctx).records, "keep");
  });

  it("leads with checks left, one pack button, and no Add checks item in the header", async () => {
    const ctx = world();
    ctx.env.GRILL_TOPUP_PRICE_CENTS = "250";
    ctx.env.GRILL_AUTO_TOPUP = "on";
    const cookie = clerkCookies();
    const html = await openAccount(ctx, cookie);
    const header = html.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0] || "";
    assert.doesNotMatch(header, /Add checks|account#checks/);
    assert.match(header, /<a href="\/decisions">Your grills<\/a>/);
    assert.match(header, /<a href="\/account" aria-current="page">Account<\/a>/);
    const checksAt = html.indexOf('id="checks"');
    const recordsAt = html.indexOf('name="action" value="records"');
    assert.ok(checksAt > 0 && checksAt < recordsAt, "checks sit above the records form");
    assert.equal(html.includes('href="/account#checks"'), false);
    const box = html.slice(checksAt, recordsAt);
    assert.match(box, /<span class="num">100<\/span>/);
    assert.match(box, /Free checks reset on the 1st\./);
    assert.doesNotMatch(box.slice(0, box.indexOf("How checks work")), /Prepaid checks carry over/);
    const more = box.match(/<details class="more-checks">([\s\S]*?)<\/details>/);
    assert.ok(more, "plenty of checks keeps the pack form folded");
    assert.match(more[0], /Need more than 100 a month\? Add 100 checks for \$2\.50/);
    assert.equal(box.includes('<details class="more-checks" open'), false);
    assert.doesNotMatch(box.replace(more[0], ""), /class="primary"/);
    const consentAt = more[1].indexOf("Automatically add another 100 checks ($2.50) when I run out");
    const buttonAt = more[1].indexOf("Add 100 checks · $2.50");
    assert.ok(consentAt > 0 && consentAt < buttonAt, "the later-charge sentence sits above the pack button");
    assert.match(box, /Free: 100 checks a month, resets on the 1st\./);
    assert.match(box, /left this month/);
    assert.match(box, /Prepaid checks left: 0/);
    assert.match(box, /Add 100 checks · \$2\.50/);
    assert.equal(box.match(/<input type="checkbox" name="auto_topup"[^>]*>/)?.[0], '<input type="checkbox" name="auto_topup" value="1">');
    assert.match(box, /Auto-add with this pack<\/span> <span class="pack-switch"><span class="state" data-state="off">Off<\/span>/);
    assert.doesNotMatch(box, /Auto-add when I run out/);
    assert.match(box, /<summary>How checks work<\/summary>/);
    assert.equal(box.includes('<details class="how" open'), false);
    assert.equal(box.includes('class="ceiling"'), false);
    assert.match(box, /Automatically add another 100 checks \(\$2\.50\)/);
    assert.equal(html.includes('id="low-checks"'), false);
    assert.doesNotMatch(html, /No prepaid checks left\./);
    assert.doesNotMatch(html, /\bPro\b|subscription|\$5 of use/);
    assert.ok(contrast("#4a453f", "#f7f4ef") >= 4.5, "helper text on the light page");
    assert.ok(contrast("#c8c0b6", "#161513") >= 4.5, "helper text on the dark page");
    assert.ok(contrast("#7a746c", "#f7f4ef") >= 3, "off switch on the light page");
    assert.ok(contrast("#7a746c", "#161513") >= 3, "off switch on the dark page");
    assert.match(html, /--help:\s*#4a453f/);
    assert.match(html, /--help:\s*#c8c0b6/);
    assert.match(html, /--switch-off:\s*#7a746c/);

    const decisions = await (await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie } }), ctx)).text();
    const decisionsHeader = decisions.match(/<header class="site-header">[\s\S]*?<\/header>/)?.[0] || "";
    assert.doesNotMatch(decisionsHeader, /Add checks|account#checks/);
    assert.match(decisions, /<a href="\/account">Account<\/a>/);
    assert.equal(decisions.includes('href="/account#checks"'), false);
    assert.equal(decisions.includes('id="low-checks"'), false);
    assert.doesNotMatch(decisions, /No prepaid checks left\./);
    assert.doesNotMatch(decisions, /of use each month|left this month|checks this month|judge spend|\bPro\b|subscription/i);
  });

  it("warns only when free checks are low and nothing is prepaid, or both are gone", async () => {
    const cookie = clerkCookies();
    const decisionsOf = (ctx) => handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie } }), ctx);

    const plenty = world();
    const plentyHtml = await openAccount(plenty, cookie);
    assert.equal(plentyHtml.includes('id="low-checks"'), false);
    assert.match(plentyHtml, /100 left this month/);
    assert.equal((await (await decisionsOf(plenty)).text()).includes('id="low-checks"'), false);

    const covered = world();
    covered.memory.command(["SET", freeChecksKey("tester@example.com", isoMonth()), "95"]);
    covered.memory.command(["HSET", topupBalanceKey("tester@example.com"), "checks", "8"]);
    const coveredHtml = await openAccount(covered, cookie);
    assert.equal(coveredHtml.includes('id="low-checks"'), false, "prepaid checks still cover a low free allowance");
    assert.match(coveredHtml, /Prepaid checks left: 8/);
    assert.match(coveredHtml, /5 left this month/);
    assert.match(coveredHtml, /<span class="num">13<\/span>/);
    assert.match(coveredHtml, /Free checks reset on the 1st\. Prepaid checks carry over\./);
    assert.match(coveredHtml, /Need more than 100 a month\?/);

    const freeGone = world();
    freeGone.memory.command(["SET", freeChecksKey("tester@example.com", isoMonth()), "100"]);
    freeGone.memory.command(["HSET", topupBalanceKey("tester@example.com"), "checks", "3"]);
    assert.equal((await openAccount(freeGone, cookie)).includes('id="low-checks"'), false);

    const low = world();
    low.memory.command(["SET", freeChecksKey("tester@example.com", isoMonth()), "95"]);
    const account = await openAccount(low, cookie);
    assert.match(account, /id="low-checks"/);
    assert.match(account, /The free allowance is nearly used up, and there are no prepaid checks\./);
    assert.match(account, /<a href="\/account#checks">Add checks<\/a>/);
    assert.match(account, /5 left this month/);
    assert.match(account, /<span class="num">5<\/span>/);
    assert.match(account, /<button type="submit" class="primary">Add 100 checks · \$5<\/button>/);
    assert.doesNotMatch(account, /Need more than/);
    assert.doesNotMatch(account, /No prepaid checks left\./);
    const decisions = await (await decisionsOf(low)).text();
    assert.match(decisions, /id="low-checks"/);
    assert.ok(decisions.indexOf('id="low-checks"') > decisions.indexOf('<header class="site-header">'));
    assert.match(decisions, /The free allowance is nearly used up, and there are no prepaid checks\./);
    assert.doesNotMatch(decisions, /of use each month|left this month|checks this month|\$0\.40/);

    const out = world();
    out.memory.command(["SET", freeChecksKey("tester@example.com", isoMonth()), "100"]);
    const empty = await openAccount(out, cookie);
    assert.match(empty, /id="low-checks"/);
    assert.match(empty, /No checks left\./);
    assert.match(empty, /0 left this month/);
    assert.match(empty, /<span class="num">0<\/span>/);
    assert.match(empty, /class="primary">Add 100 checks · \$5/);
    assert.doesNotMatch(empty, /Need more than/);
    assert.match(await (await decisionsOf(out)).text(), /No checks left\./);
  });

  it("shows free checks left and does not repeat the older monthly count", async () => {
    const ctx = world();
    const cookie = clerkCookies();
    await openAccount(ctx, cookie);
    const account = storedAccount(ctx);
    ctx.memory.command(["SET", monthlyCheckKey(account.id, isoMonth()), "6"]);
    assert.equal(ctx.memory.command(["GET", freeChecksKey("tester@example.com", isoMonth())]), null);
    const html = await openAccount(ctx, cookie);
    const checksAt = html.indexOf('id="checks"');
    const box = html.slice(checksAt, html.indexOf('name="action" value="records"'));
    assert.match(box, /100 left this month/);
    assert.doesNotMatch(html, /checks this month/);
    assert.doesNotMatch(html, /\b6 checks\b/);
    assert.equal(ctx.memory.command(["GET", freeChecksKey("tester@example.com", isoMonth())]), null);
  });
});

describe("account checkout form action", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  it("lets the Add checks form follow Stripe Checkout and no other site", async () => {
    const ctx = world();
    const res = await handleAccount(new Request(accountUrl(), safariInit("GET", clerkCookies())), ctx);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<form method="post" action="\/account"[^>]*>[\s\S]*Add 100 checks · \$5/);
    const csp = res.headers.get("content-security-policy");
    const formAction = csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("form-action "));
    assert.ok(formAction, csp);
    assert.deepEqual(formAction.slice("form-action ".length).split(/\s+/), ["'self'", "https://checkout.stripe.com"]);
    assert.equal(
      csp,
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self' https://checkout.stripe.com; frame-ancestors 'none'",
    );
  });
});
