# Changelog

## Unreleased

- Optional anonymous usage stats, off unless you turn them on. After the first successful grill, and at most once per ISO week after that, the tool can POST a metadata ping to `https://grillyour.ai/api/ping`: a random install id, the version, the client and route, whether the grill succeeded, coarse timing, and the UTC day. Never the decision. `GRILL_PING=off` or `DO_NOT_TRACK=1` disables it. The paste route does not send it.
- The judge grades severity against the decision, not the finish of the plan. A challenge is serious when, if it is right, a rejected option looks as good or better or the chosen option must become a different plan. A fix to the plan's test, threshold, sample size or timing that can be made in place is moderate and still shows. A verdict of "weak" needs a serious challenge. The judge is told not to soften a serious flaw and not to inflate a moderate one. The paste-route judge prompt says the same. Live evals had judges from several companies and cost bands filing "serious" for detail fixes on sound decisions.
- After a finished grill, the tool can show one Grill news line, at most once a session, about an optional Pro plan (saved history and look-back reminders). It shows only when the day is within 7 days of the release date baked into that build, or on the first 3 days of a month, and not otherwise. It is on unless "Show Grill news" is switched off, or `GRILL_NEWS` is off, and it stops after 2026-11-13. The tool sends nothing and stores nothing. The paste route can show the same news once per conversation, and skips it if you declined the signal offer.
- The website replaces the "Get a starter key" button with a form to hear when Pro is ready, while accounts aren't live. Joining is double opt-in, confirmed with a button press. The confirmation link is encrypted, so the email address is not in the URL. The list is deleted 60 days after the launch email. Sign-ups are Pro interest and are not counted as users. If Resend or Upstash isn't configured, the page says sign-ups aren't open yet.
- A grill can carry an optional goal and guardrails, in the user's words. The judge checks a stated goal or guardrail and does not invent one. A trade-off the user names and accepts is not a defect. The decision record stays version 1 and adds `goal`, `guardrails` and `source_app` only when they have a value. The Grill tool does not fill in `source_app`. Look-back asks whether the goal was reached and whether the guardrails held.
- The default judge is only OpenRouter's Auto Router (`openrouter/auto`). It excludes the author's company and does not pin a fallback model. A transient failure retries that same router, with backoff and a fixed limit. If the model that answers is still the excluded company, the run errors and does not return that verdict. `JUDGE_MODEL` still overrides the chain.

## 0.1.1

- Requests to OpenRouter send `HTTP-Referer: https://grillyour.ai` next to `X-Title: Grill`, so OpenRouter can show aggregate usage counts for the app. Decision text still goes only to OpenRouter.
- The Desktop extension manifest stays valid for Claude Desktop. The release also includes `grill-smithery.mcpb`, the same bundle with each tool's input schema from `tools/list`, for the Smithery registry.
- The optional judge model setting says to leave it blank for Grill's default, which picks a judge automatically from a different company than your assistant.
- `server.json` names the v0.1.1 bundle. Its checksum is still the published 0.1.0 file until that bundle exists.

## 0.1.0

- First release. An outside judge for a decision you approve, with zero-retention routing, a Desktop extension, and a paste route.
