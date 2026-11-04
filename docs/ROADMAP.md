# Roadmap

Ideas for later. None of these is a promise to build. A consider-when line is the trigger that brings an idea back. Triggers are tied to a stage: 10 users, 100 users, feedback themes, or cost. A real user is a person who ran a grill, as [PRINCIPLES.md](PRINCIPLES.md) defines it.

The daily growth work reviews docs/ROADMAP.md before it asks what to build. A weekly scan updates docs/ROADMAP.md and docs/COMPETITORS.md together. New ideas get a consider-when line. Competitor notes get a date and what changed. Who early outreach is for, and the rules it follows, are in [ICP.md](ICP.md).

Last scan: 2026-11-04. Names and links are in [COMPETITORS.md](COMPETITORS.md). An idea taken only from a competitor or a channel post, with no user signal, is labelled (competitor-only, needs user signal). A line that says "Trigger met" means the consider-when is already true. It is still not a promise to build.

## Google Docs add-on

People already draft decisions in a doc. An add-on would let them grill that draft without leaving it.

Consider when: 25+ users, or if users ask for it in docs.

## Shared/team sessions with a decision owner

A session more than one person can see, with one named decision owner. The owner still makes the call. Grill does not become the decision.

Consider when: 100 users, or team demand.

## Agent-to-agent harness

A way for one agent to ask Grill to judge another agent's plan, with a person as the decision owner. Later.

Consider when: later, after shared sessions are in use, or if an agent platform asks for a harness.

## Higher spend cap for contributors ($10/month vs $5)

A contributor could have a higher monthly spend cap, $10 instead of $5. It can be granted by hand at small scale.

Consider when: first contributor near the $5 cap, or 5+ active contributors.

## Contributor votes on the roadmap

People who contribute could vote on which roadmap idea comes next.

Consider when: 10+ active contributors.

## ChatGPT and Claude connector directory listings

Get listed in OpenAI's ChatGPT plugin directory and Anthropic's Claude Connectors Directory so people who already have those apps open can find Grill.

2026-11-04 scan: Claude submissions are scanned and listed as Community by default. Verified is assigned automatically, with no application. A Community listing helps browse and search. It may not be suggested inside a chat. Plugins (plugins, skills and connectors on one page) reaches general availability on 2026-11-09. A local `.mcpb` is no longer accepted there. Only the hosted connector or a plugin can be listed.

ChatGPT submission is a plugin ZIP, then automated findings, then review. Review needs 5 positive and 3 negative test cases, a demo video, a reviewer account that works without MFA, email codes or magic links, the four listing URLs, and verified identity. Custom MCP servers can be added from Plugins without Developer Mode. Checked this repo on 2026-11-04: `site/start.html` does not tell people to turn on Developer Mode. OpenAI's reviewer account cannot use an email code. This repo's privacy note still says sign-in is an emailed code only, and there is no password. Confirm how a reviewer signs in before anyone submits. The terms address is available. DCR may simplify sign-in. Identity verification is still Tony's.

Consider when: now. Do not submit until Tony approves. Blockers: a reviewer demo account past the invite wall, OpenAI identity verification, and a paid Claude plan for Anthropic's portal. The operator name and postal address are on the terms.

Trigger met: the consider-when is now (2026-11-04). Submitting still waits on Tony's approval and the blockers above.

## Hand-run partnerships (no commission software)

Two or three partnerships run by hand: an AI newsletter, a Natter-style plugin or org pre-install, or similar. No affiliate software.

Consider when: now. Track outcomes before any automated referral program.

Trigger met: the consider-when is now (2026-11-04).

## Invite bonus with a hard global budget

When someone joins from a share or invite link, give the inviter and the invitee a small extra monthly allowance. Cap total extra spend so the service stays well under the ~$40/month cost line.

Consider when: after the share link ships, and only with Tony's OK, since it changes caps config. Budget must be a hard global counter.

The share-link half of this trigger is met. The share page has shipped. See Archived. It still needs Tony's OK.

## Paid tier above the free cap

A simple paid plan above the free monthly allowance. Revenue stays parked until the trigger.

Consider when: 100 evidenced users (people who ran a grill), Grill costs above about $40/month, or Tony says so.

## Commission partner / referral program

Revenue share or tracked links for partners with a real audience. Start as a coupon code and manual payouts. No partner portal until demand is proven.

Consider when: a partner asks for a revenue share or a tracked link after at least one hand-run partnership. Not before.

## Publish the hosted address on the MCP Registry

