# Persona-sim and Grill, simulated against the ICP

Date: 28 November 2026. Asked by Tony: "should/how could this skill be incorporated into grill? think from first principles about the purpose of grill, consider spend efficiency ... importantly run a persona-sim against our ICP. would adding this advance grill's growth? if so, develop an adversarially tested and persona-sim hardened plan."

Status: a proposal. Nothing is built, and nothing was sent to anyone. The people below are invented. Read against [ICP.md](ICP.md), [STRATEGY.md](STRATEGY.md) and [PRINCIPLES.md](PRINCIPLES.md). If this file and PRINCIPLES.md disagree, PRINCIPLES.md wins.

persona-sim is a research method Tony uses in another project: one language model plays a panel of customers, reacts to messages or plans, and the reactions are mined for objections. Its source paper is Maier et al., arXiv 2510.08338. In that project every run already calls Grill twice, once on the plan and once on the recommendation, and no simulated prediction has yet been confirmed by a real result.

## Answer

- **Not a Grill feature.** A persona panel is one model playing many customers. Hosting one is the council STRATEGY.md lists as not now, and a second promise next to the judge (principle 10). No user has asked. Cost is not the reason: a one-call panel would be about 3 to 6 checks.
- **Where it fits: two things Grill already has.**
  1. The outside check of the call a panel leads to.
  2. The record and look-back. Write down what the panel predicted and when the real test reads, and Grill asks on that day. A persona tool cannot do this for itself, and it is Grill's own bet: "the record is the product" (STRATEGY principle 4). It uses `grill_decided` and `grill_look_back` as they are.
- **Spend.** The panel never runs on Grill's key. It runs on the person's plan quota or their own API key. Grill spends one grill on the call the panel leads to (a short write-up is one check, a long one more) and a look-back, which calls no judge. A large hosted panel (100 or more model calls) would be about 40 to 150 checks: 0.4 to 1.5 times anyone's free month. **Pro adds no checks.** It raises the daily stop from 30 to 100 and adds a 200-grill monthly stop, but the 100 free checks and the $5 safety cap still bind (`freeChecksFor` and `personCapUsd` in [scripts/hostedCore.mjs](../scripts/hostedCore.mjs)).
- **Growth: small and unproven.** No user asked, and reach is the constraint. The simulation gave no usable evidence of demand (below). It is worth one cheap test inside work Tony already does.

## Spend by route

| Route | Panel paid by | Grill checks per panel-led call |
|---|---|---|
| Hosted panel (not now) | Grill's key | About 40 to 150 for a large panel, about 3 to 6 for one call |
| Own assistant, then grill | The person's plan quota or API key | 1 for a short write-up, more for a long one, plus the look-back |
| Own router key | The person pays the router | 0 Grill checks |
| Copy and paste | The person's other assistants | 0 Grill checks |

## The plan

**Step 0. Default, no owner time.** [ROADMAP.md](ROADMAP.md) gets "Hosted persona panel: not now", with its trigger: a real user asks, and a measured run costs Grill under $0.30. README unchanged.

**Step 1. A reply test inside the @AskGrill batches Tony already approves.** No new page and no new copy surface; one new ref label.

- Add a `sim` topic to ICP.md's reply tags.
- Reply only where someone says they are about to act on a simulated-customer result. That is a real decision. Lead with a verdict on what they said, as ICP.md requires.
- The call to action for this cohort is `/start/?ref=sim` instead of `?ref=askgrill`, plus the usual single-use code. That is an ICP.md amendment, inside Tony's yes. An agent adds `sim` to `START_REF_LABELS` and its test.
- Day 0 is the first batch after Tony's yes. The Claude directory listing (owner item 1) gets its own slot this week. It is still the bigger reach lever.
- Owner budget: 60 minutes over the whole test.
- Before day 0: confirm `node scripts/outside-loop.mjs` shows the internal list set and fresh.

**Measure, fixed before day 0.**

- Before day 0, count qualifying public posts (someone about to act on a simulated-customer result) from the last 14 days. 15 minutes. Under 10: do not start, and record "niche too thin for replies".
- Count only linked conversions. A linked first grill is an outside first grill counted under ref `sim` (`first_grill_ref`), or the person saying in the thread that they grilled. A linked sign-up is `signup_ref:sim`, or a redeemed single-use code minted for a `sim` reply's lead. The topic tag alone never counts. Coming back and look-backs are monitoring only.
- The linked count is a floor. A connector sign-up made without the browser's ref cookie is missed, and open sign-up makes codes optional.
- **Keep** (go to Step 2) as soon as there are 3 or more linked first grills, at any reply count.
- **Read 1**, at the later of 28 days or reply 30, stopping on day 56:
  - 0 linked first grills and 0 linked sign-ups at 30 replies: drop.
  - 1 or 2 linked first grills, or 0 with any linked sign-up: extend once by 30 replies.
  - Under 30 replies by day 56: if fewer than 30 qualifying posts were seen, drop ("niche too thin"). If the posts were there and the batches did not go out: "not tested: owner time".
