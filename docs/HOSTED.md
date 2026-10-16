# Grill inside your chat

Not live yet. The code is off unless `GRILL_HOSTED=on`. When it is on, it is invite-only: set `GRILL_HOSTED_ALLOWLIST` to the emails that may grill. Anyone else gets a short message and no grill. Open sign-up is a separate switch, `GRILL_OPEN_SIGNUP=on`, and is off by default.

Grill pays for the starter credit, so two hard monthly caps sit in front of every grill: one for the whole service and one per person. When either is reached, the grill does not run and the person gets one plain sentence saying the free grills for the month are used up and nothing was charged to them. Each person's router key is also hard-capped by the router itself.

This is a connector, not the installed tool. The installed tool is unchanged: your key, on your computer, and the write-up goes only to the model router.

The judge is always OpenRouter's Auto Router (`openrouter/auto`). Grill excludes only the company that wrote the write-up. It does not fall back to the chat's own model, for speed or cost, and it does not pin a model.

## What a person does

1. Add a custom connector. The URL is `https://<host>/mcp`. On a preview that host is the preview origin. `https://mcp.grillyour.ai/mcp` comes later, when the owner adds that domain.
2. Connect. A sign-in opens. Google, or an emailed code. No key to paste, and no card.
3. The first grill asks, once, whether to keep decision records. Answer once. The outside-judge disclosure is shown once per account, then not again.
4. Say the decision as you mean it. The assistant sends that. It does not show a template or wait for an OK. The note comes back in the chat. If three grills are already running, the assistant waits and retries on its own.

Decisions you chose to keep are at `/decisions`. Each gets a look-back date 14 days out. When the date comes, `/decisions` lists it under "Due for a look-back", and the next `grill_decided` adds one line counting the calls due, at most once a UTC day. To be reminded outside the chat, switch on a calendar link on `/decisions` or `/account` and subscribe to it in your calendar app. It is off by default, shown once, and shows "Grill look-back due" on each date, with titles only if you switch them on. Turning it off, getting a new link, or deleting the account stops the old link. The link is `https://<host>/decisions/calendar/<secret>.ics`. Why it works this way: [PRD-lookback-reminders.md](PRD-lookback-reminders.md).

 The account, the credit, and delete are at `/account`. Both pages are plain HTML, with the same content rules as the Pro pages: no analytics script.

## What the owner sets

On the preview environment only, until the spike in [hosted-spike.md](hosted-spike.md) passes.

| Variable | What it is |
|---|---|
| `GRILL_HOSTED` | `on` to serve `/mcp`, the sign-in metadata, the authorization-server metadata, `/decisions`, the calendar link and `/account`. Anything else, including unset, is a 404. |
| `GRILL_HOSTED_ALLOWLIST` | Comma-separated emails that may grill while sign-up is invite-only. If unset or empty, nobody is let in. |
| `GRILL_OPEN_SIGNUP` | `on` lets any verified email grill, ignoring the list. Anything else, including unset, keeps it invite-only. Turn it on only with the caps below set. |
| `GRILL_MONTHLY_CAP_USD` | Optional. Hard cap on what Grill pays for all hosted grills in a calendar month (UTC). Default `20`. `0` stops every grill. |
| `GRILL_USER_MONTHLY_CAP_USD` | Optional. Hard cap per person per calendar month (UTC), keyed to a hash of the email the starter credit belongs to, so an agent shares its owner's cap. Default `1`. |
| `CLERK_ISSUER` | Clerk Frontend API URL, no trailing slash. This is the authorization server in the protected-resource metadata. It does not serve the sign-in page. |
| `CLERK_SIGN_IN_URL` | Optional. Absolute URL of the Clerk Account Portal sign-in page. When unset, Grill derives it from `CLERK_ISSUER`: `name.clerk.accounts.dev` becomes `https://name.accounts.dev/sign-in`, `name.clerk.accountsstage.dev` becomes `https://name.accountsstage.dev/sign-in`, and `clerk.example.com` becomes `https://accounts.example.com/sign-in`. Set this when the Frontend API host does not follow those shapes. |
| `CLERK_JWKS_URL` | Optional. Defaults to `<CLERK_ISSUER>/.well-known/jwks.json`. |
| `CLERK_SECRET_KEY` | Clerk secret key. Used to read the verified email, to read an AgentID access token when the sign-in is an agent, and to delete the user when they delete the account. |
| `OPENROUTER_MANAGEMENT_KEY` | Creates one capped key per person. Never put this where a visitor can read it. |
| `GRILL_STARTER_CREDIT_USD` | Optional. Hard limit on that key. Default `1.00`. No monthly reset. |
| `UPSTASH_REDIS_REST_URL` | Redis for the account, the short-lived report, the records, and the spend counters for the caps. |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token. |
| `GRILL_KEY_ENCRYPTION_KEY` | 32 bytes, base64. Encrypts the model-router key at rest. |
| `GRILL_RECORD_KEY` | 32 bytes, base64. Wraps the per-person key that encrypts records. |

The caps count each finished grill's cost in micro-dollars with atomic `INCRBY` counters. A grill that reports no cost counts as a typical grill ($0.03). A grill may start while spend is under the cap, so the last one can finish slightly over; the next one is stopped. Fields a running grill changes (its spend row, the once-only disclosure, the per-person record key) are written to their own keys with atomic commands, so two grills finishing at once cannot overwrite each other's account data.

Generate the two encryption keys with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Store them as secrets. Losing `GRILL_RECORD_KEY` makes stored records unreadable. Rotating it needs a re-wrap, which this slice does not do.

The function that runs the judge is allowed 300 seconds, and its bundle includes `scripts/**`, because the judge is still `scripts/judge.mjs`.

## Clerk

For this preview:

- Publish Client ID Metadata Documents and Dynamic Client Registration. Require PKCE. Scopes `openid`, `profile`, `email`.
- Older MCP clients look up the authorization server on this host, including the path-inserted `/mcp` forms from RFC 8414. Grill answers `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration` (and both with `/mcp`) with Clerk's own document from `CLERK_ISSUER`, as JSON, `Access-Control-Allow-Origin: *`, cached for about a minute. If Clerk cannot be read, the response redirects there. Protected-resource metadata is unchanged and still names `CLERK_ISSUER`.
- Google, and an emailed code.
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
| Unknown | No match | nothing, unless the call names an author | `unknown` |

An explicit `author` argument wins. A client name is only a hint when the OAuth client is unknown, and it never overrides the row above.

## Claude Code

```bash
claude mcp add --transport http grill https://<preview-host>/mcp
```

Then `/mcp`, choose grill, Authenticate, and sign in with an allowlisted email.

## Grok

Grok is not part of the pass rule in the spike. When you try it, add a custom connector at the same `/mcp` URL and sign in with an allowlisted email. Grill treats a redirect on `grok.com` or `grok.x.ai` as Grok and excludes x-ai from the judge. If Grok's redirect host is different, the client is unknown and nothing is excluded until the call names an author. Do not pin Grok's own model to save time.

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

## Still to do before this is on

The pull request lists these. Do them on the preview, then run [hosted-spike.md](hosted-spike.md). Do not point `grillyour.ai` or `mcp.grillyour.ai` at this until that spike passes.
