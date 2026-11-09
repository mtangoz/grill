# Analytics loop: what PostHog (and friends) are for

Set on 9 Nov 2026. PostHog project capture is **off** live until `GRILL_POSTHOG_KEY` is set on the Vercel project from Grill's own PostHog org (support@grillyour.ai). Never use Kindo's PostHog.

## Question

Where does the funnel leak, and which reversible fix should Monday work pick?

## Five decisions only

1. **Which channel drives visits?** Vercel Web Analytics referrers (readable today) + `/start?ref=` Redis tags.
2. **Homepage → Connect?** Redis `start_ref:home` (Connect links to `/start/?ref=home`). Pageview `/` vs `/start` from Vercel is a backup proxy.
3. **/start reach?** Redis `grill:metric:start_views` (every load) vs tagged refs.
4. **Pro interest?** Redis paid-intent (`pricing` / `checkout` / `notify`). `/pricing` has no client analytics (CSP); keep it that way.
5. **Activation / repeat?** Redis funnel + email-test lines from `weekly-metrics.mjs`. Cross-page person funnels are not PostHog's job: the site uses a one-page-load ID on purpose.

## Why PostHog at all

Vercel Hobby can read pageviews, but **custom events return 402**. PostHog (Grill-owned, EU by default, cookieless, no person profile) is the free way to count allowlisted `grillTrack` events once the project key is on. It does **not** replace Redis for activation or Pro interest.

## Monday readout

1. Vercel `aggregate_pageviews` by path and referrer (last 7 days).
2. `node scripts/weekly-metrics.mjs` (paid-intent, start views/refs, funnel, email test).
3. `node scripts/posthogReadout.mjs` when `GRILL_POSTHOG_PERSONAL_API_KEY` + `GRILL_POSTHOG_PROJECT_ID` exist on the box (none today). Prints pageviews and allowlisted events for 7 days, or exits quietly when not configured.

## Thresholds (directional, low N is fine)

- **Awareness leak:** homepage visitors mostly direct/empty referrer and start views flat → try one channel experiment, not a redesign.
- **Connect leak:** `/` visitors >> `start_ref:home` for a week → grill the homepage CTA copy before adding pages.
- **Activation leak:** start views rise but `funnel_grills` / outside evidenced users do not → fix connect steps, not ads.
- **Pro interest:** paid-intent pricing flat while visits rise → leave pricing alone until activation moves.

## Grill of this plan (9 Nov 2026)

Verdict: **Solid if**.
- Challenge: with PostHog off, a client `cta_connect` event cannot feed the weekly click rate. Fixed: Redis `ref=home` + `start_views` are the source of truth; `page.html` stays free of `grillTrack` (Claude artifact).
- Challenge: a `/start` pageview must not send sensitive query values. Fixed: no client analytics on the `/start` API page; PostHog (when on) already strips the query string on static pages.

## Changes

None yet.
