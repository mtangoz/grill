// Grill Pro accounts: magic link, managed key, setup, sample grill, rotate, cancel.
// Stripe and OpenRouter are faked. The sample grill uses the project's loopback stand-in.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STRIPE_API } from "../api/_pro.mjs";
import { createMockManagement } from "../api/_mockRouter.mjs";
import {
  consumeMagicLink,
  defaultJudge,
  fileStore,
  handlePro,
  handleProAuth,
  handleProReports,
  handleProTry,
  judgeAllowed,
  memoryStore,
  readUsageReport,
  redisStore,
  renderSetupConfig,
  signPayload,
  startMagicLink,
  stripeStore,
  syncAccountSubscription,
  testModeEnabled,
  usageReport,
} from "../api/_account.mjs";

const NOW = Date.UTC(2026, 8, 26, 20, 0, 0);
const ENV = {
  GRILL_PRO_TEST_MODE: "1",
  GRILL_SESSION_SECRET: "test-session-secret-32",
  OPENROUTER_MANAGEMENT_KEY: "mgmt_test",
  NODE_ENV: "test",
};

function deps(store, fetch, env = ENV, now = NOW) {
  return { env, fetch, store, now };
}

async function body(res) {
  return res.text();
}

function cookieFrom(res) {
  const raw = res.headers.get("set-cookie") || "";
  const m = raw.match(/grill_pro=([^;]+)/);
  assert.ok(m, raw);
  return `grill_pro=${m[1]}`;
}

