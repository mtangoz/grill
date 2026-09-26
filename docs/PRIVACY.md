# Privacy: who can see your decision

**Short version:** Grill has no server, no account and no tracking. Your notes stay in your tools. The one thing that leaves your machine is the write-up you approve, and it goes only to the judge you chose.

## Who sees what

| Who | What they see | What stops more |
|---|---|---|
| **You** | Everything | — |
| **Claude** (Anthropic) | The conversation you're already having | Your Claude privacy settings |
| **OpenRouter**, one-click route | The approved write-up, in transit; request metadata (token counts, timing) | It stores no prompts unless you opt in (below). It samples a small number of prompts for anonymous categorization |
| **The judge's model provider** | The approved write-up, in transit | Grill routes **only** to zero-data-retention endpoints (`provider: { zdr: true, data_collection: "deny" }`), and never falls back to one that retains |
| **The app you paste into**, paste route | The approved write-up | That app's settings. Use its private mode, for example a Temporary Chat in ChatGPT |
| **Jev (TypeSafe)**, optional quality check | **Nothing unless you turn it on.** Then the masked write-up and the judge's report | A zero-data-retention endpoint, checked weekly; the check is dropped if any other endpoint answers |
| **Grill's maintainers** | **Nothing.** Only the choices you share, if you share them | There is nowhere for anything else to go |

## What Grill enforces in code

Each of these is pinned by a test, so it can't quietly stop being true.
- **Nothing leaves without your OK.** Claude shows you the write-up before anything is sent.
- **Keys and tokens never leave.** If the write-up, question or context contains anything shaped like an API key, token or private key, the run stops before any network call and says so. It never echoes the value.
- **Contact details are masked.** Email addresses, phone numbers and card numbers are replaced with `[email]`, `[phone]` and `[card number]` before sending. The report says how many, never what.
- **One destination.** The code you install makes exactly one kind of network call, to OpenRouter. It has no other network code and no third-party packages, so there is no hidden dependency to trust.
- **Quotes are checked locally.** Every quote a challenge attacks is checked against your write-up on your own machine, so a made-up objection is flagged. This sends nothing anywhere.
- **The Jev quality check is off by default.** Turned on, Jev scores whether the falsifiers are real tests and the verdict fits. The result is kept only if Jev's zero-retention endpoint answered.
- **Nothing stored.** The write-up reaches the judge through a pipe, never a file. The report's temporary copy is deleted once read.
- **Verifiable builds.** Each release is built by GitHub Actions from the tagged source, with a signed provenance attestation and checksums. You can confirm the extension is exactly this code.

## Two OpenRouter settings to check (one-click route)

Both are off by default. Keep them off:
1. **Input & Output Logging** (Observability settings). If you use it for other work, add your Grill key under **Excluded API Keys**.
2. **OpenRouter use of inputs/outputs** (Privacy settings), the 1% discount for letting OpenRouter use your data.

## Your key

- **Claude Desktop:** you paste it into the extension's install dialog, which masks it and stores it securely.
- **Claude Code:** the plugin asks for it and stores it securely, or reads `OPENROUTER_API_KEY` from your environment.
- **The paste route** needs no key.

The judge sends the key only to OpenRouter, in the `Authorization` header. It is never logged, never written to a file, and never asked for in chat.

## Your log

The weekly review keeps your decision log where you choose: a Google Drive folder, a Notion database, a local folder, or your own notes. It holds summaries and short quotes, never full transcripts, and leaves out personal, health and HR details about named people unless you ask.

## On your own computer

Claude Desktop may keep local logs of tool calls, including the write-up, on your computer. That is Claude's local logging, not Grill's.

## Helping Grill improve

Grill learns the way OpenRouter's router does: from aggregate choices, never from content ([LEARNING.md](../LEARNING.md)).
- **After a grill,** Claude may offer a link that pre-fills a public GitHub issue with a few choices: the kind of decision, the judge's model family, the verdict, whether it was worth engaging, and where you used Grill.
- **The form has no text boxes.** Grill's monthly report discards any issue edited to contain anything else.
- **You open the link and submit it yourself, or you don't.** It's off unless you choose it, every time.
