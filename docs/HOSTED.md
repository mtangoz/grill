# Grill inside your chat

Live at grillyour.ai. The connector is served when `GRILL_HOSTED=on`. Open sign-up is on in production (`GRILL_OPEN_SIGNUP=on`, since 2026-11-03): anyone with a verified email can sign up. The switch is off by default in the code. When it is off, set `GRILL_HOSTED_ALLOWLIST` to the emails that may grill. Anyone else gets a short message and no grill, with a link to `/redeem`. A code from `GRILL_INVITE_CODES`, or a single-use code in the codes store, lets a signed-in person in. With `GRILL_INVITE_CODES` unset and no code in the store, redeem does nothing.

Grill pays for the starter credit, so two hard monthly caps sit in front of every grill: one for the whole service and one per person. When either is reached, the grill does not run and the person gets one plain sentence saying the free grills for the month are used up and nothing was charged to them. Each person's router key is also hard-capped by the router itself.

This is a connector, not the installed tool. The installed tool is unchanged: your key, on your computer, and the write-up goes only to the model router.

The judge is always OpenRouter's Auto Router (`openrouter/auto`). Grill excludes only the company that wrote the write-up, when it can tell which that is. When it cannot, nobody is excluded and the verdict says independence was not verified. It does not fall back to the chat's own model, for speed or cost, and it does not pin a model.

## What a person does

