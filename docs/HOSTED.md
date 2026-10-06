# Grill inside your chat

Not live yet. The code is off unless `GRILL_HOSTED=on`. When it is on, it is invite-only: set `GRILL_HOSTED_ALLOWLIST` to the emails that may grill. Anyone else gets a short message and no grill.

This is a connector, not the installed tool. The installed tool is unchanged: your key, on your computer, and the write-up goes only to the model router.

The judge is always OpenRouter's Auto Router (`openrouter/auto`). Grill excludes only the company that wrote the write-up. It does not fall back to the chat's own model, for speed or cost, and it does not pin a model.

## What a person does

1. Add a custom connector. The URL is `https://<host>/mcp`. On a preview that host is the preview origin. `https://mcp.grillyour.ai/mcp` comes later, when the owner adds that domain.
2. Connect. A sign-in opens. Google, or an emailed code. No key to paste, and no card.
3. The first grill asks, before anything is sent, whether to keep decision records. Answer once.
4. Grill a decision the usual way: the assistant shows the write-up, you say go, and the verdict comes back in the chat. If it is still running, the assistant calls `grill_result` on its own.

Decisions you chose to keep are at `/decisions`. The account, the credit, and delete are at `/account`. Both pages are plain HTML, with the same content rules as the Pro pages: no analytics script.

## What the owner sets

On the preview environment only, until the spike in [hosted-spike.md](hosted-spike.md) passes.

| Variable | What it is |
|---|---|
| `GRILL_HOSTED` | `on` to serve `/mcp`, the sign-in metadata, `/decisions` and `/account`. Anything else, including unset, is a 404. |
| `GRILL_HOSTED_ALLOWLIST` | Comma-separated emails. If unset, the list does not filter. Set it before anyone is invited. |
| `CLERK_ISSUER` | Clerk Frontend API URL, no trailing slash. This is the authorization server in the protected-resource metadata. It does not serve the sign-in page. |
| `CLERK_SIGN_IN_URL` | Optional. Absolute URL of the Clerk Account Portal sign-in page. When unset, Grill derives it from `CLERK_ISSUER`: `name.clerk.accounts.dev` becomes `https://name.accounts.dev/sign-in`, `name.clerk.accountsstage.dev` becomes `https://name.accountsstage.dev/sign-in`, and `clerk.example.com` becomes `https://accounts.example.com/sign-in`. Set this when the Frontend API host does not follow those shapes. |
| `CLERK_JWKS_URL` | Optional. Defaults to `<CLERK_ISSUER>/.well-known/jwks.json`. |
| `CLERK_SECRET_KEY` | Clerk secret key. Used to read the verified email, to read an AgentID access token when the sign-in is an agent, and to delete the user when they delete the account. |
| `OPENROUTER_MANAGEMENT_KEY` | Creates one capped key per person. Never put this where a visitor can read it. |
| `GRILL_STARTER_CREDIT_USD` | Optional. Hard limit on that key. Default `1.00`. No monthly reset. |
| `UPSTASH_REDIS_REST_URL` | Redis for the account, the short-lived report, and the records. |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token. |
| `GRILL_KEY_ENCRYPTION_KEY` | 32 bytes, base64. Encrypts the model-router key at rest. |
| `GRILL_RECORD_KEY` | 32 bytes, base64. Wraps the per-person key that encrypts records. |

Generate the two encryption keys with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Store them as secrets. Losing `GRILL_RECORD_KEY` makes stored records unreadable. Rotating it needs a re-wrap, which this slice does not do.

The function that runs the judge is allowed 300 seconds, and its bundle includes `scripts/**`, because the judge is still `scripts/judge.mjs`.

## Clerk

For this preview:

- Publish Client ID Metadata Documents and Dynamic Client Registration. Require PKCE. Scopes `openid`, `profile`, `email`.
- Google, and an emailed code.
- Redirect `https://claude.ai/api/mcp/auth_callback` for Claude on the web, desktop, mobile and Cowork.
- Port-agnostic loopback `http://localhost/callback` and `http://127.0.0.1/callback` for Claude Code.
- Add this site's origin to Clerk's allowed origins. Signed-out visits to `/decisions` and `/account` redirect to the Account Portal sign-in page, then back here. Grill reads the `__session` cookie with the same JWKS. A development instance does not set that cookie on a `*.vercel.app` preview: the dev session stays on Clerk's host, and Clerk will not send the browser back until this origin is allowed. A return with no session shows a short message instead of another redirect. On a production instance, use your own domain (`accounts.<domain>` for sign-in, the app on that same domain) so the cookie can come back with the person.
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

## Still to do before this is on

The pull request lists these. Do them on the preview, then run [hosted-spike.md](hosted-spike.md). Do not point `grillyour.ai` or `mcp.grillyour.ai` at this until that spike passes.