function post(handler, path, fields, cookie, d) {
  return handler(
    new Request(`https://grillyour.ai${path}`, {
      method: "POST",
      headers: { cookie: cookie || "", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
    d,
  );
}

describe("test mode stays off in production", () => {
  it("requires the flag, and ignores it when production is set", () => {
    assert.equal(testModeEnabled({}), false);
    assert.equal(testModeEnabled({ GRILL_PRO_TEST_MODE: "1" }), true);
    assert.equal(testModeEnabled({ GRILL_PRO_TEST_MODE: "1", VERCEL_ENV: "production" }), false);
    assert.equal(testModeEnabled({ GRILL_PRO_TEST_MODE: "1", NODE_ENV: "production" }), false);
    assert.equal(testModeEnabled({ GRILL_PRO_TEST_MODE: "yes" }), false);
  });
});

describe("the judge has to be a different company", () => {
  it("defaults each assistant to a company it isn't, and blocks Copilot's own vendors", () => {
    for (const id of ["claude-desktop", "claude-web", "claude-code", "chatgpt", "copilot", "gemini", "grok", "muse"]) {
      assert.equal(judgeAllowed(id, defaultJudge(id)), true, id);
    }
    assert.equal(judgeAllowed("claude-desktop", "anthropic/claude-sonnet-4.5"), false);
    assert.equal(judgeAllowed("chatgpt", "openai/gpt-5.6-sol"), false);
    assert.equal(judgeAllowed("copilot", "openai/gpt-5.6-sol"), false);
    assert.equal(judgeAllowed("copilot", "anthropic/claude-sonnet-4.5"), false);
    assert.equal(judgeAllowed("copilot", "x-ai/grok-4"), false);
    assert.equal(judgeAllowed("copilot", "google/gemini-2.5-pro"), true);
    assert.equal(judgeAllowed("gemini", "openai/gpt-5.6-sol"), true);
  });

  it("puts the managed key in the one-click config, and keeps it out of a paste instruction", () => {
    const key = "sk-or-v1-test-config-only";
    const desktop = renderSetupConfig({ assistant: "claude-desktop", judge: "google/gemini-2.5-pro", key });
    assert.match(desktop, new RegExp(key));
    assert.match(desktop, /google\/gemini-2\.5-pro/);
    assert.match(desktop, /Claude Desktop/);
    const paste = renderSetupConfig({ assistant: "chatgpt", judge: "google/gemini-2.5-pro", key });
    assert.match(paste, /Do not paste the key into the chat/);
    const [warning, rest] = paste.split("Do not paste the key into the chat.");
    assert.ok(!warning.includes(key));
    assert.ok(rest.includes(key), "the one-click section still carries the key");
    assert.match(paste, /Gemini/);
  });
});

describe("the account flow", () => {
  it("signs in, simulates a purchase, sets up, grills, rotates and cancels", { timeout: 30000 }, async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const d = deps(store, fetch, { ...ENV, GRILL_PRO_BILLING: "subscription" });
    const email = "pro@example.com";

    const sent = await post(handleProAuth, "/pro/auth", { email }, "", d);
    assert.equal(sent.status, 200);
    const sentHtml = await body(sent);
    assert.match(sentHtml, /Test mode/);
    const link = sentHtml.match(/id="magic" href="([^"]+)"/)?.[1];
    assert.ok(link?.includes("/pro/auth?token="), sentHtml);
    const token = new URL(link, "https://grillyour.ai").searchParams.get("token");

    const authed = await handleProAuth(new Request(`https://grillyour.ai/pro/auth?token=${encodeURIComponent(token)}`), d);
    assert.equal(authed.status, 303);
    const cookie = cookieFrom(authed);
    const again = await handleProAuth(new Request(`https://grillyour.ai/pro/auth?token=${encodeURIComponent(token)}`), d);
    assert.equal(again.status, 400, "a magic link works once");

    const bought = await post(handlePro, "/pro", { action: "purchase" }, cookie, d);
    assert.equal(bought.status, 200);
    const boughtHtml = await body(bought);
    const key = boughtHtml.match(/id="k"[^>]*value="([^"]+)"/)?.[1];
    assert.ok(key?.startsWith("sk-or-v1-test-"), boughtHtml);
    assert.ok(!JSON.stringify(store.dump()).includes(key), "the raw key is not stored");

    const bad = await post(handlePro, "/pro", { action: "setup", assistant: "claude-desktop", judge: "anthropic/claude-sonnet-4.5", key }, cookie, d);
    assert.equal(bad.status, 400);
    const badHtml = await body(bad);
    assert.match(badHtml, /different company/);
    assert.match(badHtml, new RegExp(`id="key"[^>]*value="${key}"`), "a rejected setup keeps the key in the form");
    assert.match(badHtml, /data-company="anthropic"/);

    const setup = await post(
      handlePro,
      "/pro",
      { action: "setup", assistant: "claude-desktop", judge: "google/gemini-2.5-pro", key },
      cookie,
      d,
    );
    assert.equal(setup.status, 200);
    const setupHtml = await body(setup);
    assert.match(setupHtml, new RegExp(key));
    assert.match(setupHtml, /google\/gemini-2\.5-pro/);
    assert.match(setupHtml, /Run a sample grill/);

    const grilled = await post(
      handleProTry,
      "/pro/try",
      { key, subject: "We're moving our launch to March. I'm 70% sure it gets us more signups." },
      cookie,
      d,
    );
    assert.equal(grilled.status, 200, await grilled.clone().text());
    const grilledHtml = await body(grilled);
    assert.match(grilledHtml, /Verdict|weak/i);
    assert.ok(!grilledHtml.includes("[key]"), "the report had no reason to echo the key");
    assert.ok(!JSON.stringify(store.dump()).includes("Steelman"), "saving is off, so the sample is not kept");

    const home = await handlePro(new Request("https://grillyour.ai/pro", { headers: { cookie } }), d);
    const homeHtml = await body(home);
    assert.match(homeHtml, /Signed in as pro@example.com/);
    assert.match(homeHtml, /Used \$0\.01 of \$3\. That is this month/);

    const rotated = await post(handlePro, "/pro", { action: "rotate" }, cookie, d);
    const rotatedHtml = await body(rotated);
    const nextKey = rotatedHtml.match(/id="k"[^>]*value="([^"]+)"/)?.[1];
    assert.ok(nextKey && nextKey !== key);
    const oldHash = [...fetch.keys.values()].find((row) => row.disabled)?.hash;
    assert.ok(oldHash, "the previous key is switched off");
    const stale = await post(handleProTry, "/pro/try", { key, subject: "A second look." }, cookie, d);
    assert.equal(stale.status, 400);

    const cancelled = await post(handlePro, "/pro", { action: "cancel" }, cookie, d);
    assert.match(await body(cancelled), /Pro is cancelled/);
    const afterCancel = await handlePro(new Request("https://grillyour.ai/pro", { headers: { cookie } }), d);
    assert.match(await body(afterCancel), /This key is switched off/);
    const left = [...fetch.keys.values()].filter((row) => !row.disabled);
    assert.equal(left.length, 0);
    const after = await store.getByEmail(email);
    assert.equal(after.subscription, "canceled");
    assert.equal(after.activeHash, null);
    assert.ok(!JSON.stringify(store.dump()).includes(nextKey));
  });

  it("refuses a simulated purchase and the sample grill when test mode is off", async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const env = { GRILL_SESSION_SECRET: ENV.GRILL_SESSION_SECRET, OPENROUTER_MANAGEMENT_KEY: "mgmt_test", GRILL_PRO_BILLING: "subscription" };
    const d = deps(store, fetch, env);
    const started = await startMagicLink("off@example.com", d);
    const session = signPayload({ t: "s", sub: started.account.id, exp: Math.floor(NOW / 1000) + 3600 }, env.GRILL_SESSION_SECRET);
    const cookie = `grill_pro=${encodeURIComponent(session)}`;
    const bought = await post(handlePro, "/pro", { action: "purchase" }, cookie, d);
    assert.equal(bought.status, 400);
    assert.match(await body(bought), /Stripe/);
    const tried = await post(handleProTry, "/pro/try", { key: "x", subject: "y" }, cookie, d);
    assert.equal(tried.status, 404);
  });

  it("remembers an account in a file, and a second process can read it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-acct-"));
    const path = join(dir, "store.json");
    try {
      const a = fileStore(path);
      await a.put({
        id: "acct_file",
        email: "file@example.com",
        createdAt: "t",
        stripeCustomerId: null,
        subscription: "none",
        assistant: null,
        judgeModel: null,
        keys: [],
        activeHash: null,
        lastLinkAt: 0,
      });
      const b = fileStore(path);
      assert.equal((await b.getByEmail("file@example.com")).id, "acct_file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("report history", () => {
  async function signedIn(email, d) {
    const sent = await post(handleProAuth, "/pro/auth", { email }, "", d);
    const link = (await body(sent)).match(/id="magic" href="([^"]+)"/)?.[1];
    const token = new URL(link, "https://grillyour.ai").searchParams.get("token");
    const authed = await handleProAuth(new Request(`https://grillyour.ai/pro/auth?token=${encodeURIComponent(token)}`), d);
    return cookieFrom(authed);
  }

  it("shows a report only to the owner, and only after they turn saving on", { timeout: 30000 }, async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const d = deps(store, fetch, { ...ENV, GRILL_PRO_BILLING: "subscription" });
    const owner = await signedIn("owner@example.com", d);
    const other = await signedIn("other@example.com", d);

    const hidden = await handleProReports(new Request("https://grillyour.ai/pro/reports"), d);
    assert.equal(hidden.status, 401);

    const bought = await post(handlePro, "/pro", { action: "purchase" }, owner, d);
    const key = (await body(bought)).match(/id="k"[^>]*value="([^"]+)"/)?.[1];
    await post(handlePro, "/pro", { action: "setup", assistant: "chatgpt", judge: "google/gemini-2.5-pro", key }, owner, d);

    const empty = await handleProReports(new Request("https://grillyour.ai/pro/reports", { headers: { cookie: owner } }), d);
    const emptyHtml = await body(empty);
    assert.match(emptyHtml, /does not email you a verdict/);
    assert.match(emptyHtml, /Saving is off/);

    const grilled = await post(handleProTry, "/pro/try", { key, subject: "Move the launch." }, owner, d);
    assert.equal(grilled.status, 200);
    assert.match(await body(grilled), /Steelman/);
    assert.ok(!JSON.stringify(store.dump()).includes("Steelman"));

    const on = await post(handleProReports, "/pro/reports", { action: "save-on" }, owner, d);
    assert.match(await body(on), /Saving is on/);

    const again = await post(handleProTry, "/pro/try", { key, subject: "Move the launch." }, owner, d);
    assert.equal(again.status, 200);
    const listed = await handleProReports(new Request("https://grillyour.ai/pro/reports", { headers: { cookie: owner } }), d);
    const listedHtml = await body(listed);
    assert.match(listedHtml, /Test-mode sample grill/);
    const id = listedHtml.match(/\/pro\/reports\?id=(rpt_[0-9a-f]+)/)?.[1];
    assert.ok(id);

    const seen = await handleProReports(new Request(`https://grillyour.ai/pro/reports?id=${id}`, { headers: { cookie: owner } }), d);
    assert.equal(seen.status, 200);
    assert.match(await body(seen), /Steelman/);

    const stolen = await handleProReports(new Request(`https://grillyour.ai/pro/reports?id=${id}`, { headers: { cookie: other } }), d);
    assert.equal(stolen.status, 404);
    const stolenHtml = await body(stolen);
    assert.match(stolenHtml, /That report isn(?:'|&#39;)t on this account/);
    assert.ok(!stolenHtml.includes("Steelman"));

    const removed = await post(handleProReports, "/pro/reports", { action: "delete", id }, owner, d);
    assert.equal(removed.status, 200);
    assert.ok(!(await body(removed)).includes("Steelman"));

    await post(handleProTry, "/pro/try", { key, subject: "Move the launch again." }, owner, d);
    const wiped = await post(handleProReports, "/pro/reports", { action: "delete-all" }, owner, d);
    assert.match(await body(wiped), /Nothing is saved yet/);
    assert.equal((await store.getByEmail("owner@example.com")).reports.length, 0);

    await post(handleProReports, "/pro/reports", { action: "save-off" }, owner, d);
    await post(handleProTry, "/pro/try", { key, subject: "Move the launch once more." }, owner, d);
    const left = await store.getByEmail("owner@example.com");
    assert.equal(left.saveReports, false);
    assert.equal(left.reports.length, 0);
    assert.ok(!JSON.stringify(store.dump()).includes("Steelman"));
  });
});

