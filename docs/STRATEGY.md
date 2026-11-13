# Strategy

Written 16 October 2026. Rewritten in place on 13 November 2026 to follow the strategy review ([reports/Grill strategy and defensible moat.md](../reports/Grill%20strategy%20and%20defensible%20moat.md)). Review it when Grill reaches 100 real users, or on 16 January 2027, whichever comes first.

[PRINCIPLES.md](PRINCIPLES.md) says what Grill will and won't do. This file says where Grill is going, and why. If the two ever disagree, PRINCIPLES.md wins.

## Where this came from

Three inputs to the first version:

- Greg Isenberg's 21 observations from 48 hours with AI founders, labs and executives in San Francisco (October 2026).
- A grill of the first draft of this strategy. The judge called it **shaky** and raised four challenges.
- A check of each challenge against this repository, because the judge sees only the write-up and can be wrong about the code.

| Judge's challenge | Status | What the repository shows |
|---|---|---|
| Calibration ("when you say 70%, you're right 45% of the time") needs dozens of resolved calls per person. Most people will never get there. | Holds | "Where your calls changed" already refuses to compare rates under 10 calls on each side. A 70% band needs roughly 30 resolved calls before it means much. At a few grills a month, that takes a year or more. |
| OpenRouter's Auto Router does not make sure the judge is from a different company. | Refuted where Grill knows the author's company. Labelled everywhere else (updated 2026-11-13) | [scripts/judge.mjs](../scripts/judge.mjs) excludes the author's company, retries when that company answers, and returns an error rather than that verdict. That holds where Grill knows the company: a recognised app, `GRILL_AUTHOR`, or a company the assistant names on the call. Everywhere else the verdict ends with a line that starts "Independence not verified:". That covers Cursor and unknown apps in chat, the /judge page with no `from`, and the installed tool when it had to guess (it then rules out Anthropic only). The paste route only warns. A name Grill does not know as a model company, or `none`, is ignored ([HOSTED.md](HOSTED.md), [ANY-APP.md](ANY-APP.md)). |
| Every route Grill grows through belongs to another company. Any of them can ship its own second opinion or close the door to connectors. | Holds | Claude, ChatGPT, Meta AI, Cursor and VS Code are all rented reach. The decisions page, the look-back reminder and the calendar link are the only surfaces Grill owns. |
| The retention measure can't carry a decision if it rests on an opt-in ping and features most people don't have. | Partly holds | In-chat Grill already counts active people per day, week and month without identity. Open sign-up is on. The local free tool is mostly invisible, by design. Since 2026-11-13 the outside counters below count each step for outside accounts. |

**The 2026-11-13 rewrite.** The strategy review found that only one of the three defences this file claimed was built, and that one had gaps. A judge from a different company was presented as a quality edge, and that edge has never been measured. The rewrite changes principles 1, 5 and 8 and recommendation 4, adds the usage ladder, the kill threshold and the Money section, and keeps the numbering.

**Grill of the rewrite.** Run on 2026-11-13 through the hosted connector, judge `openai/gpt-6.1-terra`, on a summary of the recommendation (every grill judges a summary). Verdict: **Shaky**. "The measurement-first posture is sensible, but the asserted trust guarantee does not establish the preferred architecture or its privacy trade-off." The question that would change it: "What data, prompts and retained records are actually shared among Grill, the originating assistant and the judge provider?" Missing: "Offer a fresh-context same-model critique alongside an explicitly disclosed cross-company option."

