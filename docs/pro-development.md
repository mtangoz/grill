# Grill Pro development

Grill Pro is parked. The public README stays on the free routes. This file is the developer setup for the website, accounts and Stripe, for when that work starts again. Why the account works the way it does: [PRO.md](PRO.md).

## The website

The site is `site/page.html`, built by `node scripts/build-site.mjs` into `_site/`, which Vercel serves. Checkout, the welcome page, the webhook and the Pro account live in `api/`. None of that is in the Desktop extension.

Web Analytics is a snippet the site build adds to the public pages only, not to the Grill tool. Enable it in the project's Analytics tab, then redeploy.

## Variables

Set these on the Vercel project. `GRILL_PRO_COUPON` has to be available when the site builds, because the page is static. Changing it does nothing until the next deploy. Unset means full price and no offer on the page.

| Variable | What it is |
|---|---|
| `GRILL_SESSION_SECRET` | Signs Pro sign-in links and session cookies. A long random string, at least 16 characters. Required before accounts work. |
| `UPSTASH_REDIS_REST_URL` | Production account store. From the Vercel Marketplace: Upstash Redis. |
| `UPSTASH_REDIS_REST_TOKEN` | Token for that Redis database. The Marketplace sets it with the URL. |
| `RESEND_API_KEY` | Sends the sign-in email. Not needed for test mode, which shows the link on the page. |
| `GRILL_PRO_EMAIL_FROM` | The From address Resend is allowed to use, such as `Grill <support@grillyour.ai>`. |
| `GRILL_PRO_ORIGIN` | Optional. Public origin for links in email, `https://grillyour.ai`. If unset, the link uses the request's own origin. |
| `GRILL_PRO_TEST_MODE` | Set to `1` to simulate a purchase and show sign-in links on the page. Ignored when `NODE_ENV` or `VERCEL_ENV` is `production`. |
| `GRILL_PRO_STORE` | Optional. File path for the test-mode account file. Default is a file in the system temp directory. |
| `STRIPE_SECRET_KEY` | Stripe secret key. The server uses it. The site never sees it. Without Redis, the Stripe customer itself is the account record. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe-webhook`. |
| `OPENROUTER_MANAGEMENT_KEY` | Creates each buyer's capped key, and switches it off when they cancel. Test mode on a laptop uses a mock instead. |
| `GRILL_PRO_PRICE_MONTH` | Stripe price id for Grill Pro at $9 a month (`price_…`). |
| `GRILL_PRO_PRICE_YEAR` | Stripe price id for Grill Pro at $90 a year (`price_…`). |
| `GRILL_PRO_COUPON` | Optional. A Stripe coupon id. When set, checkout applies it and the site says "Early access: 50% off Pro for life" ($4.50 a month, or $45 a year). The coupon must be 50% off with duration `forever`. |
| `GRILL_PORTAL_URL` | Optional. The Stripe customer portal (`https://billing.stripe.com/…`), linked from the account and the welcome page. |
| `GRILL_PRO_KEY_LIMIT` | Optional. Monthly allowance in dollars. Default 3, and it won't go above 50. |

## Stripe

In Stripe, create a product, those two recurring prices, and a coupon with `percent_off` 50 and `duration` `forever`. Put the coupon's id in `GRILL_PRO_COUPON`. Point a webhook at `https://grillyour.ai/api/stripe-webhook` for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `customer.deleted`. Success URL: `https://grillyour.ai/welcome?session_id={CHECKOUT_SESSION_ID}`. The discount stays on a subscription for as long as that subscription lasts, including renewals, because Stripe stores it. Key hashes stay on the Stripe customer, which is what that webhook reads. The account (email, setup, session) lives in Upstash Redis, or on the Stripe customer if Redis isn't configured. To end early access, unset `GRILL_PRO_COUPON` and redeploy. People who already subscribed keep the discount.

## Try it before Stripe

To try the whole Pro flow before Stripe is connected: `GRILL_PRO_TEST_MODE=1 GRILL_SESSION_SECRET=… node scripts/pro-dev-server.mjs`, then open `/pro`. Test mode never turns on in production.
