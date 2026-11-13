# Four-arm comparison: draft protocol

Status: draft. This is a plan for one measurement. Nothing in it has been run.
Registered: not yet. When it is, this line gives the date, the commit, the seed checksum and the model ids.
Measured: not yet.

This file is a draft until the owner registers it, before the paid run. Until then any part of it can change, and nothing may call it registered. After that, a change is a deviation and is listed at the end of this file.

The harness is `scripts/eval-four-arm.mjs`. Its rules, in code, are in `scripts/fourArmCore.mjs`. The tests in `scripts/fourArm.test.mjs` keep this file and that code in step.

## The question

A person asks an AI to write up a decision. Then they want the strongest case against it. Does Grill, as shipped, catch more planted flaws than the simpler things that person could do with the same AI?

Whether an outside judge catches more than the same model starting fresh has not been measured yet. What is true by rule is narrower: the judge is from a different company than the one that wrote the plan, when Grill can tell which that is. This run is how a wider claim could be earned, or shown not to be.

## The four arms

Every arm gets the same write-up W and the same question Q. W is written once by the author model (see "Who writes each case").

| Arm | What it is | Exactly what is sent |
| --- | --- | --- |
| A | The same model, same chat | Three messages to the author model, with no system prompt and no tools: the person's ask; W as the model's own earlier turn; then Q, a blank line, and "Argue the other side." |
| B | The same model, fresh context, Grill's brief | `node scripts/judge.mjs --json --question Q --author <family>` with W on standard input, and `JUDGE_MODEL` set to the author model in that child process only |
| C | A stronger model from the same lab, Grill's brief | The same call, with `JUDGE_MODEL` set to the stronger model |
| D | The product as shipped | The same call, with `JUDGE_MODEL` unset: the Auto Router picks the judge, the author's company is left out, and the product refuses an answer that the author's company served anyway |

"Grill's brief" is the judge's own instructions and answer form in `scripts/judgeCore.mjs`, unchanged. Arms B, C and D run the unmodified `scripts/judge.mjs`. They see W and Q. They do not see the person's ask. Arm A does, because it is the same chat.

Every request, in every arm, asks the router for zero-retention endpoints, as the product does.

The separate quality check that can follow a verdict is off in every arm. It reads a verdict after the fact and is not part of what is graded.

## What D minus B is called

D minus B is "the product as shipped against the same model with a fresh context and Grill's brief".

It is not "the cross-company increment". Arm D is whatever the router serves on the day. That is a model from another company, and it is also a different model, of a different strength and price. The gap between D and B mixes those two things, and this run cannot pull them apart. Arm C is there to show what a stronger model does with no change of company.

## The case set

<!-- seed-counts:start -->
Seeds not written yet.
<!-- seed-counts:end -->

The lines above are taken from `evals/four-arm/seeds.jsonl` when it exists. A test fails if they differ from the file.

The target for the frozen split is 120 flawed cases, 40 sound twins and 20 loaded cases. A dev split of 12 seeds is for rehearsals and is never part of a result.

A seed is what a person would type to their assistant: the facts, the option they lean to, and a request for a write-up of about 200 words. For a flawed seed, the flaw is in those facts. A sound twin is the same situation with the flaw taken out. A loaded seed asks a question that takes its own answer as settled. Every situation is made up, with invented names and numbers. `node scripts/eval-four-arm.mjs validate-seeds <file>` checks a seed file and prints its counts.

The set is a draft until the owner reads a sample and registers it.

Why 120 flawed cases: with 120, a paired test finds a true difference of 15 points about 76 to 89 times in 100. It finds a 10 point difference about 38 to 49 times in 100, and a 5 point difference about 11 to 13 times in 100. At the floor of 110 cases the first figure is about 71 to 85. So this run can speak only about differences of about 15 points or more. These figures assume arm B catches about 70 in 100. The lower end is for arms that miss unrelated cases, the higher end for arms that find the same cases hard.

The 29 public cases in `evals/cases/` are not used here. They were used to write the judge's instructions, and on the one measured run the product caught every flawed and loaded one. They cannot tell one critic from another.

### The seed file

`evals/four-arm/seeds.jsonl` holds one JSON object per line. Each has exactly these eleven fields, all text. Anything else is refused.

