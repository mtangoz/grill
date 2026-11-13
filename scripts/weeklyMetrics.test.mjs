// Weekly metrics lines for paid intent and free-to-paid. Counts only. Made-up numbers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUNNEL_KEYS as HOSTED_FUNNEL_KEYS } from "./hostedCore.mjs";
import { IMPACT_LOOKBACKS_KEY, IMPACT_UNSUB_KEY } from "./impactDigest.mjs";
import { FOUNDING_COUNT_KEY, FREE_TO_PAID_KEY, FUNNEL_KEYS, IMPACT_EMAIL_KEYS, INSTALL_PINGS_KEY, PAID_INTENT_KEYS, START_REF_LABELS, START_VIEWS_KEY, WAITLIST_SIGNUPS_KEY, readWeeklyMetrics, startRefLine, weeklyMetricLines } from "./weeklyMetricsCore.mjs";

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

  it("dates the JSON line, reads the newer ref labels, and adds one line for opt-in install pings", async () => {
    const now = Date.parse("2026-11-13T23:59:00Z");
    const seen = [];
    const values = {
      [START_VIEWS_KEY]: "40",
      "grill:metric:start_ref:home": "9",
      "grill:metric:start_ref:demo": "3",
      "grill:metric:start_ref:readme": "6",
      "grill:metric:start_ref:notify": "2",
      "grill:metric:start_ref:data-flow": "4",
      "grill:metric:start_ref:how-we-test": "1",
      // A tag off the list is still not read: there is no SCAN.
      "grill:metric:start_ref:someone-else": "50",
      [INSTALL_PINGS_KEY]: "12",
      [FUNNEL_KEYS.grills]: "11",
    };
    const report = await readWeeklyMetrics(
      ENV,
      async (url, init) => {
        seen.push(JSON.parse(init.body));
        return fetchFor(values)(url, init);
      },
      now,
    );
    assert.deepEqual(START_REF_LABELS, ["home", "askgrill", "hn", "smithery", "demo", "x", "readme", "notify", "data-flow", "how-we-test"]);
    assert.equal(INSTALL_PINGS_KEY, "grill:ping:unique");
    assert.equal(report.date, "2026-11-13");
    assert.equal(report.installPings, 12);
    assert.equal(report.users, undefined);
    // Each new read is a GET of one fixed key, like the reads before it. The fake fetch refuses anything else.
    assert.deepEqual(seen.filter((args) => args[1] === INSTALL_PINGS_KEY), [["GET", INSTALL_PINGS_KEY]]);
    for (const label of START_REF_LABELS) {
      assert.deepEqual(seen.filter((args) => args[1] === `grill:metric:start_ref:${label}`), [["GET", `grill:metric:start_ref:${label}`]], label);
    }
    assert.equal(seen.some((args) => String(args[1]).includes("someone-else")), false);
    assert.equal(seen.some((args) => /^(SCAN|KEYS|HGETALL|PFCOUNT)$/.test(args[0])), false);

    const lines = weeklyMetricLines(report);
    // The pinned lines keep their places.
    assert.equal(lines[6], "start views: 40");
    assert.equal(lines[7], "start refs: home 9 · demo 3 · readme 6 · notify 2 · data-flow 4 · how-we-test 1");
    assert.equal(lines[8], "grills: 11");
    assert.equal(lines[13], "email unsubscribes: 0");
    // The new line sits after them, just above the JSON line.
    assert.equal(lines.at(-2), "opt-in install pings: 12");
    assert.equal(lines.indexOf("opt-in install pings: 12") > 13, true);
    const json = JSON.parse(lines.at(-1));
    assert.equal(json.date, "2026-11-13");
    assert.equal(json.installPings, 12);
    assert.equal(json.startRefs.readme, 6);
    assert.equal(json.startRefs["how-we-test"], 1);
    assert.doesNotMatch(lines.at(-1), /decision|title|verdict/);
    assert.equal(startRefLine({ readme: 2, notify: 0 }), "start refs: readme 2");
    // A report made before these fields existed still prints.
    assert.equal(weeklyMetricLines({ paidIntentPricing: 0, paidIntentCheckout: 0, paidIntentNotify: 0, freeToPaid: 0 }).at(-2), "opt-in install pings: 0");
    // With no clock passed in, the date is today's UTC day.
    const today = await readWeeklyMetrics(ENV, fetchFor({}));
    assert.match(today.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(today.date, new Date().toISOString().slice(0, 10));
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
