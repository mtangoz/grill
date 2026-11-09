# Roadmap

Ideas for later. None of these is a promise to build. A consider-when line is the trigger that brings an idea back. Triggers are tied to a stage: 10 users, 100 users, feedback themes, or cost. A real user is a person who ran a grill, as [PRINCIPLES.md](PRINCIPLES.md) defines it.

The daily growth work reviews docs/ROADMAP.md before it asks what to build. A weekly scan updates docs/ROADMAP.md and docs/COMPETITORS.md together. New ideas get a consider-when line. Competitor notes get a date and what changed. Who early outreach is for, and the rules it follows, are in [ICP.md](ICP.md).

Each idea has three parts. **Impact** says what it moves (usage, retention, revenue, trust, or hygiene) and roughly how much: high, medium or low. It is a guess until a measure in [STRATEGY.md](STRATEGY.md) or [PRINCIPLES.md](PRINCIPLES.md) backs it. **Consider when** is the trigger. **Status** says whether the trigger is met. Revenue ideas follow STRATEGY.md: earn the second grill before chasing the hundredth user.

Most triggers read the real-user count in STRATEGY.md. That count is 1 as of 2026-11-09, so every user-count trigger below reads as not met.

### At a glance

| Idea | Impact | Trigger | Status |
|---|---|---|---|
| Record the real-user count | High, enables every other trigger | Now | Done |
| Close the unknown-client judge gap | High, trust | Now | Trigger met |
| Publish the hosted address on the MCP Registry | Medium, usage | Now | Trigger met |
| ChatGPT and Claude connector directory listings | High, usage | Now, with the owner's approval | Trigger met, blocked |
| Hand-run partnerships | Medium, usage | Now | Trigger met |
| Settle the Gemini "testing now" line | Low, trust | Now | Trigger met |
| Verify Meta AI (Muse) in chat | Medium, usage | Now | Trigger met |
| Remove the dead Smithery mentions | Low, hygiene | Now | Half done |
| Pre-mortem reply angle | Low, usage | Now, content only | Trigger met |
| Public launch (Show HN, Product Hunt) | High, usage, one-off | Real-user count recorded and activation measured | Not met |
| Plan for after the founding 100 | Medium, revenue | Founding count reaches 80 of 100 | Not met |
| Paid tier (turn Pro on) | High, revenue | 100 real users and 20 evidenced look-backs | Not met |
| Pay-as-you-go above the allowance | Low, revenue | 30 paying users, and over 15% reach the allowance | Not met |
| Team pilot, then a team plan | High, revenue and retention | 100 users, or a team asks | Not met |
| Shared/team sessions with a decision owner | High, retention | 100 users, or team demand | Not met |
| Invite bonus with a hard global budget | Medium, usage | Share link shipped, plus the owner's OK | Half met |
| Commission partner / referral program | Medium, usage | A partner asks, after a hand-run partnership | Not met |
| Google Docs add-on | Medium, usage | 25+ users, or users ask | Not met |
| Gemini and Google Search app listing | Medium, usage | Claude listing live and 25+ users | Not met |
| Personal calibration view | Medium, retention | A person has 30 resolved calls | Not met |
| Markdown export of a verdict | Low, usage | 2+ users ask, or the share link is used | Not met |
| Optional second judge | Medium, trust | Feedback says one judge is not enough, and cost allows | Not met |
| Perplexity on the connect page | Low, usage | A tested connect, or a user asks | Not met |
| Agent-to-agent harness | Medium, new market | After shared sessions, or a platform asks | Not met |
| Pinned judge for agent audits (separate product) | Unknown, new market | A platform offers to pay, and the owner makes the values call | Not met |
| Higher spend cap for contributors | Low, contributors | First contributor near the $5 cap | Not met |
| Contributor votes on the roadmap | Low, contributors | 10+ active contributors | Not met |
| Privacy work for work use (work mode, Spaces, org view) | High, revenue later | The triggers in the privacy PRD | Not met |

### Triggers that bring several ideas forward at once

