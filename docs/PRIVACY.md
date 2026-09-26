# Privacy: where your data goes

**Short version:** your notes stay in your tools, and your log stays where you put it. One thing leaves your machine: the challenge subject you approve, sent to the outside judge.

## What stays put

- **Your notes, email and calendar** are read in place, through the connections you set up. Nothing is copied to a server. The plugin has none.
- **The log** holds summaries and short quotes, never full transcripts. It lives where you choose: a local folder, Notion, or Google Drive.
- **Personal, health and HR details** about named people are left out unless you ask for them.
- **No telemetry.** The plugin sends no analytics and no usage data.

## What leaves, and only with your OK

- **The subject.** When you grill a decision, Claude writes it up and shows it to you. Nothing leaves until you approve it. Then it goes one of two ways:
  - **One-click route** (the Claude Desktop extension, or the plugin in Claude Code): the judge sends it, with your key, to OpenRouter.
  - **Paste route** (claude.ai web or phone): you paste it into another assistant yourself. That app's own data settings apply; ChatGPT, for example, may use chats for training unless you've turned that off.
- **Zero-retention routing.** Every request asks OpenRouter to use only endpoints with a zero-data-retention policy (`provider: { zdr: true, data_collection: "deny" }`). If a model has no such endpoint, its request fails and the judge moves to the next model in its chain. It never falls back to a retaining endpoint.
- **Processing in transit.** OpenRouter and the model provider that serves the request process the subject to answer it. That's the one exposure. Keep names, numbers and details you wouldn't share out of the subject.
- **The report** comes back to your chat. The extension's temporary copy is deleted as soon as it's read.

## Your key

- **Claude Desktop:** you paste the key into the extension's install dialog. Claude Desktop masks it and stores it securely.
- **Claude Code:** the plugin asks for it and stores it securely, or reads `OPENROUTER_API_KEY` from your environment.
- **The paste route** uses no key.

The judge sends the key only to OpenRouter, in the `Authorization` header. It is never logged, never written to a file, never returned to the chat, and never asked for in chat.
