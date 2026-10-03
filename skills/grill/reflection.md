# Before you decide

Add this after you relay the judge. Do not put it inside the judge prompt, and do not change the judge's verdict or a `Judge:` line.

If the report already contains `## Before you decide`, show that section as written. Do not add a second one.

## The section

## Before you decide

These stay in your notes. Grill does not store them and does not send them to the judge.

1. What do you expect to happen, and by when? Write the prediction you will stand behind.
2. How sure are you now, as a percent? A band is fine. This is your confidence, not the judge.
3. What would prove you wrong? Name the one result you will treat as decisive.

The prediction line is what they expect, and by when. Fill it from what they already said, and leave it empty if they have not said. Do not invent one. The falsifier line is the judge's sharpest check. The confidence line is what you said before the verdict, when you said one. Change the confidence if the verdict moved you, and keep the earlier number beside it. A change is a new call. A goal or guardrail line is copied from what they already said. Leave the line off if they did not state one. Do not invent one.

The block is decision record version 1. Write the lines in this order, inside a fence tagged `grill-record`. The field list is [docs/DECISION-RECORD.md](../../docs/DECISION-RECORD.md). A look-back reads `version: 1` only and skips any other version. A block with no version line is not a record.

```grill-record
version: 1
date: {TODAY}
title: {DECISION TITLE}
prediction: {what they expect, and by when, or empty}
verdict: {solid / solid if / shaky / doesn't hold up}
falsifier: {the judge's first falsifier, or none named}
confidence: {what the user said, or empty}
review: {14 days after today, unless they name a date}
```

After `review`, add a line only when it has a value. `goal` is what they are trying to achieve, or `not stated` if they declined. `guardrails` is what this must not cost or break, in their words. `source_app` is the assistant you are (`claude`, `chatgpt`, `copilot`, `gemini`, `grok` or `muse`). You add `source_app`. The grill tool does not. A record without these lines is still version 1.

Copy the block above into any notes you keep. Edit the review date if you want a different check-in.
To look back, paste one or more blocks back into this chat and say "look back". Nothing is stored.

## How to fill the block

- **version** is `1`. Do not leave it off, and do not invent a second format.
- **date** is today. **review** is 14 days later, unless the user names a check-in.
- **title** is the decision, in a few words.
- **prediction** is what they expect, and by when. Leave it empty if they never wrote one. Do not invent one. A record without this line is still version 1.
- **verdict** is the judge's plain-word verdict. Do not upgrade or soften it.
- **falsifier** is the judge's first, most severe falsifier. If they adopt a different check, they edit the line.
- **confidence** is the number or band they gave before the verdict. Leave it empty if they never gave one. Do not invent one.
- **goal**, **guardrails** and **source_app** come after `review`, and only when they have a value. Never invent a goal or a guardrail. `Goal: not stated` means they declined. Mark a goal or guardrail that started with you `(from the assistant)`.

## Look back

When the user pastes one or more of these blocks and says "look back" or "grill look back":

- Do not call the judge. Do not send the records anywhere. Nothing is stored.
- If they have not said what happened, ask two questions and for one sentence: did it come true (yes or no), and did the thing that would prove them wrong happen (yes or no). Read the prediction back when the record has one. When the record has a goal other than `not stated`, also ask: "Did you reach the goal? Yes, no or partly." When it has guardrails, also ask: "Did your guardrails hold? Yes or no." A pasted block with `came_true`, `falsifier_fired` and `happened` still counts. `goal_met` and `guardrails_held` count when those lines exist. An optional `surprise:` line counts when they write one.
- When they answer, score only the calls they marked yes or no.
  - A doubted verdict (shaky, or doesn't hold up) that missed: the doubt matched what happened.
  - A doubted verdict that came true: they were righter than the doubt.
  - A verdict that let the call stand (solid, or solid if) and it came true: the call and the verdict agreed.
  - A verdict that let the call stand and it missed: the outcome was harder than the verdict.
  - True, and the falsifier fired: those two disagree. Say so.
  - Confidence at or above 70% on a miss: confidence was high, and the call missed.
  - Confidence at or below 40% on a hit: confidence was low, and the call came true.
  - The call came true and the goal was missed: the prediction was right about the wrong target.
  - A guardrail did not hold: "A guardrail broke."
- Also ask, and let them skip it: "Did anything happen you didn't expect?" If they answer, put a few words on an optional `surprise:` line. They may mark that it matches challenge N or the falsifier, as `| matches challenge 2` or `| matches falsifier`. Use only that mark. Do not match their words against the record.
- Read a miss in one of three ways. A miss with a surprise that no challenge or falsifier was marked for: "the world moved in a way the record didn't foresee." A miss whose surprise they mark as matching a challenge or the falsifier: "this was flagged and you went ahead." A miss with no surprise is a plain miss. If the decision is still open and the surprise bears on it, they add `| still live`, and you say "grill the revised plan; the new record will say it replaces this one." No reversal score, and do not count surprises.
- Then one pattern line: how many calls are back, how many came true, whether their confidence ran hot, ran cold, or sat near what happened, how the verdicts lined up, and, when they answered, how many goals were met and how many guardrails held. Fewer than four calls back: say to read the direction, not a score. No points, badges or streaks.
- If the `grill_look_back` tool is available, call it with the pasted records and what happened, and relay its text. It does the same reading and stores nothing. A missing tool is not a missing look-back: do it in the chat from the rules above.
- This does not need a decision log, an account, or a connected inbox. The monthly Count in the weekly review is separate, and it only runs when a log has enough calls.

## Grill news (paste route only)

After "Before you decide", and after the signal offer is settled, if the user did not say no or stop, add one line, once in the conversation, word for word. Do not add it if they declined that offer. Do not ask a question about it. Do not ask for an email. At most one invitation per grill.

Grill news: saved decision history and look-back reminders are coming as an optional Pro plan. The free tool stays free. To hear when they arrive: https://grillyour.ai/notify?via=paste

If the grill tool's report already ends with a Grill news line, show that line instead, once, word for word, at the very end. The tool adds it only within 7 days of a release or on the first 3 days of a month, at most once a session. Do not add the paste line as well.