| When this happens | Look again at |
|---|---|
| The real-user count is recorded | Public launch, then every user-count trigger below |
| 25 real users | Google Docs add-on, Gemini and Google Search app listing |
| 100 real users and 20 evidenced look-backs | Paid tier, team pilot, shared sessions, optional second judge |
| Founding members reach 80 of 100 | Plan for after the founding 100, paid tier |
| Monthly judge spend nears the service cap | Paid tier, invite bonus budget, optional second judge |
| A team or an agent platform asks | Team pilot, agent-to-agent harness, pinned judge |
| Repeated feedback asking for the same thing | The idea that feedback names. A single request is not a theme. |

The cost line: the hosted service cap is `GRILL_MONTHLY_CAP_USD`, default $20 in the code ([HOSTED.md](HOSTED.md)). Earlier notes here said "about $40 a month", with no source. Use the production value of that cap. The owner sets it.

Last scan: 2026-11-04. Names and links are in [COMPETITORS.md](COMPETITORS.md). An idea taken only from a competitor or a channel post, with no user signal, is labelled (competitor-only, needs user signal). A line that says "Trigger met" means the consider-when is already true. It is still not a promise to build.

## Google Docs add-on

Impact: medium, usage. Meets people where they already write a decision. Costs a Google Workspace review and a second surface to maintain.

People already draft decisions in a doc. An add-on would let them grill that draft without leaving it.

Consider when: 25+ users, or if users ask for it in docs.

## Shared/team sessions with a decision owner

Impact: high, retention. A team decides often, so a shared record reaches enough look-backs in weeks, not a year (STRATEGY principle 6).

A session more than one person can see, with one named decision owner. The owner still makes the call. Grill does not become the decision.

Consider when: 100 users, or team demand.

## Agent-to-agent harness

Impact: medium, a new market. Agents make many decisions, but this stretches the promise that a person decides.

A way for one agent to ask Grill to judge another agent's plan, with a person as the decision owner. Later.

Consider when: later, after shared sessions are in use, or if an agent platform asks for a harness.

## Higher spend cap for contributors ($10/month vs $5)

Impact: low, contributors. Keeps an active contributor from hitting the early-tester cap.

A contributor could have a higher monthly spend cap, $10 instead of $5. It can be granted by hand at small scale.

Consider when: first contributor near the $5 cap, or 5+ active contributors.

## Contributor votes on the roadmap

Impact: low, contributors. Gives ownership without money (see the contributor loop PRD).

People who contribute could vote on which roadmap idea comes next.

Consider when: 10+ active contributors.

## ChatGPT and Claude connector directory listings

Impact: high, usage. People find the connector inside the app they already use, with no URL to paste.

Get listed in OpenAI's ChatGPT plugin directory and Anthropic's Claude Connectors Directory so people who already have those apps open can find Grill.

2026-11-04 scan: Claude submissions are scanned and listed as Community by default. Verified is assigned automatically, with no application. A Community listing helps browse and search. It may not be suggested inside a chat. Plugins (plugins, skills and connectors on one page) reaches general availability on 2026-11-09. A local `.mcpb` is no longer accepted there. Only the hosted connector or a plugin can be listed.

ChatGPT submission is a plugin ZIP, then automated findings, then review. Review needs 5 positive and 3 negative test cases, a demo video, a reviewer account that works without MFA, email codes or magic links, the four listing URLs, and verified identity. Custom MCP servers can be added from Plugins without Developer Mode. Checked this repo on 2026-11-04: `site/start.html` does not tell people to turn on Developer Mode. OpenAI's reviewer account cannot use an email code. This repo's privacy note still says sign-in is an emailed code only, and there is no password. Confirm how a reviewer signs in before anyone submits. The terms address is available. DCR may simplify sign-in. Identity verification is still Tony's.

Consider when: now. Do not submit until Tony approves. Blockers: a reviewer demo account past the invite wall, OpenAI identity verification, and a paid Claude plan for Anthropic's portal. The operator name and postal address are on the terms.