| Field | What it holds |
| --- | --- |
| `id` | Lowercase words and digits joined by hyphens, 80 characters at most. Unique in the file. |
| `kind` | `flawed`, `sound` or `loaded`. |
| `category` | One of `personal-money`, `career`, `hiring-and-team`, `pricing-and-sales`, `marketing`, `operations-and-suppliers`, `software-and-tools`, `housing-and-moving`, `study-and-training`, `events-and-community`. |
| `user_ask` | 60 to 220 words. What the person types. It must ask for a write-up of about 200 words, in those words: "200 words". |
| `question` | The one-line question put to the judge. 4 to 40 words, ending in a question mark. |
| `flaw` | One sentence of 6 to 60 words that names the planted flaw, or how the question is loaded. Empty for a sound seed. |
| `flaw_type` | For a flawed seed, one of `arithmetic`, `base-rate-ignored`, `survivorship`, `sunk-cost`, `dropped-requirement`, `hidden-dependency`, `timeline-conflict`, `confounded-evidence`, `small-sample`, `selection`, `contradicts-own-goal`, `irreversible-no-trial`. For a loaded seed, `loaded-question`. For a sound seed, `none`. |
| `twin_of` | For a sound seed, the id of the flawed seed it corrects, in the same split and category. Empty otherwise. A flawed seed has at most one twin. |
| `author_family` | `anthropic` or `openai`. Empty in a draft batch. It is set on every seed when the batches are merged. |
| `drafter_family` | Who drafted the seed. For a model, its company, spelled as one of `openai`, `anthropic`, `google`, `x-ai`, `deepseek`, `meta-llama`, `mistralai`, `moonshotai`, `minimax`, `qwen`, `cohere`, `amazon`, `microsoft`, `nvidia`, `perplexity`, `z-ai`. For a human, `owner` or `person`. No other spelling is taken. |
| `split` | `dev` or `frozen`. |

`question` and `flaw` are each one line.

`user_ask`, `question` and `flaw` may not hold any of these:

- An email address, a phone number or a web address. A bare site name such as `ovenbarn.com` counts as a web address.
- An em dash, an en dash or any other long dash, the minus sign character included. A plain hyphen is fine.
- The name of an AI company or model. See the list below.
- A phrase from Grill's own write-up template: "prediction, offered at" and "the strongest case against".
- A label Grill prints in its own report: "cheap test" and "what would flip the call".

The last rule is there because arms B, C and D print those labels and arm A does not. A `question` or a `flaw` sentence that used one would lean toward those arms on its wording alone. A hyphen in place of the space, or capital letters, changes nothing. No flaw type is named in those words either.

The name check is by whole word, in any letter case, and it is wide. Company names such as Amazon, Google, Microsoft and Nvidia count as AI company names here. So do product names such as Copilot, Gemini, Mistral, Cohere and Llama, even where they are everyday words or a person's name. Use invented names. The refused words are:

anthropic, claude, openai, chatgpt, gpt, google, deepmind, gemini, gemma, x-ai, xai, grok, deepseek, meta-llama, meta ai, llama, mistralai, mistral, moonshotai, moonshot, kimi, minimax, qwen, alibaba, tongyi, cohere, amazon, microsoft, copilot, nvidia, perplexity, z-ai, zhipu, glm, openrouter, auto router, typesafe, jev, baidu, tencent, hunyuan, bytedance, doubao, xiaomi, stepfun, inclusionai, thinkingmachines, nousresearch.

Also refused: "open ai" and "chat gpt" written as two words, Meta with a capital M, a short model name such as o4-mini, and any model id written as company/model.

Two seeds may not tell the same situation. The validator reads two asks as the same situation when they share half of their wording or more. A twin and the seed it corrects are the one exception, and they must share wording. Write a twin by copying the flawed seed's ask and changing only what takes the flaw out. The validator wants at least a fifth of the wording shared. Wording is counted in runs of five words.

`validate-seeds` names the line, the seed and the rule for each problem it finds.

## Who writes each case

Each seed gets one author family before any model is called: `anthropic` or `openai`. Flawed and loaded seeds alternate between the two inside each split and kind, in order of flaw type, category and id. A sound twin takes the author family of the flawed seed it corrects. `node scripts/eval-four-arm.mjs assign-authors <file>` does this. The family is stored in the seed, so the checksum covers it.

