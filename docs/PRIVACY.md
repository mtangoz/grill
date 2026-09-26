# Privacy: who can see your decision

**Short version:** Grill has no account and no tracking, and never sees a decision. The only server is the small one that sells Grill Pro, and it never handles a write-up. Your notes stay in your tools. The one thing that leaves your machine is the write-up you approve, and it goes only to the judge you chose.

## Who sees what

| Who | What they see | What stops more |
|---|---|---|
| **You** | Everything | — |
| **Claude** (Anthropic) | The conversation you're already having | Your Claude privacy settings |
| **The model router** (OpenRouter), one-click route | The approved write-up, in transit; request metadata (token counts, timing) | It stores no prompts unless you opt in (below). It samples a small number of prompts for anonymous categorization |
| **The judge's model provider** | The approved write-up, in transit | Grill routes **only** to zero-data-retention endpoints (`provider: { zdr: true, data_collection: "deny" }`), and never falls back to one that retains |
| **The app you paste into**, paste route | The approved write-up | That app's settings. Use its private mode, for example a Temporary Chat in ChatGPT |
| **Jev (TypeSafe)**, quality check, on by default | The masked write-up and the judge's report | A zero-data-retention endpoint, checked weekly; the check is dropped if any other endpoint answers |
| **Grill's maintainers** | **Nothing.** Only the choices you share, if you share them. With Pro, also your billing details and your key's usage, as below | There is nowhere for anything else to go |
| **Stripe**, Grill Pro only | Your email, card and billing address | Stripe's own privacy policy. Grill never sees your card |
| **Grill's Pro server**, Grill Pro only | Your checkout and your subscription's status | It runs only when you buy and when your subscription changes. Write-ups never pass through it |
| **Grill's router account**, Grill Pro only | Your key's usage: cost, model and time of each check, never the text | Logging is off and every request is zero-retention, account-wide |

## What Grill enforces in code

Each of these is pinned by a test, so it can't quietly stop being true.
- **Nothing leaves without your OK.** Claude shows you the write-up before anything is sent.
- **Keys and tokens never leave.** If the write-up, question or context contains anything shaped like an API key, token or private key, the run stops before any network call and says so. It never echoes the value.
- **Contact details are masked.** Email addresses, phone numbers and card numbers are replaced with `[email]`, `[phone]` and `[card number]` before sending. The report says how many, never what.
- **One destination.** The code you install makes exactly one kind of network call, to the model router. It has no other network code and no third-party packages, so there is no hidden dependency to trust.
- **Quotes are checked locally.** Every quote a challenge attacks is checked against your write-up on your own machine, so a made-up objection is flagged. This sends nothing anywhere.
- **The Jev quality check is on by default.** Jev scores whether the falsifiers are real tests and the verdict fits. Claude tells you before each grill that Jev will see it. Skip it for one grill by saying so, or switch it off in Grill's settings to send the write-up to the judge only. The result is kept only if Jev's zero-retention endpoint answered.
- **Nothing stored.** The write-up reaches the judge through a pipe, never a file. The report's temporary copy is deleted once read.
- **Verifiable builds.** Each release is built by GitHub Actions from the tagged source, with a signed provenance attestation and checksums. You can confirm the extension is exactly this code.

## Two router settings to check (one-click route)

Both are off by default. Keep them off:
1. **Input & Output Logging** (Observability settings). If you use it for other work, add your Grill key under **Excluded API Keys**.
2. **Use of inputs/outputs** (Privacy settings), the 1% discount for letting the router use your data.

## Grill Pro

Pro changes who pays for the AI, not where your write-up goes.
- **Your write-ups still go straight** from your Claude to the router, using your Pro key. They never pass through Grill's server.
- **Your Pro key comes from Grill's router account.** That account is set to zero-data-retention endpoints only, with logging off, for every key.
- **What Grill keeps for Pro:**
  - your email and subscription, in Stripe;
  - a record of which key is yours, stored on your Stripe customer;
  - each key's usage in the router account (cost, model and time of each check, never the text).
- **The key is shown to you once** and stored nowhere. If you lose it, we switch it off and give you a new one.

## Your key

- **Claude Desktop:** you paste it into the extension's install dialog, which masks it and stores it securely.
- **Claude Code:** the plugin asks for it and stores it securely, or reads `OPENROUTER_API_KEY` from your environment.
- **The paste route** needs no key.

The judge sends the key only to the model router, in the `Authorization` header. It is never logged, never written to a file, and never asked for in chat.

## Your log

The weekly review keeps your decision log where you choose: a Google Drive folder, a Notion database, a local folder, or your own notes. It holds summaries and short quotes, never full transcripts, and leaves out personal, health and HR details about named people unless you ask.

## On your own computer

Claude Desktop may keep local logs of tool calls, including the write-up, on your computer. That is Claude's local logging, not Grill's.

## Helping Grill improve

Grill improves under the same privacy controls as a grill: masked text, zero-retention routing, nothing kept, and never a real decision ([LEARNING.md](../LEARNING.md)).
- **After a grill,** Claude may offer a link that pre-fills a public GitHub issue with a few choices: the kind of decision, the judge's model family, the verdict, whether it was worth engaging, and where you used Grill.
- **The form has no text boxes.** Grill's monthly report discards any issue edited to contain anything else.
- **You open the link and submit it yourself, or you don't.** It's off unless you choose it, every time.
