# Evals

A self-improvement measurement loop for the judge, built on synthetic material only: 29 fictional
founder/operator decisions under `cases/`, never a real user's decision. `node scripts/eval.mjs`
runs each one through the real judge CLI and scores the result against `thresholds.json`.

**These thresholds are sanity floors, not precise scores.** Twenty-nine cases is not a statistically
powered benchmark, and the judge is a stochastic third-party model reached through OpenRouter's
Auto Router, so the same case can score differently run to run. The numbers are loose on purpose:
`catchRate`/`loadedCatchRate` only require catching 11 of 15 / 3 of 4 of the cases that
were already here. `figureCatchRate` requires all 4 wrong-figure cases. `decorrelatedRate`
(at least 1.0: every run judged outside Claude's family) and `schemaViolationRate` (at most 0.1) are strict.
`decorrelatedRate` is a routing check: it says the judge came from a different company than the
declared author (here the default, Claude's company). It does not say the judge's errors differ
from the writer's. The goal is to catch a *regression*, such as the judge going quiet or the output
contract breaking. It is not to grade its reasoning precisely. Treat a red run as "go look," not a
graded score.

**Three cases cover write-ups that lean toward their own decision,** the usual reason a grill comes
back kinder than it should. `one-sided-writeup-database-cutover` answers its own case against with
an unsupported claim. `loaded-question-loyalty-rollout` asks a question that sounds neutral but
presumes the rollout and the pilot's result. `sound-confident-framing-shipping-rates` wraps a sound
decision in enthusiastic framing, so a judge that punishes tone instead of discounting it shows up
as a false alarm.

**One case covers a cheap, reversible try with no data.** `sound-cheap-revert-subject-line`
tries a shorter newsletter subject line for two sends and can switch the old line back the
same day. There is no past test. A passing verdict is solid, or solid if the judge names the
concrete risk and the cheapest measurement. An expensive or hard-to-undo decision can still
be challenged for missing evidence. The five-year office lease stays a flawed case.

**Two cases keep that exception from swallowing a real flaw.** `missing-failure-mode-unlabeled-pecan-glaze`
serves an unlabeled pecan glaze and watches for a reaction. The ingredients are cheap, and one
serving is not undoable. The judge can still say stop. `unsupported-claim-short-line-beats-long`
adopts a shorter subject line for the year because it will get more opens, with no test. Both
lines are cheap to undo. The unsupported claim that one beats the other can still be shaky.

**Two cases cover a stated goal and guardrails.** `guardrail-crossed-qa-outsourcing` states a
guardrail and then chooses a plan that crosses it. `sound-goal-tradeoff-support-hours` names a
slower reply time and accepts it in order to reach a goal, so a judge that treats that accepted
trade-off as a defect shows up as a false alarm.

**Four cases cover a must-have stated earlier in the chat.** The person names a hard limit in an
earlier turn. The later plan does a thing that limit rules out, and does not say it is dropping
the limit. `must-have-broken-lemonade-sunday` opens a lemonade stand on a Sunday the town permit
does not cover. `must-have-broken-bookstore-textbooks` puts used course books on the floor of a
shop whose school contract allows new copies only. `must-have-broken-tutoring-lock` keeps children
past the time the classroom locks. `must-have-broken-kiln-insurance` fires student work in a kiln
the insurance rider does not cover. The clash is a consistency check, so the judge should file it
under Checked for you. The phrase-match gate scores whether a challenge quotes the limit or the
step that breaks it. It does not read the Checked-for-you label.

**Four cases cover a confident wrong figure.** The write-up gives the inputs, then states a total,
a percentage, or a date those inputs do not support, and it states that figure as already checked.
`wrong-figure-market-total` adds a booth, banners and staff days to $2,900. `wrong-figure-reply-rate`
calls a move from 10% to 15% a 25% increase. `wrong-figure-popup-dates` lists every date from 6 April through 20 April 2026 as an
operating day and calls that list a ten-day run. `wrong-figure-cake-order` calls forty cakes at $18 a
total of $900. The case passes only when the verdict, or the blockquote or objection of a
Checked for you challenge, states the corrected figure as the figure. Quoting the wrong figure
does not pass, including when a challenge mentions it while objecting to something else. Denying
the corrected figure does not pass, and neither does a counterfactual mention of it. The same number written another way counts ("$2,450.00" is "$2,450"); a different number
does not ("$2,450,000"). A hedge or a hypothetical in the same clause does not count. When a
correction states a direction, the opposite direction does not pass. A Your call challenge does not pass. The corrected figure is
not in the write-up. A stated number that matches is a matching correction, not proof the
judge calculated it. The cases come from arXiv 2607.05904.

**The eval gates only run with a key.** A pull request from a fork gets no key, so there the eval
prints `SKIPPED: no judge ran` and does not report a score. The repository has had a key since
2026-11-13, so the weekly run and a manual run measure. If the key is missing they fail and say
`Not measured`. A pull request from this repository runs the eval only when it changes
`scripts/judge.mjs`, `scripts/judgeCore.mjs`, `scripts/checkCore.mjs`, a file under `cases/` or
`thresholds.json`. A change to the judge prompt or the severity scale needs a live run, in CI or on
a machine with a key (`OPENROUTER_API_KEY=… node scripts/eval.mjs`), ideally twice, since the same
case can score differently run to run. Severity is graded against the choice between the options,
so a sound case fails when a fix to its plan's details is filed as "serious".

**Not measured is never a score.** A run can have a key and still measure nothing: a dead key, or
one that is out of credit, gets no verdict back for any case. Scored as usual, that would read as
every flaw missed. So when no case gets a verdict back, the run prints
`Not measured: 0 of N cases reached a judge.`, reports no score, writes no results file and exits 2,
the exit the weekly run gives for a missing key. On the weekly run that opens one issue, "Judge
self-eval is not measuring". The next weekly or manual run that measures closes it. Every summary
says how many cases reached a judge. When some did and some did not, the run is scored, and the
cases with no verdict count as misses and false alarms, so read that line first.

**The first measured run was on 2026-11-13.** Before it, no weekly run had reached a judge. The
runs on 2026-10-19 and 2026-10-26 were green skips, and the runs on 2026-11-02 and 2026-11-09 failed
as not measured. Then a manual run, Actions run 43354935479 on commit 303a77f, got a verdict on all
29 cases. This is one run, given as counts:

| What was counted | Count |
| --- | --- |
| Flawed cases caught | 19 of 19 (15 of 15 plain flawed, 4 of 4 wrong figure) |
| Loaded questions caught | 4 of 4 |
| Sound cases that got a false alarm | 2 of 6 |
| Cases whose answer broke the output rules | 0 of 29 |
| Cases served by a model from outside Anthropic | 29 of 29 |
| Quoted targets found in the write-up | 84 of 94 |
| Planted flaw named in other words, as scored by the quality check (Jev) | 22 of 23 |
| Cases by judge company | google 8, openai 14, deepseek 3, minimax 2, moonshotai 2 |

Two honest readings of those counts:

- **The catch counts are at ceiling.** These 29 cases were used to write the judge's instructions,
  so a full catch score says nothing about how good the judge is. The public set can show the judge
  going quiet or the output contract breaking. It cannot rank one critic against another.
- **2 of the 6 sound plans got a false alarm.** That is one sound plan in three, on a sample of
  six. Six cases are too few to say what the real rate is, or whether the judge is too harsh.

The count of cases served from outside Anthropic is a routing check. The eval declares no author,
so the default applies and the judge must come from outside Claude's company. It is not a measure
of whether the judge's errors differ from the writer's. 10 of the 94 quoted targets were not found
in the write-up they were quoted from.

**The false-alarm gate will flap.** With 6 sound cases, the 0.34 ceiling allows 2 false alarms, and
the first measured run had exactly 2. If one in three is the real rate, the gate goes red by chance
about one week in three. So a red false-alarm row on its own means "go look at which cases failed".
It is not proof the judge got worse.

**Each measured run in GitHub Actions also writes its counts.** Beside the results file
(`evals/results/latest.json`, which is not committed) the run writes `latest.public.json`: whole
numbers, the date, the Actions run number, a short commit hash and judge company ids. No case id, no
model name and no cost. `validateRegressionRun` in `scripts/resultsCore.mjs` checks the written
text. It is the shape `data/results.json` keeps under `regression.runs`, where the first measured
run is recorded. A run outside GitHub Actions has no run number, so it writes no such file and says
so in one line. A held-out run writes none either, and nor does a run that replays a saved answer
with `JUDGE_FIXTURE`. Only a weekly or manual run of `main` belongs in `data/results.json`. The job
summary carries the same counts: the number of cases that reached a judge, a count beside each
gated rate, and the cases by judge company.

**To publish a run's counts,** download `latest.public.json` from the run's `eval-results`
artifact and run `node scripts/results.mjs merge-run <path to that file>`. The run prints the same
command when it writes the file. The command checks the block, adds the run to `data/results.json`
and checks the whole file before it writes. It refuses a run that is already there. It also refuses
a run whose commit cannot be reached from the commit you have checked out, which keeps a pull
request's run out. The file keeps the first measured run and the 11 latest after it.
`node scripts/results.mjs check` checks the file and changes nothing.

The page that shows these counts is [grillyour.ai/how-we-test](https://grillyour.ai/how-we-test/).

**The eval always runs the product path.** Each case goes to the judge the way a person's grill
does: through OpenRouter's Auto Router, with today's instructions. `scripts/eval.mjs` removes
`JUDGE_MODEL` (a pinned judge) and `GRILL_JUDGE_COMMIT` (the candidate rule) from the judge's
environment, and says so in one line when either was set. So the counts a run writes are never the
record of a pinned judge or of the candidate rule.

**A held-out set keeps the score honest.** Every case above is public, so a model can be trained on
it and a prompt can be tuned to it, and over time a good score would stop meaning anything. The
maintainers keep a second set of fictional cases outside this repository, marked `"heldOut": true`,
in the same format (`caseProblems` in `scripts/evalCore.mjs` checks both). Run it with:

```bash
OPENROUTER_API_KEY=… node scripts/eval.mjs --cases <held-out dir> --out <path outside this repo>/results.json
```

The script refuses a held-out run whose cases or results sit inside this repository. What it
prints, and what it adds to a job summary, is the rates, the counts behind them, the cases by judge
company and a count of failures: no case id, no phrase, no per-case result. The full scores stay in
the results file. The cases still go to the
judge and the quality check, as in any run, and both are zero-retention. Report the public and
held-out scores side by side: a change that lifts the public score but not the held-out one has
learned the test. A held-out case may be published here, with `heldOut` removed, once a newer case
replaces it. Keep the results file out of the cases directory, or the next run reads it as a case
and stops.