The author model for that family is sent the person's ask and nothing else, once. Its reply is the write-up W. A usable write-up has 100 to 400 words and came from the author's company. W is saved with its own checksum and is never edited.

## Settled before any arm runs

For each flawed case, three graders answer two yes or no questions about the write-up:

- Is the flaw visible in the write-up alone?
- Does the write-up already point the flaw out?

A case leaves the analysis only by one of two rules, both applied before any arm runs:

1. The author model gave no usable write-up.
2. The write-up already points out the planted flaw. Then there is nothing left to catch.

Both counts are reported.

The "flaw visible in the write-up alone" flag does not remove a case. It is there because arm A sees the person's ask and arms B, C and D do not. A flaw the author left out of the write-up can be caught only by arm A. D against B and D against A are both shown split by this flag.

## Primary outcome and test

Planted-flaw catch on flawed cases, D against B.

A catch is a yes from the graders to one question: does the critique point out the known problem? It is not a match on words.

The test is exact McNemar on the paired cases, two-sided 0.05.

## The decision rule

The rule is one ordered list. The first line that applies is the result.

1. Not measured. See "What Not measured means".
2. If fewer than 110 flawed cases are analysed, the result is "too few cases to test". It changes no claim.
3. If there is a sign flip between the two author families, there is no pooled headline. See "Splits".
4. D better: D caught more than B, and the test is under 0.05.
5. D worse: B caught more than D, and the test is under 0.05. This sends work to a judge quality floor, a rule for which models the router may pick, before anything else.
6. Otherwise: no difference of 15 points or more was found. It is never "no difference". A smaller one could be there and this run could not see it. If the gap seen is 15 points or more and the test is still not under 0.05, the report says a gap of that size was seen and could not be told from chance. It does not say none was found. The result line then reads "a gap of 15 points or more was seen, and no direction is claimed". What it changes is the same.

Two more conditions:

- Any public sentence about quality also needs D not worse than C. That means D caught at least as many flawed cases as C, both ways of counting.
- A direction (D better or D worse) is claimed only when it holds both ways of counting. See "Usable answers".

What each result changes:

| Result | What it changes |
| --- | --- |
| Not measured | Nothing. There is no result. |
| too few cases to test | No claim changes. |
| D better | A sentence about quality may be put to the owner, only if D is not worse than C and the set is not a single-drafter set. It states the difference, the number of cases, and that the cases are made up. Nothing stronger. |
| no difference of 15 points or more was found, or a gap was seen and no direction is claimed | No sentence about quality. Public copy keeps to the rule and says no more. |
| no pooled headline | The same as the line above. The two author families are shown apart. |
| D worse | No sentence about quality. The next work is a judge quality floor. |

## Secondary analyses

Four tests, listed here by name so none can be added later:

1. D against A: the product as shipped against typing "argue the other side" in the same chat. This is the answer to "why not type argue the other side".
2. D against C: the product as shipped against a stronger model from the same lab with Grill's brief.
3. B against A: a fresh context and Grill's brief against the same chat, same model.
4. C against B: a stronger model against the same model, both from the author's lab, both with Grill's brief.

Each is exact McNemar on catch, with unusable answers counted as misses. The four p values are corrected together by Holm's method and read at 0.05. The usable-only numbers are shown beside them.

There is no outcome where a person or a model says which of two answers they like more.

## Alarms on sound twins

A sound twin is a plan with the flaw taken out. An alarm is a critique that tells the reader not to go ahead as written. A condition, a small fix or a thing to check is not an alarm.

Alarm rate is compared for arms B, C and D only. Arm A is told to argue, so its alarm rate is set by its instruction. It is shown and not compared.

With about 40 twins, a rate is known only to within about 15 points either way. So arms are not ranked on alarm unless the gap is 30 points or more.

## Loaded cases

Loaded cases are described, not tested. The report says, for each arm, how many answers named how the question was loaded.

## Usable answers

An answer is usable when all of these hold:

- Arm A: the reply has at least 30 words and came from the author's company.
- Arms B and C: `judge.mjs` returned a verdict, and the answer came from the author's company.
- Arm D: `judge.mjs` returned a verdict from a company other than the author's.
- The graders could label it. An answer they could not label counts as unusable.

Catch is reported two ways:

1. With unusable answers counted as misses.
2. On usable answers only.

The primary conclusion must hold in both. If the two disagree, no direction is claimed. The result falls under rule 6 of the decision rule, with a line that says the two ways of counting disagree, and both tables are shown.

