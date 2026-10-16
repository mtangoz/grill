// The website's analytics: Vercel always, PostHog only with Grill's own key, and only allowlisted
// event names and fields ever leave the page.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { analyticsSnippet, posthogConfig, TRACKED_EVENTS } from "./siteAnalytics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "phc_GrillTestProjectKey0000000000000000000";

function run(snippet, { referrer = "" } = {}) {
  const sent = [];
  const va = [];
  const window = {};
  const script = snippet.match(/<script>([\s\S]*?)<\/script>/)[1];
  runInNewContext(script, {
    window,
    document: { referrer },
    location: { origin: "https://grillyour.ai", pathname: "/look-back/", hostname: "grillyour.ai", search: "?ref=hn&x=secret" },
    crypto: { randomUUID: () => "page-1" },
    URL,
    fetch: (url, opts) => {
      sent.push({ url, opts, body: JSON.parse(opts.body) });
      return Promise.resolve();
    },
  });
  window.vaq = va;
  return { window, sent, va };
}

describe("website analytics", () => {
  it("is Vercel only when no PostHog key is set", () => {
    assert.equal(posthogConfig({}), null);
    const snippet = analyticsSnippet({});
    assert.ok(snippet.includes('<script defer src="/_vercel/insights/script.js"></script>'));
    assert.doesNotMatch(snippet, /posthog/i);
    const { sent } = run(snippet);
    assert.equal(sent.length, 0);
  });

  it("refuses the other company's PostHog key, a malformed key, and an unknown host", () => {
    assert.throws(() => posthogConfig({ GRILL_POSTHOG_KEY: "phc_P9F0MGI5IDmTnLqIvk6ug0vj0MOzDI0YNBtBuYSq812" }), /another company/);
    assert.throws(() => posthogConfig({ GRILL_POSTHOG_KEY: "phx_personal_api_key_not_a_project_key" }), /project key/);
    assert.throws(() => posthogConfig({ GRILL_POSTHOG_KEY: KEY, GRILL_POSTHOG_HOST: "https://evil.example" }), /must be one of/);
    assert.deepEqual(posthogConfig({ GRILL_POSTHOG_KEY: ` ${KEY} ` }), { key: KEY, host: "https://eu.i.posthog.com" });
  });

  it("fails the site build on the other company's key", () => {
    const env = { ...process.env, GRILL_POSTHOG_KEY: "phc_P9F0MGI5IDmTnLqIvk6ug0vj0MOzDI0YNBtBuYSq812" };
    assert.throws(() => execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env }), /another company/);
  });

  it("sends a page view and allowlisted events, with a one-page ID and no person, location or words", () => {
    const { window, sent } = run(analyticsSnippet({ GRILL_POSTHOG_KEY: KEY }), { referrer: "https://news.ycombinator.com/item?id=1" });
    window.grillTrack("reflection_lookback_started", { records: 3, title: "Take the job", ref: "hn" });
    window.grillTrack("copy_prompt", { ref: "Not An Allowlisted Ref!" });
    window.grillTrack("surprise_text", { records: 1 });
    assert.deepEqual(sent.map((s) => s.body.event), ["$pageview", "reflection_lookback_started", "copy_prompt"]);
    for (const { url, opts, body } of sent) {
      assert.equal(url, "https://eu.i.posthog.com/i/v0/e/");
      assert.equal(opts.credentials, "omit");
      assert.equal(body.api_key, KEY);
      assert.equal(body.distinct_id, "page-1");
      assert.equal(body.properties.$process_person_profile, false);
      assert.equal(body.properties.$geoip_disable, true);
      assert.equal(body.properties.$current_url, "https://grillyour.ai/look-back/", "no query string");
    }
    assert.equal(sent[0].body.properties.$referring_domain, "news.ycombinator.com");
    assert.equal(sent[1].body.properties.records, 3);
    assert.equal(sent[1].body.properties.ref, "hn");
    assert.ok(!JSON.stringify(sent).includes("Take the job"));
    assert.equal(sent[2].body.properties.ref, undefined);
  });

  it("keeps nothing in the browser and loads no third-party script", () => {
    const snippet = analyticsSnippet({ GRILL_POSTHOG_KEY: KEY });
    assert.doesNotMatch(snippet, /cookie|localStorage|sessionStorage|indexedDB/i);
    const srcs = [...snippet.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(srcs, ["/_vercel/insights/script.js"]);
  });

  it("allowlists every event the pages send", () => {
    for (const file of ["site/page.html", "site/look-back.html"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      for (const [, name] of source.matchAll(/\b(download_mcpb|download_skill|copy_prompt|openrouter_key_click|reflection_[a-z_]+)\b/g)) {
        assert.ok(TRACKED_EVENTS.includes(name), `${file} sends ${name}, which is not allowlisted`);
      }
    }
  });
});
