---
name: grill
description: Grill a decision, plan or forecast. An outside AI judge, a model from a different company than Claude, argues the strongest case for and against it, names the cheapest test that would settle each challenge, and gives a verdict. Use when the user says grill, stress-test, pressure-test, poke holes in, red-team or challenge something they decided or plan to decide, when the weekly review marks a decision for grilling, or when they say look back or paste a decision record to score.
---

# Grill a decision

The user has been thinking with you, so your critique is correlated with theirs. Grilling sends the decision to a judge from a **different model family**. The judge writes:
- a steelman of the decision, and a counter-steelman;
- challenges, each with a **falsifier**: the cheapest test that would settle it;
- a verdict, in the same words as the website: solid, solid if, shaky, or doesn't hold up. The tool's own result uses `holds`, `holds-with-conditions`, `weak` or `refuted` for those four.

## First time

If the user seems new ("what is this?", "set up Grill"), say in two lines what it does. Then offer to grill **one real decision right now**: something they decided or will decide this week, and how sure they are. The first grill is the setup.

If they set up the one-click route with their own model-router key (not Grill Pro, whose account is already set this way), mention once the two settings in that account that keep write-ups unstored. Both are off by default:
- **Input & Output Logging** (Observability settings): leave it off, or list their Grill key under "Excluded API Keys".
- **Use of inputs/outputs** (Privacy settings, the 1% discount): leave it off.

## 1. Write the subject

Ask only for what's missing, at most two questions. Then write:
- **The decision,** and the options that were on the table.
- **The reasons given,** in the user's words where you have them.
- **The prediction and confidence,** exactly as the user gave them. A band stays a band; never invent one. If there's none, ask: "What do you expect to happen, by when, and how sure are you?"
- **The strongest case against,** written as its best advocate would put it. Use any dissent you know of (a co-founder, a customer); if there's none, make the best case for the main alternative.
- **Every number with its date,** read fresh where you can. The judge builds its case on the figures you give it.
- **A neutral question,** at most 300 characters, that never names a preferred answer. For a forecast, ask whether the confidence is too high, too low or about right, and for the earliest sign **in either direction**.

Leave out names of people who aren't needed, and anything personal, health- or HR-related.

## 2. Get the user's OK

Show the subject and question, and say where they will go before sending anything:
- **One-click route:** a model router, zero-data-retention endpoints only. About a cent, on their own key.
  - **Say who else sees it.** If the `grill` tool's description says the Jev quality check is on, tell them: Jev, a decision model from TypeSafe, also sees the masked write-up and the report, on the same zero-retention terms. It checks the judge's work. They can skip it for this grill, or switch it off in Grill's settings (Claude Desktop: Settings → Extensions → Grill).
  - If they say skip it, call the tool with `quality_check: false`. That covers this grill only.
- **Paste route:** the assistant they paste it into, under that app's own data settings.

## 3. Send it

**If you have the `grill` tool** (from the Grill extension in Claude Desktop, or the plugin in Claude Code):
1. Call it with `subject` and `question`. If the subject came from another assistant, add `author`, for example `openai`, so that family is excluded too.
2. If it returns a job id, call `grill_result` with it until the report arrives. It usually takes 1–3 minutes; tell the user it's working.
3. If it says Grill isn't set up, relay its steps. Never ask the user to paste their key into the chat. A Grill Pro key goes in the same settings field as their own key. If Grill's settings name a judge model, the tool already uses it. That judge has to be a different company from the assistant they think with. If they name one from the same company, say so and don't treat it as the outside judge.

**If you don't have the tool** (claude.ai on the web or phone, or no extension yet), use the paste route. Claude Desktop and Claude Code enforce a different company in code. This route cannot, so you check it and warn.
1. Before you write the judge prompt, note your own maker in one line: "Your assistant: Claude by Anthropic."
2. Fill in `paste-prompt.md` from this skill's folder with the approved subject and question.
   - Mask what the one-click route masks: email addresses become [email], phone numbers [phone], card numbers [card number].
   - Never include a key or token.
   - Suggest they turn on the app's private mode first, for example a Temporary Chat in ChatGPT.
