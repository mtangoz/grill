# Roadmap

Ideas for later. None of these is a promise to build. A consider-when line is the trigger that brings an idea back. Triggers are tied to a stage: 10 users, 100 users, feedback themes, or cost. A real user is a person who ran a grill, as [PRINCIPLES.md](PRINCIPLES.md) defines it.

The daily growth work reviews docs/ROADMAP.md before it asks what to build. A weekly scan updates docs/ROADMAP.md and docs/COMPETITORS.md together. New ideas get a consider-when line. Competitor notes get a date and what changed. Who early outreach is for, and the rules it follows, are in [ICP.md](ICP.md).

Each idea has three parts. **Impact** says what it moves (usage, retention, revenue, trust, or hygiene) and roughly how much: high, medium or low. It is a guess until a measure in [STRATEGY.md](STRATEGY.md) or [PRINCIPLES.md](PRINCIPLES.md) backs it. **Consider when** is the trigger. **Status** says whether the trigger is met. Revenue ideas follow STRATEGY.md: earn the second grill before chasing the hundredth user.

Most triggers read the real-user count in STRATEGY.md. That count is 1 as of 2026-11-09, so every user-count trigger below reads as not met.

The 2026-11-13 strategy puts reach first: at today's reach the kill threshold in STRATEGY.md is expected to read "not tested: the constraint is reach" on 2027-02-28, so the next quarter is reach work. Most of that work is the owner's, and it is listed next.

### Waiting on the owner

Ordered by effect on reach. Times are rough guesses of the owner's own time, not elapsed time. Nothing here is built by an agent.

