# Evals

A self-improvement measurement loop for the judge, built on synthetic material only: 12 fictional
founder/operator decisions under `cases/`, never a real user's decision. `node scripts/eval.mjs`
runs each one through the real judge CLI and scores the result against `thresholds.json`.

**These thresholds are sanity floors, not precise scores.** Twelve cases is not a statistically
powered benchmark, and the judge is a stochastic third-party model reached through OpenRouter's
Auto Router — the same case can score differently run to run. The numbers are loose on purpose:
`catchRate`/`loadedCatchRate` only require catching 4 of 6 / 2 of 3 cases, and `decorrelatedRate`
(at least 1.0: every run judged outside Claude's family) and `schemaViolationRate` (at most 0.1) are strict. The goal is to
catch a *regression* — the judge going quiet, or the output contract breaking — not to grade its
reasoning precisely. Treat a red run as "go look," not a graded score.
