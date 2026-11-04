// First 100 people let in are founding members. Made-up addresses only.
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { signPayload } from "../api/_account.mjs";
import {
  FOUNDING_CAP,
  FOUNDING_COUNT_KEY,
  assignFoundingMember,
  backfillFoundingMembers,
  foundingBackfillOrder,
  foundingMemberLine,
  foundingSkipsPaywall,
  foundingSpotsLine,
  readFoundingCount,
} from "../api/_founding.mjs";
import { PAID_INTENT_KEYS } from "../api/_paidIntent.mjs";
import { handlePricing } from "../api/_pricing.mjs";
import { handleStart } from "../api/_start.mjs";
import { createMemoryRedis } from "./hostedCore.mjs";
import { FOUNDING_COUNT_KEY as WEEKLY_KEY, weeklyMetricLines } from "./weeklyMetricsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function commandFor(memory = createMemoryRedis()) {
  return {
    memory,
    command: async (args) => memory.command(args),
  };
}

describe("founding members", () => {
  it("assigns one number per email and stops at 100", async () => {
    const { command, memory } = commandFor();
    const first = await assignFoundingMember(command, "Ada@Example.com");
    const again = await assignFoundingMember(command, "ada@example.com");
    assert.equal(first.number, 1);
    assert.equal(again.number, 1);
    assert.equal(again.already, true);
    assert.equal(await readFoundingCount(command), 1);
    assert.equal(foundingMemberLine(1), "Founding member #1 of 100: Grill is free for you for life.");
    assert.equal(foundingSkipsPaywall(1), true);
    assert.equal(foundingSkipsPaywall(null), false);

    for (let i = 2; i <= FOUNDING_CAP; i += 1) {
      const result = await assignFoundingMember(command, `member${i}@example.com`);
      assert.equal(result.number, i);
    }
    const late = await assignFoundingMember(command, "late@example.com");
    assert.equal(late.ok, false);
    assert.equal(late.reason, "full");
    assert.equal(memory.command(["GET", FOUNDING_COUNT_KEY]), "100");
    assert.equal(foundingSpotsLine(0), "First 100 users get Grill free for life, 100 spots left.");
    assert.equal(foundingSpotsLine(99), "First 100 users get Grill free for life, 1 spot left.");
    assert.equal(foundingSpotsLine(100), "All 100 founding spots are taken.");
  });

  it("backfills invitees and testers by first access and skips Tony's own addresses", async () => {
    const people = [
      { email: "tony.keeper@example.com", at: "2026-01-01T00:00:00.000Z" },
      { email: "Later@Example.com", at: "2026-03-02T00:00:00.000Z" },
      { email: "early@example.com", at: "2026-02-01T00:00:00.000Z" },
      { email: "early@example.com", at: "2026-04-01T00:00:00.000Z" },
      { email: "nodate@example.com" },
      { email: "owner@example.com", at: "2026-01-02T00:00:00.000Z" },
    ];
    const order = foundingBackfillOrder(people, ["Tony.Keeper@example.com", "owner@example.com"]);
    assert.deepEqual(order.map((row) => row.email), ["early@example.com", "later@example.com", "nodate@example.com"]);

    const { command } = commandFor();
    const assigned = await backfillFoundingMembers(command, people, ["tony.keeper@example.com", "owner@example.com"]);
    assert.deepEqual(
      assigned.map((row) => [row.email, row.number]),
      [
        ["early@example.com", 1],
        ["later@example.com", 2],
        ["nodate@example.com", 3],
      ],
    );
    const second = await backfillFoundingMembers(command, people, ["tony.keeper@example.com", "owner@example.com"]);
    assert.deepEqual(second.map((row) => row.number), [1, 2, 3]);
    assert.equal(await readFoundingCount(command), 3);
  });

  it("documents the backfill order and the weekly line", () => {
    const hosted = readFileSync(join(ROOT, "docs/HOSTED.md"), "utf8");
    assert.match(hosted, /first access/);
    assert.match(hosted, /Tony/);
    assert.match(hosted, /not stored in the repository/);
    const icp = readFileSync(join(ROOT, "docs/ICP.md"), "utf8");
    assert.match(icp, /First 100 users get Grill free for life/);
    const report = { paidIntentPricing: 0, paidIntentCheckout: 0, paidIntentNotify: 0, freeToPaid: 0, waitlist: 0, founding: 7 };
    assert.equal(weeklyMetricLines(report).at(-2), "founding members: 7/100");
    assert.equal(weeklyMetricLines({ ...report, founding: 140 }).at(-2), "founding members: 100/100");
    assert.equal(WEEKLY_KEY, FOUNDING_COUNT_KEY);
  });

  it("shows the live spots on /start, including when they are gone", async () => {
    const { command } = commandFor();
    const open = await handleStart(new Request("https://grillyour.ai/start"), { redis: command });
    assert.equal(open.status, 200);
    const openHtml = await open.text();
    assert.match(openHtml, /First 100 users get Grill free for life, 100 spots left\./);
    assert.match(openHtml, /Connect Grill to your AI/);
    assert.equal(openHtml.includes("<script"), false);
    for (let i = 1; i <= FOUNDING_CAP; i += 1) await assignFoundingMember(command, `full${i}@example.com`);
    const full = await handleStart(new Request("https://grillyour.ai/start/"), { redis: command });
    assert.match(await full.text(), /All 100 founding spots are taken\./);
  });

  it("tells a founding member they don't need to pay, and still states the price for everyone else", async () => {
    const memory = createMemoryRedis();
    const redisUrl = "https://redis.example.test";
    const fetchImpl = async (url, init = {}) => {
      assert.equal(String(url), redisUrl);
      return Response.json({ result: memory.command(JSON.parse(init.body)) });
    };
    const env = {
      UPSTASH_REDIS_REST_URL: redisUrl,
      UPSTASH_REDIS_REST_TOKEN: "redis-token",
      GRILL_SESSION_SECRET: "session-secret-at-least-16",
    };
    const anon = await handlePricing(new Request("https://grillyour.ai/pricing"), { env, fetch: fetchImpl });
    const anonHtml = await anon.text();
    assert.match(anonHtml, /First 100 users get Grill free for life, 100 spots left\./);
    assert.match(anonHtml, /A founding member does not pay that\./);
    assert.match(anonHtml, /\$9 a month/);
    assert.match(anonHtml, /value="Notify me"/);
    assert.equal(memory.command(["GET", PAID_INTENT_KEYS.pricing]), "1");

    await assignFoundingMember(async (args) => memory.command(args), "ada@example.com");
    const accountId = "acct_abcdef0123456789";
    memory.command(["SET", `grill:acct:${accountId}`, JSON.stringify({ id: accountId, email: "ada@example.com", keys: [] })]);
    const token = signPayload({ t: "s", sub: accountId, exp: Math.floor(Date.now() / 1000) + 3600 }, env.GRILL_SESSION_SECRET);
    const member = await handlePricing(
      new Request("https://grillyour.ai/pricing", { headers: { cookie: `grill_pro=${encodeURIComponent(token)}` } }),
      { env, fetch: fetchImpl },
    );
    const memberHtml = await member.text();
    assert.match(memberHtml, /Founding member #1 of 100: Grill is free for you for life\./);
    assert.match(memberHtml, /You don't need to pay\./);
    assert.equal(memberHtml.includes("Notify me"), false);
    assert.equal(memberHtml.includes("Get Pro"), false);
    assert.equal(memberHtml.includes("<script"), false);
    const click = await handlePricing(
      new Request("https://grillyour.ai/pricing", {
        method: "POST",
        headers: { cookie: `grill_pro=${encodeURIComponent(token)}`, "content-type": "application/x-www-form-urlencoded" },
        body: "intent=notify",
      }),
      { env, fetch: fetchImpl },
    );
    assert.equal(click.status, 303);
    assert.equal(memory.command(["GET", PAID_INTENT_KEYS.notify]), null);

    const saved = { ...process.env, fetch: globalThis.fetch };
    Object.assign(process.env, env, { GRILL_PRO_BILLING: "subscription", GRILL_PRO_PRICE_MONTH: "price_month1234", STRIPE_SECRET_KEY: "sk_test_fake" });
    globalThis.fetch = fetchImpl;
    try {
      const { GET } = await import("../api/checkout.js");
      const checkout = await GET(new Request("https://grillyour.ai/checkout?plan=month", { headers: { cookie: `grill_pro=${encodeURIComponent(token)}` } }));
      const checkoutHtml = await checkout.text();
      assert.equal(checkout.status, 200);
      assert.match(checkoutHtml, /You don't need to pay\./);
      assert.match(checkoutHtml, /Founding member #1 of 100: Grill is free for you for life\./);
      assert.equal(memory.command(["GET", PAID_INTENT_KEYS.checkout]), null);
    } finally {
      globalThis.fetch = saved.fetch;
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
      delete process.env.fetch;
    }
  });

  it("prints the backfill order and writes nothing unless asked", () => {
    const dir = mkdtempSync(join(tmpdir(), "founding-backfill-"));
    const file = join(dir, "people.json");
    writeFileSync(
      file,
      JSON.stringify([
        { email: "tony.keeper@example.com", at: "2026-01-01T00:00:00.000Z" },
        { email: "later@example.com", at: "2026-03-02T00:00:00.000Z" },
        { email: "early@example.com", at: "2026-02-01T00:00:00.000Z" },
      ]),
    );
    const ran = spawnSync(process.execPath, [join(ROOT, "scripts/founding-backfill.mjs"), "--file", file, "--exclude", "tony.keeper@example.com"], { encoding: "utf8" });
    assert.equal(ran.status, 0, ran.stderr);
    assert.match(ran.stdout, /early@example.com #1/);
    assert.match(ran.stdout, /later@example.com #2/);
    assert.match(ran.stdout, /Wrote nothing/);
    assert.equal(ran.stdout.includes("tony.keeper"), false);
  });
});
