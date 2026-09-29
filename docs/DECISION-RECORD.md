# Decision record

Version 1. Grill writes this block at the end of a grill. You copy it. Grill does not store it.

The same text is what a later reader would keep. Do not rewrite it into another shape.

```grill-record
version: 1
date: 2026-09-27
title: The decision, in a few words
prediction: what you expected, and by when
verdict: shaky
falsifier: the cheapest test that would prove it wrong
confidence: 70%
review: 2026-10-11
```

## Fields

Writers always emit these lines, in this order, inside a fence tagged `grill-record`. `version` is first so a paste can be told apart from any other notes.

| Field | Meaning |
|---|---|
| version | Always `1` for this format. |
| date | The day the record was written, `YYYY-MM-DD`. |
| title | The decision, one line. |
| prediction | What you expect, and by when. One line. Empty when you have not written it. A block written before this line existed still reads: the prediction is then empty. |
| verdict | One of: `solid`, `solid if`, `shaky`, `doesn't hold up`. |
| falsifier | The judge's first falsifier, or `none named`. |
| confidence | What you said, such as `70%` or `50–70%`. Empty when you did not say. A bare percent in the decision itself is not a confidence. |
| review | The check-in date, `YYYY-MM-DD`. The default is 14 days after `date`. |

## Reading

- A record starts at a line `version: 1`. It ends at the next `version:` line, or at a fence.
- Field order on the way in does not matter. Writers still use the order above.
- A block with no `version` line is not a record.
- Any other version is skipped whole. It is not scored as if it were version 1.
- Empty `confidence` is allowed. Empty `prediction` is allowed, and a missing `prediction` line is the same as empty. `date` and `title` are required.
- Missing `goal`, `guardrails` and `source_app` lines are the same as absent. They are not required. A record without them reads as the record above.
- The look-back reply is a different block. It uses `title`, `came_true`, `falsifier_fired` and `happened`, inside an ordinary text fence. When the record has a goal or guardrails, it also uses `goal_met` (yes, no or partly) and `guardrails_held` (yes or no). That reply is not a decision record.

## Optional lines

2026-09-29. Version stays 1.

A later Grill has to keep reading records people already copied, and an older Grill has to keep reading records written today. A new version number would make one of those fail. A reader that only accepts version 1 skips anything else, and a reader that only accepts a new version skips the records already in people's notes. An optional line does neither. Writers add it after `review` only when it has a value. Readers that do not know the line ignore it. Readers that do know it use it. A record with none of these lines is the same record as before.

| Field | Meaning |
|---|---|
| goal | What you are trying to achieve, in your words. `not stated` when you declined. Omit the line when there is nothing to write. Never invent a goal. |
| guardrails | What this must not cost or break, in your words. Omit the line when you named none. A trade-off you name and accept is not a guardrail you failed. |
| source_app | The assistant that wrote the record, such as `claude` or `chatgpt`. You or the assistant add it. The Grill tool does not. |

Look-back uses a goal when the line is present and is not `not stated`. It asks "Did you reach the goal? Yes, no or partly." A guardrails line asks "Did your guardrails hold? Yes or no." The answers use `goal_met` and `guardrails_held`. When the call came true and the goal was missed, the reading says the prediction was right about the wrong target. When a guardrail did not hold, it says "A guardrail broke." The pattern line counts goals met and guardrails held.

## What can be added later, without changing this block

The text of a version 1 block is the whole record. These can be added later by keeping that text as written:

- **Stored history.** Save the block unchanged.
- **A reminder on the review date.** Read `review`. The date is already in the block.
- **A monthly look-back.** Read the version 1 blocks from that month and run the same look-back. The reply stays a separate note.

Grill does none of those today. A free grill stores nothing, needs no account, and sends the block nowhere.
