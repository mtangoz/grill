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
- Missing `goal`, `guardrails`, `decided`, `source_app`, `supersedes` and `changed` lines are the same as absent. They are not required. A record without them reads as the record above.
- A record never carries a `superseded-by` line. When two records are pasted and one `supersedes` line names the other's date and title, the look-back works out that the later call replaced the earlier one. A record pasted on its own still names the call it replaced, from its own `supersedes` line.
- The look-back reply is a different block. It uses `title`, `came_true`, `falsifier_fired` and `happened`, inside an ordinary text fence. When the record has a goal or guardrails, it also uses `goal_met` (yes, no or partly) and `guardrails_held` (yes or no). That reply is not a decision record.
- The look-back also asks "Did anything happen you didn't expect?" The reply may add an optional `surprise:` line: a few words, or leave the line off. To mark that those words match a challenge or the falsifier, add a clause after `|`: `| matches challenge 2` or `| matches falsifier`. Grill uses only that mark. It does not compare the words with the record. `| still live` means the decision is still open and the surprise bears on it.

```text
title: The decision, in a few words
came_true: no
falsifier_fired: no
happened: one sentence on what actually happened
surprise: a few words | matches challenge 2 | still live
```

A miss with a surprise and no match mark reads: the world moved in a way the record didn't foresee. A miss whose surprise is marked as matching a challenge or the falsifier reads: this was flagged and you went ahead. A miss with no surprise is a plain miss. When the line includes `still live`, the reading adds: grill the revised plan; the new record will say it replaces this one. A surprise is not scored and not counted.

## Optional lines

2026-09-29. Version stays 1.

A later Grill has to keep reading records people already copied, and an older Grill has to keep reading records written today. A new version number would make one of those fail. A reader that only accepts version 1 skips anything else, and a reader that only accepts a new version skips the records already in people's notes. An optional line does neither. Writers add it after `review` only when it has a value. Readers that do not know the line ignore it. Readers that do know it use it. A record with none of these lines is the same record as before.

| Field | Meaning |
|---|---|
| goal | What you are trying to achieve, in your words. `not stated` when you declined. Omit the line when there is nothing to write. Never invent a goal. |
| guardrails | What this must not cost or break, in your words. Omit the line when you named none. A trade-off you name and accept is not a guardrail you failed. |
| source_app | The assistant that wrote the record, such as `claude`, `claude-code` or `chatgpt`. You or the assistant add it. The installed Grill tool does not. A Grill account in chat fills it from the connector you used. |
| decided | What you chose, in your words, including any change you made because of a challenge. Omit the line until you have chosen. Never invent it. |
| supersedes | The earlier record this one replaces, as its date and title: `2026-01-10 Hire contractor`. Add it only when you say the choice changed. Omit it on a re-run, when nothing changed. Never invent it. There is no `superseded-by` line. |
| changed | Why the choice changed, in the shape `evidence — your few words`, `goals — your few words`, `context — your few words`, or `reweighed — your few words`. `reweighed` means the same facts weighed differently. Add it only with `supersedes`, and only in your words. Never invent it. |

Look-back uses a goal when the line is present and is not `not stated`. It asks "Did you reach the goal? Yes, no or partly." A guardrails line asks "Did your guardrails hold? Yes or no." The answers use `goal_met` and `guardrails_held`. When the call came true and the goal was missed, the reading says the prediction was right about the wrong target. When a guardrail did not hold, it says "A guardrail broke." The pattern line counts goals met and guardrails held. A `decided` line is read back as what you chose. When the call is scored, the reading says whether that choice came true. The line is omitted when you have not chosen. It is never invented. A `supersedes` line is read back as the call this one replaced. If that earlier record is not in the paste, the look-back says once: "If this replaced an earlier record, paste that too to see both." A `changed` line is read back as what changed. When it says `reweighed`, the reading is: "Nothing new came in; you weighed it differently."

## What can be added later, without changing this block

The text of a version 1 block is the whole record. These can be added later by keeping that text as written:

- **Stored history.** Save the block unchanged.
- **A reminder on the review date.** Read `review`. The date is already in the block.
- **A monthly look-back.** Read the version 1 blocks from that month and run the same look-back. The reply stays a separate note.

Grill does none of those today. A free grill stores nothing, needs no account, and sends the block nowhere.
