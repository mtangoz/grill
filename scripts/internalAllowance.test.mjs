// Addresses on the existing GRILL_INTERNAL_EMAILS list get a higher free-check
// allowance and a higher per-person dollar cap. The outside-count reader is unchanged.
// A person already at the ordinary $5 cap, with no prepaid checks left, is not stopped.
import { createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAccount, resetHostedCaches } from "../api/_hosted.mjs";
import { countsAsOutside } from "./outsideLoopCore.mjs";
import {
  allotGrill,
  allowanceLine,
  capBlock,
  createMemoryRedis,
  freeChecksFor,
  isInternalAccount,
  keyLimitWithTopup,
  personCapUsd,
  personSpendKey,
  toMicros,
  topupExhaustedText,
} from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const LIST = { GRILL_INTERNAL_EMAILS: "Owner@Grill.example, g_outreach" };
const INTERNAL = { id: "g_owner", email: "owner@grill.example" };
const OUTSIDER = { id: "g_pat", email: "pat@elsewhere.example" };

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

describe("internal allowance", () => {
  it("uses the existing list, case-insensitively, for the cap person and the account email", () => {
    assert.equal(isInternalAccount(INTERNAL, LIST), true);
    assert.equal(isInternalAccount({ id: "g_owner", email: "OWNER@grill.example" }, LIST), true);
    assert.equal(isInternalAccount({ id: "g_bot", email: "bot@agents.example", human: "owner@grill.example" }, LIST), true);
    assert.equal(isInternalAccount({ id: "g_bot", email: "owner@grill.example", human: "pat@elsewhere.example" }, LIST), true);
    assert.equal(isInternalAccount({ id: "g_outreach" }, LIST), true);
    assert.equal(isInternalAccount({ id: "G_Outreach" }, LIST), true);
    assert.equal(isInternalAccount(OUTSIDER, LIST), false);
    assert.equal(isInternalAccount({ id: "on", email: "pat@elsewhere.example" }, { GRILL_INTERNAL_EMAILS: "on" }), false);
    assert.equal(isInternalAccount(INTERNAL, {}), false);
    assert.equal(freeChecksFor(LIST, INTERNAL), 2000);
    assert.equal(freeChecksFor(LIST, OUTSIDER), 100);
    assert.equal(freeChecksFor({ ...LIST, GRILL_FREE_CHECKS: "40" }, OUTSIDER), 40);
    assert.equal(freeChecksFor({ ...LIST, GRILL_INTERNAL_FREE_CHECKS: "2500" }, INTERNAL), 2500);
    assert.equal(freeChecksFor({ ...LIST, GRILL_INTERNAL_FREE_CHECKS: "nope" }, INTERNAL), 2000);
    assert.equal(personCapUsd(LIST, INTERNAL), 50);
    assert.equal(personCapUsd(LIST, OUTSIDER), 5);
    assert.equal(personCapUsd({ ...LIST, GRILL_INTERNAL_PERSON_CAP_USD: "80" }, INTERNAL), 80);
    assert.equal(personCapUsd({ ...LIST, GRILL_INTERNAL_PERSON_CAP_USD: "nope" }, INTERNAL), 50);
    assert.equal(allowanceLine(1850, LIST, INTERNAL), "Free: 2000 checks a month, resets on the 1st. 1850 left this month.");
    assert.doesNotMatch(allowanceLine(1850, LIST, INTERNAL), /internal/i);
    assert.equal(personSpendKey("Owner@Grill.example", "2026-11"), personSpendKey("owner@grill.example", "2026-11"));
    assert.equal(countsAsOutside(INTERNAL, LIST), false, "the outside counters still skip this list");
    assert.equal(countsAsOutside(OUTSIDER, LIST), true);
  });

  it("does not stop an internal person who has spent $5 with no prepaid checks, and still stops everyone else", () => {
    const env = { GRILL_TOPUPS: "on", ...LIST };
    const blockedShape = {
      serviceMicros: 0,
      userMicros: toMicros(5),
      env,
      topupChecks: 0,
      topupBudgetMicros: 0,
      topupPresent: true,
      origin: "https://grillyour.ai",
      freeChecksUsed: 3,
    };
    assert.equal(capBlock({ ...blockedShape, account: INTERNAL }), null);
    assert.equal(capBlock({ ...blockedShape, account: { email: "OWNER@grill.example" } }), null);
    const stopped = capBlock({ ...blockedShape, account: OUTSIDER });
    assert.equal(stopped.which, "topup");
    assert.equal(stopped.text, topupExhaustedText("https://grillyour.ai"));
    assert.match(stopped.text, /Your prepaid balance is used up/);
    const service = capBlock({ ...blockedShape, serviceMicros: toMicros(20), account: INTERNAL });
    assert.equal(service.which, "service");
    const next = allotGrill({
      usedChecks: 3,
      draw: 1,
      allowance: freeChecksFor(env, INTERNAL),
      beforeMicros: toMicros(5),
      chargeMicros: toMicros(0.03),
      freeCapMicros: toMicros(personCapUsd(env, INTERNAL)),
      topups: true,
    });
    assert.equal(next.freeChecks, 1);
    assert.equal(next.paidChecks, 0);
    assert.equal(next.freeMicros, toMicros(0.03), "the next grill still counts toward the service cap");
    assert.equal(next.paidMicros, 0);
    assert.equal(keyLimitWithTopup(env, 0, 0, 5, personCapUsd(env, INTERNAL)), 50);
    assert.equal(keyLimitWithTopup({ GRILL_TOPUPS: "on" }, 0, 0, 5), 5);
  });
});

function world(extra = {}) {
  const memory = createMemoryRedis();
  const router = { creates: [], patches: [], usage: 5, limit: 5 };
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
    ...extra,
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
      router.limit = body.limit;
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: body.limit, limit_reset: "monthly" } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "PATCH") {
        const body = JSON.parse(init.body);
        router.patches.push(body);
        if (Number.isFinite(body.limit)) router.limit = body.limit;
        return Response.json({ data: { hash: "hash_tester_1" } });
      }
      return Response.json({ data: { hash: "hash_tester_1", limit: router.limit, usage: router.usage, usage_monthly: router.usage, disabled: false } });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory, router };
}

describe("account page allowance", () => {
  it("shows the internal allowance, and the ordinary one for everyone else", async () => {
    resetHostedCaches();
    const internal = world({ GRILL_INTERNAL_EMAILS: "Tester@Example.com", GRILL_TOPUPS: "on", GRILL_AUTO_TOPUP: "on", GRILL_TOPUP_PRICE_ID: "price_testpack1" });
    const res = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_tester", exp: Math.floor(Date.now() / 1000) + 3600 })}` } }), internal);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /Free: 2000 checks a month, resets on the 1st\./);
    assert.match(html, /Need more than 2000 a month\? Add 100 checks for \$5/);
    assert.doesNotMatch(html, /\binternal\b/i);
    assert.match(html, /If automatic add is on, another pack is charged to your saved card when you run out, up to your monthly ceiling\. You can turn it off on your account page\./);
    assert.doesNotMatch(html, /Nothing is charged later on its own/);
    assert.equal(internal.router.creates[0]?.limit, 50);
    resetHostedCaches();
    const ordinary = world();
    const page = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_other", exp: Math.floor(Date.now() / 1000) + 3600 })}` } }), ordinary);
    assert.match(await page.text(), /Free: 100 checks a month, resets on the 1st\./);
    assert.equal(ordinary.router.creates[0]?.limit, 5);
  });
});
