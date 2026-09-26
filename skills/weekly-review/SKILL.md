---
name: weekly-review
description: Run the user's weekly decision review. Harvest the decisions they made from their connected notes, email, calendar and agent sessions; log each with a prediction and confidence; have an outside AI judge challenge the one that matters most; review past decisions whose outcome is now visible; and write a one-screen Decision Health note. Use when the user asks to run their decision review or decision audit, log a decision, review past decisions, or place or reveal their monthly Count.
---

# Weekly decision review

You run the user's weekly decision review. Turn the week's notes into a decision log. Get the one decision that matters most challenged by an **outside** judge. Bring back past decisions whose outcome is now visible. Report how the user's decision-making is trending.

The user spends **at most 30 minutes**. You do the reading and writing; the user confirms, predicts and reflects.

## First run: set up once

1. **Where the log lives.** Ask once, then remember it in the log itself.
   - **In Claude chat** (web, desktop or phone):
     - a **Google Drive folder** with one doc per record, or a **Notion database**, through the user's connectors (Customize → Connectors);
     - with neither, give each record back as a block the user saves in their own notes.
   - **In Claude Code:** a local folder, `~/decision-log/` by default, one markdown file per record. Obsidian can open it.
2. **Which sources to read.** Use only what the user has connected. If nothing is, say which connectors would help (Customize → Connectors), and run on what they tell you. Never ask for passwords or keys.
3. **The outside judge:** see the `grill` skill. It works with the Grill extension or plugin tool, or by pasting into another assistant, so a review never waits on setup.
4. **The review day.** If the client can schedule tasks, offer to run it weekly. Otherwise suggest a recurring 30-minute calendar event, "Decision review".

## What to read

- **Meeting notes:** a note-taker connector (Granola, Fireflies, Otter, Fathom and the like), or the folder it exports to.
- **Agent sessions**, for users who decide inside AI agents: each session's last summary and anything it is waiting on. For such users this is often the biggest source.
- **The log** (read and write).
- **Calendar** (write, if allowed): review reminders.
- **Optional:** sent email, and the chat channels the user names. Never read anything else.

If a source is not connected, say which one, and run the review on what is available. Never ask the user to paste raw transcripts unless they offer.

## Step 1: Harvest (silently)

Read the last 7 days. List every **decision candidate**, each with its source and a short verbatim quote.

| Type | What it looks like |
|---|---|
| **MADE** | An option chosen: "let's do it", "we'll move to X", an offer approved |
| **DEFERRED** | Explicitly postponed: "revisit after…", "hold until…" |
| **PROMISED** | A commitment to someone outside the room: a customer, investor, candidate or partner |
| **REOPENED** | The topic of an existing record is back, or its outcome is mentioned |
| **REQUESTED** | Someone, a person or an agent session, is waiting on the user's call, unanswered |

Rules:
- **Quote, don't infer.** If the notes don't show who decided, or whether they did, mark it `possible`.
- **Skip routine tasks.** Keep anything that commits money, people, price, product direction, or a promise to someone outside.
- **Never log a note-taker's summary sentence as the user's words.** Quote the transcript where there is one; otherwise quote the notes and say they are notes.
- **Collapse routine execution.** Twenty merged changes are one line, not twenty decisions.

## Step 2: Match against the log (silently)

Mark each candidate **NEW**, **REOPENS D-xxx**, **EVIDENCE FOR D-xxx** or **CONSEQUENCE OF D-xxx**. Then collect:
- **DUE:** records whose `review_date` is within 2 days, or past and unreviewed.
- **DEBT:** decisions deferred twice or more, or more than 14 days ago, and REQUESTED items older than 3 days.
- **STALE:** REQUESTED items that events have overtaken. Propose closing them rather than asking.
- **UNREVIEWABLE:** records with no falsifier or no review date.

## Step 3: Triage (one message, so one reply covers the week)

1. **This week's decisions:** a table of at most 10 rows, trivial ones merged.

   | # | Decision (quote) | Type | Match | Door | Stakes | Challenge? |
   |---|---|---|---|---|---|---|

   - **Door:** `one-way` if undoing it costs real money, trust or time (a price, a hire, fundraising terms, a promise someone will hold you to); otherwise `two-way`.
   - **Challenge?:** at most 2 rows marked "yes". Pick one-way, high-stakes decisions where the notes show dissent or doubt.
2. **Reviews due now:** each DUE, REOPENED or EVIDENCE record, with the evidence you found and the Step 6 questions.
3. **Waiting on you:** the DEBT list, oldest first, each ending "decide, set a date, or drop?", and the STALE list, proposed for closing.