- **Read 2**, at reply 60 or day 112, whichever comes first: keep if there are 3 or more linked first grills across all 60. Otherwise drop. No second extension.
- Never select or contact accounts by ref label. PRIVACY.md says the label is used only to count which outreach brings users.

**Step 1b. One judge clause, drafted by an agent, gated by the eval.** Add one clause to the judge's evidence-mismatch rule (`scripts/judgeCore.mjs`, `prompts/grill.md`): a simulated or model-generated result read as an observed one is a hypothesis to test, and its levels are not forecasts. Add two made-up regression cases, one where the simulation is labelled correctly and one where it is read as fact. Merge only if the weekly regression holds, false-alarm gate included. It helps every grill of AI-written analysis.

**Step 2, only on keep.** A guide page whose one call to action is `/start/?ref=sim-guide`, then a free kit skill in the plugin marketplace: a one-call panel built from facts the person gives, objections and not rates, every line labelled simulated, one grill of the call it leads to, then `grill_decided` with a scored prediction. The panel never runs on Grill's key.

**For Tony's own persona-sim runs.** When he approves a panel-led pick, record it with `grill_decided`, in his words, with the real test's read date as the look-back. Grill's look-back then scores the run.

## How a look-back scores a simulated prediction

The record already has the fields ([DECISION-RECORD.md](DECISION-RECORD.md)): `prediction` ("what you expected, and by when"), `review`, and a look-back reply with `came_true`, `happened` and `falsifier_fired`. A simulated prediction counts as scored only when:

- the `prediction` line names the metric, the direction and the read date, and compares two arms where both run ("B beats A on replies per send, read 2026-12-30"), never a level ("40% reply");
- `review` is the real test's read date, not the 14-day default;
- the look-back reply has `came_true` yes or no, and `happened` gives the observed numbers with n.

If the real test never reached its planned sample, `came_true` is left out and the call reads "not observable", never a hit or a miss. A made-up example:

```grill-record
version: 1
date: 2026-12-01
title: Lead the launch email with message B
prediction: message B gets more replies per send than message A, read 2026-12-30
verdict: solid if
falsifier: send 15 of each; compare replies per send
review: 2026-12-30
decided: Run the split as planned
```

On 2026-12-30: `came_true: no`, `happened: B 1 of 15, A 2 of 15; the planned 30 sends were reached`. That call is scored: a miss on direction, at the planned sample.

## Draft guide copy (Step 2 only)

Tested twice with simulated personas and fact-checked against this repository. Not published.

> **Grill a simulated-customer run**
>
> No panel? Grill any decision the same way. This page is for when a panel of AI personas fed the call.
>
> A panel is good for finding objections and wording to test. It can't tell you what real people will do. Before you act on one, have an outside judge look at the call you're about to make.
>
> Say what you're about to do because of the panel, the way you'd say it: "We'll lead with message B because most simulated buyers preferred it." Add two or three sentences: what the personas were built from (interview notes, a survey, or a prompt you wrote), which AI ran them, and what they were shown. Say the results are simulated.
>
> The judge is told to argue against your call. It checks whether the call follows from what you send; it can't check your personas against real buyers. The real test does that. You get a short verdict, the sharpest point and, when the judge names one, a cheap real test to run before you act. Cite the real test, not the verdict.
>
> Then say what you chose and when the real test reads. With Grill in chat and records on, Grill keeps that and asks you on that day what happened, so you learn whether your panels are worth running.
>
> The judge is from a different company than the one that wrote your write-up, when Grill can tell which that is. If the panel ran on another company's AI, say which. Each verdict names the model that judged it.
>
> Grill neither runs nor pays for the panel. With Grill in chat a short grill is one check (100 free a month); a long write-up can use several. On your own router key you pay the router. Copy and paste sends nothing to Grill: it runs in assistants you already use.
>
> Leave out customer and company names and anything from interviews you haven't cleared to share. Where your text goes and what a record keeps, on each route: grillyour.ai/data-flow.

## What the simulation did

**Design.** 24 invented people in 8 segments drawn from ICP.md: indie founder, product manager, operations lead and founder reporting to a board (primary); agent builder (secondary); and three adjacent segments, a growth or product-marketing lead who has tried persona tools, a multi-model council user, and a team lead. Seven descriptions, one per call: Grill today (control), the same reworded (placebo), three versions of a persona kit or guide, a hosted panel, and a one-check "who pushes back" layer. Free-text answers, never numbers. Two blind raters mapped each answer to 1 to 5 on trying it this week and on pulling a real decision into Grill. Persona models: Sonnet and Haiku. Raters: Opus and Sonnet. Themes: Opus. **One model family wrote, rated and themed, so agreement between them is not independence.**