Trigger met: the consider-when is now (2026-11-04). Submitting still waits on Tony's approval and the blockers above.

## Hand-run partnerships (no commission software)

Impact: medium, usage. One newsletter or pre-install can reach more of the ICP than a month of posts.

Two or three partnerships run by hand: an AI newsletter, a Natter-style plugin or org pre-install, or similar. No affiliate software.

Consider when: now. Track outcomes before any automated referral program.

Trigger met: the consider-when is now (2026-11-04).

## Invite bonus with a hard global budget

Impact: medium, usage. Rewards word of mouth, which suits a product people share as a screenshot.

When someone joins from a share or invite link, give the inviter and the invitee a small extra monthly allowance. Cap total extra spend so the service stays well under the ~$40/month cost line.

Consider when: after the share link ships, and only with Tony's OK, since it changes caps config. Budget must be a hard global counter.

The share-link half of this trigger is met. The share page has shipped. See Archived. It still needs Tony's OK.

## Paid tier above the free cap (turn Pro on)

Impact: high, revenue. Pro is built and priced at $9 a month or $90 a year (owner decision, 2026-11-07). At the default $3 monthly key cap, gross margin is about 59% for someone who uses the whole allowance and about 88% for a typical user ([PRD-hosted-pro.md](PRD-hosted-pro.md)). Founding members stay free for life.

A simple paid plan above the free monthly allowance. Revenue stays parked until the trigger. Sell look-back reminders and "Where your calls changed", not calibration (STRATEGY rec 4).

Consider when: 100 evidenced users (people who ran a grill) and at least 20 evidenced look-backs from people other than the maintainers, as STRATEGY.md rec 4 sets. Or Tony says so. Monthly judge spend nearing the service cap is a reason to look again. On its own it means tightening the free allowance, not selling.

## Commission partner / referral program

Impact: medium, usage. Only worth the bookkeeping once a hand-run partnership has shown it brings real users.

Revenue share or tracked links for partners with a real audience. Start as a coupon code and manual payouts. No partner portal until demand is proven.

Consider when: a partner asks for a revenue share or a tracked link after at least one hand-run partnership. Not before.

## Publish the hosted address on the MCP Registry

Impact: medium, usage. Downstream directories copy the registry, so one publish fixes several listings.

The live registry entry, checked 2026-11-04, is still `io.github.mtangoz/grill` at v0.1.0, with only the stdio `.mcpb` package and no `remotes` entry for `https://grillyour.ai/mcp`. Downstream directories read that entry, so they only see the local bring-your-own-key package. This repo's `server.json` already lists that remote and is at 0.1.1. Publishing it (`mcp-publisher publish`, as mtangoz) is separate work. This note does not change `server.json`. PulseMCP submissions are still paused (page last updated 2026-09-03). They say they will ingest the official registry when they reopen. mcp.so was not re-checked.

Consider when: now. Channel hygiene. It does not wait on a real-user count, on feedback, or on cost. It is cheap, and it fixes stale data.

Trigger met: the consider-when is now (2026-11-04).

## Remove the dead Smithery mentions

Impact: low, hygiene.

Smithery shut down its MCP proxy on 2026-10-31. The Grill listing at `https://smithery.ai/servers/hold-systems/grill` returned 404 on 2026-11-04. README.md still names Smithery. The weekly snapshot script outside this repo (`grill-growth/snapshot.py`) still polls `registry.smithery.ai`, so that install count is dead. `smithery.yaml` in this repo is the local bundle, not the dead directory listing.

Status 2026-11-08: the README's Smithery line is gone, and the research note says Smithery closed. The ops snapshot still polls Smithery. Removing that poll is the half still to do.

Consider when: now. Housekeeping. No real-user count, feedback theme, or cost gate.

Trigger met: the consider-when is now (2026-11-04).

## Settle the Gemini "testing now" line

Impact: low, trust. Copy that says "testing now" for weeks reads as stale.

