# Weekly impact email: test plan (set before results)

Set on 8 Nov 2026, before the first send. Changing a number here after a send needs a dated line under **Changes**.

## Question

Does the Monday note make people come back and log what happened? The goal is curiosity about impact (did a grill change the call) and retention through look-backs and Yes or No taps.

## When it ends: people reached, not weeks

- Read out once **30 different people have received at least one note and there have been 60 sends**, then wait **7 more days** so the last Monday's returns are in.
- Backstop: the last send is **25 Jan 2027** (12 Mondays). Read out 7 days later even if the numbers fall short.
- Too little data is not a reason to stop. It is cheap and reversible, so we decide on what we have, say how sure we are, and keep measuring.

## Holdout

- About **1 in 4 accounts** is held out, fixed by a hash of the account id (`weekly-email-v1`). Same group every week.
- Held out means not sent. Their settings and unsubscribe still work. A held-out week counts only when that person would have got a note (not a quiet week), so both groups are compared like for like.
- With tens of accounts the gap will be noisy. Treat it as directional, and read it next to the per-person funnel.

## Primary measure

Share of eligible person-weeks with a **return within 7 days of the Monday**: a grill, a look-back, or a Yes or No tap. Sent vs held out.

Split into two, because a tap alone could rise while real use falls (from the grill):
- **Activity**: a grill or a look-back.
- **Tap only**: a Yes or No tap with no grill or look-back that week.

## Keep, change or stop

- **Keep** if the sent group's return rate is at least the held-out rate and activity is not lower, with the guardrail OK.
- **Change the copy or cadence** if sent is below held out on activity, or clicks are near zero.
- **Pause now** if the guardrail trips. Stopping is a decision for Tony.

## Guardrails

- Unsubscribes over **10% of people reached**: pause.
- Any spam complaint or a bounce spike in Resend's dashboard (checked by hand each Monday; no webhook): pause.

## Also watched

- Clicks: opens of `/decisions?from=email` while signed in (sign-in can drop the tag, so this undercounts).
- Look-backs confirmed from the email (`grill:metric:impact_email_lookbacks`).
- No open tracking and no third-party trackers.

## Where to read it

`node scripts/weekly-metrics.mjs` prints two `email test:` lines: people, sends, ready or not, guardrail, clicks, and each group's returns.

## Grill of this plan (8 Nov 2026)

Verdict: **Solid if**. Defensible as a directional decision, not proof of a retention lift.
- Risk: deciding on the Monday the numbers are reached. Fixed: wait 7 more days.
- Challenge: a tap might not mean retention. Fixed: activity and tap only are reported apart.

## Changes

None yet.
