# Before you decide

Add this after you relay the judge. Do not put it inside the judge prompt, and do not change the judge's verdict or a `Judge:` line.

If the report already contains `## Before you decide`, show that section as written. Do not add a second one.

## The section

## Before you decide

These stay in your notes. Grill does not store them and does not send them to the judge.

1. What do you expect to happen, and by when? Write the prediction you will stand behind.
2. How sure are you now, as a percent? A band is fine. This is your confidence, not the judge.
3. What would prove you wrong? Name the one result you will treat as decisive.

The falsifier line is the judge's sharpest check. The confidence line is what you said before the verdict, when you said one. Change the confidence if the verdict moved you, and keep the earlier number beside it. A change is a new call.

```text
date: {TODAY}
title: {DECISION TITLE}
verdict: {solid / solid if / shaky / doesn't hold up}
falsifier: {the judge's first falsifier, or none named}
confidence: {what the user said, or empty}
review: {14 days after today, unless they name a date}
```

Copy the block above into any notes you keep. Edit the review date if you want a different check-in.
To look back, paste one or more blocks back into this chat and say "look back". Nothing is stored.

## How to fill the block

- **date** is today. **review** is 14 days later, unless the user names a check-in.
- **title** is the decision, in a few words.
- **verdict** is the judge's plain-word verdict. Do not upgrade or soften it.
- **falsifier** is the judge's first, most severe falsifier. If they adopt a different check, they edit the line.
- **confidence** is the number or band they gave before the verdict. Leave it empty if they never gave one. Do not invent one.

## Look back

When the user pastes one or more of these blocks and says "look back" or "grill look back":

- Do not call the judge. Do not send the records anywhere. Nothing is stored.
- If they have not said what happened, ask, for each record: did the prediction come true (yes, no, or not yet), did the falsifier fire (yes, no, or not yet), and what actually happened, in one sentence.
- When they answer, score only the calls they marked yes or no.
  - A doubted verdict (shaky, or doesn't hold up) that missed: the doubt matched what happened.
  - A doubted verdict that came true: they were righter than the doubt.
  - A verdict that let the call stand (solid, or solid if) and it came true: the call and the verdict agreed.
  - A verdict that let the call stand and it missed: the outcome was harder than the verdict.
  - True, and the falsifier fired: those two disagree. Say so.
  - Confidence at or above 70% on a miss: confidence was high, and the call missed.
  - Confidence at or below 40% on a hit: confidence was low, and the call came true.
- Then one pattern line: how many calls are back, how many came true, whether their confidence ran hot, ran cold, or sat near what happened, and how the verdicts lined up. Fewer than four calls back: say to read the direction, not a score. No points, badges or streaks.
- If the `grill_look_back` tool is available, call it with the pasted records and what happened, and relay its text. It does the same reading and stores nothing. A missing tool is not a missing look-back: do it in the chat from the rules above.
- This does not need a decision log, an account, or a connected inbox. The monthly Count in the weekly review is separate, and it only runs when a log has enough calls.
