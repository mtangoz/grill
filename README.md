# 🔥 Grill

**A second opinion on your decisions, from a different AI company than the one you think with.**

**Setup guide:** [grillyour.ai](https://grillyour.ai)

Tell the assistant you think with, **"grill this"**: Claude, ChatGPT, Copilot, Gemini, Grok or Muse. It writes up your decision, and you check it. Then an outside judge, a model from a different company, argues the strongest case against it. It names the cheapest test that would settle each doubt, and gives a verdict.

> **Verdict: shaky.** The plan assumes customers stay at the new price, and nothing in it tests that.
> **Falsifier:** show the new price to one in ten new signups for two weeks, and compare how many start paying.

## Set up

### Claude Desktop (Mac or Windows): the one-click judge, 2 minutes

1. **Get a key** for Grill's model router: go to [openrouter.ai/keys](https://openrouter.ai/keys), sign in, click **Create key**, and add $5 of credit. A grill costs about a cent.
2. **Install Grill.** Download **[grill.mcpb](https://github.com/mtangoz/grill/releases/latest/download/grill.mcpb)** and double-click it, or drag it onto the Claude window. Paste your key when Claude asks. There's nothing else to install; Claude Desktop runs it.
3. **Try it.** In any chat, type:
   *Grill this: we're moving our launch to March. I'm 70% sure it gets us more signups.*

### claude.ai on the web or your phone: no key needed

1. Download **[grill-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/grill-skill.zip)**. In Claude, open **Customize → Skills**, upload it, and switch it on.
   To add everything at once instead, go to **Customize → Plugins → Add → Add marketplace** and enter `mtangoz/grill`.
2. Say *"grill this: …"*. Claude writes the judge's prompt. Tap **Open in ChatGPT**, or paste it into Gemini, then paste the answer back into Claude.

Want it in one step? Use Claude Desktop, above.

### ChatGPT, Copilot, Gemini, Grok or Muse: no install, no key

1. Copy **[the Grill prompt](prompts/grill.md)** into the assistant you think with, and say what you're deciding.
2. It writes your decision up with you, then gives you a prompt for the judge.
3. Paste that into an assistant from a **different company**, then paste the answer back.

| You think with | Judge with |
|---|---|
| ChatGPT | Claude, Gemini or Grok |
| Copilot | Gemini, because Copilot can run OpenAI, Anthropic or xAI models |
| Gemini | Claude, ChatGPT or Grok |
| Grok or GrokBot | Claude, ChatGPT or Gemini |
| Muse | Claude, ChatGPT or Gemini |

### Claude Code

```
/plugin marketplace add mtangoz/grill
/plugin install grill@grill
```

It asks for your model router key, or uses `OPENROUTER_API_KEY` if it's already set.

## The weekly review (optional)

Say **"run my weekly decision review"**. Claude reads the tools you've connected (**Customize → Connectors**: Gmail, Google Calendar, Google Drive, Notion, Granola and the like). Then it:
- lists the decisions you made this week;
- asks you to put a number on each: what you expect, by when, and how sure you are;
- grills the one that matters most;
- brings back the ones whose results are in.

Your log lives in a Google Drive folder or Notion database you choose. Once a month, you bet on how many of your calls will come true.

**Install:** upload [weekly-review-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/weekly-review-skill.zip) the same way, or add the plugin.

## What it costs

| | Cost |
|---|---|
| Grill | Free |
| The one-click judge, your own key | Your own key's credit: about a cent a grill, so $5 lasts hundreds. Unlimited on that credit. No account |
| The copy-and-paste routes | Free, on the assistants you already use |
| Starter key | Free. No card. $0.50 of judge spend, once, for one verified email (`GRILL_STARTER_ALLOWANCE_USD`). It does not refill |
| Grill Pro (optional) | $9 a month or $90 a year, when paid plans are on (`GRILL_PRO_BILLING=subscription`). A key we manage, with a monthly cap. The site says when early access takes half off, for life |

## Privacy

- **Your notes stay in your tools.** Only the write-up you approve leaves:
  - on the one-click route, it goes through a model router to zero-data-retention endpoints only;
  - on the paste route, it goes to the assistant you paste it into.
- **Grill enforces this in code,** and tests pin each rule:
  - a key or token in the write-up stops the run before anything is sent;
  - email addresses, phone numbers and card numbers are masked;
  - the installed code can talk to the model router and nothing else, and uses no third-party packages.
- **The free tool has no account.** Grill's makers never see your decisions. An account is only for a key we manage: a free starter allowance, or Pro when paid plans are on. Bring your own key and there is no account, and checks stay unlimited on your own credit. Grill does not email a verdict or a weekly note. A signed-in user can turn on saving copies of reports, and can delete them. Saving is off until they do. We also keep counts of sign-ups, keys issued, first grills, allowances used up and upgrade clicks, never the text of a decision. This website counts visits anonymously, with no cookies and nothing that identifies you. The Grill tool itself never tracks you.

Details, including two router settings to check: [docs/PRIVACY.md](docs/PRIVACY.md).

## How Grill gets better

Grill's self-improvement runs under the same privacy controls as a grill: masked text, zero-retention routing, nothing kept. It never sees a real decision:
- **Weekly:** 15 synthetic decisions with planted flaws check that the judge still catches them.
- **Monthly:** a report counts the choices people opt to share after a grill: was it worth engaging, and did the verdict match what happened.

Every change must still pass the checks. See [LEARNING.md](LEARNING.md).

## Why not just ask your own assistant?

It helped you think it through, so its critique shares your blind spots. A judge from another company doesn't. Claude Desktop and Claude Code enforce that in code, and tell you if a run lands on your own company anyway. The copy-and-paste routes check it and warn you. The table above is who to paste into.

The judge must argue your side before it attacks, quote the words it targets, and give every challenge a test that would settle it. A verdict of "solid" with no challenges is a real answer when it's earned. It's told that a made-up objection and an unearned "solid" both cost you.

A different company isn't enough on its own. The write-up still comes from your side of the decision, and a judge that grades the framing hands your own conclusion back to you. So:
- **Claude writes the write-up as a clerk, not an advocate.** Every option gets the same depth. The case against goes in at full strength, and nobody answers it. The question names every option and doesn't lean toward one.
- **The judge is told who wrote it.** It judges the facts, not the framing. It argues the other side with the same effort, then checks whether its verdict would change if the other side had written up the same facts.

**Quality checks:**
- **Local, always on:** Grill checks every quote a challenge attacks against your write-up, and flags any it can't find. It also flags a "solid" given over a serious challenge.
- **Jev, on by default:** a decision model from TypeSafe, on a zero-retention endpoint, scores whether each falsifier is a real test and whether the verdict fits. Claude tells you before each grill that Jev will see the masked write-up. Skip it for one grill by saying so, or switch it off in Grill's settings. It adds about $0.0002 a grill.

## If something's off

| You see | It means |
|---|---|
| "Grill isn't set up yet" | Your key is missing. Claude Desktop: **Settings → Extensions → Grill** |
| "Still grilling (job …)" | Normal. Claude collects the report itself; it takes 1–3 minutes |
| A 402 or credit error | Add credit at [openrouter.ai/credits](https://openrouter.ai/credits) |
| A warning banner in the report | The judge couldn't see everything, for example a subject that was too long. The report says what |

## Develop

```bash
node --test scripts/*.test.mjs   # no network, no key
npm run build:extension          # dist/grill.mcpb
```

Low-risk pull requests merge themselves once checks are green. Medium and high risk pull requests from the same authors are grilled. Rules and the opt-out labels are in [docs/PR-AUTOMATION.md](docs/PR-AUTOMATION.md).

- **Layout:**
  - `skills/`: what Claude reads in chat;
  - `prompts/grill.md`: the same grill for any other assistant, carrying the paste route's judge prompt word for word (a test pins it);
  - `server/`: the Desktop extension's tool;
  - `scripts/judge.mjs`: the judge itself, which also runs on its own (`node scripts/judge.mjs --help`).
- **Release:** bump the version in `package.json`, `manifest.json` and `.claude-plugin/plugin.json` (a test keeps them equal), then run the release workflow. It tags that version and publishes the extension and the skill zips.

### The website and Grill Pro

The site is `site/page.html`, built by `node scripts/build-site.mjs` into `_site/`, which Vercel serves. Checkout, the welcome page, the webhook and the Pro account live in `api/`. None of that is in the Desktop extension. Why the account works the way it does: [docs/PRO.md](docs/PRO.md).

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
| `GRILL_PRO_KEY_LIMIT` | Optional. Monthly allowance in dollars for a paid key. Default 3, and it won't go above 50. |
| `GRILL_STARTER_ALLOWANCE_USD` | Optional. Dollars of judge spend on a free starter key. Default 0.50. It does not refill. A bad value keeps the default. Not a count of grills. |
| `GRILL_PRO_BILLING` | Optional. `subscription` shows paid checkout. Unset or `off` (the default) hides the paywall so a starter key works before Stripe is connected. Set it for the site build too, the same way as `GRILL_PRO_COUPON`, or the page keeps the paywall hidden. |

In Stripe, create a product, those two recurring prices, and a coupon with `percent_off` 50 and `duration` `forever`. Put the coupon's id in `GRILL_PRO_COUPON`. Point a webhook at `https://grillyour.ai/api/stripe-webhook` for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `customer.deleted`. Success URL: `https://grillyour.ai/welcome?session_id={CHECKOUT_SESSION_ID}`. The discount stays on a subscription for as long as that subscription lasts, including renewals, because Stripe stores it. Key hashes stay on the Stripe customer, which is what that webhook reads. The account (email, setup, session) lives in Upstash Redis, or on the Stripe customer if Redis isn't configured. To end early access, unset `GRILL_PRO_COUPON` and redeploy. People who already subscribed keep the discount.

To try the flow before Stripe is connected: `GRILL_PRO_TEST_MODE=1 GRILL_SESSION_SECRET=… node scripts/pro-dev-server.mjs`, then open `/pro` and get a starter key. No card. Test mode never turns on in production. Paid checkout stays off until `GRILL_PRO_BILLING=subscription` and the Stripe price variables are set.

Activation (an account that then ran a grill) is the `first_grill` count. Depletion (a starter allowance that ran out) is the `allowance_exhausted` count. On Redis those are `grill:metric:first_grill` and `grill:metric:allowance_exhausted`, next to `account_created`, `key_issued` and `upgrade_clicked`. They are counts only. The account pages do not load website analytics. A weekly job reads them with the account store. The first grill is recorded the next time that usage (cost only) is read, usually when the person opens the account, because the installed Grill tool never calls Grill.

Web Analytics is a snippet the site build adds to the public pages only, not to the Grill tool. Enable it in the project's Analytics tab, then redeploy. Contact: support@grillyour.ai.

## License

MIT. See [LICENSE](LICENSE).
