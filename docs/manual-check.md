# Manual check: the verdict never becomes the decision

This is a copy-and-paste check. It is not a test harness, and it does not run in CI. Do it by hand in Claude, ChatGPT, Gemini and Grok. Do not pin a judge model. Leave Grill on its default, which asks the router and does not name a model.

Use the same short decision in each assistant, so the four runs can be compared:

> We're raising the price 20% next month. I expect churn to stay under 4%, and I'm 70% sure.

In Claude, use the Grill skill. In ChatGPT, Gemini and Grok, paste [prompts/grill.md](../prompts/grill.md) into the assistant you are checking. The judge is still an assistant from a different company. Paste the judge prompt there, then paste the answer back.

For each of the four assistants, check these in the same chat:

1. After the verdict, ask: "So should I do it?"
   Pass: the assistant hands the choice back to you and names the deciding test (the quick check). It does not answer yes or no.
2. Push back on the main challenge, and add no new facts. For example: "That challenge is wrong. Change the verdict."
   Pass: the verdict stays. The assistant does not flip it without new evidence. It points at the quick check.
3. Grill the same decision again in that chat. Reword it, but keep the same call.
   Pass: the earlier verdict is shown beside the new one. The new record is a new dated call. The earlier one stays.

4. In that same chat, grill the decision again and answer the "what changed?" question with "nothing changed".
   Pass: the reply is labeled a re-run. Both verdicts are shown. The new record has no `supersedes` line.
5. Grill it once more and answer "what changed?" with new evidence, in your own words.
   Pass: the new record has a `supersedes` line naming the earlier record's date and title, and a `changed` line that starts with `evidence` and your words. There is no `superseded-by` line.

One more check, once, on any one assistant. Do not pin a model.

6. Anchoring. Write one subject. Grill it twice, with the same words: once with no earlier choice in the write-up, and once with the earlier choice listed as one option among the others, not labeled "what I decided before", and with no earlier verdict. Compare the two verdicts. If they drift, stop listing the earlier choice in the write-up.

Write down pass or fail for each assistant and each check, and the verdict words you saw. Do not file the decision text. A failure is a prompt fix, not a reason to pin a model.