Response: [/data-flow/](https://grillyour.ai/data-flow/) answers the question, route by route, from the code. The same-model fresh-context critique is arm B of the four-arm comparison ([evals/four-arm/README.md](../evals/four-arm/README.md)). It is not shipped as a product option before that result.

## Where Grill stands today

- **Product:** the free tool works in Claude Desktop, Claude Code, claude.ai (skill), any MCP app (`npx -y grillyour`), and by copy and paste in ChatGPT, Copilot, Gemini, Grok and Muse. Grill in your chat, the hosted connector, is verified in claude.ai, ChatGPT and Grok Bot. Gemini is still being tested, and Meta AI has setup steps in the README but is not verified ([HOSTED.md](HOSTED.md)). Installed users run release 0.1.1 from 2026-09-29 until 0.2.0 is cut.
- **North Star:** 100 real users ([PRINCIPLES.md](PRINCIPLES.md#north-star)). As of 2026-11-09 the count is 1 real user and 0 evidenced look-backs. Updated monthly. A real user is a person outside the maintainers and their agents or test accounts who ran at least one successful grill ([PRINCIPLES.md](PRINCIPLES.md#north-star)). The first one ran a grill on 2026-11-05, two days after open sign-up. Hosted accounts: 4 total, 3 of which are maintainer or test/reviewer accounts and are excluded. Look-backs saved on Grill accounts: not counted yet. That is a separate count from evidenced look-backs, and the two are never added.
- **Reach:** 228 visitors to the home page in the last 30 days, about 95% with no referrer and about a dozen from search. Distribution is the binding constraint.
- **Retention features:** look-back reminders, "Your habits", and "Where your calls changed" are built for in-chat Grill.
- **Money:** nothing is for sale. See [Money](#money).
- **Independence:** enforced in code where Grill knows the author's company: a recognised app, `GRILL_AUTHOR`, or a company the assistant names. Everywhere else the verdict says independence was not verified. The paste route only warns.
- **Measured about the judge:** one weekly regression run, on 29 cases that were used to write the judge's instructions, so a full catch score says nothing about how good the judge is. Not measured yet: whether an outside judge catches more than the same model starting fresh. The counts are on [/how-we-test/](https://grillyour.ai/how-we-test/).

## Guiding principles

These guide choices about what to build, sell and measure. They sit under PRINCIPLES.md and never override it.

1. **Independence is a trust rule, not a measured edge.** The judge did not write the plan. On the connector and the installed tool it does not get your assistant's memory or system instructions. When Grill can tell which company wrote the plan, the judge is from a different company; when it cannot, the verdict says so. Whether that catches more than the same model starting fresh has not been measured yet, so Grill does not sell it as better. Close every route where the rule can quietly fail before telling more people about it.
2. **Get better when models get better.** Ask of every feature: if a stronger model ships next month, does this get better or worse? Build only what gets better. No fine-tuning, and no pinned model in the free tool. A stronger model makes the judge better for free, and it also makes your own assistant a better critic of its own work, so the verdict's edge shrinks and the record's does not.
3. **Earn the second grill before chasing the hundredth user.** AI products can gain users fast and lose them just as fast. A person who comes back and records what they decided is worth more than ten who tried it once.
4. **The record is the product. The verdict is how it starts.** Any assistant can be told to argue the other side. Few people keep a record of what they decided and come back to it. Look-backs are where Grill earns its place.
5. **Charge only for something defined.** Nothing is for sale today, and there is no defined paid product for one person ([Money](#money)). Calibration is a long-term reward, not a reason to buy. Before anything is charged for, name who pays, what they get in the first billing period, and the evidence that they want it.
6. **Pool where samples are small.** Any statistic about judgement needs many resolved calls. Groups that decide together, like a team, a fund or a board, get there in weeks, not years.
7. **Rented reach, owned relationship.** Grow through other companies' assistants, but every route should lead people to something Grill owns. Sign-up stays opt-in and the privacy rules stay as they are.
8. **Copyable is fine. Unmeasured is not.** The prompt is open source and easy to copy. Whether an outside judge catches more than the same model starting fresh is not measured yet, so Grill does not claim it. The four-arm comparison would measure it, and its result is published on /how-we-test/ whichever way it falls. What a later entrant cannot copy is a dated record of decisions with their outcomes.
9. **Decisions belong to the people who made them.** Data brokers are paid well right now to sell company data to labs. Grill will not join them, at any price. That is already a promise in PRINCIPLES.md, and it is part of why people can trust Grill with a real decision.
10. **One product, one promise.** If Grill ever offers something that breaks a founding rule, such as a pinned judge for audits, it ships as a separate product with its own name and rules. It never ships as a quiet exception in the free tool.

## Assessment

**What is strong.** The core idea is sound, and the code backs most of it: where Grill knows which company wrote the plan, that company is excluded and checked on the model that answered, and everywhere else the verdict says so. Routing to the best available outside model improves the judge as models improve. The privacy promises are specific and tested, and /data-flow/ now says route by route what is sent and kept. Most of the retention loop already exists.

**What is weak.** The repository shows how close Grill is to 100 real users: 1, with 0 evidenced look-backs, as of 2026-11-09. Until 2026-11-13 nothing counted people between a /start view and a grill, or who came back. The outside counters now do, from the day they go live. The product is ahead of the evidence. A team that does this much careful work with 1 real user risks polishing a product that has barely been tested.

**The biggest risk.** People try it once. "Grill this" is easy to try and easy to forget. Grill survives only if decisions are frequent and important enough that people come back, and only if they come back to score them. No product the review found has solved that step.

**The second risk.** Platforms. A "second opinion" button in ChatGPT or Claude would take the casual users. That button would come from the same company as the assistant. Grill's answer is principle 1 as a rule people can check, and principle 4: a record across hosts, with outcomes.

**Verdict.** Hold the position, change the claim, and measure. Pro and any expansion wait until the kill threshold below has been read.

## The usage ladder

Each step, and where it is read. Nothing here is sent to anyone or put on a dashboard. Each number is read only when someone runs the readout by hand.

| Step | Where it is read |
|---|---|
| Visit | Vercel Web Analytics, by path and referrer. |
| Start | `node scripts/weekly-metrics.mjs`, the lines `start views` and `start refs` (labels include readme, demo, notify, data-flow and how-we-test). Browser views only. |
| Account | No instrument counts outside accounts. The nearest number is `Records question: yes N, no M` in `node scripts/outside-loop.mjs`, which counts first answers. |
| First grill | `Outside people who grilled` in `node scripts/outside-loop.mjs`. |
| Came back | `Of those, came back: K of N`: a judged grill 20 hours or more after the first, among people who first grilled 14 or more days ago. |
| Choice logged | `Choices logged`. |
| Look-back | `Done within 14 days: K of N`, in the kill threshold block of the same readout. |

The outside readout counts nobody until `GRILL_INTERNAL_EMAILS` is set in production. Until then it prints `not counted: internal list not set`. Installed-tool reach is the `opt-in install pings` line of the weekly metrics, which counts only people who turned usage stats on.

## Kill threshold for the record bet

Set 2026-11-13 with this strategy, before any outside look-back has come due. The owner may change any number until 2026-12-15. A later change is logged under "How to update this file" with its reason, and the constants in [scripts/outsideLoopCore.mjs](../scripts/outsideLoopCore.mjs) change in the same commit.

**Counted:** look-backs saved on Grill accounts by outside accounts, bucketed by the day they fall due. Outside means not on the operator's private list of maintainer, test, reviewer and agent addresses (`GRILL_INTERNAL_EMAILS`). An agent account is matched by its own email and by the email of the person it acts for. A person is an account. Only look-back dates set after the counters went live are counted: a look-back whose date was set before the readout's `Counting since` day is never counted. A look-back is counted under the later of its date and the day it was set. Before that day, moving it moves the count and switching it off takes it out. From that day on nothing lowers the count.

**Cohort:** the first 30 by due day, taking the whole day on which the 30th falls. A look-back that is deleted at any time, or switched off or moved after it came due, stays counted as due on that day, and counts as not done unless it was answered within 14 days of that day. An early answer counts as done. A look-back that already has its answer when its date is counted counts as due and as done. "Within 14 days" means answered on the due day or one of the 13 days after it (UTC). The same goes for 7 days. Both email arms count. The counters do not record which arm an account is in, so the arms cannot be read apart today. Look-backs due after the last Monday email (2027-01-25) are reported apart.

**Read day:** 14 days after the cohort's last due day, or 2027-02-28, whichever is first. With a cohort under 30, the read day is 2027-02-28. Before the read day the readout shows what a reading taken that day would say, and nothing is decided. From the read day on, the look-backs are judged as they stood on the read day, so the reading does not move.

1. If on the read day fewer than 30 look-backs have had a full 14 days, or they come from fewer than 5 people: record "not tested: the constraint is reach". This is never a kill.
2. Otherwise kill if fewer than 8 of the cohort were done within 14 days: stop building on the solo record (no Pro work, no calibration view, no new reminder channel). The team pilot is the only record bet left.
3. Otherwise keep going if 15 or more were done within 14 days. The 7-day count is reported beside it. Half within 7 days is the reminder plan's own target (docs/PRD-lookback-reminders.md).
4. Otherwise change one thing about the reminder, read the next 30 once, then decide by rules 2 and 3. The next 30 are the first 30 that fall due after the read day, taking the whole day on which the 30th falls, read 14 days after their last due day. No backstop date is set for that second read. If the second read has 8 to 14 done within 14 days, rules 2 and 3 do not decide it: it goes to the owner.

At today's reach the expected reading on 2027-02-28 is "not tested: the constraint is reach". That means the next quarter is reach work only: directory listings, the registry, the launch list and the one team pilot, not more features on the record.

Where to read it: `node scripts/outside-loop.mjs`. The readout reads the store and cannot see the server's settings. It prints the last day the server counted and warns when that day is more than 7 days old. Check that `GRILL_INTERNAL_EMAILS` is still set before a reading is recorded. A stretch when it was unset is not counted and does not show.

## Money

This section sets no price and names no paid feature.

- **Nothing is for sale today.** Pro billing is built and switched off (`GRILL_PRO_BILLING`).
- **What the launch list was promised is live and free.** The launch list was told saved history and look-back reminders would come as an optional Pro plan. Both work today, free, with Grill in your chat.
- **The free-for-life promises that are live:** every hosted account is told it is free for life with $5 of use a month, reset on the 1st (the account page and the terms). /start says the first 100 users get Grill free for life (founding members). The installed tool is free on your own key and stays account-free. The decision-handling code stays open source under the MIT license, for good.
- **So there is no defined paid product for one person.** The free allowance, $5 a month, is more than the $3 a month a paid key allows. Saved records and reminders are already free.
- **The first thing that could be charged for** is a team record, or a record a third party relies on. There is no evidence yet that anyone would pay for either. The team pilot (recommendation 6) is how to find out.

## Recommendations, in order

1. **Count the 100.** Record the current number of real users and evidenced look-backs here, from the sources PRINCIPLES.md already names. Update it monthly. Every later step depends on it. Look-backs saved on Grill accounts are counted by the outside readout, under that name, and never added to the 100.
2. **Talk to every real user.** At under 100 users, a conversation teaches more than a dashboard. For each person, ask: what did you grill, did you come back, and what would make you come back? Keep only dated counts and themes with no decision content in this repo.
3. **Close the independence gap.** When Grill cannot tell which company wrote the plan, say so on the verdict, or ask for the company, instead of silently excluding Anthropic. Done in part on 2026-11-13: every such route now says "Independence not verified:". Asking the assistant for its company, and Grill CI on an unknown author, are parked for the owner ([ROADMAP.md](ROADMAP.md), "Waiting on the owner").
4. **Hold any paid plan until the record bet has been read.** Pro stays parked. Its bar in [ROADMAP.md](ROADMAP.md) stays: 100 real users, and at least 20 evidenced look-backs from people other than the maintainers. That bar is not read before the kill threshold above reaches rule 3. Do not sell calibration, and do not sell what is already free.
5. **Name the buyer.** Use the conversations in step 2 to find who would pay. Likely candidates: founders who report to a board, product managers, investors. Write the Pro page for one of them.
6. **Run one team pilot.** Invite one small team that already makes decisions together to use in-chat Grill for a month. Watch whether a shared record keeps them coming back, and whether they would pay for it.
7. **Make the verdict easy to share, later.** A verdict and its test make a good screenshot. Add an opt-in, masked share card only after step 1 shows people coming back. Spreading a product people don't return to doesn't help.

**Not now:** a hosted judge API for agents, data partnerships of any kind, paid advertising, a council or a second judge, a calibration view, and more Pro features.

## Open decisions

These belong to the owner.

- **The kill threshold numbers.** Any of them can change until 2026-12-15.
- **A pinned judge for agent audits.** An agent platform may pay for a check before an irreversible action, with a signed record that can be reproduced. Reproducing a verdict needs a pinned model. Grill's free tool promises never to pin one. Principle 10 allows this only as a separate product. Whether to build it at all is a values call.
- **Who Grill is for.** One person deciding alone, or a group deciding together. The answer changes the product, the price and the page.

## How to update this file

Change it when the evidence changes, and say what changed. When the strategy shifts, grill the new version first and record the verdict here.

What changed:

- 2026-11-13: rewritten in place after the strategy review. Principles 1, 5 and 8 and recommendation 4 changed; the usage ladder, the kill threshold and Money added; the grill of the rewrite recorded under "Where this came from".
