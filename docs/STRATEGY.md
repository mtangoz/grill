# Strategy

Written 16 October 2026. Review it when Grill reaches 100 real users, or on 16 January 2027, whichever comes first.

[PRINCIPLES.md](PRINCIPLES.md) says what Grill will and won't do. This file says where Grill is going, and why. If the two ever disagree, PRINCIPLES.md wins.

## Where this came from

Three inputs:

- Greg Isenberg's 21 observations from 48 hours with AI founders, labs and executives in San Francisco (October 2026).
- A grill of the first draft of this strategy. The judge called it **shaky** and raised four challenges.
- A check of each challenge against this repository, because the judge sees only the write-up and can be wrong about the code.

| Judge's challenge | Status | What the repository shows |
|---|---|---|
| Calibration ("when you say 70%, you're right 45% of the time") needs dozens of resolved calls per person. Most people will never get there. | Holds | "Where your calls changed" already refuses to compare rates under 10 calls on each side. A 70% band needs roughly 30 resolved calls before it means much. At a few grills a month, that takes a year or more. |
| OpenRouter's Auto Router does not guarantee a different-company judge. | Refuted, with a gap | [scripts/judge.mjs](../scripts/judge.mjs) excludes the author's company, retries when that company answers, and returns an error rather than that verdict. The gap: on a non-Claude host, `GRILL_AUTHOR` unset and no `author` on the call means Anthropic is excluded instead of the right company. The paste route can only warn. |
| Every route Grill grows through belongs to another company. Any of them can ship its own second opinion or close the door to connectors. | Holds | Claude, ChatGPT, Meta AI, Cursor and VS Code are all rented reach. The decisions page, the look-back reminder and the calendar link are the only surfaces Grill owns. |
| The retention measure can't carry a decision if it rests on an opt-in ping and features most people don't have. | Partly holds | In-chat Grill already counts active people per day, week and month without identity. It is invite-only, so the numbers are small. The local free tool is mostly invisible, by design. |

## Where Grill stands today

- **Product:** the free tool works in Claude Desktop, Claude Code, claude.ai (skill), any MCP app (`npx -y grillyour`), Meta AI, and by copy and paste in ChatGPT, Copilot, Gemini and Grok.
- **North Star:** 100 real users ([PRINCIPLES.md](PRINCIPLES.md#north-star)). The current count is not recorded in this repository.
- **Retention features:** look-back reminders, "Your habits", and "Where your calls changed" are built for in-chat Grill.
- **Money:** Pro is built and priced at $9 a month or $90 a year. It is parked (`GRILL_PRO_BILLING` off). In-chat Grill is invite-only.
- **Independence:** enforced in code on the Desktop, Claude Code and MCP routes. It depends on configuration on non-Claude hosts, and only warns on the paste route.

## Guiding principles

These guide choices about what to build, sell and measure. They sit under PRINCIPLES.md and never override it.

1. **Independence is the product.** The reason to use Grill instead of your own assistant is a judge from a different company. Close every route where that can quietly fail before telling more people about it.
2. **Get better when models get better.** Ask of every feature: if a stronger model ships next month, does this get better or worse? Build only what gets better. No fine-tuning, and no pinned model in the free tool.
3. **Earn the second grill before chasing the hundredth user.** AI products can gain users fast and lose them just as fast. A person who comes back and records what they decided is worth more than ten who tried it once.
4. **The record is the product. The verdict is how it starts.** Any assistant can be told to argue the other side. Few people keep a record of what they decided and come back to it. Look-backs are where Grill earns its place.
5. **Sell what a person gets in the first month.** Calibration is a long-term reward, not the reason to buy. A paid plan has to pay off within one billing period: reminders, a look-back, a call that changed.
6. **Pool where samples are small.** Any statistic about judgement needs many resolved calls. Groups that decide together, like a team, a fund or a board, get there in weeks, not years.
7. **Rented reach, owned relationship.** Grow through other companies' assistants, but every route should lead people to something Grill owns. Sign-up stays opt-in and the privacy rules stay as they are.
8. **Copyable is fine. Unmeasured is not.** The prompt is open source and easy to copy. A judge that is measurably better than a same-company critique, shown with published evals, is not.
9. **Decisions belong to the people who made them.** Data brokers are paid well right now to sell company data to labs. Grill will not join them, at any price. That is already a promise in PRINCIPLES.md, and it is part of why people can trust Grill with a real decision.
10. **One product, one promise.** If Grill ever offers something that breaks a founding rule, such as a pinned judge for audits, it ships as a separate product with its own name and rules. It never ships as a quiet exception in the free tool.

## Assessment

**What is strong.** The core idea is sound, and the code backs it up: a different company is excluded and verified, not just requested. Grill gets better each time a new model ships. The privacy promises are specific and tested. Pro is built and waiting. Most of the retention loop already exists.

**What is weak.** Grill doesn't yet know its own numbers. Nothing in the repository shows how close it is to 100 real users, how many people come back, or how many record a decision. The product is ahead of the evidence. A team that does this much careful work before having users risks polishing a product nobody has tested yet.

**The biggest risk.** People try it once. "Grill this" is easy to try and easy to forget. Grill survives only if decisions are frequent and important enough that people come back.

**The second risk.** Platforms. A "second opinion" button in ChatGPT or Claude would take the casual users. That button would come from the same company as the assistant, though, so Grill's defence is principle 1. The defence holds only if Grill says it clearly and enforces it on every route.

**Verdict.** The strategy is right for this stage. Pro and any expansion should wait until there is evidence that people come back.

## Recommendations, in order

1. **Count the 100.** Record the current number of real users and evidenced look-backs here, from the sources PRINCIPLES.md already names. Update it monthly. Every later step depends on it.
2. **Talk to every real user.** At under 100 users, a conversation teaches more than a dashboard. For each person, ask: what did you grill, did you come back, and what would make you come back?
3. **Close the independence gap.** When the host is not Claude and no company is given, say so on the verdict, or ask for the company, instead of silently excluding Anthropic. This change touches the judge, so it needs its own pull request and review.
4. **Set the bar for turning Pro on before you turn it on.** Proposed: 100 real users, and at least 20 evidenced look-backs from people other than the maintainers. Sell look-back reminders and "Where your calls changed". Do not sell calibration.
5. **Name the buyer.** Use the conversations in step 2 to find who would pay. Likely candidates: founders who report to a board, product managers, investors. Write the Pro page for one of them.
6. **Run one team pilot.** Invite one small team that already makes decisions together to use in-chat Grill for a month. Watch whether a shared record keeps them coming back, and whether they would pay for it.
7. **Make the verdict easy to share, later.** A verdict and its test make a good screenshot. Add an opt-in, masked share card only after step 1 shows people coming back. Spreading a product people don't return to doesn't help.

**Not now:** a hosted judge API for agents, data partnerships of any kind, and paid advertising.

## Open decisions

These belong to the owner.

- **A pinned judge for agent audits.** An agent platform may pay for a check before an irreversible action, with a signed record that can be reproduced. Reproducing a verdict needs a pinned model. Grill's free tool promises never to pin one. Principle 10 allows this only as a separate product. Whether to build it at all is a values call.
- **Who Grill is for.** One person deciding alone, or a group deciding together. The answer changes the product, the price and the page.

## How to update this file

Change it when the evidence changes, and say what changed. When the strategy shifts, grill the new version first and record the verdict here.
