/**
 * The website's analytics snippet, built once and added to every page scripts/build-site.mjs writes.
 * The Grill tool, site/page.html as a Claude artifact, and the account pages never load it.
 *
 * Pages call window.grillTrack(name, data). It keeps only an allowlisted event name and two
 * allowlisted fields (a channel `ref` and a `records` count), then hands that to:
 *   - Vercel Web Analytics, always: cookieless page counts plus these events.
 *   - PostHog, only when GRILL_POSTHOG_KEY is set at build time. No posthog-js: one JSON POST per
 *     event to the capture endpoint. No cookie, no localStorage, no person profile, no autocapture,
 *     no session recording, no GeoIP lookup. The ID is random and lasts one page load, so a page's
 *     visit and its clicks can be joined, and two visits cannot.
 *
 * Grill's PostHog must be its own organization. The owner's other company also uses PostHog; its
 * project key is refused here by hash, so a pasted key from the wrong account fails the build.
 */
import { createHash } from "node:crypto";

export const TRACKED_EVENTS = [
  "download_mcpb",
  "download_skill",
  "copy_prompt",
  "openrouter_key_click",
  "reflection_record_shown",
  "reflection_record_copied",
  "reflection_lookback_started",
  "reflection_lookback_completed",
];

export const POSTHOG_HOSTS = ["https://eu.i.posthog.com", "https://us.i.posthog.com"];
const DEFAULT_HOST = POSTHOG_HOSTS[0];

// sha256 of project keys that belong to another company's PostHog organization.
const FOREIGN_KEY_HASHES = new Set(["66eb8ff0001a2438511949a74943e3760851dadf9fc918f631aea1d55d3bb5f9"]);

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

/** The PostHog settings from the build environment, or null when it is off. Throws on a bad or foreign key. */
export function posthogConfig(env = process.env) {
  const key = trimmed(env.GRILL_POSTHOG_KEY);
  if (!key) return null;
  if (!/^phc_[A-Za-z0-9]{20,64}$/.test(key)) throw new Error("GRILL_POSTHOG_KEY must be a PostHog project key (phc_...)");
  if (FOREIGN_KEY_HASHES.has(createHash("sha256").update(key).digest("hex"))) {
    throw new Error("GRILL_POSTHOG_KEY belongs to another company's PostHog organization. Use the key of Grill's own PostHog project.");
  }
  const host = trimmed(env.GRILL_POSTHOG_HOST) || DEFAULT_HOST;
  if (!POSTHOG_HOSTS.includes(host)) throw new Error(`GRILL_POSTHOG_HOST must be one of ${POSTHOG_HOSTS.join(", ")}`);
  return { key, host };
}

/** The <script> tags for the end of <body>. */
export function analyticsSnippet(env = process.env) {
  const ph = posthogConfig(env);
  const events = JSON.stringify(Object.fromEntries(TRACKED_EVENTS.map((e) => [e, 1])));
  const posthog = ph
    ? `
  var PH = ${JSON.stringify({ key: ph.key, url: `${ph.host}/i/v0/e/` })};
  var pageId = "";
  try { pageId = crypto.randomUUID(); } catch (err) { pageId = String(Math.random()).slice(2) + String(Date.now()); }
  function toPosthog(event, props) {
    var p = { $process_person_profile: false, $geoip_disable: true, $lib: "grill-site", $pathname: location.pathname,
      $current_url: location.origin + location.pathname };
    for (var k in props) p[k] = props[k];
    try {
      fetch(PH.url, { method: "POST", keepalive: true, credentials: "omit", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: PH.key, event: event, distinct_id: pageId, properties: p }) }).catch(function () {});
    } catch (err) {}
  }
  var referrer = "";
  try { referrer = document.referrer ? new URL(document.referrer).hostname : ""; } catch (err) { referrer = ""; }
  toPosthog("$pageview", referrer && referrer !== location.hostname ? { $referring_domain: referrer } : {});`
    : "";
  return `<script>
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
(function () {
  var EVENTS = ${events};${posthog}
  window.grillTrack = function (name, data) {
    if (!EVENTS[name]) return;
    var clean = {};
    if (data && typeof data.ref === "string" && /^[a-z-]{1,20}$/.test(data.ref)) clean.ref = data.ref;
    if (data && Number.isInteger(data.records) && data.records >= 0 && data.records <= 10000) clean.records = data.records;
    window.va("event", { name: name, data: clean });${ph ? "\n    toPosthog(name, clean);" : ""}
  };
})();
</script>
<script defer src="/_vercel/insights/script.js"></script>`;
}