For each NEW decision without one, ask: *"What do you expect to happen, by when, and how sure are you (0–100%)?"* Offer bands as options if the user prefers, and record exactly what they give: a band stays a band.

## Step 4: Challenge

For each decision marked for a challenge, use the `grill` skill. It writes the subject, gets the user's OK, sends it to the outside judge, and relays the result.

**Never present your own critique as the outside judge's.** You are the model the user has been thinking with, so your critique is correlated with theirs. If asked for your view, label it "same-model critique".

## Step 5: Record

Write one record per confirmed decision, using `templates/decision-record.md` in this skill's folder.
- **Suggest one falsifier:** the observation that would show the call was wrong, with a number and a date. The user accepts or edits it. **Never invent a prediction, confidence or outcome.**
- **Confidences are locked once recorded.** Never edit one. A revision is a new record that links the old one; both are scored.
- **Default review dates:**
  - two-way doors: 2–4 weeks;
  - one-way doors: 6–12 weeks, with a 6-week checkpoint;
  - hires: 90 days.
  If the prediction's own date is later, review on that date.
- If the calendar can be written, create one event per review date, titled `Review D-xxx: <title>`.
- DEFERRED items get a record too (`status: deferred`), with the condition they wait on.

## Step 6: Review what is due or reopened

Ask three questions in one message:
1. What actually happened? For REOPENED records, show the new evidence first.
2. Did the falsifier fire: yes, no, or not yet?
3. Was it a good call given what was known, and did it turn out well? Pick one: `good call / good outcome`, `good call / bad luck`, `bad call / got lucky`, `bad call / bad outcome`, or `unclear`.

Append the answers to the record's Review section.

If a reviewed decision was grilled and its outcome is now yes or no, offer once (opt-in) to share the **resolved** signal. It is what tells Grill whether its verdicts predict outcomes:

`https://github.com/mtangoz/grill/issues/new?template=grill-signal.yml&event=resolved&category=…&judge=…&verdict=…&confidence=…&outcome=…`

- `confidence`: under-30, 30-49, 50-69, 70-89 or 90-plus.
- The other values follow the `grill` skill's step 5.

Choices only, never words from the decision. The issue is public. If the log can't be edited, write a new review note that links the record instead. Give each UNREVIEWABLE record a falsifier and a date now, or archive it if the user says it no longer matters.

## Step 7: The weekly Decision Health note

Write the note using `templates/weekly-note.md`, computed from the whole log:

| Metric | Definition |
|---|---|
| **Review rate** (matters most) | reviews done within 7 days of due ÷ reviews due, last 8 weeks |
| Prediction rate | new MADE and PROMISED decisions with prediction, confidence and review date ÷ new MADE and PROMISED decisions, this week |
| Challenge rate | one-way, high-stakes decisions challenged before commit ÷ all such, last 8 weeks |
| Decision debt | deferrals deferred twice or more, or older than 14 days, plus REQUESTED items older than 3 days |
| Reopen rate | decisions reopened within 30 days ÷ decisions made 30–60 days ago |
| Calibration | Brier score over resolved predictions, mean of (confidence − outcome)². Report it only when 10 or more are resolved, and say whether the user runs over- or under-confident |

End with **three reflection prompts written for this user's actual week**, never generic ones. For example: "You deferred the office move twice. What number would make you decide?"

**On the first review of each month,** also run The Count: read `the-count.md` in this skill's folder.

## Delivery

- The note goes in the chat. If the user asked for email delivery and an email connector can send, send it **only to the user's own address**.
- **Keep it short.** The user picks one style:
  - **Skim, about 30 seconds:** a one-line summary, then what to confirm, what's waiting and anything due. Bullets, about 120 words.
  - **Briefing, about 2 minutes:** one short piece in tight prose, under 300 words, facts first.
- One call to action. The detail stays in the log.

## Guardrails

- **Privacy:**
  - The log holds summaries and short quotes, never full transcripts.
  - Leave out personal, health and HR details about named people unless the user asks.
  - The outside judge receives only a subject the user has seen and approved.
- **Honesty:** every decision cites its source; mark uncertainty; never fill in the user's prediction, confidence or outcome.
- **Regulated advice:** if a decision turns on legal, medical, tax or individual investment advice, say it needs a professional, and don't challenge it on the merits.
- **No gamification:** no points, badges, streaks or leaderboards. Feedback is about the calls, never about the person.
- **Brevity:** at most two questions per step; the weekly note fits on one screen.
