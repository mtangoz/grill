---
name: grill
description: Grill a decision, plan or forecast. An outside AI judge, a model from a different company than Claude, argues the strongest case for and against it, names the cheapest test that would settle each challenge, and gives a verdict. Use when the user says grill, stress-test, pressure-test, poke holes in, red-team or challenge something they decided or plan to decide, or when the weekly review marks a decision for grilling.
---

# Grill a decision

The user has been thinking with you, so your critique is correlated with theirs. Grilling sends the decision to a judge from a **different model family**. The judge writes:
- a steelman of the decision, and a counter-steelman;
- challenges, each with a **falsifier**: the cheapest test that would settle it;
- a verdict: `holds`, `holds-with-conditions`, `weak` or `refuted`.

## First time

If the user seems new ("what is this?", "set up Grill"), say in two lines what it does. Then offer to grill **one real decision right now**: something they decided or will decide this week, and how sure they are. The first grill is the setup.

If they use the one-click route, mention once the two settings in their model router account that keep write-ups unstored. Both are off by default:
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
3. If it says Grill isn't set up, relay its steps. Never ask the user to paste their key into the chat.

**If you don't have the tool** (claude.ai on the web or phone, or no extension yet), use the paste route:
1. Fill in `paste-prompt.md` from this skill's folder with the approved subject and question.
   - Mask what the one-click route masks: email addresses become [email], phone numbers [phone], card numbers [card number].
   - Never include a key or token.
   - Suggest they turn on the app's private mode first, for example a Temporary Chat in ChatGPT.
2. Give it back as one block they can copy. If it is under 6,000 characters, also give an "Open in ChatGPT" link: `https://chatgpt.com/?q=` followed by the URL-encoded prompt. For Gemini or any other assistant, they paste it themselves.
3. Ask them to paste the judge's answer back here. That answer is the outside judge's; your own view is not.
4. Mention once that Claude Desktop with the Grill extension does this in one step: https://github.com/mtangoz/grill#set-up

## 4. Relay the result

- **Verdict first,** with its one-line reason.
- **The top challenges by severity,** each with its falsifier. Quote the judge; don't soften it or argue it into agreement.
- **Degradation:** if the report carries a warning banner (a clipped subject, a failed provider, a judge from an excluded family), say so plainly. "The judge found nothing" and "the judge couldn't see it" must never read the same.
- **Next steps:** ask which falsifier they'll adopt and whether their confidence moved. A changed confidence is a new, dated call; the original stays on the record.
- **Recording:** if they keep a decision log, record the verdict and the falsifier they adopt.
- **Your own view:** only if asked, labelled "same-model critique".

## 5. Offer to share a signal (opt-in, every time)

Grill improves under the same privacy controls as a grill: from a few shared choices, never from content. After they answer "worth engaging?", offer once: *"Want to help Grill get better? This shares only a few choices, no words from your decision."*

If they say yes, give them this link, filled in, to open and submit themselves:

`https://github.com/mtangoz/grill/issues/new?template=grill-signal.yml&event=rated&category=…&judge=…&verdict=…&rating=…&client=…`

- `category`: one of pricing, hiring, fundraising, product, timing, vendor, operations, personal, other.
- `judge`: the served model's family, which is the part before the `/`, such as openai, google, deepseek, meta, mistral, qwen, xai or moonshot. Use `other` for anything else, and `paste-route` for the paste route.
- `verdict`: holds, holds-with-conditions, weak or refuted.
- `rating`: yes or no.
- `client`: desktop, web, phone or code.

Never put anything else in the link. Tell them the issue is public. If they say no, drop it.
