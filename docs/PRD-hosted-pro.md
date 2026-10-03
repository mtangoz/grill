# PRD: Grill Pro, hosted. One key everywhere, including ChatGPT and claude.ai in a browser

Status: proposed. Owner: founder. Written 2026-10-03.

## 0. Why, in one line

A paying customer should be able to grill from the assistant they already use, including ChatGPT and claude.ai in a browser. That should take one sign-in, with no key to copy and no terminal.

North Star check ([PRINCIPLES.md](PRINCIPLES.md)): a real user is a person who ran a grill. Most people think in ChatGPT or claude.ai in a browser. Today neither can use an outside judge without copy-and-paste. This PRD opens that route for Pro without making it the default for anyone.

## 1. The problem

| Where the user thinks | Free today | Pro today | After this PRD (Pro) |
|---|---|---|---|
| Claude Desktop, Claude Code | one click, own key | managed key, one click | unchanged |
| Cursor, VS Code, Codex, Gemini CLI | `npx -y grillyour` ([#24](https://github.com/mtangoz/grill/pull/24)) | the same, managed key | unchanged |
| **ChatGPT, claude.ai (browser, phone)** | copy and paste | **copy and paste: the key is unused** | **add a connector, sign in once** |

Browser apps can only reach an MCP server on the internet. So Pro needs a hosted one, and the write-up has to pass through it. That breaks one sentence of today's promise: *"Only the write-up you approve leaves your machine. It goes to OpenRouter."* The founder has decided Pro may break it (2026-10-03). The rest of this PRD keeps that break as small, visible and checkable as it can be.

## 2. Privacy: what changes, and what does not

### What stays true for everyone

- The free tool, and every local route for Pro (Desktop, Claude Code, `npx`), work exactly as now. The write-up goes straight from the user's machine to OpenRouter. Nothing hosted is in that path.
- The hosted route is **Pro only and opt-in**. It is used only when the user adds the Grill connector to a browser app. Nothing switches it on by itself.
- The judge still keeps nothing. Every request asks for zero-data-retention endpoints and excludes providers that train on inputs.
- Grill never stores decision text, notes or reflections. The "never stores" half of the promise stays whole. Only the "never sees" half changes, and only on this route.

### What the hosted route adds (the honest new sentence)

> On the hosted route, your approved write-up passes through Grill's relay on its way to the judge. The relay holds it in memory for the length of the grill. It is not logged or written to disk. The report waits, encrypted with a key only your assistant holds, for at most 15 minutes so your assistant can collect it.

### How the relay earns that sentence

| Risk | Control | Checked by |
|---|---|---|
| Write-up in logs | The relay never logs a request or response body. Errors return a fixed message with a request id. Log drains and error trackers stay off for `api/mcp`. | A test fails if any `console.*` in the relay takes the subject, the report or a request body. Same style as `privacy.test.mjs`. |
| Write-up stored | Nothing in plain text touches Redis or disk. A finished report is encrypted (AES-256-GCM) with a fresh random key per job. The **key lives only in the job id handed to the assistant**. Redis holds ciphertext with a 15-minute TTL, deleted on first read. | A test intercepts every Redis write and asserts each is ciphertext no longer than the report plus the overhead. |
| Masking skipped | The relay runs the same masking as the local judge (`judgeCore.mjs`): keys and tokens refuse the run; emails, phones and cards are masked. Same code, not a copy. | The existing masking tests run against the relay path too. |
| Code differs from what we say | The relay is in this public repository and deploys only from `main`. A `/pro/relay` page shows the commit SHA that is live. | A release check compares the live SHA with the tagged release. |
| Judge from the user's own company | The connector knows its client from the OAuth registration (ChatGPT means `openai`, claude.ai means `anthropic`). It sets the author automatically, like `GRILL_AUTHOR` in #24. A call's own `author` still wins. | Tests for each client mapping, plus the existing "refuse a correlated verdict" guard. |
| Managed key exposed | The relay needs the account's managed OpenRouter key. It is kept encrypted at rest (envelope encryption, secret in Vercel env), decrypted only inside a grill call, and never returned. OpenRouter's per-key cap still bounds spend if anything goes wrong. | A test asserts no route returns the key. Rotation already exists. |

PRIVACY.md and PRINCIPLES.md change in the **same PR** as the relay, and the site says it before launch, as PRINCIPLES.md requires. The PRINCIPLES line becomes: *"Grill never collects decision text. On Pro's hosted route a write-up passes through Grill's relay in memory, unlogged and unstored."*

## 3. Convenience: the hosted flow

1. **Connect.** In ChatGPT (Settings, Apps and connectors) or claude.ai (Customize, Connectors), add `https://grillyour.ai/mcp`. The Pro page has a copy button and screenshots for each.
2. **Sign in once.** OAuth 2.1 with dynamic client registration, as both apps expect. The login is the existing magic-link sign-in. The consent screen states the new privacy sentence in full before the user agrees.
3. **Grill.** "Grill this: …". The assistant writes it up and shows it, the user approves, and the report comes back in 1–3 minutes. The tools are the same as local: `grill`, `grill_result`, `grill_look_back`.
4. **No key anywhere.** The user never sees or copies an OpenRouter key on this route.

Long runs: `grill` waits up to 45 seconds, then returns a job id, exactly like the local server. The work continues in the same function (Vercel `waitUntil`, `maxDuration` 300 s). If a run passes 300 s, the job id returns a clear "the judge took too long" error, not silence.

## 4. Pricing: a small subscription, then pay as you go

### What a grill costs (measured)

| Judge | Mean cost a grill | Source |
|---|---|---|
| OpenRouter Auto Router (Grill's default) | 2.2–3.0¢ | 197 runs, Kindo Q3 review-instrument audit; 11 GrillBot hub runs averaged 1.5¢ |
| A strong pinned judge (`gpt-sol` class) | 6.3¢ (one 11 KB subject: 15¢) | same audit, §8 |
| Jev quality check | 0.02¢ | PRO.md |

### What a user spends a month (assumed until measured)

We have no real-user distribution yet. Usage is bursty, around decisions, so assume grills a month per active user are lognormal: median 4–6, spread σ = 1.0. That gives:

| Assumption | Mean | 1 SD | Mean + 1 SD | Users it covers |
|---|---|---|---|---|
| median 4, Auto Router | 6.6 grills, $0.17 | 8.6 grills | 15 grills = **$0.38** | 91% |
| median 6, Auto Router | 9.9 grills, $0.25 | 13 grills | 23 grills = **$0.57** | 91% |
| median 6, strong judge | 9.9 grills, $0.62 | 13 grills | 23 grills = **$1.44** | 91% |

Heavy users exist: Kindo's own repo ran about ten a day, about 300 a month, which is $7–19. They are why overage exists, not a reason to raise the base price.

Because usage is skewed, mean + 1 SD covers about 90% of users, not 84%.

### Proposal

- **Pro: $3 a month, or $30 a year. It includes $1.50 of judge spend a month.** $1.50 is mean + 1 SD under the most expensive assumption above, with every grill on a strong judge. On the default router it is about 60 grills.
- **Beyond the allowance: pay as you go at cost + 10%.** It is **off until the user switches it on**. Without it, a grill past the allowance returns "You've used this month's $1.50. Switch on pay-as-you-go, or it resets on <date>." That is a plain stop, not a nag, and no grill is billed by surprise.
- **A monthly spend cap**, default $10, set by the user. OpenRouter enforces it on the key: the key's limit is the allowance plus the cap, reset monthly. So even a bug in Grill cannot bill past it.
- **Show spend in the tool, not by email.** Each report's footer adds one line: "This month: $0.84 of $1.50." Grill sends no new email.
- The **$0.50 starter allowance** (no card) stays as the trial. **Bring your own key stays free and unlimited.**

### The 10% margin is thinner than it looks

| On $1.00 of judge spend | List + 10% | All-in cost + 10% |
|---|---|---|
| Charged | $1.100 | $1.161 |
| OpenRouter list price | −$1.000 | −$1.000 |
| OpenRouter fee on buying credit (verify; about 5.5%) | −$0.055 | −$0.055 |
| Stripe 2.9% on the overage (it rides the subscription invoice, so no extra 30¢) | −$0.032 | −$0.034 |
| **Kept** | **$0.013 (1.3%)** | **$0.072 (6.2%)** |

**Recommendation:** charge 10% over *all-in* cost (OpenRouter's list price plus its credit fee). The receipt can still say "OpenRouter cost + 10%". "10% over list" barely breaks even.

### The subscription's own margin

At $3 a month, Stripe takes about $0.39 (2.9% + 30¢). A user who spends the whole allowance costs $1.58 with the router fee. That leaves about **$1.03** for hosting at worst, and about $2.00 for a typical user at $0.40–0.60 of spend. The yearly plan drops eleven of the twelve 30¢ fees. $3 is the lowest price where Stripe's fixed fee stays under 15% of revenue. Below that, prefer prepaid credit.

### Re-calibrate from real data, not this table

The meter already exists: the router reports each managed key's monthly spend (`readKeyUsage`, cost only, no text). Every quarter, set the allowance to mean + 1 SD of last quarter's paying users' monthly spend, rounded up to $0.25. That only applies once there are at least 30 paying users; before that, the $1.50 above stands. A change to the allowance applies to the next billing period and is announced on the account page.

## 5. Build

Reuse first. Accounts, magic links, managed keys, caps, rotation, Stripe checkout and webhooks all exist (`api/_account.mjs`, `api/_pro.mjs`, PRO.md).

| Piece | New or reused |
|---|---|
| `api/mcp.js`: Streamable HTTP MCP endpoint | **new**. It wraps the tool definitions the local server already has, moved to a shared module so there is one home. |
| OAuth 2.1 authorization server with dynamic client registration (`/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/authorize`, `/oauth/token`) | **new**. It signs in with the existing magic link. Tokens are HMAC-signed like today's session cookie, with no token table. |
| Relay: masking, prompt, call, validation | **reused**. `judge.mjs` logic moves to a function both the CLI and the relay call, so there is one code path. |
| Encrypted short-lived job store | **new**, on the Upstash Redis Pro already uses. |
| Managed key encrypted at rest | **new field** on the account record. |
| Stripe metered price for overage, plus a month-end job: usage minus allowance becomes a usage record | **new**. It reads the existing per-key usage. |
| Account page: allowance meter, pay-as-you-go switch, cap, connector setup for ChatGPT and claude.ai | **extends** the existing pages. |
| PRIVACY.md, PRINCIPLES.md, site copy, consent screen | **changed**, same PR as the relay. |

Behind `GRILL_HOSTED=on`, off by default, like `GRILL_PRO_BILLING`.

## 6. Phases

1. **Measure (now, no code).** Turn starter keys on for a small group. Read cost-only monthly spend per key. This replaces the assumed table in §4 with a real one.
2. **Relay in test mode.** `api/mcp.js`, OAuth and the encrypted job store, with `GRILL_PRO_TEST_MODE` against the loopback router. Connect from ChatGPT developer mode and a claude.ai custom connector on a preview deployment.
3. **Privacy review.** Merge PRIVACY.md and PRINCIPLES.md, then grill the relay design with an outside judge, the same instrument we sell, before launch.
4. **Billing.** The $3 / $30 prices, the metered overage price, the cap and the footer line, all under Stripe test keys.
5. **Launch to the Pro launch list.**

## 7. How we will know it worked

- **Activation.** The share of new Pro accounts that run a first grill within 7 days (`first_grill`, already counted). Target: hosted-route accounts at least match local-route accounts.
- **Where users are.** The share of Pro grills on the hosted route versus local. This tests the assumption that most people think in a browser.
- **Allowance fit.** The share of paying users who reach the allowance. Target: 5–15%. Below that the price is too high for what people use; above it the allowance is too small.
- **Privacy incidents: zero.** Any write-up found in a log, a store or an error report is a launch blocker and gets a public note.
- **Margin.** Contribution per paying user stays positive after Stripe, router fees and hosting.

## 8. Decisions for the founder

1. **Price and allowance.** $3 / $30 with $1.50 included (recommended), or $5 with $3 included.
2. **What the 10% is applied to.** All-in cost (recommended) or OpenRouter list.
3. **Pay-as-you-go off by default** (recommended), or on with the cap.
4. **Hosted route for Desktop users too?** Recommended: no. Keep local the default wherever a local route exists, and use hosted only where no local route can reach.

## 9. Not in scope

Storing report history (already designed as opt-in `/pro/reports`), team plans, a hosted route for free users, and any telemetry beyond the cost-only counts listed in PRO.md.