1. **File the Claude directory listing.** The kit is in [DIRECTORY-SUBMISSIONS.md](DIRECTORY-SUBMISSIONS.md): submit the hosted connector, not the plugin. Needs a paid Claude plan and a reviewer sign-in (item 17). About 1 hour.
2. **File the ChatGPT listing.** Same kit, plus OpenAI identity verification, a demo video and the reviewer account. About 3 hours, plus OpenAI's wait.
3. **Cut release 0.2.0 and republish the MCP Registry entry.** Installed users still run 0.1.1 from 2026-09-29, so none of the installed-tool changes in CHANGELOG.md reach npm, the `.mcpb` or the skill zip until then. Do item 27 first, and update the `server.json` description in the conditional form at the same time (item 29). About 1 hour.
4. **Tell the launch list that saved history and look-back reminders are live and free.** An agent drafts two sentences; the owner sends. First rewrite the launch email template in `api/_notify.mjs` (`LAUNCH_SUBJECT` and `launchEmailText`) before anyone sends it: it still lists saved history and reminders as what Pro adds. About 30 minutes.
5. **Talk to the one real user, and recruit one team pilot** (STRATEGY recommendations 2 and 6). About 2 hours over a few weeks.
6. **Set `GRILL_INTERNAL_EMAILS` in production BEFORE this branch deploys.** Comma-separated. Include maintainer, test, reviewer and agent addresses (an agent is matched by its own email and by its person's email). An entry needs an @: a value such as `on` counts nobody. Unset, no outside counter is written and the readout prints "not counted: internal list not set". After setting it, run one grill from any account so `node scripts/outside-loop.mjs` shows `Counting since: <day>`. If it is set late, look-back dates set earlier are never counted. Add a reviewer's address before they sign in. Keep it set afterwards. If it is unset later, counting stops from then on and that stretch is never counted. `node scripts/outside-loop.mjs` shows the last day the server counted. About 10 minutes.
7. **The four-arm comparison:** read a sample of the seeds, add or commission non-Anthropic seeds, register the protocol, and fund the run (about $25 to $45). The owner's steps are the nine under "What the owner does" in [evals/four-arm/README.md](../evals/four-arm/README.md). Register and fund only after the seed set is fixed. Two drafting rounds showed blind readers find every planted flaw, so the set is too easy as drafted. The drafts are not committed. About 4 hours, plus the run cost.
8. **The founding-spot line on /start under open sign-up.** "First 100 users get Grill free for life" still shows while open sign-up does not take a spot. Honour it or reword it; more traffic now goes to /start. About 15 minutes to decide.
9. **The Monday email: opt-in or opt-out, and what follows 2027-01-25.** The paragraph under the records question says Grill may email on a Monday while the test runs; it is not true for held-out accounts, and it stops being true after 2027-01-25. About 30 minutes.
10. **Whether the chat's own company may judge when the assistant names a different author** (in Claude, `author: openai` now excludes OpenAI and not Anthropic). About 15 minutes to decide.
11. **Enforce the records choice on the server** (never accept a yes before the question was returned). Since this branch, an assistant that sends `keep_records: false` by mistake also deletes waiting drafts, not only future saving. Saved records are untouched. About 15 minutes to decide.
12. **Mask before storing on the hosted route.** Today what Grill keeps is not masked. About 15 minutes to decide.
13. **A zero-retention flag on the Jev request.** Needs one live call to check TypeSafe accepts it. About 30 minutes.
14. **Ask the assistant for its company on unknown clients**, as a flagged build. About 15 minutes to decide.
15. **Grill CI: an unknown author should not clear needs-review.** About 10 minutes to decide.
16. **Stop storing the reaction reason unless the person says yes.** About 10 minutes to decide.
17. **Reviewer sign-in without an emailed code.** The options are in the kit. About 30 minutes to choose.
18. **Auth on the digest route.** About 10 minutes to decide.
19. **A call to action on the share page.** ICP.md says share links are proof only. About 10 minutes to decide.
20. **A homepage link to /demo, and a work-decision starter prompt.** Both are queued as experiments in [experiments/analytics-loop.md](experiments/analytics-loop.md), with their triggers. Both change copy the owner chose. About 15 minutes to approve or refuse each.
21. **Count verdict labels and quality checks by judge company on the server.** About 15 minutes to decide.
22. **Add sound cases to the public eval set.** Six sound cases make the false-alarm gate flap: the weekly gate went red on 2026-11-13 at 3 of 6 and green on the next run with the same judge files. About 1 hour to review new cases.
23. **A judge quality floor** (the router's cost tier and a price ceiling), without pinning a model. About 30 minutes to decide.
24. **Change the PRINCIPLES definition of evidenced look-backs.** Today it counts public signal issues and outreach replies, and the Pro bar reads it. Look-backs saved on Grill accounts are a separate count and are never added to it. About 15 minutes to decide.
25. **State a choice on the web, and outcome buttons on the due list.** The new waiting line on Your grills tells people to say the choice in a chat where Grill is connected, so a /judge-only user still has no way to turn a waiting grill into a record. About 15 minutes to decide.
26. **Refresh the 16-name vendor list when the router adds a company.** `AUTHOR_VENDORS` in `server/index.mjs` now decides exclusion: a real vendor outside the 16 names is ignored as an author. Check it against the live OpenRouter catalogue. About 15 minutes each time.
27. **Confirm what Claude Desktop and Claude Code send as `clientInfo.name`** before release 0.2.0. If neither is recognised, every installed verdict there says "Independence not verified:". About 15 minutes.
28. **The business-model sentence "Grill is paid for by subscriptions only."** in docs/PRIVACY.md and site/contribute.html. Nothing is for sale today (STRATEGY.md, Money). Keep it as intent or reword it. About 10 minutes.
29. **The `server.json` description**, in the conditional independence form, at the next release. About 5 minutes.
30. **Short unconditional "different AI" lines.** The home page description and JSON-LD say "A different AI argues the case against your plan", and the home lede says "from a different AI", with no condition. On a run where nobody is excluded the judge can be the same company's model. Tighten or keep. About 10 minutes.
31. **Two counter choices.** Split the email arms in the outside counters, or leave them unread. Whether a look-back deleted before its day should stay in the count (today it does). About 15 minutes.
32. **GitHub upkeep.** Close issues #22 and #123, the two empty monthly learning reports (the workflow now keeps one rolling issue and never touches them). Add a `Written-by-model: <vendor>/<model>` line to the prompts of the automations that open pull requests through the API. Merge the `learn.yml` and `eval.yml` changes by hand: workflow files never merge themselves. About 20 minutes.
33. **Sentences that still say "different company" with no condition, in files no package on this branch owned.** The installed judge setting ("it must be from a different company than the assistant that wrote the subject. A same-company pin is refused."), which in a guessed session refuses only an Anthropic pin; `HOSTED_INSTRUCTIONS` ("Exclude only the company that wrote the write-up."); the `judge_model` text in `smithery.yaml` (pinned by scripts/packaging.test.mjs); and docs/ICP.md lines 5 and 15. Give each the condition, or keep it. About 20 minutes.

### Proposed on this branch, needs the owner's yes before merge

The branch `claude/sleepy-curie-ze1wxi` changed 161 promise-level, legal or positioning sentences. None has the owner's yes. The full list, one row per sentence with the file, the old text, the new text and the commit, is in [PROPOSED-WORDING.md](PROPOSED-WORDING.md). It was built from every commit since 311ea3f whose subject starts "Proposed", plus the positioning commits without that label. The groups:

| Group | Rows | What changed, in short |
|---|---|---|
| Public site pages | 46 | about, check-your-ai, FAQ, contribute, privacy, terms, the home description and llms.txt: every "different company" line takes the condition; no "blind spots"; the FAQ says what is not measured yet; privacy and terms say what Grill keeps (the 15-minute copy, the account row, the counts, the Monday email). Two new pages: /data-flow/ and /how-we-test/. |
| README and docs | 59 | README, WHY, PRINCIPLES (approval, telemetry, judge, models, paid plans, speed, North Star), PRIVACY.md, DATA-LEDGER (new rows and the key-family table), HOSTED, ANY-APP, PRO, the reminders PRD, LEARNING, and two new sentences in evals/README.md. |
| Grill in chat (hosted tool text) | 24 | "Independence not verified:" lines; the first-use line without "from a different company" on unverified runs and linking /data-flow/; the paragraph under the records question; the reaction reply; the look-back reply no longer says nothing is stored; the tool description for every host; no "credit" in limit messages; /notify says saved history and reminders work today. |
| The installed tool | 16 | The guessed-author line and opening; the reaction reply; no Grill Pro line in the no-key reply; the same-family note; manifest.json and plugin.json descriptions and settings. |
| Skills and the paste prompt | 13 | No "correlated with" or "blind spots"; the conditional company line; the first-use link to /data-flow/; the paste prompt sends a short summary; the paste-route Pro news line deleted. |
| Directory submission kit | 3 | Listing copy in the conditional form, data-handling answers quoted from /data-flow/, reviewer prompts. |

To say no to one row, revert the commit named in it, or reword that sentence alone.

### At a glance

| Idea | Impact | Trigger | Status |
|---|---|---|---|
| Record the real-user count | High, enables every other trigger | Now | Done |
| Close the unknown-client judge gap | High, trust | Now | Labelled on this branch, not enforced |
| Publish the hosted address on the MCP Registry | Medium, usage | Now | Trigger met |
| ChatGPT and Claude connector directory listings | High, usage | Now, with the owner's approval | Trigger met, blocked |
| Hand-run partnerships | Medium, usage | Now | Trigger met |
| Settle the Gemini "testing now" line | Low, trust | Now | Done |
| Verify Meta AI (Muse) in chat | Medium, usage | Now | Trigger met |
| Remove the dead Smithery mentions | Low, hygiene | Now | Half done |
| Pre-mortem reply angle | Low, usage | Now, content only | Trigger met |
| Public launch (Show HN, Product Hunt) | High, usage, one-off | Real-user count recorded and activation measured | Not met |
| Plan for after the founding 100 | Medium, revenue | Founding count reaches 80 of 100 | Not met |
| Paid tier (turn Pro on) | High, revenue | 100 real users and 20 evidenced look-backs, after the kill threshold reaches rule 3 | Not met |
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
| Look-back reminders through ChatGPT MCP events | Medium, retention | ChatGPT listing live and 5 real users with a look-back date, or a user asks | Not met |
| Publish our eval results in plain words | Low, trust | 10 real users, or a user or reviewer asks | Done |
| Parked from the 2026-11-13 strategy | Mixed, see the section | The owner's call on each | Waiting on the owner |

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
| The kill threshold for the record bet is read (2027-02-28 at the latest) | Paid tier, personal calibration view, look-back reminders through ChatGPT MCP events, team pilot |

The cost line: the hosted service cap is `GRILL_MONTHLY_CAP_USD`, default $20 in the code ([HOSTED.md](HOSTED.md)). Earlier notes here said "about $40 a month", with no source. Use the production value of that cap. The owner sets it.

Last scan: 2026-11-11. Names and links are in [COMPETITORS.md](COMPETITORS.md). An idea taken only from a competitor or a channel post, with no user signal, is labelled (competitor-only, needs user signal). A line that says "Trigger met" means the consider-when is already true. It is still not a promise to build.

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

2026-11-11 scan: ChatGPT now suggests plugins mid-chat using conversion, usage and retention. That is a secondhand report of OpenAI's DevDay talk. Review info now lives in plugin.json. Queues are longer. The Claude Plugins page reached general availability on 2026-11-09. This raises the value of submitting ChatGPT soon. Remaining blockers are unchanged: Tony's approval, OpenAI identity verification, and reviewer account OAuth and seeding.

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

A simple paid plan above the free monthly allowance. Revenue stays parked until the trigger. Not calibration, and not what is already free (STRATEGY rec 4).

Status 2026-11-13: STRATEGY.md now says there is no defined paid product for one person. Saved records and look-back reminders are free with Grill in your chat, and the free allowance ($5 a month) is more than a paid key allows ($3). Rec 4 holds this until the kill threshold for the record bet reaches rule 3.

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

Done: 2026-11-11. README, HOSTED.md and the FAQ say Gemini and Muse work today by copy and paste. Adding Grill as a connector inside either is not verified.

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

Status 2026-11-13: not now (STRATEGY.md). The four-arm comparison comes first.

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

On the hosted connector, an unrecognised client with no author named excludes nobody. It does not exclude Anthropic. The judge can then be the same company as the assistant, and the verdict used to say nothing about that. Say so on the verdict: one line after the privacy note, naming the judge's company, and saying to grill again and name the assistant if that company is the same. A recognised client gets no line. Cursor is recognised and still excludes nobody, on purpose, because it runs several companies' models, so it gets no line either. The installed MCP server still excludes Anthropic when it does not recognise the client and no company is named. This touches what the verdict says about the judge, so it needs its own pull request and review (STRATEGY rec 3).

Impact: high, trust. A judge from a different company is the trust rule (STRATEGY principle 1).

Consider when: now, before any launch that brings people from non-Claude MCP apps.

Trigger met: the consider-when is now (2026-11-08).

Draft PR open: 2026-11-10. The hosted reply adds the line. Who is excluded is unchanged.

Status 2026-11-13, on this branch: every route where Grill cannot tell which company wrote the plan is labelled. Hosted unknown clients, Cursor, a judge from a company Grill has no name for, the installed tool's guess, a /judge link with no usable `from`, and a misnamed author all end the verdict with a line that starts "Independence not verified:". None of them is enforced. The paragraph above describes the code before this branch. Still open, under Waiting on the owner: asking the assistant for its company (item 14), a valid different author replacing the chat's company (item 10), and Grill CI on an unknown author (item 15).

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

Crux (uncrux.io) shows a free group-weighting tool. That is still not a reason to build before the trigger.

Consider when: 100 users, or a team asks. Gate T in [PRD-privacy-foundations.md](PRD-privacy-foundations.md) still applies: no marketing hosted Grill for work or team use until its privacy steps merge.

## Personal calibration view

"When you say 70%, you're right N% of the time", for one person's resolved calls.

Impact: medium, retention, for the few heavy users who get there. It is not a reason to buy (STRATEGY principle 5).

Consider when: at least one person has 30 resolved calls with a stated confidence. Before that, "Where your calls changed" already refuses to compare small samples.

Status 2026-11-13: not now (STRATEGY.md). A kill under the record bet's threshold rules it out.

## Pinned judge for agent audits (separate product)

A check before an irreversible agent action, with a signed record that can be reproduced. Reproducing a verdict needs a pinned model, and the free tool never pins one. By STRATEGY principle 10, this could only ship as a separate product with its own name and rules.

Impact: unknown, a new market. It is a values call before it is a product.

Consider when: an agent platform offers to pay for it, and the owner decides to build it at all (STRATEGY open decisions).

## Privacy work for work use

Work mode, Spaces, an aggregate org view, and later customer-managed keys, SSO, a DPA and data residency. Each waits on its own trigger in [PRD-privacy-foundations.md](PRD-privacy-foundations.md) section 5, and in section F of the growth framework in the ops repo. This file does not repeat those thresholds.

Impact: high, revenue later. Work use is where a team plan gets paid for.

Consider when: the triggers in PRD-privacy-foundations section 5 fire.

## Look-back reminders through ChatGPT MCP events

Impact: medium, retention. A reminder inside the chat the person already uses is more likely to get the one-tap outcome.

ChatGPT, as of 2026-11-10, can start an automation when an MCP server emits an event. That works in Work chats, on the web and on desktop. This is a platform change, not a note from a competitor. Grill could emit an event when a look-back is due, so the person's own ChatGPT prompts the one-tap outcome. That needs the event spec on the server, and the ChatGPT listing, first.

Consider when: the ChatGPT listing is live and at least 5 real users have a look-back date set, or a user asks for reminders inside ChatGPT.

Status: not met.

## Publish our eval results in plain words (competitor-only, needs user signal)

Impact: low, trust.

Cruxes lists every study, failures included. Grill could publish counts-only summaries of judge-rule tests. A rule that lost its holdout stays off. No decision content.

Consider when: 10 real users, or a user or reviewer asks how Grill knows its verdicts are any good. (competitor-only, needs user signal)

Done: 2026-11-13. /how-we-test/ shows counts from data/results.json: one run of the weekly regression check, holdout v1, the four-arm comparison as a draft that has not run, real users and the two look-back counts. The 2026-11-13 strategy makes publication unconditional. A measured weekly run is added with `node scripts/results.mjs merge-run <public block>` (LEARNING.md).

## Parked from the 2026-11-13 strategy

Impact: mixed. These are the ideas on the owner's list above, written down so the daily growth work does not pull them forward on its own. Owner actions that are not ideas (listings, the release, the launch list, interviews, the setting, the comparison) are only in that list. Each idea needs the owner's yes before anyone builds it.

### The chat's own company as judge when the assistant names another author (item 10)

Consider when: the owner decides; or a user reports a same-company verdict in Claude after naming another author.

### Enforce the records choice on the server (item 11)

Never accept a yes before the question was returned. Since this branch, `keep_records: false` sent by mistake also deletes waiting drafts.

Consider when: the owner decides, or before the ChatGPT listing is filed.

### Mask before storing on the hosted route (item 12)

Consider when: the owner decides, or Gate T in [PRD-privacy-foundations.md](PRD-privacy-foundations.md) opens.

### A zero-retention flag on the Jev request (item 13)

Consider when: one live call shows TypeSafe's endpoint accepts it.

### Ask the assistant for its company on unknown clients (item 14)

A flagged build. Today such a run is labelled "Independence not verified:".

Consider when: the owner says yes, or the outside counters show first grills from unknown apps.

### Grill CI: an unknown author does not clear needs-review (item 15)

Consider when: the owner decides; or a pull request with no `Written-by-model` line merges with an unverified judge.

### Stop storing the reaction reason unless the person says yes (item 16)

Consider when: the owner decides, or the first reaction from an outside account arrives.

### Reviewer sign-in without an emailed code (item 17)

Consider when: before the ChatGPT listing is filed. OpenAI's reviewer account cannot use an email code.

### Auth on the digest route (item 18)

Consider when: the owner decides; or the digest route is called by anyone but the weekly job.

### A call to action on the share page (item 19)

Consider when: the share link is used by outside accounts, and the owner says yes.

### A homepage link to /demo, and a work-decision starter (item 20)

Queued in [experiments/analytics-loop.md](experiments/analytics-loop.md) with their triggers and measures.

Consider when: the connect leak or the activation leak in that file shows for a week, and the owner says yes to that experiment.

### Count verdict labels and quality checks by judge company on the server (item 21)

Consider when: the four-arm comparison is registered, or 30 outside grills a month.

### More sound cases in the public eval (item 22)

Consider when: now. The false-alarm gate went red on 2026-11-13 at 3 of 6 and green on the next run with the same judge files.

### A judge quality floor (item 23)

The router's cost tier and a price ceiling, without pinning a model.

Consider when: the four-arm comparison finds the product path worse than the same model starting fresh, or the router's defaults change.

### The PRINCIPLES definition of evidenced look-backs (item 24)

Consider when: the first look-back saved on an outside Grill account is counted.

### State a choice on the web, and outcome buttons on the due list (item 25)

Consider when: a /judge-only user has a waiting grill, or the kill threshold reaches rule 4 and the reminder needs one change.

## Archived

Ideas moved here are already shipped, or the note is stale. Each one keeps its old consider-when line and says why it left the active list.

### Shareable verdict link (no decision text)

A public link that shows only the verdict and the sharpest challenge. Private by default. Opt-in per verdict. Revocable. Never the user's question or record body.

Consider when: now. Ship the share page first. Invite bonus is separate.

Archived: already shipped. `/decisions` offers Share verdict, and `/share/<token>` shows the verdict and one challenge. See [UX.md](UX.md) and [HOSTED.md](HOSTED.md).