3. Give it back as one block they can copy. If it is under 6,000 characters, also give an "Open in ChatGPT" link: `https://chatgpt.com/?q=` followed by the URL-encoded prompt. For Gemini or any other assistant, they paste it themselves. Name the assistants they can paste it into: ChatGPT, Gemini or Grok.
4. Ask them to paste the judge's answer back here. Your own view is not the judge.
5. Mention once that Claude Desktop with the Grill extension does this in one step: https://github.com/mtangoz/grill#set-up
6. If they have a Grill Pro setup that names a judge, paste into that assistant, and only if it is a different company from you. Do not put their managed key in the prompt.

When they paste the judge's answer back, compare companies before you relay the verdict. Read the opening line. It should be `Judge: <model name> by <company>`. Compare it with the maker you noted. Treat ChatGPT and OpenAI as one company, Claude and Anthropic as one, Gemini and Google as one, Grok and xAI as one, and Muse and Meta as one. Copilot can run OpenAI, Anthropic or xAI models, so only Gemini counts as a different company (a line that names Gemini or Google). You are Claude, so the assistants to paste into instead are ChatGPT, Gemini or Grok. If you cannot tell the company, treat the line as missing.

- If the companies differ, the first line you show is `Judge: X by Y. Different company from your assistant ✓`, with X and Y from the judge's line.
- If the companies match, the first line you show is `Warning: this verdict is NOT independent. The judge is the same company as your assistant. Paste the judge prompt into ChatGPT, Gemini or Grok instead.`
- If the Judge line is missing, the first line you show is `Warning: this verdict is unverified. The answer has no Judge line, so this is not a confirmed outside judge. Paste the judge prompt into ChatGPT, Gemini or Grok instead.`

## 4. Relay the result

On the paste route, the company check above is the first line you show. A result from the `grill` tool already enforced a different company in code; relay that report as written, and do not look for a Judge line.

- **Plain words, the same ones the website uses.** Say solid, solid if…, shaky or doesn't hold up for the four verdicts (holds, holds-with-conditions, weak, refuted). Call a challenge a weak spot and a falsifier a quick check. Change the words, never the substance.
- **Verdict first,** with its one-line reason. On the paste route it comes after the company-check line.
- **The top challenges by severity,** each with its falsifier. Quote the judge; don't soften it or argue it into agreement.
- **Degradation:** if the report carries a warning banner (a clipped subject, a failed provider, a judge from an excluded family), say so plainly. "The judge found nothing" and "the judge couldn't see it" must never read the same.
- **Next steps:** the report's own "Before you decide" section, when the tool included one. Show it. Do not add a second copy, and do not send it to the judge.
- **Paste route:** after the company-check line, the verdict and the challenges, add the section in `reflection.md`. Fill the decision record from the judge. Leave confidence empty if they never gave one.
- **Recording:** the record block is theirs to copy anywhere. If they also keep a decision log, they can file the longer template from the weekly review. Grill does not store the block.
- **Your own view:** only if asked, labelled "same-model critique".

## 6. Look back

When they paste one or more decision record blocks and say "look back" or "grill look back", follow `reflection.md`. If the `grill_look_back` tool is available, call it and relay the result. It needs no key and stores nothing. Without the tool, ask what happened and score the calls in the chat, using the same rules. Do not tell them they need an account, a decision log, or a connected inbox for this. The monthly Count is only the weekly review, and only when that log has enough calls.

## 5. Offer to share a signal (opt-in, every time)

Grill improves under the same privacy controls as a grill: from a few shared choices, never from content. After they answer "worth engaging?", offer once: *"Want to help Grill get better? This shares only a few choices, no words from your decision."*

If they say yes, give them this link, filled in, to open and submit themselves:

`https://github.com/mtangoz/grill/issues/new?template=grill-signal.yml&event=rated&category=…&judge=…&verdict=…&rating=…&client=…`

- `category`: one of pricing, hiring, fundraising, product, timing, vendor, operations, personal, other.
- `judge`: the served model's family, which is the part before the `/`, such as openai, google, deepseek, meta, mistral, qwen, xai or moonshot. Use `other` for anything else, and `paste-route` for the paste route.
- `verdict`: holds, holds-with-conditions, weak or refuted. Plain words map back as solid → holds, solid if → holds-with-conditions, shaky → weak, doesn't hold up → refuted.
- `rating`: yes or no.
- `client`: desktop, web, phone or code.

Never put anything else in the link. Tell them the issue is public. If they say no, drop it.
