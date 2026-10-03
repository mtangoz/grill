# Hosted Grill spike (not live yet)

This is the gate for Grill inside a chat. It is off until you turn it on, and only on a **preview**. Do not point `grillyour.ai` or `mcp.grillyour.ai` at it yet. Do not merge this for production until the pass rule below holds.

You are checking one thing: after sign-in, a grill that takes about two minutes comes back in the chat **with no extra word from you**. The assistant has to call `grill_result` on its own.

## What you need first

The preview will not sign anyone in until the accounts in the checklist at the bottom of [HOSTED.md](HOSTED.md) exist. Minimum for this spike:

- `GRILL_HOSTED=on` on the **preview** environment only
- `GRILL_HOSTED_ALLOWLIST` set to your email (and any other invitee you will actually use)
- Clerk keys, as in that checklist, on the same preview
- `OPENROUTER_MANAGEMENT_KEY`, plus a little credit on Grill's OpenRouter account
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- `GRILL_RECORD_KEY` and `GRILL_KEY_ENCRYPTION_KEY`

In Clerk, for this preview only: publish CIMD, publish DCR, require PKCE, scopes `openid profile email`, Google and email code turned on. Allow redirect `https://claude.ai/api/mcp/auth_callback`, and port-agnostic loopback `http://localhost/callback` and `http://127.0.0.1/callback`. Add this preview's origin to Clerk's allowed origins so the sign-in popup can return.

Deploy the pull request as a Vercel **preview**. Copy the preview origin. The connector URL is:

```text
https://<preview-host>/mcp
```

That URL is what you paste below. It will not be `https://mcp.grillyour.ai/mcp` until you add that domain later, on purpose.

## Claude.ai on the web

1. Open [claude.ai](https://claude.ai) in a desktop browser, signed in as an allowlisted email.
2. Go to **Customize → Connectors → Add custom connector**.
3. Paste the preview URL ending in `/mcp`. Add it.
4. Click **Connect**. A Grill sign-in popup opens. Continue with Google, or use an email code. Do not paste a key. There is no card.
5. The first time you grill, Grill asks, before anything is sent: keep a record of your decisions, yes or no. Answer once.
6. In a new chat, say: `Grill this: we will slip the launch by two weeks. I'm 60% sure that buys a cleaner release.`
7. When Claude shows the write-up, say `go`.
8. Wait. Do not type `check`, do not open another app, do not refresh. A two-minute grill should land in the chat by itself.

Repeat from step 6 five times, in five chats (the same connector). Count a run as a pass only if the verdict appears with no further word from you.

## Claude.ai on a phone

1. Install or open the Claude app, same account.
2. Add the same custom connector: **Customize → Connectors → Add custom connector**, paste the same `/mcp` URL, then **Connect** and sign in.
3. If the phone already connected on the web, it may already be signed in. If the popup breaks, note that and stop. That is a fail for the phone, not a reason to switch the server on for everyone.
4. Run one grill the same way: `grill this`, approve the write-up with `go`, then wait with the phone unlocked. Do not type anything else.

The phone run is extra evidence. The pass rule below is the five web runs.

## Claude Code

In a terminal, with Claude Code installed:

```bash
claude mcp add --transport http grill https://<preview-host>/mcp
```

Start Claude Code, run `/mcp`, choose **grill**, then **Authenticate**. Sign in with the same allowlisted email. Then ask it to grill a short decision, approve the write-up, and wait. Same rule: you should not have to say `check`.

## Pass rule

Sign-in completes, and a grill of about two minutes finishes with **no user action** in at least **4 of the 5** web runs.

Write down, for each run: did the verdict arrive on its own, about how long it took, and the last line (it should say whether the decision was saved, the look-back date, and about how many grills of credit are left).

## If it fails

Do not build around the failure in production. If fewer than 4 of 5 runs return on their own, the chat is not re-checking `grill_result`. Stop and switch this slice to the fallback: the first reply says the grill is still running and asks the person to say `check` in a minute. That is one extra word, and it is still inside the chat.

Say which runs failed, whether the failure was sign-in, a timeout, or a verdict that never arrived, and whether the phone behaved differently from the web.

## What this spike does not prove

It does not prove ChatGPT, Gemini, or Grok. It does not turn the connector on for people outside the allowlist. It does not add a card or a top-up.
