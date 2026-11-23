// Free checks are the allowance a person sees: 100 a month, same units as a prepaid pack,
// used before prepaid, reset on the 1st (UTC). The dollar caps stay a safety limit.
import { createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleMcp, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_WEB_REDIRECT,
  allotGrill,
  allowanceLine,
  capBlock,
  checksForCost,
  createMemoryRedis,
  freeChecksKey,
  freeMonthlyChecks,
  isoMonth,
  personSpendKey,
  splitChecks,
  toMicros,
  topupBalanceKey,
  userAllowanceUsedText,
  userMonthlyCapUsd,
} from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCE = "https://mcp.example/mcp";
const BANNED = /\$5 of (?:use|free)/i;
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

describe("free check allowance", () => {
  it("defaults to 100 checks and keeps a bad override at that default", () => {
    assert.equal(freeMonthlyChecks({}), 100);
    assert.equal(freeMonthlyChecks({ GRILL_FREE_CHECKS: "40" }), 40);
    assert.equal(freeMonthlyChecks({ GRILL_FREE_CHECKS: "0" }), 0);
    assert.equal(freeMonthlyChecks({ GRILL_FREE_CHECKS: "nope" }), 100);
    assert.equal(userMonthlyCapUsd({}), 5, "the dollar safety cap stays");
    assert.equal(allowanceLine(97), "Free: 100 checks a month, resets on the 1st. 97 left this month.");
    assert.equal(allowanceLine(40, { GRILL_FREE_CHECKS: "40" }), "Free: 40 checks a month, resets on the 1st. 40 left this month.");
  });

  it("uses free checks before prepaid, and leaves prepaid alone while free checks remain", () => {
    assert.deepEqual(splitChecks(0, 1, 100), { freePart: 1, paidPart: 0 });
    assert.deepEqual(splitChecks(99, 1, 100), { freePart: 1, paidPart: 0 });
    const covered = allotGrill({
      usedChecks: 0,
      draw: checksForCost(0.09),
      allowance: 100,
      beforeMicros: 0,
      chargeMicros: toMicros(0.09),
      freeCapMicros: toMicros(5),
      topups: true,
    });
    assert.equal(checksForCost(0.09), 3);
    assert.deepEqual(
      { freeChecks: covered.freeChecks, paidChecks: covered.paidChecks },
      { freeChecks: 3, paidChecks: 0 },
      "a long grill still fits in the free checks, so prepaid is not drawn",
    );
    assert.equal(covered.paidMicros, 0);
    assert.equal(covered.freeMicros, toMicros(0.09));
  });

  it("draws the overflow, including a grill that costs more than one check, from prepaid", () => {
    assert.deepEqual(splitChecks(98, 3, 100), { freePart: 2, paidPart: 1 });
    assert.deepEqual(splitChecks(100, 3, 100), { freePart: 0, paidPart: 3 });
    const straddling = allotGrill({
      usedChecks: 99,
      draw: 3,
      allowance: 100,
      beforeMicros: 0,
      chargeMicros: toMicros(0.09),
      freeCapMicros: toMicros(5),
      topups: true,
    });
    assert.equal(straddling.freeChecks, 1);
    assert.equal(straddling.paidChecks, 2);
    assert.equal(straddling.freeMicros + straddling.paidMicros, toMicros(0.09));
    const spent = allotGrill({
      usedChecks: 100,
      draw: checksForCost(0.07),
      allowance: 100,
      beforeMicros: toMicros(0.5),
      chargeMicros: toMicros(0.07),
      freeCapMicros: toMicros(5),
      topups: true,
    });
    assert.equal(checksForCost(0.07), 3);
    assert.equal(spent.freeChecks, 0);
    assert.equal(spent.paidChecks, 3);
    assert.equal(spent.freeMicros, 0, "prepaid spend does not count against the free dollar cap");
    const safety = allotGrill({
      usedChecks: 0,
      draw: 1,
      allowance: 100,
      beforeMicros: toMicros(5),
      chargeMicros: toMicros(0.03),
      freeCapMicros: toMicros(5),
      topups: true,
    });
    assert.equal(safety.freeChecks, 0);
    assert.equal(safety.paidChecks, 1, "the dollar safety cap still moves a grill onto prepaid");
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 0, env: { GRILL_TOPUPS: "on" }, freeChecksUsed: 100, origin: "https://grillyour.ai" }).text, userAllowanceUsedText("https://grillyour.ai"));
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 0, env: { GRILL_TOPUPS: "on" }, freeChecksUsed: 99, topupChecks: 10 }), null);
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 0, freeChecksUsed: 99 }), null);
  });

  it("resets on the 1st UTC because the counter key includes the month", () => {
    const email = "tester@example.com";
    const november = Date.UTC(2026, 10, 30, 23, 0, 0);
    const december = Date.UTC(2026, 11, 1, 0, 0, 0);
    assert.equal(isoMonth(november), "2026-11");
    assert.equal(isoMonth(december), "2026-12");
    assert.notEqual(freeChecksKey(email, isoMonth(november)), freeChecksKey(email, isoMonth(december)));
    assert.equal(freeChecksKey(email, "2026-12").endsWith(":2026-12"), true);
  });
});

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "_site") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(html|md|mjs|js)$/.test(name)) out.push(path);
  }
}

