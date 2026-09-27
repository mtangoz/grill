# How Grill gets better without seeing your decisions

A model router improves every day without reading anyone's prompts: it learns which models people choose for each kind of task. Grill copies that idea one layer up, and runs its whole loop under the same privacy controls as a grill: masked text, zero-retention routing, nothing kept.

**The rule:** Grill learns from synthetic cases, public metadata and choices people share. Never from a decision.

## Three loops

| Loop | Learns from | Runs | Output |
|---|---|---|---|
| **1. Model choice** | The router's market data: which models people use for each task type | Continuously, inside the router | The judge Grill gets, inherited free as models improve |
| **2. Quality** | 12 synthetic decisions in `evals/cases/`, with planted flaws, sound cases and loaded questions. Each report is also scored by **Jev**, TypeSafe's typed decision model, which is a third model family | Weekly, and on every change to the judge (`eval.yml`) | Gated: catch rate, false-alarm rate, loaded-question catches, decorrelation. Watched: quotes grounded, falsifiers concrete, verdicts that fit, and Jev's reading of whether the planted flaw was caught. An issue if a gate falls below its floor |
| **3. Usefulness and accuracy** | Opt-in, dropdown-only signals: "worth engaging?" by judge family, and each verdict against its outcome | Monthly (`learn.yml`) | A report with recommendations, such as "exclude judge family X" or "verdicts aren't predicting outcomes" |

**Plus upkeep** (`upstream.yml`, weekly):
- the judge's fallback models still exist on the router, and still have zero-retention endpoints; every endpoint serving Jev is zero-retention;
- the extension manifest still validates against the latest `mcpb` tool.

## Quality checks on one grill

These run on a single grill. They are not the weekly eval loop above.

- **Local, always on:** Grill checks every quote a challenge attacks against your write-up, and flags any it can't find.
- **Jev, on by default:** a decision model from TypeSafe, on a zero-retention endpoint, scores whether each falsifier is a real test and whether the verdict fits. Claude tells you before each grill that Jev will see the masked write-up. Skip it for one grill by saying so, or switch it off in Grill's settings. It adds about $0.0002 a grill.

The reflection at the end of a report (what you expect, how sure you are, what would prove you wrong) is not sent to the judge and is not a learning signal. Grill does not store it.

## Why Jev for quality

- **It answers narrow questions with probabilities, not prose:** "is this falsifier a concrete test?", "does this verdict fit these challenges?", "did any challenge find the planted flaw?". It's cheap enough (about $0.0002 a report) to score every eval run.
- **It is a third family,** separate from Claude and from the judge, so it doesn't grade its own homework.
- **Its readings are watched before they are trusted.** They sit beside the phrase-match gate until a few weeks of runs show they agree with it; only then should a Jev metric become a gate.

## How a change lands

1. **Measure.** The loops open an issue when something drifts or a signal crosses a threshold. Recommendations need at least 10 data points, and stay silent below that.
2. **Propose.** A person or an agent drafts one change: a prompt edit, a chain change, an excluded judge family, a new eval case.
3. **Gate.**
   - The change must keep the synthetic evals above their floors (`evals/thresholds.json`).
   - A change prompted by a real-world failure also adds a synthetic case that reproduces it, so the evals grow with what's learned.
   - Evals are a gate, never the goal. Tuning the prompt to the 12 cases would only teach the judge the test.
4. **Ship.** A tagged release rebuilds the extension, with provenance.

## What the signals can and can't tell us

- **They can:** which judge families people find worth engaging, by kind of decision; and whether "weak" and "refuted" verdicts come true less often than "holds" (verdicts that predict nothing are a prompt problem).
- **They can't:** anything about a decision's content. The form has no text fields, and the report drops any issue edited to include text.
- **Honest limits:** people who share are self-selected, and a public issue carries their GitHub username. Treat the numbers as directional until there are hundreds.
