# Evals

A self-improvement measurement loop for the judge, built on synthetic material only: 23 fictional
founder/operator decisions under `cases/`, never a real user's decision. `node scripts/eval.mjs`
runs each one through the real judge CLI and scores the result against `thresholds.json`.

**These thresholds are sanity floors, not precise scores.** Twenty-three cases is not a statistically
powered benchmark, and the judge is a stochastic third-party model reached through OpenRouter's
Auto Router — the same case can score differently run to run. The numbers are loose on purpose:
`catchRate`/`loadedCatchRate` only require catching 9 of 13 / 3 of 4 cases, and `decorrelatedRate`
(at least 1.0: every run judged outside Claude's family) and `schemaViolationRate` (at most 0.1) are strict. The goal is to
catch a *regression* — the judge going quiet, or the output contract breaking — not to grade its
reasoning precisely. Treat a red run as "go look," not a graded score.

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

**The eval gates only run with a key.** CI has no OpenRouter key, so there the eval prints a notice and
skips. A change to the judge prompt or the severity scale needs a live run on a machine with a key
(`OPENROUTER_API_KEY=… node scripts/eval.mjs`), ideally twice, since the same case can score
differently run to run. Severity is graded against the choice between the options, so a sound case
fails when a fix to its plan's details is filed as "serious".

**A held-out set keeps the score honest.** Every case above is public, so a model can be trained on
it and a prompt can be tuned to it, and over time a good score would stop meaning anything. The
maintainers keep a second set of fictional cases outside this repository, marked `"heldOut": true`,
in the same format (`caseProblems` in `scripts/evalCore.mjs` checks both). Run it with:

```bash
OPENROUTER_API_KEY=… node scripts/eval.mjs --cases <held-out dir> --out <path outside this repo>/results.json
```

The script refuses a held-out run whose cases or results sit inside this repository. What it
prints, and what it adds to a job summary, is the rates and a count of failures: no case id, no
phrase, no per-case result. The full scores stay in the results file. The cases still go to the
judge and the quality check, as in any run, and both are zero-retention. Report the public and
held-out scores side by side: a change that lifts the public score but not the held-out one has
learned the test. A held-out case may be published here, with `heldOut` removed, once a newer case
replaces it. Keep the results file out of the cases directory, or the next run reads it as a case
and stops.
