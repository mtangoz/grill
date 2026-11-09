// Weekly metrics lines for paid intent and free-to-paid. Counts only. Made-up numbers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUNNEL_KEYS as HOSTED_FUNNEL_KEYS } from "./hostedCore.mjs";
import { IMPACT_LOOKBACKS_KEY, IMPACT_UNSUB_KEY } from "./impactDigest.mjs";
import { FOUNDING_COUNT_KEY, FREE_TO_PAID_KEY, FUNNEL_KEYS, IMPACT_EMAIL_KEYS, PAID_INTENT_KEYS, START_VIEWS_KEY, WAITLIST_SIGNUPS_KEY, readWeeklyMetrics, weeklyMetricLines } from "./weeklyMetricsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV = {
  UPSTASH_REDIS_REST_URL: "https://redis.example.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
};

function fetchFor(values) {
  return async (url, init) => {
    assert.equal(String(url), ENV.UPSTASH_REDIS_REST_URL);
    const [op, key] = JSON.parse(init.body);
    assert.equal(op, "GET");
    return Response.json({ result: values[key] ?? null });
  };
}

describe("weekly metrics", () => {
  it("prints paid-intent and free-to-paid lines, and does not call them users", async () => {
    const report = await readWeeklyMetrics(
      ENV,
      fetchFor({
        [PAID_INTENT_KEYS.pricing]: "4",
        [PAID_INTENT_KEYS.checkout]: "2",
        [PAID_INTENT_KEYS.notify]: "7",
        [FREE_TO_PAID_KEY]: "1",
        [WAITLIST_SIGNUPS_KEY]: "3",
        [FOUNDING_COUNT_KEY]: "7",
        [FUNNEL_KEYS.grills]: "11",
        [FUNNEL_KEYS.choices]: "6",
        [FUNNEL_KEYS.lookbacksSet]: "5",
        [FUNNEL_KEYS.lookbacksDone]: "2",
        [IMPACT_EMAIL_KEYS.lookbacks]: "4",
        [IMPACT_EMAIL_KEYS.unsubscribes]: "1",
        [START_VIEWS_KEY]: "9",
        "grill:metric:start_ref:home": "5",
        "grill:metric:start_ref:askgrill": "2",
      }),
    );
    assert.equal(report.label, "Weekly metrics");
    assert.equal(report.countsAsUsers, false);
    assert.equal(report.users, undefined);
    const lines = weeklyMetricLines(report);
    assert.deepEqual(lines.slice(0, 4), [
      "paid-intent pricing: 4",
      "paid-intent checkout: 2",
      "paid-intent notify: 7",
      "free-to-paid: 1",
    ]);
    assert.equal(lines[4], "waitlist: 3");
    assert.equal(lines[5], "founding members: 7/100");
    assert.equal(lines[6], "start views: 9");
    assert.equal(lines[7], "start refs: home 5 · askgrill 2");
    assert.deepEqual(lines.slice(8, 14), ["grills: 11", "choices logged: 6", "look-backs set: 5", "look-backs done: 2", "email look-backs: 4", "email unsubscribes: 1"]);
    assert.equal(IMPACT_EMAIL_KEYS.lookbacks, IMPACT_LOOKBACKS_KEY);
    assert.equal(IMPACT_EMAIL_KEYS.unsubscribes, IMPACT_UNSUB_KEY);
    assert.equal(JSON.parse(lines.at(-1)).lookbacksDone, 2);
    assert.doesNotMatch(lines.at(-1), /decision|title|verdict/);
    assert.deepEqual(HOSTED_FUNNEL_KEYS, FUNNEL_KEYS);
    assert.equal(JSON.parse(lines.at(-1)).freeToPaid, 1);
    assert.equal(JSON.parse(lines.at(-1)).waitlist, 3);
    assert.equal(JSON.parse(lines.at(-1)).founding, 7);
    const missing = await readWeeklyMetrics(ENV, fetchFor({}));
    assert.equal(missing.paidIntentPricing, 0);
    assert.equal(missing.freeToPaid, 0);
    await assert.rejects(readWeeklyMetrics({}, fetchFor({})), (err) => err.code === "unconfigured");
  });

  it("snapshot.sh appends the weekly lines after the Pro-interest line", () => {
    const snapshot = readFileSync(join(ROOT, "scripts/snapshot.sh"), "utf8");
    assert.match(snapshot, /notify-interest\.mjs/);
    assert.match(snapshot, /weekly-metrics\.mjs >> metrics\.jsonl/);
  });

  it("the outreach call to action is /start plus an invite code", () => {
    const icp = readFileSync(join(ROOT, "docs/ICP.md"), "utf8");
    assert.match(icp, /\/start\/\?ref=askgrill/);
    assert.match(icp, /single-use invite code/);
    assert.match(icp, /A direct message does not carry a decision or a verdict/);
  });
});
