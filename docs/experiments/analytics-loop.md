# Analytics loop: what PostHog (and friends) are for

Set on 9 Nov 2026. PostHog project capture is **off** live until `GRILL_POSTHOG_KEY` is set on the Vercel project from Grill's own PostHog org (support@grillyour.ai). Never use Kindo's PostHog.

## Question

Where does the funnel leak, and which reversible fix should Monday work pick?

## Five decisions only

1. **Which channel drives visits?** Vercel Web Analytics referrers (readable today) + `/start?ref=` Redis tags.
2. **Homepage → Connect?** Redis `start_ref:home` (Connect links to `/start/?ref=home`). Pageview `/` vs `/start` from Vercel is a backup proxy.
3. **/start reach?** Redis `grill:metric:start_views` (every browser view; crawlers, link-preview fetches and non-GET requests are not counted) vs tagged refs. The start ref labels read are home, askgrill, hn, smithery, demo, x, readme, notify, data-flow and how-we-test. The series breaks at the merge of the 2026-11-13 branch: views before it include crawler and HEAD traffic, and seven more automated clients stop being counted at the same time. A request with no User-Agent is still counted.
4. **Pro interest?** Redis paid-intent (`pricing` / `checkout` / `notify`). `/pricing` has no client analytics (CSP); keep it that way.
5. **Activation / repeat?** For outside accounts, `node scripts/outside-loop.mjs`: people who grilled, who came back, records answers, choices, first grills by app, and the kill threshold for the record bet (the usage ladder in [STRATEGY.md](../STRATEGY.md)). It counts nobody until `GRILL_INTERNAL_EMAILS` is set in production. The Redis funnel and email-test lines from `weekly-metrics.mjs` still include maintainer accounts. Cross-page person funnels are not PostHog's job: the site uses a one-page-load ID on purpose.

## Why PostHog at all

Vercel Hobby can read pageviews, but **custom events return 402**. PostHog (Grill-owned, EU by default, cookieless, no person profile) is the free way to count allowlisted `grillTrack` events once the project key is on. It does **not** replace Redis for activation or Pro interest.

## Monday readout

1. Vercel `aggregate_pageviews` by path and referrer (last 7 days).
2. `node scripts/weekly-metrics.mjs` (paid-intent, start views/refs, funnel, email test). The line `opt-in install pings: N` sits just above the JSON line; it counts only installs whose owner turned usage stats on. The JSON line now carries `date` (the UTC day) and `installPings`.
3. `node scripts/outside-loop.mjs` (outside accounts only). Check the line on the last day the server counted before reading the rest.
4. `node scripts/posthogReadout.mjs` when `GRILL_POSTHOG_PERSONAL_API_KEY` + `GRILL_POSTHOG_PROJECT_ID` exist on the box (none today). Prints pageviews and allowlisted events for 7 days, or exits quietly when not configured.

## Thresholds (directional, low N is fine)

- **Awareness leak:** homepage visitors mostly direct/empty referrer and start views flat → try one channel experiment, not a redesign.
- **Connect leak:** `/` visitors >> `start_ref:home` for a week → grill the homepage CTA copy before adding pages.
- **Activation leak:** start views rise but `funnel_grills` / outside evidenced users do not → fix connect steps, not ads.
- **Pro interest:** paid-intent pricing flat while visits rise → leave pricing alone until activation moves.

5. Read the "Waiting on the owner" list at the top of [ROADMAP.md](../ROADMAP.md). Most of what moves reach now is on it.

## Queued experiments (not shipped; each needs the owner's yes)

One change per week. Revert it if its measure does not move in two weeks. At about one real user, a week of data may not separate signal from noise, so act only on a gap of several counts.

1. **"See a grill first" under the homepage button.** Trigger: the connect leak above (`/` visitors far above `start_ref:home`) for a week. Change: one plain text link under the button, to `/demo/`. Measure: `start_ref:home` plus `start_ref:demo`. It changes the one-button homepage the owner chose, and breaks the site test that keeps `/demo/` off the homepage.
2. **A work decision as the starter prompt.** Trigger: start views rise while outside first grills do not (the activation leak). Change: replace the fantasy-football starter on /start with a work decision in the person's own words. Measure: `First grills by app` in `node scripts/outside-loop.mjs`. It changes the starter prompt several tests pin.

## Grill of this plan (9 Nov 2026)

Verdict: **Solid if**.
- Challenge: with PostHog off, a client `cta_connect` event cannot feed the weekly click rate. Fixed: Redis `ref=home` + `start_views` are the source of truth; `page.html` stays free of `grillTrack` (Claude artifact).
- Challenge: a `/start` pageview must not send sensitive query values. Fixed: no client analytics on the `/start` API page; PostHog (when on) already strips the query string on static pages.

## Changes

- 2026-11-13: start views count browser GET views only, so the series breaks at merge. The weekly JSON line gains `date` and `installPings`, and five ref labels. The outside readout is added for activation and repeat. Two experiments are queued, not shipped.