describe("the starter allowance", () => {
  async function signedIn(email, d) {
    const sent = await post(handleProAuth, "/pro/auth", { email }, "", d);
    const link = (await body(sent)).match(/id="magic" href="([^"]+)"/)?.[1];
    const token = new URL(link, "https://grillyour.ai").searchParams.get("token");
    const authed = await handleProAuth(new Request(`https://grillyour.ai/pro/auth?token=${encodeURIComponent(token)}`), d);
    return cookieFrom(authed);
  }

  it("gives one capped key with no card, and does not mint a second", async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const d = deps(store, fetch);
    const cookie = await signedIn("starter@example.com", d);
    const home = await body(await handlePro(new Request("https://grillyour.ai/pro", { headers: { cookie } }), d));
    assert.match(home, /Get a starter key/);
    assert.match(home, /\$0\.50/);
    assert.doesNotMatch(home, /Simulate purchase/);

    const issued = await post(handlePro, "/pro", { action: "starter" }, cookie, d);
    assert.equal(issued.status, 200);
    const key = (await body(issued)).match(/id="k"[^>]*value="([^"]+)"/)?.[1];
    assert.ok(key?.startsWith("sk-or-v1-test-"));
    const row = [...fetch.keys.values()][0];
    assert.equal(row.limit, 0.5);
    assert.equal(row.limit_reset, null);
    assert.equal(fetch.keys.size, 1);

    const again = await post(handlePro, "/pro", { action: "starter" }, cookie, d);
    assert.equal(again.status, 400);
    assert.match(await body(again), /already has its starter key/);
    assert.equal(fetch.keys.size, 1);
    const account = await store.getByEmail("starter@example.com");
    assert.equal(account.plan, "starter");
    assert.equal(account.starterIssued, true);
    assert.equal(account.subscription, "none");

    const report = await readUsageReport(store);
    assert.equal(report.accountCreated, 1);
    assert.equal(report.keyIssued, 1);
    assert.equal(report.activation, 0);
  });

  it("rotates only the remainder, and stops at three keys an hour", async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const d = deps(store, fetch);
    const cookie = await signedIn("rotate@example.com", d);
    const issued = await post(handlePro, "/pro", { action: "starter" }, cookie, d);
    const first = [...fetch.keys.values()][0];
    fetch.noteUsage(first.hash, 0.2);
    const rotated = await post(handlePro, "/pro", { action: "rotate" }, cookie, d);
    assert.equal(rotated.status, 200, await rotated.clone().text());
    const live = [...fetch.keys.values()].filter((row) => !row.disabled);
    assert.equal(live.length, 1);
    assert.equal(live[0].limit, 0.3);
    assert.equal(live[0].limit_reset, null);

    const third = await post(handlePro, "/pro", { action: "rotate" }, cookie, d);
    assert.equal(third.status, 200, await third.clone().text());
    const blocked = await post(handlePro, "/pro", { action: "rotate" }, cookie, d);
    assert.equal(blocked.status, 429);
    assert.match(await body(blocked), /too many new keys/);
    const still = [...fetch.keys.values()].filter((row) => !row.disabled);
    assert.equal(still.length, 1, "a refused rotation leaves the current key on");
  });

  it("refuses to rotate once the allowance is spent, and does not refill it", async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const d = deps(store, fetch);
    const cookie = await signedIn("spent@example.com", d);
    await post(handlePro, "/pro", { action: "starter" }, cookie, d);
    const first = [...fetch.keys.values()][0];
    fetch.noteUsage(first.hash, 0.5);
    const refused = await post(handlePro, "/pro", { action: "rotate" }, cookie, d);
    assert.equal(refused.status, 400);
    assert.match(await body(refused), /used up/);
    assert.equal([...fetch.keys.values()].filter((row) => !row.disabled).length, 1);
    assert.equal(fetch.keys.size, 1);
  });

  it("counts activation, depletion and an upgrade click, and still stores no decision text", { timeout: 30000 }, async () => {
    const store = memoryStore();
    const fetch = createMockManagement();
    const env = { ...ENV, GRILL_STARTER_ALLOWANCE_USD: "0.50" };
    const d = deps(store, fetch, env);
    const cookie = await signedIn("events@example.com", d);
    const issued = await post(handlePro, "/pro", { action: "starter" }, cookie, d);
    const key = (await body(issued)).match(/id="k"[^>]*value="([^"]+)"/)?.[1];
    await post(handlePro, "/pro", { action: "setup", assistant: "claude-desktop", judge: "google/gemini-2.5-pro", key }, cookie, d);
    const grilled = await post(
      handleProTry,
      "/pro/try",
      { key, subject: "We're moving our launch to March. I'm 70% sure it gets us more signups." },
      cookie,
      d,
    );
    assert.equal(grilled.status, 200, await grilled.clone().text());
    assert.ok(!JSON.stringify(store.dump()).includes("Steelman"));

    const hash = [...fetch.keys.keys()][0];
    fetch.noteUsage(hash, 0.5);
    const home = await body(await handlePro(new Request("https://grillyour.ai/pro", { headers: { cookie } }), d));
    assert.match(home, /does not refill/);
    const upgraded = await post(handlePro, "/pro", { action: "upgrade" }, cookie, d);
    assert.equal(upgraded.status, 200);
    assert.match(await body(upgraded), /Paid plans aren't on/);

    const report = await readUsageReport(store);
    assert.equal(report.accountCreated, 1);
    assert.equal(report.keyIssued, 1);
    assert.equal(report.activation, 1);
    assert.equal(report.depletion, 1);
    assert.equal(report.upgradeClicked, 1);
    assert.deepEqual(usageReport({ first_grill: "2", allowance_exhausted: -3, account_created: "nope" }), {
      accountCreated: 0,
      keyIssued: 0,
      activation: 2,
      depletion: 0,
      upgradeClicked: 0,
    });
    const paid = await post(handlePro, "/pro", { action: "purchase" }, cookie, d);
    assert.equal(paid.status, 400);
    const paidHtml = await body(paid);
    assert.match(paidHtml, /Paid plans are off/);
    assert.doesNotMatch(paidHtml, /Stripe/);
  });
});

