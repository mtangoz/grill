---
name: challenge
description: Have an outside AI judge, a model from a different company than the one the user is talking to, argue the strongest case against one decision or forecast, and name the cheap tests that would settle it. Uses the user's own OpenRouter key. Use when the user asks to challenge, stress-test, grill or red-team a decision, a plan or a forecast, or when the weekly review marks a decision for a challenge.
---

# Challenge a decision with an outside judge

You are the model the user has been thinking with, so your critique is correlated with theirs. This skill sends the decision to a judge from a **different model family**. The judge writes a steelman, a counter-steelman, challenges that each carry a falsifier (the cheap test that would settle it), and a verdict: `holds`, `holds-with-conditions`, `weak` or `refuted`.

## 1. Write the challenge subject

Use these sections, in plain markdown:
- **The decision** and the options that were on the table.
- **The reasons given,** quoted from the user's notes, with sources.
- **The prediction and confidence,** exactly as the user gave them. A band stays a band; never invent one.
- **The strongest case against,** built from any dissent in the notes (a co-founder's objection, a customer's reaction), written as its best advocate would put it. If there was no dissent, say so, and make the best case for the main alternative.
- **Every number read fresh from its source today,** with its date. The judge will build its case on whatever figure you give it, so a stale one skews the whole report.
- **A neutral question** of at most 300 characters that never names a preferred answer. For a forecast, ask whether the confidence is too high, too low or about right, and for the earliest sign **in either direction**.

Leave out names of people who aren't needed, and anything personal, health- or HR-related.

## 2. Get the user's OK

Show the user the subject and the question. **Nothing leaves the machine until they approve it.** Tell them what happens to it:
- it goes to OpenRouter, routed only to zero-data-retention endpoints;
- OpenRouter and the model provider process it in transit;
- the plugin stores nothing.

## 3. Run the judge

It needs the user's own key in the environment, `OPENROUTER_API_KEY`. If it's missing, stop and point them to the README's "Bring your own key" section. Never ask them to paste the key into the chat.

Run this with a 10-minute Bash timeout; it usually takes 1–3 minutes:

```bash
out="$(mktemp -d)"
node "${CLAUDE_PLUGIN_ROOT}/scripts/judge.mjs" --json --out "$out/report.md" \
  --question "<the neutral question>" <<'SUBJECT'
<the approved subject>
SUBJECT
echo "report: $out/report.md"
```

- **If the subject came from another model family,** for example a plan drafted in ChatGPT, add `--author openai`. That family is excluded from judging on top of the default exclusion of Anthropic models.
- **Cost:** about a cent a challenge on the default model chain, charged to the user's OpenRouter account.

## 4. Relay the result

- **Verdict:** give it and its one-sentence reason first.
- **Challenges and falsifiers:** relay the top challenges by severity, each with its falsifier. Quote the judge; don't paraphrase it into agreement.
- **Degradation:** if the run printed `DEGRADED` lines (a clipped subject, a provider failure, a judge from an excluded family), say so plainly. "The judge found nothing" and "the judge couldn't see it" must never read the same.
- **Recording:** if the user keeps a decision log, record the verdict and any falsifier they adopt on the decision's record. Ask before adding a falsifier.
- **Your own view:** only if asked, labelled "same-model critique".

Offer the full report file. Delete the temp directory when the user is done with it.