`site/page.html`, `site/faq.html` and `site/start.html` still say Gemini should work and is still being tested (US only, a personal Google account, Keep Activity on). One Gemini web custom-app connect test would let the copy say it works, or the line should come out. Copy edits are separate work.

Consider when: now, so existing copy stays honest, or when the first user asks about Gemini (feedback).

Trigger met: the consider-when is now (2026-11-04). A user asking is not required.

## Gemini and Google Search app listing

Impact: medium, usage.

Google's Connected Apps Platform preview (2026-10-28) is one place to register an MCP app for Gemini and Google Search. It is a preview with a waitlist. Joining it is a sign-up under a Hold Systems address, so it needs Tony's OK. The 2026-11-04 scan had no user signal for this. It is a channel listing.

Consider when: the Claude directory listing is live and there are 25+ real users, or Google opens the preview with no waitlist. Real-user count. Not before.

## Pre-mortem reply angle (competitor-only, needs user signal)

Impact: low, usage. Content, not a feature.

Same-chat pre-mortem prompts are common on X. Nearly all of them are the same model grading itself. One competitor post describes anchoring: the second question is already shaped by the first confident answer. A reply can say that a pre-mortem in the same chat is the same model grading itself, and that the check should happen before the follow-up questions. Public replies stay inside the approved outreach rules. This is not a product change.

Consider when: now, as content only, inside those rules. Measure by replies, not impressions. It does not become a feature without a user signal (feedback). (competitor-only, needs user signal)

Trigger met: the consider-when is now (2026-11-04), for the reply angle only.

## Markdown export of a verdict (competitor-only, needs user signal)

Impact: low, usage.

A Markdown copy of the verdict and the challenge only, never the question, as an extension of the share link. Council AI (council-ai.app) exports a verdict people can send. Grill's share page already shows the verdict and one challenge, and nothing else from the record.

Consider when: 2+ real users ask to send or share a verdict (feedback), or the shipped share link is actually being used. Use is not recorded in this repo. (competitor-only, needs user signal)

## Optional second judge (competitor-only, needs user signal)

Impact: medium, trust. It roughly doubles the cost of a grill.

Two judges, from two companies that are not the one that wrote the answer, with the disagreement shown. Council-style products, Perplexity Model Council and Triall do something like this. Grill's rule stays: the judge is a different company, and the person still decides. Revenue stays parked. This is not a panel to build because other products have one.

Consider when: feedback says one judge is not enough, and the cost of a grill is well under the ~$40/month line at 100 real users. Both feedback and cost. (competitor-only, needs user signal)

## Perplexity on the connect page

Impact: low, usage.

Perplexity accepts a custom remote connector: an HTTPS MCP URL, OAuth or an API key, Streamable HTTP or SSE. This repo's connect page has no Perplexity section. Perplexity also ships its own Model Council inside that client, so a setup line is not a reason to change the product.

Consider when: someone has tested a connect, or the first user asks (feedback). Not before.

## Record the real-user count

Write the number of real users and evidenced look-backs into STRATEGY.md, and update it monthly. The hosted counts already exist: `account_created` and `first_grill` ([PRO.md](PRO.md)), the weekly look-back funnel, and the founding count ([HOSTED.md](HOSTED.md)). Subtract the maintainers.

Impact: high. Every user-count trigger in this file reads this number. Without it, nothing here can move from not met to met.

Consider when: now. STRATEGY.md rec 1 asks for it, and PRD-privacy-foundations expected it by 2026-11-01.

Trigger met: the consider-when is now (2026-11-08).

Done: recorded 2026-11-09 in STRATEGY.md. Monthly refresh.

## Close the unknown-client judge gap

When the MCP server does not recognise the client and no company is named, it still excludes Anthropic. A non-Claude author can then be judged by its own company. Say so on the verdict, or ask for the company, instead of guessing. This touches the judge, so it needs its own pull request and review (STRATEGY rec 3).

Impact: high, trust. A judge from a different company is the product (STRATEGY principle 1).

Consider when: now, before any launch that brings people from non-Claude MCP apps.

Trigger met: the consider-when is now (2026-11-08).

