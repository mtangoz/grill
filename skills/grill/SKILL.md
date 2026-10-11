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

## 1. Send the decision as stated

Send what the user already said, plus context already in the chat. Do not rewrite it into a template. Do not fill in blanks. Do not write your own case against into the subject.

Ask at most one short question, and only if the decision is truly unclear, such as "What's the goal?" Then send it. Do not wait for an OK.

The first time with this person, say once, in one or two sentences: the decision goes to an outside judge from a different company, through a router that does not keep it; a quality check (Jev, from TypeSafe) may see the same write-up and does not keep it; a grill costs about a cent. After that, do not say it again. Do not mention the check, its score, the judge's model, or a balance. If they ask to skip the check, call the tool with `quality_check: false` for this grill only.

Leave out names of people who aren't needed, and anything personal, health- or HR-related.

## 2. Send it

**If you have the `grill` tool** (from the Grill extension in Claude Desktop, or the plugin in Claude Code):
1. Call it with `subject` and `question`. If the subject came from another assistant, add `author`, for example `openai`, so that family is excluded too.
2. If it returns a job id, call `grill_result` with it until the note arrives, before you reply. Do not ask the user for a job id, and do not tell them how long it takes.
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

On the paste route, the company check above is the first line you show. Then show only the short note: one verdict line, any option they had not named, and at most two challenges, each with one cheap test. Do not show the steelman. A result from the `grill` tool already enforced a different company in code. Relay that note as written, and do not look for a Judge line. Do not show the judge's model, a score, a balance, a quote check, or a disclaimer.

Then exactly one line, and no second question:

Your call + confidence %? (e.g. 'delay, 70%')

If the note already ends with that line, do not add another.

- **Plain words, the same ones the website uses.** Say solid, solid if…, shaky or doesn't hold up. "Solid if" always comes with its conditions; never shorten it to "solid". Quote the judge; don't soften it: no "overall, the judge agrees with you".
- **Needs facts.** If the note says the input is too thin, show that. Do not turn it into a confident verdict.
- **The verdict never becomes the decision.** If the user asks "so should I do it?", or asks you to choose, hand the choice back and name the deciding test. Do not answer yes or no.
- **Pushback:** if the user disputes a challenge, don't settle it for them, and don't flip the verdict unless they bring new evidence.
- **Grilling again:** if the same decision is grilled again in this chat, ask one question: "What changed?" Show the earlier verdict beside the new one. If nothing changed, it is a re-run: no `supersedes` line and no `changed` line. If they say the choice changed, add `supersedes` as the earlier record's date and title, and `changed` as one of `evidence`, `goals`, `context` or `reweighed`, then their few words. Never invent them. Never send the earlier verdict to the judge.
- **A record only after they answer.** Pre-fill the prediction from what they already said. Take the choice and the confidence from that one reply. Follow `reflection.md`. If they never answer, write no record and set no look-back. Do not show the record before they answer, and do not explain the format.
- **Your own view:** only if asked, labelled "same-model critique".
- **Grill news:** The tool adds a line that starts with "Grill news:" only after a finished report, at most once a session, and only within 7 days of the release date in that build or on the first 3 days of a month. If the report includes that line, show it once, word for word, after the note and before the closing question. It is a statement. Do not turn it into a question, do not ask about it, and do not repeat it unless the user asks. Never ask for an email in the chat. The tool does not ask for, accept, or send an email. Outside those windows the report has no news line. Do not add one.

## 6. Look back

When they paste one or more decision record blocks and say "look back" or "grill look back", follow `reflection.md`. If the `grill_look_back` tool is available, call it and relay its one line: "You predicted X at 70%. What happened?" It needs no key and stores nothing. Without the tool, show the same one line and score the answer in the chat. When the record has a `decided` line, read it back in their words, and when the call is scored say whether that choice came true. When it has `supersedes`, say which earlier call it replaced. If that earlier record is not in the paste, say once: "If this replaced an earlier record, paste that too to see both." When `changed` says `reweighed`, say: "Nothing new came in; you weighed it differently." Do not write a `superseded-by` line. Work out which call replaced which only when both records are pasted. Do not add a checklist. Do not tell them they need an account, a decision log, or a connected inbox for this. The monthly Count is only the weekly review, and only when that log has enough calls.

## 5. Offer to share a signal (opt-in, every time)

Grill improves under the same privacy controls as a grill: from a few shared choices, never from content. After they answer "worth engaging?", offer once: *"Want to help Grill get better? This shares only a few choices, no words from your decision."*

If they say yes, give them this link, filled in, to open and submit themselves:

`https://github.com/mtangoz/grill/issues/new?template=grill-signal.yml&event=rated&category=…&judge=…&verdict=…&rating=…&client=…`

- `category`: one of pricing, hiring, fundraising, product, timing, vendor, operations, personal, other.
- `judge`: the served model's family, which is the part before the `/`, such as openai, google, deepseek, meta, mistral, qwen, xai or moonshot. Use `other` for anything else, and `paste-route` for the paste route.
- `verdict`: `solid`, `solid if`, `shaky`, or `doesn't hold up`, the same words as the verdict. In the link, encode a space as `%20` and the apostrophe as `%27`, so `solid if` is `solid%20if` and `doesn't hold up` is `doesn%27t%20hold%20up`.
- `rating`: yes or no.
- `client`: desktop, web, phone or code.

Never put anything else in the link. Tell them the issue is public. If they say no, drop it. One "no" means no more asks in this conversation, including the line below.

**Paste route only.** If you don't have the `grill` tool, and the user did not say no to the signal offer, then after the closing line and after the signal offer is settled, show this once, word for word. Do not elaborate, and do not ask a question about it. Skip it if they said no or stop. At most one invitation per grill. If the tool's report already ends with a Grill news line, show that line instead, and do not add this one as well.

> Grill news: saved decision history and look-back reminders are coming as an optional Pro plan. The free tool stays free. To hear when they arrive: https://grillyour.ai/notify?via=paste
