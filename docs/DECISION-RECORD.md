# Decision record

Version 1. Grill writes this block at the end of a grill. You copy it. Grill does not store it.

The same text is what a later reader would keep. Do not rewrite it into another shape.

```grill-record
version: 1
date: 2026-09-27
title: The decision, in a few words
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
| verdict | One of: `solid`, `solid if`, `shaky`, `doesn't hold up`. |
| falsifier | The judge's first falsifier, or `none named`. |
| confidence | What you said, such as `70%` or `50–70%`. Empty when you did not say. A bare percent in the decision itself is not a confidence. |
| review | The check-in date, `YYYY-MM-DD`. The default is 14 days after `date`. |

## Reading

- A record starts at a line `version: 1`. It ends at the next `version:` line, or at a fence.
- Field order on the way in does not matter. Writers still use the order above.
- A block with no `version` line is not a record.
- Any other version is skipped whole. It is not scored as if it were version 1.
- Empty `confidence` is allowed. `date` and `title` are required.
- The look-back reply is a different block. It uses `title`, `came_true`, `falsifier_fired` and `happened`, inside an ordinary text fence. That reply is not a decision record.

## What can be added later, without changing this block

The text of a version 1 block is the whole record. These can be added later by keeping that text as written:

- **Stored history.** Save the block unchanged.
- **A reminder on the review date.** Read `review`. The date is already in the block.
- **A monthly look-back.** Read the version 1 blocks from that month and run the same look-back. The reply stays a separate note.

Grill does none of those today. A free grill stores nothing, needs no account, and sends the block nowhere.