## Verify Meta AI (Muse) in chat

The README has Muse connector steps with a public client ID. The site and HOSTED.md still say Meta AI is coming soon. One test connect would let the site say it works, or the README steps should come out.

Impact: medium, usage. A large audience that cannot run an MCP app on a computer.

Consider when: now, so the README and the site say the same thing, or when the first user asks (feedback).

Trigger met: the consider-when is now (2026-11-08).

## Public launch (Show HN, Product Hunt)

One planned launch, with drafts already in the ops repo. A launch is a single spike. It helps only if people come back afterwards.

Impact: high, usage, once. It is the cheapest way to reach the first 100 real users. If retention is unmeasured, the spike teaches nothing.

Consider when: the real-user count is recorded, and sign-up to first grill is measured (`account_created` to `first_grill`), so the spike can be read. Not before.

## Plan for after the founding 100

The first 100 accounts given access are free for life. Open sign-up does not take a spot ([HOSTED.md](HOSTED.md#founding-members)). Decide what the 101st person sees, and what the free monthly allowance is after that, before the count runs out.

Impact: medium, revenue. It sets the free tier that Pro has to beat.

Consider when: founding members reach 80 of 100 (the weekly line shows `founding members: N/100`), or the paid tier trigger is met.

## Pay-as-you-go above the allowance

Metered overage at all-in cost plus 10%, off until the user switches it on, under a user-set monthly cap. Designed in [PRD-hosted-pro.md](PRD-hosted-pro.md).

Impact: low, revenue. At cost plus 10% it barely breaks even. Its job is to keep heavy users from hitting a hard stop.

Consider when: Pro has 30 or more paying users and more than 15% of them reach the monthly allowance (the PRD's allowance-fit measure).

## Team pilot, then a team plan

Invite one small team that already decides together to use in-chat Grill for a month (STRATEGY rec 6). Price a team plan only after the pilot.

Impact: high, revenue and retention. One team on a plan of around $50 to $100 a month is worth many solo subscribers, and a team reaches enough look-backs to be useful in weeks.

Consider when: 100 users, or a team asks. Gate T in [PRD-privacy-foundations.md](PRD-privacy-foundations.md) still applies: no marketing hosted Grill for work or team use until its privacy steps merge.

## Personal calibration view

"When you say 70%, you're right N% of the time", for one person's resolved calls.

Impact: medium, retention, for the few heavy users who get there. It is not a reason to buy (STRATEGY principle 5).

Consider when: at least one person has 30 resolved calls with a stated confidence. Before that, "Where your calls changed" already refuses to compare small samples.

## Pinned judge for agent audits (separate product)

A check before an irreversible agent action, with a signed record that can be reproduced. Reproducing a verdict needs a pinned model, and the free tool never pins one. By STRATEGY principle 10, this could only ship as a separate product with its own name and rules.

Impact: unknown, a new market. It is a values call before it is a product.

Consider when: an agent platform offers to pay for it, and the owner decides to build it at all (STRATEGY open decisions).

## Privacy work for work use

Work mode, Spaces, an aggregate org view, and later customer-managed keys, SSO, a DPA and data residency. Each waits on its own trigger in [PRD-privacy-foundations.md](PRD-privacy-foundations.md) section 5, and in section F of the growth framework in the ops repo. This file does not repeat those thresholds.

Impact: high, revenue later. Work use is where a team plan gets paid for.

Consider when: the triggers in PRD-privacy-foundations section 5 fire.

## Archived

Ideas moved here are already shipped, or the note is stale. Each one keeps its old consider-when line and says why it left the active list.

### Shareable verdict link (no decision text)

A public link that shows only the verdict and the sharpest challenge. Private by default. Opt-in per verdict. Revocable. Never the user's question or record body.

Consider when: now. Ship the share page first. Invite bonus is separate.

Archived: already shipped. `/decisions` offers Share verdict, and `/share/<token>` shows the verdict and one challenge. See [UX.md](UX.md) and [HOSTED.md](HOSTED.md).
