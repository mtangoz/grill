# Verdict quality

A blind comparison of two judges on the same decision. The current judge is today's prompt. The candidate is that prompt plus one rule, switched on with `GRILL_JUDGE_COMMIT`. Production leaves the variable unset, so the judge people use does not change until this comparison says the candidate is better.

The rule, and nothing else in the prompt:

> When the outcome depends on someone else's opinion or can't be known yet, judge the work against that person's stated criteria and give a call. Never answer that the subject can't settle it. The cheap test names the person, the exact thing to show them, and what counts as a pass.

`1`, `true`, `on`, and `yes` turn it on. Anything else, including unset, is off.

## What is measured

The primary metric is the share of pairs where a blind rater says which output would change what you do next. The candidate must win at least 60% of decided pairs, and the one-sided sign test must have p < 0.1. A tie is not a decided pair. The null is an even chance: the p-value is the probability of this many candidate wins or more if the two outputs were equal.

Three secondary fields are recorded and do not decide the gate:

- took a position
- specific to this case
- cheap concrete test

## Cases

`cases.jsonl` has one JSON object per line: `id`, `subject`, `context`, and `split` (`dev` or `holdout`). The set is about 40 decisions a founder, a PM, or an ops lead would actually grill: hiring, pricing, shipping code, picking a vendor, a forecast, and whether a named person will approve the work.

The holdout is 15 of those cases, including two real failures: a manager named Charlie judging a weekly GTM update, and a plan to improve an AI verdict tool. `holdout.sha256` is the checksum of those 15 cases. A holdout run refuses to start when the checksum does not match. Do not edit a holdout case to help a candidate. Do not update the checksum to make a tuning change pass.

Dev cases are for fixing the harness and for reading what the two judges say. They are not the measurement.

## How to run

This spends router credit. It is not part of `npm test` and it must not be added to CI. With no key, a dev run skips and a holdout run exits 2 without writing a file.

```bash
# Dev only. This is a tuning run. It will not read holdout cases.
OPENROUTER_API_KEY=… node scripts/eval-verdicts.mjs --split dev

# The measurement. Once per candidate.
OPENROUTER_API_KEY=… node scripts/eval-verdicts.mjs --split holdout
```

`GRILL_API_KEY` works the same way as it does for `scripts/judge.mjs`. The script writes `evals/verdict-quality/out/<date>/pairs.jsonl` and `labels.csv`. Pass `--out` to choose another directory. Each case is two calls through the same OpenRouter path, one with the flag off and one with it on. A and B are randomised. Model names are removed. `labels.csv` already has `candidate_side` filled in, because the scorer needs it.

A finished holdout `pairs.jsonl` in that directory blocks a second run. That block is a reminder, not a substitute for the rule below.

## How to label

Label from `pairs.jsonl`. Hide the `candidate_side` column until every other cell on that row is filled. Do not label a run you can already tell apart by watching it.

For each pair, read the subject and the context, then the two outputs.

- `would_change`: `A` if output A would change what you do next, `B` if output B would, `tie` if you cannot pick one.
- `took_position_a` and `took_position_b`: `yes` if that output gives a call, `no` if it refuses or says the subject cannot settle it.
- `specific_a` and `specific_b`: `yes` if the note is about this case, `no` if the same words would fit a different decision.
- `cheap_test_a` and `cheap_test_b`: `yes` if it names a concrete cheap test, `no` if it does not.

Leave `candidate_side` as the harness wrote it.

Then:

```bash
node scripts/eval-score.mjs --labels evals/verdict-quality/out/<date>/labels.csv
```

Exit 0 means the candidate cleared both bars. Exit 1 means it did not. The flag stays unset either way until someone turns it on after a passing holdout.

## The holdout rule

The holdout is used once per candidate and never for tuning. Read the labels, record the score, and stop. A second run, a rewritten case, or a prompt edited against those labels is not this measurement. Tuning scripts refuse to read holdout cases. `node scripts/eval-verdicts.mjs --split holdout --tune` exits before it opens the file.

Opted-in `grill_feedback` cases, from a separate change, get appended to `dev`. They never go on the holdout.
