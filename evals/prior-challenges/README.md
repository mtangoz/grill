# Prior challenges: a candidate behind a flag

On a re-grill of a revised plan, the candidate judge also marks each challenge from the earlier grill as **fixed** or **still open**, so the "What Grill changed" block comes from Grill instead of the assistant grading its own revision. It is switched on with `GRILL_JUDGE_PRIOR_CHALLENGES` (`1`, `true`, `on`, `yes`). Production leaves it unset, and it stays off until the owner says yes.

Off, or with no earlier challenges, the judge's messages and answer form are byte for byte today's (`scripts/priorChallenges.test.mjs`), so every holdout case is judged exactly as it is now. A "fixed" mark must quote words that are really in the revised plan; otherwise it reads as open.

Only `scripts/judge.mjs --prior <text>` can send earlier challenges today. Hosted Grill does not pass them yet. That wiring is a separate change, made only if this candidate passes.

## How it is measured

This spends router credit. It is not part of `npm test` and must not be added to CI.

```bash
OPENROUTER_API_KEY=… node scripts/eval-prior-challenges.mjs --out <dir>
```

- **Holdout v2, read only.** The checksum is checked before anything is sent, and nothing is added to it. Each case is judged twice by today's judge (run-to-run noise) and once by the candidate with the first run's challenges as the earlier list. The plan did not change, so every "fixed" is a false fix, and verdicts that move more than today's noise mean the list is anchoring the judge.
- **Revision cases** in `cases.jsonl`: revised plans with hand-labelled earlier challenges. Today's judge re-grills the revision. The candidate also marks each earlier challenge.
- **The bar** (`passesBar` in `scripts/priorChallengesEvalCore.mjs`): false fixes on holdout at most 10%; candidate verdict agreement no more than 15 points below today's run-to-run agreement; marks right on at least 75% of hand labels. Passing the bar does not turn the flag on. The owner rates a handful of blind pairs (`pairs.md`) first.

## Results, 2026-11-22 (flag still off)

- **Holdout v2** (25 cases, unchanged): 0 false fixes in 68 marks. Today's judge agreed with itself on 19 of 25 verdicts (76%). The candidate agreed with today's first run on 21 of 25 (84%), so the earlier list did not move verdicts beyond run-to-run noise. Mean move: about a tenth of a step harsher.
- **Revision cases**, first run: 13 of 18 marks right (72%), under the 75% bar. Two misses were this repo's quote check rejecting a right quote that had the judge's comment after it (fixed, with a test), and one case where the judge returned no marks (now shown as "did not check" instead of "0 fixed").
- **Revision cases**, second run with those fixes: 16 of 18 right (89%), 0 false fixes. 5 of 6 verdicts matched today's judge.
- Passing the bar does not turn the flag on. Six blind pairs from the second run wait for the owner's rating.
