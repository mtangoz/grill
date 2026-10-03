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

You have usually helped reach this decision, and even when you haven't, a write-up in the user's own terms leans toward it. The judge tends to agree with whatever the write-up leans toward: that is the usual reason a grill comes back kinder than it should. Write as a clerk, not an advocate.

Ask only for what's missing, at most two questions, in this order. Stop after two.
1. What is being decided, and only if that is unclear.
2. The prediction and confidence. This one never yields. If there's none, ask: "What do you expect to happen, by when, and how sure are you?" A band stays a band. Never invent either.
3. Only if a slot is left, one combined question: "What are you trying to achieve, and is there anything this must not cost or break?" Skip it when both are already clear, or when the user says "just grill it".

Then write:
- **The decision,** and every option that was on the table, including "not now" or "keep things as they are" when that was one.
- **The reasons given,** in the user's words where you have them. Only reasons the user gave or agreed with; if one started with you, say so.
- **The prediction and confidence,** exactly as the user gave them.
- **Goal and guardrails,** in the user's words, on their own lines: `Goal:` and, when they named any, `Guardrails:`. If they decline, or say "just grill it" without naming a goal, write `Goal: not stated`. Never invent either. If one started with you and they agreed, mark it `(from the assistant)`.
- **The strongest case against,** written as its best advocate would put it, as long and as specific as the reasons for. Use any dissent you know of (a co-founder, a customer); if there's none, make the best case for the main alternative. State it and stop: don't answer it, not even with the user's answer. Their answer goes with their reasons, and the judge weighs both.
- **The facts that cut against it,** as well as the ones that support it: the number that looks bad, the time it went wrong before, what nobody knows yet.
- **Every number with its date,** read fresh where you can. The judge builds its case on the figures you give it.
- **A neutral question,** at most 300 characters, that never names a preferred answer:
  - name every option, not only the chosen one;
  - keep the reasons out of it: "to win back churned users" inside a question is a reason, not a question;
  - don't ask a question whose easy answer is the choice already made: "Should we…?", "Does it make sense to…?", or "How fast should we…?" when the real question is whether.

  A good default: "Between A and B, which do these facts support, and what would have to be true for the other to be the better call?" For a forecast, ask whether the confidence is too high, too low or about right, and for the earliest sign **in either direction**.

Then check the framing before you show it:
- **Report, don't grade.** Cut words that grade the evidence instead of stating it (clearly, obviously, strong, safe, a no-brainer), and any recommendation of your own.
- **The swap test.** Would someone who chose the other option sign this as a fair account? If not, fix it.

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
3. Give it back as one block they can copy. If it is under 6,000 characters, also give an "Open in ChatGPT" link: `https://chatgpt.com/?q=` followed by the URL-encoded prompt. For Gemini or any other assistant, they paste it themselves. Name the assistants they can paste it into: ChatGPT, Gemini or Grok. If they have an OpenRouter key, also give an Open in Grill link: `https://grillyour.ai/judge#text=` plus the URL-encoded approved write-up, then `&from=claude`. The write-up goes in the fragment, never the query string. Do not put their key in the link. They open it, paste the key once, and read the verdict there. Pasting the write-up into that page works the same way.
4. Ask them to paste the judge's answer back here. Your own view is not the judge.
5. Mention once that Claude Desktop with the Grill extension does this in one step: https://github.com/mtangoz/grill#set-up
6. If they have a Grill Pro setup that names a judge, paste into that assistant, and only if it is a different company from you. Do not put their managed key in the prompt.

When they paste the judge's answer back, compare companies before you relay the verdict. Read the opening line. It should be `Judge: <model name> by <company>`. Compare it with the maker you noted. Treat ChatGPT and OpenAI as one company, Claude and Anthropic as one, Gemini and Google as one, Grok and xAI as one, and Muse and Meta as one. Copilot can run OpenAI, Anthropic or xAI models, so only Gemini counts as a different company (a line that names Gemini or Google). You are Claude, so the assistants to paste into instead are ChatGPT, Gemini or Grok. If you cannot tell the company, treat the line as missing.

- If the companies differ, the first line you show is `Judge: X by Y. Different company from your assistant ✓`, with X and Y from the judge's line.
- If the companies match, the first line you show is `Warning: this verdict is NOT independent. The judge is the same company as your assistant. Paste the judge prompt into ChatGPT, Gemini or Grok instead.`
- If the Judge line is missing, the first line you show is `Warning: this verdict is unverified. The answer has no Judge line, so this is not a confirmed outside judge. Paste the judge prompt into ChatGPT, Gemini or Grok instead.`

## 4. Relay the result

On the paste route, the company check above is the first line you show. A result from the `grill` tool already enforced a different company in code; relay that report as written, and do not look for a Judge line.