1. Follow the steps for the AI at `https://grillyour.ai/start/` (on a preview, use that preview's origin instead of grillyour.ai). Claude.ai, ChatGPT and Grok Bot are verified working. Gemini and Muse work today by copy and paste, no install, no key. Adding Grill as a connector inside Gemini or Muse is not verified. The connector URL is `https://<host>/mcp`. On a preview that host is the preview origin. `https://mcp.grillyour.ai/mcp` comes later, when the owner adds that domain.
2. Connect. A sign-in opens. Anyone can sign up. Sign in with an emailed code: use the same email each time, the same email you signed up with, every time, and check spam if the code isn't there in a minute. No key to paste, no password, and no card. In Claude, open Customize → Connectors → Add custom connector and paste `https://<host>/mcp`. Asking Claude in a chat to connect it does not work. A code at `/redeem` still grants early-tester access: free, $5 of use each month, on the same $20 service cap.
3. The first grill asks, once, whether to keep decision records. Under the question, one paragraph says where the decision goes whichever way they answer, what a yes keeps, and where the full account is (`https://grillyour.ai/data-flow/`). It asks nothing more. Answer once. The outside-judge disclosure is shown once per account, then not again. It says "from a different company" only when Grill could tell which company wrote the write-up.
4. Say the decision as you mean it. The assistant sends that. It does not show a template or wait for an OK. The note comes back in the chat. If three grills are already running, the assistant waits and retries on its own.

An assistant that cannot add a connector can still use this grill. It gives the person a link, `/judge?q=` plus the decision, at most 4000 characters. A longer one is refused. It is also dropped from the address before the browser is sent to sign in, so the sign-in company does not get it. Add `from` with the same client names a connector already matches, such as `gemini`, `gemini-cli`, `antigravity`, `claude`, `chatgpt`, `grok`, `muse` or `meta`, so that company is excluded. The page names the company in one line. With no `from`, or one it does not know, nobody is excluded. The page then shows one line above the button that starts "Independence not verified:", and the verdict carries its own line that starts the same way. Only `from` counts on this page. A company remembered from the person's connector is not used. The page is signed in the same way as `/decisions`. It shows the decision and does not run a grill until they press the button. The verdict is on the page to copy back. Keeping records follows the same rule as a grill in chat: the first time asks, with the same paragraph under the question, and a later grill uses that answer.

Decisions you chose to keep are at `/decisions`. The page opens on whether a grill changed the call, then on what is due for a look-back. What happened? opens that record. Saying "look back" in chat is what saves what happened. With one decision due, the answer is saved on it. With two or more due, the chat lists them by title, up to five, and an answer is saved only on the decision it names: the assistant passes that title in `records`, or puts a `title:` line above the answer. An answer that names none of them is saved on none and counted as none. A grill that has a verdict and no stated choice yet shows as a count, "1 grill is waiting for your call", with what to do. Nothing from that draft is shown. With three or more decisions, the impact block has one quieter line under the short count: how many decisions, the percent looked back, and, once three have been looked back, how often the verdict held up. With fewer, that line is absent. It is not repeated under the due list. Chips in one row filter by type and by client. A filter with only one value is hidden. The list is grouped due, open, and closed. A title opens that one record: the verdict, what you chose, how sure you were, and whether you have looked back. The type comes from the words already in the record. The client is the one already stored: Claude, ChatGPT, Cursor, Grok Bot, other, or unknown. Claude Code is counted with Claude. Share verdict, on the record, publishes that record's verdict and one challenge at `/share/<token>`. It is off until you confirm, and Stop sharing or deleting the record turns it off. Export and Delete all are small links under the list. Delete all also deletes any grill still waiting for a choice, and so does turning records off, in chat, on `/decisions` or on `/account`. A grill still running when records are switched off leaves no draft when it finishes. Each gets a look-back on the day the decision named, when the words name one, and 14 days out otherwise. The record page can change that date or turn the look-back off. Each record keeps the time of its first look-back answer, from the chat, a tap or a note. A later answer, tap or note has its own time and does not move the first one. The page does not show it. The JSON export does, as `lookback_first_at`. When the date comes, `/decisions` lists it as due, and the next `grill_decided` adds one line counting the calls due, at most once a UTC day. A signed-in account gets a Monday email, from 9 Nov 2026 until the test reaches 30 people and 60 sends (no later than 25 Jan 2027; about one in four accounts is held out and not sent), unless you turn it off on `/account` or with the unsubscribe link in the email. It uses the same changed-call count as Your grills. A verdict is not a change. A week with nothing new sends nothing, and an overdue look-back is not mailed again. The outcome links open a confirm page. To be reminded outside the chat, switch on a calendar link on `/decisions` or `/account` and subscribe to it in your calendar app. It is off by default, shown once, and shows "Grill look-back due" on each date, with titles only if you switch them on. Turning it off, getting a new link, or deleting the account stops the old link. The link is `https://<host>/decisions/calendar/<secret>.ics`. Why it works this way: [PRD-lookback-reminders.md](PRD-lookback-reminders.md).

 The account, the credit, and delete are at `/account`. Both pages are plain HTML, with the same content rules as the Pro pages: no analytics script.

## What the owner sets

These are set in production at grillyour.ai, and on any preview you test with. The gate this route went through is recorded in [hosted-spike.md](hosted-spike.md).

| Variable | What it is |
|---|---|
| `GRILL_HOSTED` | `on` to serve `/mcp`, the sign-in metadata, the authorization-server metadata, `/decisions`, `/judge`, `/share/<token>`, the calendar link and `/account`. Anything else, including unset, is a 404. |
| `GRILL_HOSTED_ALLOWLIST` | Comma-separated emails that may grill while sign-up is invite-only. If unset or empty, nobody is let in. |
| `GRILL_OPEN_SIGNUP` | `on` lets any verified email grill, ignoring the list. Anything else, including unset, keeps it invite-only. Turn it on only with the caps below set. While it is `on`, `/start` sets no cookie: the `grill_ref` cookie exists only for the waitlist form, which invite-only sign-up shows. |
| `GRILL_INVITE_CODES` | Comma-separated invite codes. Add `:N` to cap a code at N uses (`friend:10`). A code with no count has no use limit. A colon that is not a whole number is skipped. Unset or empty leaves only the codes store. With that empty too, redeem is off, and a stored redemption does not admit anyone. This does not change the $5 and $20 caps. A single-use code for one lead can live in the existing store instead: the key is a hash of the code, the value is the max uses (1 for a lead), and a lead label can hold only one code. The plaintext code is not stored. Open sign-up stays off. Someone without a code can join the waitlist at `/start` or on the invite wall. That stores the email and the `?ref=` source. Approving them mints one of these codes. It does not email them and it does not let them in until they redeem it. |
| `GRILL_MONTHLY_CAP_USD` | Optional. Hard cap on what Grill pays for all hosted grills in a calendar month (UTC). Default `20`. `0` stops every grill. |
| `GRILL_USER_MONTHLY_CAP_USD` | Optional. Hard cap per person per calendar month (UTC), keyed to a hash of the email the starter credit belongs to, so an agent shares its owner's cap. Default `5`: the early-tester allowance, free for life, reset on the 1st. Each person's router key is minted at the same amount with a monthly reset. |
| `CLERK_ISSUER` | Clerk Frontend API URL, no trailing slash. This is the authorization server in the protected-resource metadata. It does not serve the sign-in page. |
| `CLERK_SIGN_IN_URL` | Optional. Absolute URL of the Clerk Account Portal sign-in page. When unset, Grill derives it from `CLERK_ISSUER`: `name.clerk.accounts.dev` becomes `https://name.accounts.dev/sign-in`, `name.clerk.accountsstage.dev` becomes `https://name.accountsstage.dev/sign-in`, and `clerk.example.com` becomes `https://accounts.example.com/sign-in`. Set this when the Frontend API host does not follow those shapes. |
| `CLERK_JWKS_URL` | Optional. Defaults to `<CLERK_ISSUER>/.well-known/jwks.json`. |
| `CLERK_SECRET_KEY` | Clerk secret key. Used to read the verified email, to read an AgentID access token when the sign-in is an agent, and to delete the user when they delete the account. |
| `OPENROUTER_MANAGEMENT_KEY` | Creates one capped key per person. Never put this where a visitor can read it. |
| `GRILL_STARTER_CREDIT_USD` | No longer used by Grill in chat. The key's limit is the per-person monthly cap above, and it resets monthly. A key made before that change, a one-off credit, is moved to the monthly cap the next time its credit is read. |
| `UPSTASH_REDIS_REST_URL` | Redis for the account, the short-lived report, the records, and the spend counters for the caps. |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token. |
| `GRILL_KEY_ENCRYPTION_KEY` | 32 bytes, base64. Encrypts the model-router key at rest. |
| `GRILL_RECORD_KEY` | 32 bytes, base64. Wraps the per-person key that encrypts records. |
| `GRILL_INTERNAL_EMAILS` | Optional. Comma-separated addresses of maintainers, test accounts, reviewers and their agents. It is matched, in lower case, against an account's own email and the email of the person an agent acts for. Keep it on the host only: it is never in the repository and never logged. While it is unset, or holds no address, the outside counters below count nobody. Set it before this code is deployed, and add a reviewer's address before they sign in. Keep it set: if it is unset later, counting stops from then on, and what happens in that stretch is never counted. |

The caps count each finished grill's cost in micro-dollars with atomic `INCRBY` counters. A grill that reports no cost counts as a typical grill ($0.03). A grill may start while spend is under the cap, so the last one can finish slightly over; the next one is stopped. Fields a running grill changes (its spend row, the once-only disclosure, the per-person record key) are written to their own keys with atomic commands, so two grills finishing at once cannot overwrite each other's account data.

A completed grill also adds one to that account's check count for the UTC month (`grill:hosted:checks:<account id>:<YYYY-MM>`). That number is what support and the account pages read. A failed judge, an automatic retry of the same run, a follow-up such as more or options, and a poll for a job result do not add one. The dollar caps above stay the safety limit. The daily limit still stops at 30 completed checks.

With `GRILL_INTERNAL_EMAILS` set, an account that is not on the list is counted as an outside account. The counts are whole numbers in Upstash hashes under `grill:metric:outside:`. Each is added when the event happens, inside that person's own request: the first grill that gets a verdict (filed under that UTC day, and under the app, from a fixed list), a later grill 20 hours or more after it (once, as having come back), the first answer to the records question, each saved choice, each look-back date (filed under the day it falls due), and the first answer on each look-back (within 7 days of that day, and within 14). A look-back falls due at the start of its day, so within 14 days means before the 15th day begins. A look-back whose date is moved or switched off before that day moves with it or leaves the count. From that day on it stays counted as due, and so does one whose record is deleted. A look-back that already has its answer when its date is counted is counted as due and as done. That covers an early answer, and a record answered before counting began whose date is moved later. A second answer, a changed tap and a later note add nothing. No job opens a kept record to make these numbers, and nothing was added to the Monday email route. Read them with `node scripts/outside-loop.mjs`, which needs the two Upstash settings. It prints "not counted: internal list not set" until the server has handled one of those events, from any account, with the list set. Counting starts that day. A look-back date set before then is not counted. A date that is already past when it is set is filed under the day it was set. A person who grilled before then is filed under the day of the oldest grill in their spend log, the next time they grill. The readout reads the store, not the server, so it cannot see whether the list is still set. It prints the last day the server handled one of those events, from any account, with the list set. When that day is more than 7 days old it prints a warning: either no account has used Grill since, or the list was unset on the server and nothing has been counted since. Check the setting on the host before you trust the numbers. If the list was unset for a stretch and then set again, the readout does not show the gap. What the counters hold is in [DATA-LEDGER.md](DATA-LEDGER.md).

Generate the two encryption keys with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Store them as secrets. Losing `GRILL_RECORD_KEY` makes stored records unreadable. Rotating it needs a re-wrap, which this slice does not do.

The function that runs the judge is allowed 300 seconds, and its bundle includes `scripts/**`, because the judge is still `scripts/judge.mjs`.

## Clerk

For this preview:

- Publish Client ID Metadata Documents and Dynamic Client Registration. Require PKCE. Scopes `openid`, `profile`, `email`.
- Older MCP clients look up the authorization server on this host, including the path-inserted `/mcp` forms from RFC 8414. Grill answers `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` (and both with `/mcp`) with Clerk's own document from `CLERK_ISSUER`, as JSON, `Access-Control-Allow-Origin: *`, cached for about a minute. If Clerk cannot be read, the response redirects there. Protected-resource metadata still names `CLERK_ISSUER`. `GET /.well-known/oauth-protected-resource/mcp` serves the same metadata as the root path.
- An emailed code. Google is off in production, so invitees are told to use the email their invite went to.
- Redirect `https://claude.ai/api/mcp/auth_callback` for Claude on the web, desktop, mobile and Cowork.
- Port-agnostic loopback `http://localhost/callback` and `http://127.0.0.1/callback` for Claude Code.
- Add this site's origin to Clerk's allowed origins. Signed-out visits to `/decisions` and `/account` redirect to the Account Portal sign-in page, then back here. Grill runs no Clerk script on these pages, so it gets the session the way Clerk's own server SDK does: when the browser carries Clerk's `__client_uat` marker, or has just come back from sign-in, Grill sends it once to Clerk's handshake (`<CLERK_ISSUER>/v1/client/handshake`, nonce format). Clerk sends it back with a nonce, which Grill trades for the session through Clerk's Backend API (`/v1/clients/handshake_payload`, with `CLERK_SECRET_KEY`), then checks the `__session` token with the same JWKS. A short-lived state cookie (`__Host-grill_hs`, 10 minutes) ties that return to this browser, so a link carrying someone else's nonce does nothing. Clerk's session token lasts about a minute, so Grill then sets its own signed cookie (`__Host-grill_page`: the Clerk user ID and an expiry, HMAC-signed with a key derived from `GRILL_RECORD_KEY`, HttpOnly, 12 hours). A form sent after that lapses goes back to the page instead of applying. A development instance does not set that cookie on a `*.vercel.app` preview: the dev session stays on Clerk's host, and Clerk will not send the browser back until this origin is allowed. A return with no session shows a short message instead of another redirect. On a production instance, use your own domain (`accounts.<domain>` for sign-in, the app on that same domain) so the cookie can come back with the person.
- AgentID is optional. Turn on Clerk's built-in AgentID connection when an agent should sign in. To let Grill check the human owner's email against the allowlist, register an AgentID app, use those custom credentials in Clerk, and add the `owner_email` scope. Details are in [hosted-spike.md](hosted-spike.md).

Grill maps the OAuth client, not the chat's own guess:

| Client | How Grill knows | Company excluded | `source_app` |
|---|---|---|---|
| Claude on the web | Redirect `https://claude.ai/api/mcp/auth_callback` | anthropic | `claude` |
| Claude Code | Client id `https://claude.ai/oauth/claude-code-client-metadata`, with a loopback redirect | anthropic | `claude-code` |
| ChatGPT | Redirect host `chatgpt.com` or `chat.openai.com` | openai | `chatgpt` |
| Grok | Redirect host `grok.com` or `grok.x.ai` | x-ai | `grok` |
| Gemini | Redirect host `gemini.google.com` or `aistudio.google.com` | google | `gemini` |
| Cursor | `clientInfo` name or User-Agent contains Cursor, and no OAuth client already matched | nothing, unless the call names a model company. Cursor is not one model company. The verdict says independence was not verified | `cursor` |
| Unknown | No match | nothing, unless the call names a model company. The verdict says independence was not verified | `unknown` |

A client name is only a hint when the OAuth client is unknown, and it never overrides the row above. A client gives its name once, when it connects. Grill keeps the company from that name in the server's memory for that client only: the same sign-in, the same OAuth client id and the same User-Agent. Another client of the same person does not get it, and at most eight clients are kept for one person. A User-Agent that says Cursor is read before a kept name, so a kept company is never used for Cursor.

The call's `author` argument is mapped to the router's own vendor prefix first. For example, `xai` or `grok` becomes `x-ai`, `claude` becomes `anthropic`, `gemini` becomes `google`, `chatgpt` or `gpt` becomes `openai`, and `meta` or `muse` becomes `meta-llama`. The names and the vendor list are `AUTHOR_ALIASES` and `AUTHOR_VENDORS` in [server/index.mjs](../server/index.mjs). Then:

- A company on that vendor list wins, even over a recognised client. In Claude, `author: openai` excludes OpenAI and no longer excludes Anthropic. Whether the chat's own company may judge in that case is an open owner decision.
- `none`, or any name that is not on that list, is ignored. It cannot remove a recognised client's company.

When neither the client nor the call names a company, the judge runs with nobody excluded, and Grill says so in three places:

- The verdict carries one line after the run note that starts "Independence not verified:". An unknown client is told which company judged, when Grill has a name for it. Cursor, and a judge from a company Grill has no name for, get: "Independence not verified: Grill couldn't tell which company's model wrote this, so no company was ruled out."
- The first-use line leaves out "from a different company".
- The audit line (`grill_result` with detail `provenance`) reads `excluded: none · decorrelated: not verified`.

`decorrelated` in the audit line is a routing check: the judge came from a different company than the declared author. It is not a measure of whether their errors differ.

## What the tool text may say

A directory lists this connector. Its reviewers read every tool description, the server instructions and what the tools return. These rules hold, and [scripts/platformPolicy.test.mjs](../scripts/platformPolicy.test.mjs) checks them:

- No tool text names a credit, a plan, a price or an upgrade, and none links to `/pricing`, `/pro`, `/checkout` or `/notify`. At a monthly limit the person gets one sentence that says what happened and when it starts again, then the support address. It does not offer more.
- The grill description reads the same for every assistant. It does not assume Claude wrote the decision, and it has no sentence about a judge model named in settings, because Grill in chat has no such setting. It says the judge is from a different company when Grill can tell who wrote the decision, and that the verdict says so when it cannot.
- The grill description names the second place the write-up goes: by default a quality check by TypeSafe also gets the masked write-up and the judge's verdict and challenges. `quality_check: false` skips it for one grill, when the person asks.
- Grill asks the assistant not to add a disclosure of its own to Grill's text. Anything the assistant's own rules require goes separately, after the run note.

After a reaction (`grill_feedback`), the reply says what is kept: the rating, the one-line reason, the verdict label and the judge model, for 180 days, and not the decision.

The test builds every sentence it can without a network. It also reads every string in the code that answers a tool call, in `scripts/hostedCore.mjs` and in the tool part of `api/_hosted.mjs`, so a new result is checked without being listed. A new sentence for this route goes in `scripts/hostedCore.mjs`.

## Claude Code

```bash
claude mcp add --transport http grill https://<preview-host>/mcp
```

Then `/mcp`, choose grill, Authenticate, and sign in with the email you signed up with.

## Grok

Grok Bot is verified working. The person tells the bot `Add this MCP server: https://<host>/mcp`, then signs in with the same email each time, the email you signed up with, every time. Grill treats a redirect on `grok.com` or `grok.x.ai` as Grok and excludes x-ai from the judge. If Grok's redirect host is different, the client is unknown, nothing is excluded until the call names its company, and the verdict says independence was not verified. Do not pin Grok's own model to save time. The spike's pass rule is still the Claude web runs in [hosted-spike.md](hosted-spike.md).

## Grill IDs, and leaving Clerk

Grill owns the account ID. Clerk's user ID is only a pointer to it, so a change of sign-in company doesn't strand anyone.

- A new account gets a Grill ID (`g_` and a UUID). Accounts made before Grill IDs keep the Clerk ID they were filed under as their Grill ID, so no data moves.
- Two links point at the Grill ID: `grill:hosted:ident:<issuer hash>:<provider user id>`, one per issuer, and `grill:hosted:person:<email hash>`, from the verified email. Everything else (account row, records, drafts, spend, key) is filed under the Grill ID.
- On a call, Grill resolves the person in this order: the provider ID already linked; else the person with this verified email; else an account made before Grill IDs, found under this provider's ID or through the starter-credit claim for this email; else a new Grill ID. Only a verified email links. A changed email moves the link, so the old address can't reach the account.
- Deleting the account removes every link, from every issuer.

**Moving from the development instance to production, or to any new provider:**

1. Deploy this code first, while the old issuer is still live. Nothing changes for anyone.
2. Point `CLERK_ISSUER` (and `CLERK_SECRET_KEY`) at the new instance, and redeploy.
3. Each person signs in once more. Their verified email finds their account. Assistants reconnect once, because the issuer URL changed.

The new provider must return verified emails only. If it can return an unverified one, it must not be used, or anyone could claim another person's records.

Still Clerk-specific: Clerk issues the access tokens, and Clerk's API is used for the email and for account delete. Running Grill's own authorization server, with Clerk only as the upstream login, would make a provider change invisible to assistants. It is deferred until a switch is actually planned, or until a mass reconnect would cost real users.

## Founding members

The first 100 accounts that get access are founding members. Access means a redeemed invite code, a place on the allowlist, or an approval from the waitlist. Open sign-up does not take a spot. Each email gets one number. Asking again does not take another. The store keeps a count and a one-way hash of the email. It does not keep a list of addresses.

A founding member does not have to pay. Checkout and pricing say "You don't need to pay." The free-for-life tier is still the early-tester allowance: $5 of use each month. That cap stays. A paid plan does not apply to them, and the account is not marked as a paid subscription.

`/start` and `/redeem` say "First 100 users get Grill free for life, N spots left", or "All 100 founding spots are taken" when the count is 100. One spot left says "1 spot left". After a code works, and on the account page, the line is "Founding member #N of 100: Grill is free for you for life."

People already let in are numbered by first access. First access is the earliest time on record: the account's `createdAt` (the first sign-in), or the waitlist row's `approvedAt` when they were approved before they had an account. Someone with no time sorts after those with one, then by email. The same email keeps the earliest time. Tony's own accounts are left out. The operator passes those addresses to the backfill. They are not stored in the repository. An allowlist email that has never signed in gets a number the next time they are admitted. An invite-code grant is only a hash, so it cannot be turned back into an email.

```
node scripts/founding-backfill.mjs --file people.json --exclude person@example.com
node scripts/founding-backfill.mjs --file people.json --exclude person@example.com --apply
```

`people.json` is an array of `{ "email", "at" }`. Without `--apply` the script prints the order and writes nothing. `--apply` needs the existing Upstash env and assigns the numbers. Do not commit the file if it holds real addresses.

## Changing this route

Grill in your chat is live at `grillyour.ai/mcp`. Try a change that touches sign-in, the judge call or `grill_result` on a preview first, and re-run the Claude web check in [hosted-spike.md](hosted-spike.md) before it reaches production. `mcp.grillyour.ai` is not set up yet.