The live registry entry, checked 2026-11-04, is still `io.github.mtangoz/grill` at v0.1.0, with only the stdio `.mcpb` package and no `remotes` entry for `https://grillyour.ai/mcp`. Downstream directories read that entry, so they only see the local bring-your-own-key package. This repo's `server.json` already lists that remote and is at 0.1.1. `.github/workflows/publish-mcp.yml` publishes that file with `mcp-publisher login github-oidc` when a release is published, or by hand from `main` (Actions → publish-mcp → Run workflow). The live entry stays v0.1.0 until that workflow runs. This note does not change `server.json`. PulseMCP submissions are still paused (page last updated 2026-09-03). They say they will ingest the official registry when they reopen. mcp.so was not re-checked.

Consider when: now. Channel hygiene. It does not wait on a real-user count, on feedback, or on cost. It is cheap, and it fixes stale data.

Trigger met: the consider-when is now (2026-11-04).

## Remove the dead Smithery mentions

Smithery shut down its MCP proxy on 2026-10-31. The Grill listing at `https://smithery.ai/servers/hold-systems/grill` returned 404 on 2026-11-04. README.md still names Smithery. The weekly snapshot script outside this repo (`grill-growth/snapshot.py`) still polls `registry.smithery.ai`, so that install count is dead. Cleanup is separate work. This note does not edit the README or that script. `smithery.yaml` in this repo is the local bundle, not the dead directory listing.

Consider when: now. Housekeeping. No real-user count, feedback theme, or cost gate.

Trigger met: the consider-when is now (2026-11-04).

## Settle the Gemini "testing now" line

`site/page.html`, `site/faq.html` and `site/start.html` still say Gemini should work and is still being tested (US only, a personal Google account, Keep Activity on). One Gemini web custom-app connect test would let the copy say it works, or the line should come out. Copy edits are separate work.

Consider when: now, so existing copy stays honest, or when the first user asks about Gemini (feedback).

Trigger met: the consider-when is now (2026-11-04). A user asking is not required.

## Gemini and Google Search app listing

Google's Connected Apps Platform preview (2026-10-28) is one place to register an MCP app for Gemini and Google Search. It is a preview with a waitlist. Joining it is a sign-up under a Hold Systems address, so it needs Tony's OK. The 2026-11-04 scan had no user signal for this. It is a channel listing.

Consider when: the Claude directory listing is live and there are 25+ real users, or Google opens the preview with no waitlist. Real-user count. Not before.

## Pre-mortem reply angle (competitor-only, needs user signal)

Same-chat pre-mortem prompts are common on X. Nearly all of them are the same model grading itself. One competitor post describes anchoring: the second question is already shaped by the first confident answer. A reply can say that a pre-mortem in the same chat is the same model grading itself, and that the check should happen before the follow-up questions. Public replies stay inside the approved outreach rules. This is not a product change.

Consider when: now, as content only, inside those rules. Measure by replies, not impressions. It does not become a feature without a user signal (feedback). (competitor-only, needs user signal)

Trigger met: the consider-when is now (2026-11-04), for the reply angle only.

## Markdown export of a verdict (competitor-only, needs user signal)

A Markdown copy of the verdict and the challenge only, never the question, as an extension of the share link. Council AI (council-ai.app) exports a verdict people can send. Grill's share page already shows the verdict and one challenge, and nothing else from the record.

Consider when: 2+ real users ask to send or share a verdict (feedback), or the shipped share link is actually being used. Use is not recorded in this repo. (competitor-only, needs user signal)

## Optional second judge (competitor-only, needs user signal)

Two judges, from two companies that are not the one that wrote the answer, with the disagreement shown. Council-style products, Perplexity Model Council and Triall do something like this. Grill's rule stays: the judge is a different company, and the person still decides. Revenue stays parked. This is not a panel to build because other products have one.

Consider when: feedback says one judge is not enough, and the cost of a grill is well under the ~$40/month line at 100 real users. Both feedback and cost. (competitor-only, needs user signal)

## Perplexity on the connect page

Perplexity accepts a custom remote connector: an HTTPS MCP URL, OAuth or an API key, Streamable HTTP or SSE. This repo's connect page has no Perplexity section. Perplexity also ships its own Model Council inside that client, so a setup line is not a reason to change the product.

Consider when: someone has tested a connect, or the first user asks (feedback). Not before.

## Archived

Ideas moved here are already shipped, or the note is stale. Each one keeps its old consider-when line and says why it left the active list.

### Shareable verdict link (no decision text)

A public link that shows only the verdict and the sharpest challenge. Private by default. Opt-in per verdict. Revocable. Never the user's question or record body.

Consider when: now. Ship the share page first. Invite bonus is separate.

Archived: already shipped. `/decisions` offers Share verdict, and `/share/<token>` shows the verdict and one challenge. See [UX.md](UX.md) and [HOSTED.md](HOSTED.md).
