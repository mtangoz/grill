# Evals

A self-improvement measurement loop for the judge, built on synthetic material only: 17 fictional
founder/operator decisions under `cases/`, never a real user's decision. `node scripts/eval.mjs`
runs each one through the real judge CLI and scores the result against `thresholds.json`.

**These thresholds are sanity floors, not precise scores.** Seventeen cases is not a statistically
powered benchmark, and the judge is a stochastic third-party model reached through OpenRouter's
Auto Router — the same case can score differently run to run. The numbers are loose on purpose:
`catchRate`/`loadedCatchRate` only require catching 6 of 8 / 3 of 4 cases, and `decorrelatedRate`
(at least 1.0: every run judged outside Claude's family) and `schemaViolationRate` (at most 0.1) are strict. The goal is to
catch a *regression* — the judge going quiet, or the output contract breaking — not to grade its
reasoning precisely. Treat a red run as "go look," not a graded score.

**Three cases cover write-ups that lean toward their own decision,** the usual reason a grill comes
back kinder than it should. `one-sided-writeup-database-cutover` answers its own case against with
an unsupported claim. `loaded-question-loyalty-rollout` asks a question that sounds neutral but
presumes the rollout and the pilot's result. `sound-confident-framing-shipping-rates` wraps a sound
decision in enthusiastic framing, so a judge that punishes tone instead of discounting it shows up
as a false alarm.

**Two cases cover a stated goal and guardrails.** `guardrail-crossed-qa-outsourcing` states a
guardrail and then chooses a plan that crosses it. `sound-goal-tradeoff-support-hours` names a
slower reply time and accepts it in order to reach a goal, so a judge that treats that accepted
trade-off as a defect shows up as a false alarm.

**The eval gates only run with a key.** CI has no OpenRouter key, so there the eval prints a notice and
skips. A change to the judge prompt or the severity scale needs a live run on a machine with a key
(`OPENROUTER_API_KEY=… node scripts/eval.mjs`), ideally twice, since the same case can score
differently run to run. Severity is graded against the choice between the options, so a sound case
fails when a fix to its plan's details is filed as "serious".