You're the model the user has been thinking with, so the way you relay the verdict can undo it.
- **Plain words, the same ones the website uses.** Say solid, solid if…, shaky or doesn't hold up for the four verdicts (holds, holds-with-conditions, weak, refuted). Call a challenge a weak spot and a falsifier a quick check. Change the words, never the substance.
- **Verdict first,** with its one-line reason. "Solid if" always comes with its conditions; never shorten it to "solid". If the report says the verdict doesn't match the challenges, say that too. On the paste route the verdict comes after the company-check line.
- **The top challenges by severity,** each with its falsifier. Quote the judge; don't soften it or argue it into agreement. Add nothing that takes the edge off: no "overall, the judge agrees with you", no rebuttal beside a challenge, and no leading with the steelman when the verdict is shaky or doesn't hold up.
- **Degradation:** if the report carries a warning banner (a clipped subject, a failed provider, a judge from an excluded family), say so plainly. "The judge found nothing" and "the judge couldn't see it" must never read the same.
- **Pushback:** if the user disputes a challenge, don't settle it for them, or for the judge. Its quick check settles it.
- **Grilling again:** a second grill of the same decision may add facts, never drop them or soften the framing. Say what changed; the first verdict stays on the record.
- **Next steps:** the report's own "Before you decide" section, when the tool included one. Show it. Do not add a second copy, and do not send it to the judge. It asks which falsifier they'll adopt and whether their confidence moved. A changed confidence is a new, dated call; the original stays on the record.
- **Paste route:** after the company-check line, the verdict and the challenges, add the section in `reflection.md`. Fill the decision record from the judge. Leave confidence empty if they never gave one. Copy `goal` and `guardrails` from the subject only when they have a value. Add `source_app` yourself, for the assistant you are. The grill tool does not add it.
- **Recording:** the record block is theirs to copy anywhere. If they also keep a decision log, record the verdict and the falsifier they adopt, in the longer weekly-review template. Grill does not store the block.
- **Your own view:** only if asked, labelled "same-model critique".
- **Grill news:** The tool adds a line that starts with "Grill news:" only after a finished report, at most once a session, and only within 7 days of the release date in that build or on the first 3 days of a month. If the report ends with that line, show it once, word for word, at the very end, after the decision record. It is a statement. Do not turn it into a question, do not ask about it, and do not repeat it unless the user asks. Never ask for an email in the chat. The tool does not ask for, accept, or send an email. Outside those windows the report has no news line. Do not add one.

## 6. Look back

When they paste one or more decision record blocks and say "look back" or "grill look back", follow `reflection.md`. If the `grill_look_back` tool is available, call it and relay the result. It needs no key and stores nothing. Without the tool, ask what happened and score the calls in the chat, using the same rules. When the record has a goal, also ask "Did you reach the goal? Yes, no or partly." When it has guardrails, also ask "Did your guardrails hold? Yes or no." Do not tell them they need an account, a decision log, or a connected inbox for this. The monthly Count is only the weekly review, and only when that log has enough calls.

## 5. Offer to share a signal (opt-in, every time)

Grill improves under the same privacy controls as a grill: from a few shared choices, never from content. After they answer "worth engaging?", offer once: *"Want to help Grill get better? This shares only a few choices, no words from your decision."*

If they say yes, give them this link, filled in, to open and submit themselves:

`https://github.com/mtangoz/grill/issues/new?template=grill-signal.yml&event=rated&category=…&judge=…&verdict=…&rating=…&client=…`

- `category`: one of pricing, hiring, fundraising, product, timing, vendor, operations, personal, other.
- `judge`: the served model's family, which is the part before the `/`, such as openai, google, deepseek, meta, mistral, qwen, xai or moonshot. Use `other` for anything else, and `paste-route` for the paste route.
- `verdict`: holds, holds-with-conditions, weak or refuted. Plain words map back as solid → holds, solid if → holds-with-conditions, shaky → weak, doesn't hold up → refuted.
- `rating`: yes or no.
- `client`: desktop, web, phone or code.

Never put anything else in the link. Tell them the issue is public. If they say no, drop it. One "no" means no more asks in this conversation, including the line below.

**Paste route only.** If you don't have the `grill` tool, and the user did not say no to the signal offer, then after "Before you decide" and after the signal offer is settled, show this once, word for word. Do not elaborate, and do not ask a question about it. Skip it if they said no or stop. At most one invitation per grill. If the tool's report already ends with a Grill news line, show that line instead, and do not add this one as well.

> Grill news: saved decision history and look-back reminders are coming as an optional Pro plan. The free tool stays free. To hear when they arrive: https://grillyour.ai/notify?via=paste
