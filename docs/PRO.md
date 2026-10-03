# Grill Pro accounts

The free tool has no account, no sign-in and no server of its own. A proposed hosted route for ChatGPT and claude.ai, and the pricing that goes with it, are in [PRD-hosted-pro.md](PRD-hosted-pro.md). Bring your own key and checks stay free and unlimited on your own credit. This file is about a key Grill manages: a free starter allowance, and the optional paid subscription for when billing is turned on.

## Why a magic link

A Pro user has to come back later, to rotate a lost key, see usage against the cap, or cancel. A password would mean storing a password. An OAuth provider would mean another company in the sign-in path. An email magic link is one address and a link that works once, for 20 minutes.

The link and the session cookie are HMAC-signed with `GRILL_SESSION_SECRET`. We don't keep a session table. The cookie is HttpOnly. The raw key is shown when it is created or rotated, then dropped. We store the router's key hash, and a SHA-256 of the key so a later paste can be checked. We never store the key.

## Where the account is kept

There is still no database product we run ourselves.

1. **Test mode** (`GRILL_PRO_TEST_MODE=1`) uses a local file, so the flow can be tried on a laptop before Stripe exists. This flag does nothing when `NODE_ENV` or `VERCEL_ENV` is `production`.
2. **Production:** Upstash Redis, from the Vercel Marketplace (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`). The server talks to it with `fetch`. No new package.
3. **If Redis isn't set** and `STRIPE_SECRET_KEY` is, the Stripe customer is the account. Key hashes already live there, so the subscription webhook can switch keys off without a second store.

Whenever a Stripe customer id is known, key hashes are written onto that customer in the same metadata fields the webhook already reads. Cancelling in Stripe still disables the key. The account record is updated to match.

## What you set

Deploy variables, including Stripe, are in [pro-development.md](pro-development.md). The ones this design depends on:

| Variable | Required when |
|---|---|
| `GRILL_SESSION_SECRET` | Always, before accounts work |
| `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` | Production. Vercel project, Marketplace, Upstash Redis. It fills these in. |
| `RESEND_API_KEY` and `GRILL_PRO_EMAIL_FROM` | Production email. Verify the domain in Resend first. Test mode skips this and shows the link on the page. |
| `GRILL_PRO_ORIGIN` | Optional. Use `https://grillyour.ai` so email links don't follow a preview URL. |
| `GRILL_PRO_TEST_MODE` | Only on a laptop or a non-production preview. Value `1`. |
| `GRILL_PRO_STORE` | Optional file path for test mode. |
| `GRILL_STARTER_ALLOWANCE_USD` | Optional. Dollars of judge spend on a starter key. Default 0.50. One-time, not a monthly refill, and not a count of grills. |
| `GRILL_PRO_BILLING` | Optional. `subscription` or unset/`off`. Default off. Also a site-build switch, like `GRILL_PRO_COUPON`. |

Stripe, when you connect it (the code already calls it; it waits on these):

| Variable | What to create in Stripe |
|---|---|
| `STRIPE_SECRET_KEY` | Secret key. Test key until you're ready. |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret. Endpoint `https://grillyour.ai/api/stripe-webhook`. Events: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.deleted`. |
| `GRILL_PRO_PRICE_MONTH` | Recurring price, $9 a month. The id looks like `price_…`. |
| `GRILL_PRO_PRICE_YEAR` | Recurring price, $90 a year. |
| `GRILL_PRO_COUPON` | Optional. Coupon id, 50% off, duration `forever`. Also set it for the site build, or the page won't mention the offer. |
| `GRILL_PORTAL_URL` | Customer portal link, `https://billing.stripe.com/…`. |
| `OPENROUTER_MANAGEMENT_KEY` | OpenRouter management key for the Grill account. Paid keys get a monthly dollar cap (`GRILL_PRO_KEY_LIMIT`, default 3). Starter keys get `GRILL_STARTER_ALLOWANCE_USD` (default 0.50) with no monthly reset. |
| `GRILL_PRO_KEY_LIMIT` | Optional. Dollars per paid key per month, above 0 and at most 50. |

Checkout already sends people to `https://grillyour.ai/welcome?session_id={CHECKOUT_SESSION_ID}`. If they're signed in, that page attaches the new key's hash to the account. The key is still shown only on that page.

## Test mode

```bash
GRILL_PRO_TEST_MODE=1 GRILL_SESSION_SECRET=replace-me-with-a-long-string \
  node scripts/pro-dev-server.mjs
```

Open `http://127.0.0.1:4173/pro`. Sign in (the link is on the page), get a starter key (no card), pick an assistant and a judge from a different company, copy the config, and run a sample grill. With `GRILL_PRO_BILLING=subscription`, the same page can simulate a purchase, rotate a paid key, and cancel. The dev server does not turn billing on by itself.

The dev server mocks OpenRouter's key API. The sample grill runs Grill's own judge against a loopback stand-in, with the managed key as the bearer token and the chosen judge model. It does not call the real router. That sample endpoint answers 404 unless test mode is on. In production, write-ups still go from the assistant straight to the router.

## Starter allowance

Any signed-in account can get one managed key without paying, while `GRILL_PRO_BILLING` is off or unset. The cap is dollars of judge spend on the OpenRouter key (`limit`, and no `limit_reset`). Default $0.50. One starter key per verified email. Asking again does not mint another, and revoking one does not refill it. Rotating reads what is left, switches the old key off, and creates a new key for that remainder only. If usage can't be read, or nothing is left, rotation is refused.

Key creation is limited to three per account per hour. The slot is taken before the router is called, so a failed attempt still counts.

Paid subscription code stays. Checkout, the simulated purchase, and the $9 copy are shown only when `GRILL_PRO_BILLING=subscription`. Rebuild the site with that variable or the paywall stays hidden.

## Usage counts

These are counts, with no decision text: `account_created`, `key_issued`, `first_grill`, `allowance_exhausted`, `upgrade_clicked`. On Redis they are `INCR grill:metric:<name>`. A file store keeps the same numbers. A Stripe-only account store keeps them in memory, so they do not survive a cold start.

Activation is `first_grill` (signed up, then a grill). Depletion is `allowance_exhausted`. `usageReport` / `readUsageReport` is what a weekly job reads. The installed extension does not phone home, so a first grill or an empty allowance is recorded the next time the server reads key usage (cost only), which is when the person opens the account. In test mode the sample grill records it immediately.

Account and key pages do not load Vercel Analytics. The raw key can be on those pages, and their content security policy does not allow a third-party script. The public site still counts anonymous page views.

## Reports

Grill does not email a verdict or a weekly note. A grill stays in the assistant that ran it. The weekly review stays in the user's chat, or in an email their own mail connector sends if they ask it to. The only email this server sends is the sign-in link.

`/pro/reports` is the history page for when a report does exist. Saving is off until the signed-in user turns it on. A copy is kept on their account only, and they can delete any one or all of them. Turning saving off stops new copies and leaves the ones already there until they delete them. Report text is never written onto a Stripe customer. If the account store is the Stripe customer itself, saving stays off.

`rememberReport` is the hook a future emailed report would call. It saves only when that account has saving turned on. In test mode, a sample grill is saved the same way, labelled as a test-mode sample, so the page can be tried before any email exists.

## Setup

The signed-in user picks the assistant they think with and a judge. The judge has to be a different company. Copilot can run OpenAI, Anthropic or xAI, so those three are refused as its judge; Gemini or DeepSeek is the default safe pick.

The config fills in the managed key and the judge model:

- Claude Desktop and Claude Code: the same settings fields as a bring-your-own key (`openrouter_api_key`) plus optional `judge_model`, passed through as `JUDGE_MODEL`. Blank still means Grill's default chain. A pin from the author's own company is refused.
- claude.ai, ChatGPT, Copilot, Gemini, Grok and Muse: a paste setup that names the judge. The key is not put in the prompt. The page still shows it for the one-click routes, labelled as such.

Bring-your-own-key installs are unchanged when the judge model is left blank.