describe("redis and stripe stores", () => {
  it("round-trips an account and a single-use nonce through the Redis REST API", async () => {
    const db = new Map();
    const fetch = async (_url, init) => {
      const [cmd, key, val] = JSON.parse(init.body);
      if (cmd === "GET") return Response.json({ result: db.get(key) ?? null });
      if (cmd === "SET") {
        db.set(key, String(val));
        return Response.json({ result: "OK" });
      }
      if (cmd === "DEL") {
        db.delete(key);
        return Response.json({ result: 1 });
      }
      if (cmd === "GETDEL") {
        const v = db.get(key) ?? null;
        db.delete(key);
        return Response.json({ result: v });
      }
      if (cmd === "INCR") {
        const n = Number(db.get(key) || 0) + 1;
        db.set(key, String(n));
        return Response.json({ result: n });
      }
      return Response.json({ result: null }, { status: 400 });
    };
    const env = { ...ENV, GRILL_PRO_TEST_MODE: "", UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "tok" };
    const store = redisStore(env, fetch);
    const started = await startMagicLink("redis@example.com", deps(store, fetch, env));
    const consumed = await consumeMagicLink(started.token, deps(store, fetch, env));
    assert.equal(consumed.account.email, "redis@example.com");
    assert.equal(await consumeMagicLink(started.token, deps(store, fetch, env)), null);
    const saved = [...db.values()].join("\n");
    assert.ok(!saved.includes(started.token), "the raw magic token is not stored");
    assert.equal(db.get("grill:metric:account_created"), "1");
    assert.equal((await readUsageReport(store)).activation, 0);
  });

  it("keeps the account on the Stripe customer, including the key hash and not the key", async () => {
    const customers = new Map();
    const fetch = async (url, init = {}) => {
      const method = init.method ?? "GET";
      const u = new URL(url);
      if (method === "POST" && u.pathname === "/v1/customers") {
        const id = "cus_NewAcct1";
        const form = new URLSearchParams(init.body);
        customers.set(id, { id, email: form.get("email"), metadata: { grill_sub: "none" } });
        return Response.json(customers.get(id));
      }
      const one = u.pathname.match(/^\/v1\/customers\/(cus_[A-Za-z0-9]+)$/);
      if (method === "GET" && one) return Response.json(customers.get(one[1]) ?? {});
      if (method === "GET" && u.pathname === "/v1/customers") {
        const email = u.searchParams.get("email");
        const row = [...customers.values()].find((c) => c.email === email);
        return Response.json({ data: row ? [row] : [] });
      }
      if (method === "POST" && one) {
        const form = new URLSearchParams(init.body);
        const customer = customers.get(one[1]);
        customer.metadata ??= {};
        for (const [k, v] of form) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (!m) continue;
          if (v === "") delete customer.metadata[m[1]];
          else customer.metadata[m[1]] = v;
        }
        return Response.json(customer);
      }
      return Response.json({ error: `unrouted ${method} ${url}` }, { status: 599 });
    };
    const env = { GRILL_SESSION_SECRET: ENV.GRILL_SESSION_SECRET, STRIPE_SECRET_KEY: "sk_test_fake", OPENROUTER_MANAGEMENT_KEY: "mgmt_test" };
    const store = stripeStore(env, async (url, init) => fetch(url.startsWith("http") ? url : `${STRIPE_API}${url}`, init));
    // proClients prefixes STRIPE_API itself, so pass fetch that sees the full URL.
    const full = async (url, init) => fetch(url, init);
    const stripe = stripeStore(env, full);
    const started = await startMagicLink("stripe@example.com", deps(stripe, full, env));
    assert.equal(started.account.id, "cus_NewAcct1");
    const consumed = await consumeMagicLink(started.token, deps(stripe, full, env));
    assert.ok(consumed.session);
    assert.equal(await consumeMagicLink(started.token, deps(stripe, full, env)), null);
    const meta = JSON.stringify(customers.get("cus_NewAcct1").metadata);
    assert.ok(!meta.includes("sk-or-"));
    const withReport = await stripe.getByEmail("stripe@example.com");
    withReport.saveReports = true;
    withReport.reports = [{ id: "rpt_aaaaaaaaaaaaaaaa", kind: "grill", title: "Secret title", body: "SENTINEL-REPORT-BODY", createdAt: "2026-09-27" }];
    await stripe.put(withReport);
    const after = JSON.stringify(customers.get("cus_NewAcct1").metadata);
    assert.ok(!after.includes("SENTINEL-REPORT-BODY"));
    assert.ok(!after.includes("Secret title"));
    assert.ok(!JSON.stringify(await stripe.getById("cus_NewAcct1")).includes("SENTINEL-REPORT-BODY"));
    const refused = await post(handleProReports, "/pro/reports", { action: "save-on" }, `grill_pro=${encodeURIComponent(consumed.session)}`, deps(stripe, full, env));
    assert.equal(refused.status, 400);
    assert.match(await body(refused), /not stored on your Stripe customer/);
    assert.ok(store);
  });

  it("a subscription webhook marks the matching account cancelled", async () => {
    const store = memoryStore();
    const account = {
      id: "acct_wh",
      email: "wh@example.com",
      createdAt: "t",
      stripeCustomerId: "cus_ABC123def",
      subscription: "active",
      assistant: "claude-desktop",
      judgeModel: "google/gemini-2.5-pro",
      keys: [{ hash: "ab".repeat(32), check: "cd".repeat(32), disabled: false }],
      activeHash: "ab".repeat(32),
      lastLinkAt: 0,
    };
    await store.put(account);
    const fetch = async (url) => {
      assert.match(url, /\/v1\/subscriptions/);
      return Response.json({ data: [{ status: "canceled" }] });
    };
    const env = { STRIPE_SECRET_KEY: "sk_test_fake", OPENROUTER_MANAGEMENT_KEY: "mgmt_test" };
    const out = await syncAccountSubscription(
      { type: "customer.subscription.deleted", data: { object: { customer: "cus_ABC123def" } } },
      deps(store, fetch, env),
    );
    assert.equal(out.action, "canceled");
    assert.equal((await store.getById("acct_wh")).subscription, "canceled");
    assert.equal((await store.getById("acct_wh")).activeHash, null);
  });
});