describe("user-facing copy", () => {
  it("does not say $5 of use or $5 of free", () => {
    const files = [join(ROOT, "README.md")];
    for (const dir of ["site", "api", "skills"]) walk(join(ROOT, dir), files);
    for (const name of ["HOSTED.md", "UX.md", "STRATEGY.md", "DATA-LEDGER.md"]) files.push(join(ROOT, "docs", name));
    const hits = [];
    for (const path of files) {
      const text = readFileSync(path, "utf8");
      if (BANNED.test(text)) hits.push(path.slice(ROOT.length + 1));
    }
    assert.deepEqual(hits, []);
    assert.match(readFileSync(join(ROOT, "site/page.html"), "utf8"), /Free: 100 checks a month\. No card\./);
    assert.match(readFileSync(join(ROOT, "site/terms.html"), "utf8"), /100 free checks a month/);
    assert.match(readFileSync(join(ROOT, "site/faq.html"), "utf8"), /100 free checks a month/);
    assert.match(readFileSync(join(ROOT, "site/start.html"), "utf8"), /Free: 100 checks a month\. No card\./);
    assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /100 free checks a month/);
  });
});

function world(extra = {}) {
  const memory = createMemoryRedis();
  const router = { creates: [], patches: [], usage: 0.03, limit: 5 };
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
      return Response.json({ key: "sk-or-v1-made-up-tester-key-0001", data: { hash: "hash_tester_1", limit: body.limit, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "PATCH") {
        router.patches.push(JSON.parse(init.body));
        return Response.json({ data: { hash: "hash_tester_1" } });
      }
      return Response.json({ data: { hash: "hash_tester_1", limit: router.limit, usage: router.usage, usage_monthly: router.usage, disabled: false } });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: (args) => memory.command(args), memory, router };
}

describe("a hosted grill draws free checks before prepaid", () => {
  it("leaves prepaid untouched, then draws three checks once the free month is used, and resets on the 1st", async () => {
    const pricey = readFileSync(new URL("./fixtures/usable-response.json", import.meta.url), "utf8").replace('"cost": 0.0123', '"cost": 0.09');
    const november = Date.UTC(2026, 10, 20, 12, 0, 0);
    const december = Date.UTC(2026, 11, 1, 0, 5, 0);
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world({ GRILL_TOPUPS: "on" });
      const token = signJwt({ iss: "https://clerk.example.test", sub: "user_tester", aud: RESOURCE, exp: Math.floor(Date.now() / 1000) + 3600, redirect_uri: CLAUDE_WEB_REDIRECT });
      const call = (id, subject, now, openrouter = fake) =>
        handleMcp(
          new Request(RESOURCE, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "grill", arguments: { subject, keep_records: false, quality_check: false } } }),
          }),
          { ...ctx, now, judgeOpenRouterUrl: openrouter.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: openrouter.env.JUDGE_DECISIONS_URL },
        );
      const first = await call(1, "Decision: Repaint the shed\nI'm 60% sure.", november);
      assert.equal((await first.json()).result.isError, false);
      const balance = topupBalanceKey("tester@example.com");
      const freeNow = freeChecksKey("tester@example.com", isoMonth(november));
      await ctx.redis(["HSET", balance, "checks", "40"]);
      await ctx.redis(["HSET", balance, "budget_micros", String(toMicros(3))]);
      resetHostedCaches();
      const second = await call(2, "Decision: keep the door blue.", november);
      assert.equal((await second.json()).result.isError, false);
      assert.equal(Number(await ctx.redis(["HGET", balance, "checks"])), 40, "prepaid stays while free checks remain");
      assert.equal(Number(await ctx.redis(["GET", freeNow])), 2);
      const person = personSpendKey("tester@example.com", isoMonth(november));
      const beforeDollars = Number(await ctx.redis(["GET", person]));
      await ctx.redis(["SET", freeNow, "100"]);
      resetHostedCaches();
      const longFake = await startFakeOpenRouter({ chat: () => ({ text: pricey }) });
      try {
        const third = await call(3, "Decision: a long write-up.", november, longFake);
        const thirdJson = await third.json();
        assert.equal(thirdJson.result.isError, false, thirdJson.result?.content?.[0]?.text || "");
      } finally {
        await longFake.close();
      }
      assert.equal(Number(await ctx.redis(["HGET", balance, "checks"])), 37, "a $0.09 grill draws 3 prepaid checks");
      assert.equal(Number(await ctx.redis(["GET", freeNow])), 100, "free checks do not grow once the month is used");
      assert.equal(Number(await ctx.redis(["GET", person])), beforeDollars, "prepaid spend stays off the free dollar counter");
      await ctx.redis(["HSET", balance, "checks", "40"]);
      resetHostedCaches();
      const fourth = await call(4, "Decision: a new month.", december);
      assert.equal((await fourth.json()).result.isError, false);
      assert.equal(Number(await ctx.redis(["HGET", balance, "checks"])), 40, "the 1st starts a new free month");
      assert.equal(Number(await ctx.redis(["GET", freeChecksKey("tester@example.com", isoMonth(december))])), 1);
      assert.equal(Number(await ctx.redis(["GET", freeNow])), 100);
    } finally {
      await fake.close();
    }
  });
});
