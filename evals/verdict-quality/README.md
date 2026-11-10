# Verdict quality

A blind comparison of two judges on the same decision. The current judge is today's prompt. The candidate is that prompt plus one rule, switched on with `GRILL_JUDGE_COMMIT`. Production leaves the variable unset, so the judge people use does not change until this comparison says the candidate is better.

The rule, and nothing else in the prompt:

> When a named person has stated criteria and the facts address them, call the outcome against those criteria — never say their decision can't be settled — and still name any missing option that would change the call. The cheap test names the person, what to show them, and what counts as a pass. Do not force a provisional go on a sequencing or multi-step question, do not add a safeguard to a cheap reversible experiment, and do not force a call when no named person has stated criteria.

`1`, `true`, `on`, and `yes` turn it on. Anything else, including unset, is off.

The broader wording lost the one measurement it was allowed. It helps when a named person has stated criteria and the judge would otherwise say the call cannot be settled. It hurts when it forces a provisional go on a sequencing or multi-step question, adds a safeguard to a cheap reversible experiment, or drops a missing option. The sentence above is that narrower rule. The flag is still off.

## What is measured

The primary metric is the share of pairs where a blind rater says which output would change what you do next. The candidate must win at least 60% of decided pairs, and the one-sided sign test must have p < 0.1. A tie is not a decided pair. The null is an even chance: the p-value is the probability of this many candidate wins or more if the two outputs were equal.

Panel labels and human labels are scored together for that bar, and the score prints them separately. A pair nobody labelled is not decided.

Three secondary fields are recorded and do not decide the gate:

- took a position
- specific to this case
- cheap concrete test

## Cases

`cases.jsonl` has one JSON object per line: `id`, `subject`, `context`, and `split` (`dev` or `holdout`). The dev rows are decisions a founder, a PM, or an ops lead would actually grill: hiring, pricing, shipping code, picking a vendor, a forecast, and whether a named person will approve the work.

Holdout v1 is spent. It is the 15 cases in `cases.jsonl` whose split is `holdout`, including two real failures: a manager named Charlie judging a weekly GTM update, and a plan to improve an AI verdict tool. The candidate won 9 of those pairs and lost 6, p=0.30. `holdout.sha256` is still the checksum of those 15 cases. Do not edit a holdout case. Do not update the checksum. Do not measure a new candidate on v1. `holdout-v1-spent.txt` says the same thing, and `node scripts/eval-verdicts.mjs --split holdout` refuses before it reads the file.

Holdout v2 is 25 new cases in `holdout-v2.jsonl`. `holdout-v2.sha256` is their checksum. A v2 run refuses to start when the checksum does not match. Do not edit a v2 case to help a candidate. Do not update that checksum to make a tuning change pass.

Dev cases are for fixing the harness and for reading what the two judges say. They are not the measurement.

## How to run

This spends router credit. It is not part of `npm test` and it must not be added to CI. With no key, a dev run skips and a holdout v2 run exits 2 without writing a file.

```bash
# Dev only. This is a tuning run. It will not read holdout cases.
OPENROUTER_API_KEY=… node scripts/eval-verdicts.mjs --split dev

# The measurement. Once per candidate. The screen rates the full answers.
OPENROUTER_API_KEY=… node scripts/eval-verdicts.mjs --split holdout-v2 --screen
```

`GRILL_API_KEY` works the same way as it does for `scripts/judge.mjs`. The script writes `evals/verdict-quality/out/<date>/pairs.jsonl` and `labels.csv`. Pass `--out` to choose another directory. Each case is two calls through the same OpenRouter path, one with the flag off and one with it on. A and B are randomised. Model names are removed from the answers. `labels.csv` already has `candidate_side` filled in, because the scorer needs it.

A finished holdout v2 `pairs.jsonl` in that directory blocks a second run. That block is a reminder, not a substitute for the rule below.

## The screen

`--screen` adds a cheaper pass after the two judges. Three models, from three providers, none of them the Auto Router the judge uses:

- `openai/gpt-4o-mini`
- `deepseek/deepseek-chat-v3.1`
- `google/gemini-3.1-flash-lite`

Each model reads the decision and both answers in full, with A and B in a random order, and says which answer would change the decision more. A trimmed answer is a different test: on the spent holdout, full answers matched the owner on 13 of 15 pairs and trimmed answers matched on 7 of 15. The screen sends the full text.

Each request asks OpenRouter for zero-data-retention routing, the same `provider` block the judge uses. A model with no such endpoint casts no vote.

When all three are confident and name the same side, that side is the label and `label_source` is `panel`. A split, a missing vote, or an unconfident vote is not labelled. Those pairs go to `sheet.md`: the verdict line plus the next two lines of each answer, and a copy-paste reply block in the `1: A` form. The full answers stay in `pairs.jsonl`. `panel.jsonl` records the three votes.

Fill the block, save it as `replies.txt`, and score:

```bash
node scripts/eval-score.mjs --labels evals/verdict-quality/out/<date>/labels.csv --replies replies.txt
```

A reply fills a sheet row. It does not replace a panel label. Exit 0 means the combined decided pairs cleared both bars. Exit 1 means they did not. The flag stays unset either way until someone turns it on after a passing holdout.

Without `--screen`, v2 still writes blind pairs and an empty `labels.csv`, for a person who wants to label every pair. That is not the screened measurement.

## How to label

Label from `pairs.jsonl` when you are filling the sheet, or when you are labelling a run that did not use the screen. Hide the `candidate_side` column until every other cell on that row is filled. Do not label a run you can already tell apart by watching it.

For each pair, read the subject and the context, then the two outputs. On the sheet, the short lines are a reminder. The choice is about the full answers.

- `would_change`: `A` if output A would change what you do next, `B` if output B would, `tie` if you cannot pick one. In `replies.txt` that is a line `1: A`, `1: B`, or `1: tie`.
- `took_position_a` and `took_position_b`: `yes` if that output gives a call, `no` if it refuses or says the subject cannot settle it.
- `specific_a` and `specific_b`: `yes` if the note is about this case, `no` if the same words would fit a different decision.
- `cheap_test_a` and `cheap_test_b`: `yes` if it names a concrete cheap test, `no` if it does not.

Leave `candidate_side` as the harness wrote it. The screen leaves the secondary fields blank. They still do not decide the gate.

The score prints `panel_candidate_wins` and `human_candidate_wins` under the combined `candidate_wins`. The pass bar uses the combined count only.

## The holdout rule

The holdout is used once per candidate and never for tuning. v1 has been used. v2 is the next one. Read the labels, record the score, and stop. A second run, a rewritten case, or a prompt edited against those labels is not this measurement. Tuning scripts refuse to read holdout cases. `node scripts/eval-verdicts.mjs --split holdout-v2 --tune` exits before it opens the file.

Opted-in `grill_feedback` cases, from a separate change, get appended to `dev`. They never go on the holdout.