## The retry rule

The rule is the same for every arm: at most 3 requests to a model for one case and one arm. A retry happens only when no usable answer came back. The first usable answer is kept and is never replaced.

Arms A, B and C are retried by the harness. Arm D is the product, which already makes up to 3 requests inside one run, so the harness runs it once.

One known difference: the product retries a failed or empty answer, and an answer served by the author's company. It does not retry an answer that came back in the right form with no usable verdict in it. The harness does, for arms A, B and C. This can only count against D.

A step that stopped part way can be resumed. Resuming fills in what is missing. It never asks again for something already answered.

## Word count and objections

For each arm the report gives the median word count of the text the graders read, and the median number of objections in it. The graders count the objections, with the same question for every arm. A longer answer has more chances to mention the flaw. These two numbers let a reader see that.

Arms B, C and D are graded on the full report, the longest layer a person can ask Grill for. It shows at most four challenges, as the product does. The short default reply is not graded in this run. The judge's whole result is kept in the raw rows, so the short reply can be graded later without a second run.

## Splits

D minus B is also shown split two ways: by author family, and by seed drafter family.

A sign flip is when D minus B is above zero for one author family and below zero for the other, with unusable answers counted as misses. A sign flip voids a pooled headline: the two families are reported apart, and no sentence about quality follows.

## The single-drafter rule

Each seed records who drafted it. If one model family drafted more than half of the frozen seeds, the set is a single-drafter set.

The result of a single-drafter set may remove a quality claim. It cannot restore one. That changes only when at least half of the frozen seeds come from another family or from the owner.

The reason: a seed drafter and an author from the same company may lean the same way, and for half the cases that company is behind arms A, B and C but not D.

## Graders and blinding

Graders are models from companies other than the two author families. For each case, a grader from the company that served arm D on that case is left out too. All four arms of a case get the same graders, so the choice of grader says nothing about the arm.

Three graders vote on each answer. The label is what at least two of them agree on.

A grader sees the write-up, the question, the planted flaw and the critique. For a sound twin there is no flaw to show, and the grader is not told the plan is sound. A grader is not told the arm or the model. Grill's run note is removed. Every AI company and model name is replaced by "[name removed]".

Blinding cannot fully blind arm A. Arms B, C and D come out in Grill's layout. Arm A is free prose and often says it is arguing the other side. A grader can tell. That is why the outcome is a yes or no question about content, and why word count is reported.

## The grader agreement floor

Before a result counts, the owner labels 40 blinded items. 16 of the 40 come from sound twins, where a wrong grade costs most. The items are picked by a fixed shuffle, not by hand.

The graders must match the owner on at least 34 of 40.

Below that, the owner's labels decide: the owner labels every item, and those labels are the ones counted. Or the run is Not measured.

## What Not measured means

Not measured means the run produced no result. The harness prints "Not measured", exits with code 2, prints no score and changes no results file.

It happens when:

- there is no router key, on the frozen split or when `--require-key` was given;
- fewer than 9 in 10 write-ups were usable;
- any arm gave a usable answer on fewer than 9 in 10 of the analysed flawed cases;
- the grader check was not done, or was not passed.

The floors are held more than once. If the write-ups fall under 9 in 10, the author step says so, and the run, score and report steps each say it again. No arm is asked, no grader is asked and no block is written. The floor for each arm is checked when the arms have run, and again by `report`. So a run cannot carry on to a result past a step that said Not measured, whether or not the shell stops at the first exit code 2.

With no key, a dev step prints "SKIPPED: no arm ran" and stops with no score. A frozen step with no key is Not measured, with or without `--require-key`.

Not measured is not a null result. It is said as plainly as a result would be.

## What is published

Counts only, in `data/results.json` under `four_arm`:

- for each arm: flawed cases, how many it caught, the same on usable answers only, alarms, usable sound twins, and unusable answers;
- for each of the five comparisons: the four paired cells, both ways of counting;
- the case counts, the date, the commit, and whether the set is a single-drafter set.

No rates, no p values, no model names, no dollar amounts and no text. A page works the rates out from the counts.

It is published whichever way it falls. That includes "too few cases to test" and a result that goes against Grill.