**Differences from control, pulling a real decision into Grill** (paired by person, 24 each; * means a seeded bootstrap interval excludes 0):

| Description | Sonnet, rater 1 | Sonnet, rater 2 | Haiku, rater 1 | Haiku, rater 2 |
|---|---|---|---|---|
| Placebo (reworded control) | -0.17 | -0.08 | +0.04 | +0.08 |
| Persona kit, red-team framing | +0.25 | +0.21 | 0.00 | +0.04 |
| Persona kit, spend framing | +0.21 | +0.21 | +0.17 | +0.29 |
| Guide only (no persona runner) | 0.00 | +0.08 | +0.04 | +0.25 |
| Hosted panel | -0.12 | -0.08 | +0.29 | +0.21 |
| "Who pushes back" layer | +0.04 | 0.00 | +0.08 | +0.42* |

**Ratings.** No version beat another by the rule fixed before the run (a gap above the placebo gap in all four cells, and an interval excluding 0 in three of four). On "try it this week" the two persona models disagreed in sign on the red-team kit. The placebo alone moved one cost rating by -0.42*, so differences of this size are noise. The hosted panel's lower cost ratings repeat the price its own description stated. No wording was picked.

**Themes.** The headline themes were written into the persona cards. 19 of 24 cards said the person had said in public they don't trust an AI checking its own answer, and the company-seat cards named a security review. A second pass neutralised those traits on 16 of the 24 cards: the "AI checking AI" objection then came only from the 8 cards that kept the trait (5 of 5). Interest in a kit or guide tracked the "runs panels now and then" trait. None of this is evidence about real people.

**What it did contribute.** Objections to the draft guide copy: the judge sees only the person's own summary; which judge answers; who pays past the free checks; "cite the real test, not the verdict"; "no panel? grill any decision". The factual errors in the first draft (a masking claim, "free on your own key", a run note on the paste route) were caught by reviewers reading this repository, not by the simulation. The guide-before-kit order came from the first grill's missing option, not from the simulation.

## Grills

All through Grill in chat, Anthropic excluded.

| Grill | Judge | Verdict | What changed |
|---|---|---|---|
| The simulation plan | google/gemini-4-neon | Solid if | Added the guide-only option the judge named as missing; added a floor of people who come back; the copy split moved to a live test |
| Final plan, run 1 | moonshotai/kimi-k3.1-pro | Solid if | Removed the gate on the directory listing (no dependency); wrote how a look-back scores a simulated prediction |
| Final plan, run 2 | moonshotai/kimi-k3.1-pro | Solid if | A conversion counts only when it links to a `sim` reply; the cohort gets its own ref label |
| Final plan, run 3 | google/gemini-4-neon | Solid if | A keep threshold and a hard stop for the extension; "under 30 replies" now tells a thin niche from unspent batches; keep fires early at 3 linked first grills |

**Still weak after three grills.** The verdict never reached solid. The fixes from run 3 were not grilled again. The test's likely reading is a drop or "niche too thin": the channel is narrow, and the linked count misses connector sign-ups that arrive without the browser cookie.

## Reviewers before the final grills

Six reviewers, each told to break the plan from one angle and to cite a file for every finding: spend, principles and privacy, measurement, owner attention, first principles, and the simulation itself. What they changed:

- Pro adds no checks. The first draft said a hosted panel was 20 to 75% of a Pro month. It is 40 to 150% of anyone's month.
- The guide asked people to paste a whole run plus four questions Grill wrote. That breaks the subject rule (the decision plus a few sentences, no template). It now asks for the call and two or three sentences.
- A ref on a page other than `/start` is never counted, and asking people by ref label would break PRIVACY.md. The test moved into the existing reply batches and counts only linked conversions.
- The page was not the smallest change. Step 1 now has no page.
- The record and look-back, the one thing a persona tool cannot do for itself, was missing. It is now the core of the integration.
- The simulation's own claims were cut back to what the data support: see "What the simulation did".

## Decisions for Tony

1. Run the `sim` reply test from the next @AskGrill batch, call to action `/start/?ref=sim`, 60-minute budget, with the directory listing filed separately this week. Recommend: yes.
2. Let an agent draft the judge clause and its two eval cases, merged only if the weekly eval holds. Recommend: yes.
3. Record approved picks from your own persona-sim runs in Grill, with the real test's read date as the look-back. Recommend: yes.

Simulation code and raw answers: `grill-experiments/persona-sim-2026-11-28/` in the private ops repository.
