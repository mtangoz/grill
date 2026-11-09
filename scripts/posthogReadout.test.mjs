// PostHog readout: configured only with Grill's personal key. Counts only. Made-up numbers.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRACKED_EVENTS } from "./siteAnalytics.mjs";
import { eventsQuery, posthogReadoutConfig, posthogReadoutLines, readPosthogReadout } from "./posthogReadout.mjs";

describe("posthog readout", () => {
  it("is off without a personal key and project id", () => {
    assert.equal(posthogReadoutConfig({}), null);
    assert.equal(posthogReadoutConfig({ GRILL_POSTHOG_PERSONAL_API_KEY: "phx_abc" }), null);
  });

  it("refuses a project capture key as the personal key", () => {
    assert.throws(
      () => posthogReadoutConfig({ GRILL_POSTHOG_PERSONAL_API_KEY: "phc_not_personal", GRILL_POSTHOG_PROJECT_ID: "123" }),
      /personal API key/,
    );
  });

  it("queries only allowlisted events including pageview", () => {
    const q = eventsQuery(7);
    assert.match(q, /\$pageview/);
    assert.match(q, /cta_connect/);
    for (const name of TRACKED_EVENTS) assert.match(q, new RegExp(name));
    assert.doesNotMatch(q, /password|email|decision/i);
  });

  it("prints counts and never calls them users", async () => {
    const env = {
      GRILL_POSTHOG_PERSONAL_API_KEY: "phx_testkey000",
      GRILL_POSTHOG_PROJECT_ID: "42",
    };
    const fetchImpl = async (url, init) => {
      assert.match(String(url), /eu\.posthog\.com\/api\/projects\/42\/query\//);
      assert.match(init.headers.Authorization, /^Bearer phx_/);
      return Response.json({ results: [["$pageview", 12], ["cta_connect", 3]] });
    };
    const report = await readPosthogReadout(env, fetchImpl);
    assert.equal(report.countsAsUsers, false);
    assert.deepEqual(posthogReadoutLines(report), [
      "posthog (last 7 days):",
      "  $pageview: 12",
      "  cta_connect: 3",
    ]);
    await assert.rejects(readPosthogReadout({}, fetchImpl), (err) => err.code === "unconfigured");
  });
});