Raw answers stay under `evals/results/four-arm/`, which git ignores. Each row keeps what the arm returned before blinding: the reply for arm A, and the judge's whole result for arms B, C and D. The public block has no place yet for the split by author family, the grader check or the result line. Until the results shape is widened, those are in the run's own report.

A rehearsal is never written into `data/results.json`. A rehearsal is any run on the dev split, on a loopback endpoint, or with a seed, arms or checksum file other than the committed one.

## The model ids are placeholders

`evals/four-arm/arms.json` names the author model and a stronger model for each family, and five graders. Every id is a placeholder, marked "owner to confirm".

They were picked from ids this repository already names and from the router's public model list on 2026-11-13. Each had a zero-retention endpoint that day, which `judge.mjs` needs.

None of this touches the product. Grill's judge still asks only the Auto Router and pins no model. The ids are for the comparison arms and live only in that file.

## Cost

About twenty-five to forty-five US dollars for one frozen run, and about two dollars for a dev rehearsal. This is an estimate, from the first measured weekly run and list prices. It is stated in this file only.

## Limits

- The cases are made up, with planted flaws. They are not real decisions with outcomes.
- It is one run on one day, with whatever the router served that day. The report lists which companies served arm D.
- There are two author families.
- The graders are models, checked against one person on 40 items.
- The seeds sit in a public repository before the run.
- A difference under about 15 points cannot be seen.

## Deviations from the registered protocol

None yet.

After registration, any change to the seeds, the model ids, the judge's instructions or the analysis is listed here, with its date and its reason, before the result is read. A changed seed or model id also stops every frozen step, `report` included. A changed model id needs the protocol registered again, and the report then lists it here by itself, as it does when the judge's instructions at the run were not the registered ones. A seed changed after the run began cannot be reported on at all: the run's own record of its seeds no longer matches.

## What the owner does

1. Read a sample of the seeds. Fix or drop any that are unclear, or where the flaw is given away.
2. Add seeds of your own, or commission seeds from another drafter, until at least half of the frozen seeds are not from one model family. Without this the set is a single-drafter set.
3. Decide whether the seeds stay public before the run.
4. Confirm the model ids in `arms.json`. `node scripts/eval-four-arm.mjs preflight` prints them and a command that checks them against the public model list. Change each "owner to confirm" to "confirmed".
5. Rehearse on the dev split (see below).
6. Register. Write the frozen checksum to `evals/four-arm/seeds.sha256`. In `arms.json`, set `status` to `registered` and fill `registered` with five things: `date`, `commit` (the commit of the tree being registered), `seeds_sha256` (the seed checksum), `judge_prompt_sha256` (the judge instructions fingerprint that `preflight` prints) and `models_sha256` (the model ids fingerprint that `preflight` prints). Change the status lines at the top of this file. The Registered line gives the date, the commit, the seed checksum and every model id in `arms.json`. Set `four_arm.status` to `registered` in `data/results.json`. Commit it all together. A test fails if the three places disagree, or if a model id is missing from the Registered line. From then on a frozen step stops if a seed or a model id has changed.
7. Run the frozen split once, with a capped key.
8. Label the 40 blinded items in `audit-sheet.md`. Do not open `audit-map.jsonl` first.
9. Run `report` with `--results data/results.json`, and commit the result whichever way it falls. `report` checks the registration and the seeds again, and stops if either changed after the run.

## How to run it

```
node scripts/eval-four-arm.mjs validate-seeds evals/four-arm/seeds.jsonl
node scripts/eval-four-arm.mjs preflight

# rehearsal on the dev split: checks the plumbing, gives no result
node scripts/eval-four-arm.mjs author --split dev
node scripts/eval-four-arm.mjs run --split dev
node scripts/eval-four-arm.mjs score --split dev
node scripts/eval-four-arm.mjs report --split dev

# registration
node scripts/eval-four-arm.mjs validate-seeds evals/four-arm/seeds.jsonl --print-checksum > evals/four-arm/seeds.sha256

# the one frozen run
node scripts/eval-four-arm.mjs author --split frozen --require-key
node scripts/eval-four-arm.mjs run --split frozen --require-key
node scripts/eval-four-arm.mjs score --split frozen --require-key
node scripts/eval-four-arm.mjs report --split frozen --owner-labels <your answers> --results data/results.json
```

The key is read the same way `judge.mjs` reads it. This script is not part of `npm test` and must not be added to CI.
