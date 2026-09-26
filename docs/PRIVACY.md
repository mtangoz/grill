# Privacy: where your data goes

**Short version:** your notes stay in your tools, and your log stays where you put it. One thing leaves your machine: the challenge subject you approve, sent to the outside judge.

## What stays put

- **Your notes, email and calendar** are read in place, through the connections you set up. Nothing is copied to a server. The plugin has none.
- **The log** holds summaries and short quotes, never full transcripts. It lives where you choose: a local folder, Notion, or Google Drive.
- **Personal, health and HR details** about named people are left out unless you ask for them.
- **No telemetry.** The plugin sends no analytics and no usage data.

## What leaves, and only with your OK

- **The subject.** When you challenge a decision, Claude writes a challenge subject and shows it to you. Only after you approve it does `scripts/judge.mjs` send it, with your key, to OpenRouter.
- **Zero-retention routing.** Every request asks OpenRouter to use only endpoints with a zero-data-retention policy (`provider: { zdr: true, data_collection: "deny" }`). If a model has no such endpoint, its request fails and the judge moves to the next model in its chain. It never falls back to a retaining endpoint.
- **Processing in transit.** OpenRouter and the model provider that serves the request process the subject to answer it. That's the one exposure. Keep names, numbers and details you wouldn't share out of the subject.
- **The report** is written to a temporary file on your machine and shown to you. Nothing is kept anywhere else.

## Your key

`OPENROUTER_API_KEY` stays in your environment. The judge sends it only to OpenRouter, in the `Authorization` header. It is never logged, never written to a file, and never put in the chat.
