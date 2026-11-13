# <img src="https://raw.githubusercontent.com/mtangoz/grill/main/site/brand/logo-256.png" alt="" width="40" height="40" align="top"> Grill: grill your AI before you send it to your boss

**Hear the strongest case against your plan, then decide for yourself.**

**Setup guide:** [grillyour.ai](https://grillyour.ai)
**No key needed:** Anyone can sign up and connect Grill to the AI they use at https://grillyour.ai/mcp.
**See it first:** [four made-up decisions, grilled](https://grillyour.ai/demo/)

Tell the assistant you think with, **"grill this"**: Claude, ChatGPT, Copilot, DeepSeek, Gemini, Grok or Muse. It sends the decision as you said it. An outside judge comes back with a short note: one verdict line, then one short line naming the question that would change the call when the judge named one, then the sharpest point and one cheap test when the judge named one. The verdict, the point and the test stay within about 50 words. The extra line is at most about 25 words, and it never comes before the verdict. Say more, options, or your call when you want the rest. After that closing line, a two-line run note names the models that answered and how long it took, then one sentence on privacy. Never drop the run note. Never put it before the verdict. A thin line gets a quick take and one question, not a refusal. A record is written only after you answer, and a percent is optional. Grill does not store it on the installed tool.

> **Verdict: shaky.** The plan assumes customers stay at the new price, and nothing in it tests that.
> **Falsifier:** show the new price to one in ten new signups for two weeks, and compare how many start paying.

## What Grill promises

The verdict never becomes the decision. You decide.
Your values and judgment calls are yours: each verdict lists what the judge checked for you separately from what is your call.
The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. When it cannot, the verdict says so.
Grill uses OpenRouter's Auto Router, and it does not pin models.
What leaves your machine is what your assistant puts in a Grill tool call: the decision and, at most, a few sentences of context. On copy and paste, nothing leaves until you paste it.
Every promise, and the code and test that enforce it: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).
What has been measured about the judge, and what has not: [grillyour.ai/how-we-test](https://grillyour.ai/how-we-test/).

## Set up

Claude Desktop and Claude Code enforce that in code. The copy-and-paste routes check it and warn you. Grill in chat enforces it for the apps it recognises. In Cursor, in an app Grill does not recognise, and on the installed tool when nothing names your assistant's company, the verdict ends with a line that starts "Independence not verified:". Who to paste into is in the table below.

When Grill is connected, most apps show a Grill tool call when it runs. If yours shows none and the answer still claims to be Grill's, Grill may not have run.

### Grill in chat

Anyone can sign up. The steps are at [grillyour.ai/start](https://grillyour.ai/start/?ref=readme). Use the same email each time, the email you signed up with, every time.

- **Claude.ai**, verified working. Works on the web, the desktop app and the phone app. The free plan allows only one custom connector. On a Team plan, an owner adds Grill, then each person signs in to Grill themselves. [Add Grill to Claude](https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Grill&connectorUrl=https%3A%2F%2Fgrillyour.ai%2Fmcp). Check the name says Grill and the URL says `https://grillyour.ai/mcp`, then Add and Connect, and sign in. Link didn't open? Customize → Connectors → Add custom connector and paste `https://grillyour.ai/mcp`. Asking Claude in a chat to connect it does not work.
- **ChatGPT**. On chatgpt.com, and in the desktop app where that is supported, in the same account or workspace where you add it. The iPhone and Android apps can't run custom connectors. Plugins → + → Add custom MCP server. Name Grill, server URL `https://grillyour.ai/mcp`, choose OAuth. Tick I understand and want to continue, then Create, then Install, and sign in.
- **Grok Bot**, verified working. Works on the desktop app and the phone app. Premium, Super and Ultra on The X Subscription include it. Check your X plan includes Grok Bot. Tell the bot `Add this MCP server: https://grillyour.ai/mcp`, then sign in when asked.
- **Gemini**: Copy and paste works today. No install, no key. The steps are under [ChatGPT, Copilot, DeepSeek, Gemini, Grok or Muse](#chatgpt-copilot-deepseek-gemini-grok-or-muse-no-install-no-key). Adding Grill as a connector inside Gemini is not verified. You can try it. For now, a personal Google account, in the US, 18 or over, in English, with Keep Activity on. On gemini.google.com: Settings, Connected Apps, Add a custom app, paste `https://grillyour.ai/mcp`, Next, then sign in.
- **Microsoft 365 Copilot.** To connect Grill in Microsoft 365 Copilot, an admin has to add it first. Copy and paste works without that. Consumer Copilot's documented connectors don't include custom servers, so use copy and paste.
- **Meta AI (Muse)**: Copy and paste works today. No install, no key. The same steps as Gemini, above. Adding Grill as a connector inside Muse is not verified. You can try the steps [below](#meta-ai-muse). Not yet verified end to end.

Setup for the owner is in [docs/HOSTED.md](docs/HOSTED.md).

### Claude Desktop (Mac or Windows): the one-click judge, about 2 minutes with a key, about 10 if you need one

1. **Get a key** for Grill's model router: go to [openrouter.ai/keys](https://openrouter.ai/keys), sign in, click **Create key**, and add credit.
2. **Install Grill.** Download **[grill.mcpb](https://github.com/mtangoz/grill/releases/latest/download/grill.mcpb)** and double-click it, or drag it onto the Claude window. Paste your key when Claude asks. There's nothing else to install; Claude Desktop runs it.
3. **Try it.** In any chat, type:
   *Grill this: we're moving our launch to March. I'm 70% sure it gets us more signups.*

The extension reads `GRILL_API_KEY`. `OPENROUTER_API_KEY` works when that is unset.

### claude.ai on the web or your phone: no key needed

1. Download **[grill-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/grill-skill.zip)**. In Claude, open **Customize → Skills**, upload it, and switch it on.
   To add everything at once instead, go to **Customize → Plugins → Add → Add marketplace** and enter `mtangoz/grill`.
2. Say *"grill this: …"*. Claude writes the judge's prompt. Tap **Open in ChatGPT**, or paste it into Gemini, then paste the answer back into Claude.

Want it in one step? Use Claude Desktop, above.

### ChatGPT, Copilot, DeepSeek, Gemini, Grok or Muse: no install, no key

1. Copy **[the Grill prompt](prompts/grill.md)** into the assistant you think with, and say what you're deciding.
2. It writes your decision up with you, then gives you a prompt for the judge.
3. Paste that into one of the judges the table names for your assistant, then paste the answer back.

| You think with | Judge with |
|---|---|
| ChatGPT | Claude, Gemini or Grok |
| Copilot | Gemini, because Copilot can run OpenAI, Anthropic or xAI models |
| DeepSeek | Claude, ChatGPT, Gemini or Grok |
| Gemini | Claude, ChatGPT or Grok |
| Grok or GrokBot | Claude, ChatGPT or Gemini |
| Muse | Claude, ChatGPT or Gemini |

### Meta AI (Muse)

You can try these steps. Adding Grill as a connector inside Muse is not verified.

1. In Muse, ask it to add a custom connector named Grill (Meta's help: custom connectors are created in chat; Settings → Connectors is for the built-in list).
2. URL: `https://grillyour.ai/mcp`. Transport: Streamable HTTP. Sign-in: OAuth.
3. If Muse asks for a Client ID, use `RNdHSHmWCRJO40vd`. Same for everyone. No secret.
4. Tap **Add**, then sign in with the same email you signed up with, every time. We email you a code; check spam if it isn't there in a minute.

### Cursor, VS Code, Codex, Gemini CLI, or any app that runs MCP servers

In Cursor, a desktop connection and a Cloud Agent connection are separate sign-ins. In Codex, check cloud authentication separately from the desktop app.

```bash
npx -y grillyour --set-key      # once: paste your key, Enter, then Ctrl-D
```

Then add a server named `grill` that runs `npx -y grillyour`. The config holds no key. Each app's config, and one-click installs for Cursor and VS Code, are in [docs/ANY-APP.md](docs/ANY-APP.md).

### Claude Code

```
/plugin marketplace add mtangoz/grill
/plugin install grill@grill
```

It asks for your model router key. Grill reads `GRILL_API_KEY` first. `OPENROUTER_API_KEY` works when that is unset. Or save the key once for every app on this computer with `npx -y grillyour --set-key`. It goes in `~/.config/grill/key`, outside any project's `.env`.

When Claude Code shows you a plan to approve, Grill adds one line, once a session: want an outside judge on this plan first? Keep planning and say "grill this plan". Claude Code hands the hook the plan, and the hook ignores it: it sends nothing and keeps nothing of the plan. To ask once, it keeps an empty marker file per session in the plugin's data folder, and removes markers older than two days the next time it runs. Turn it off with `GRILL_PLAN_OFFER=off`.

Claude Code's advisor (`/advisor`) has a stronger Claude look over the work. That is a second opinion from the same company. Grill's judge is from another one when Grill can tell which AI wrote the plan. Use both.

## What it costs

Grill is free. On your own key you pay the router. Copy and paste uses the assistants you already have.

Saved decisions and look-back reminders are free today with [Grill in your chat](https://grillyour.ai/start/?ref=readme). Paid plans are off. The free tool stays free and account-free.

## Privacy

- Your notes stay in your tools. What is sent is what your assistant puts in the Grill tool call: the decision and, at most, a few sentences of context. The reflection you write stays in your chat or your own notes.
- The free tool has no account. Grill's makers never see a decision from that tool unless you send that grill after a reaction. Anonymous usage stats are off unless you turn them on. An in-chat account is open to anyone who signs up; what it stores is in [docs/DATA-LEDGER.md](docs/DATA-LEDGER.md).
- A key, token or password in the write-up stops the run. Email addresses, phone numbers, card and bank numbers, ID numbers, labelled dates of birth, street addresses, postcodes and IP addresses are masked. Names are not. The full list is in [docs/PRIVACY.md](docs/PRIVACY.md).
- The quality check (Jev) is on by default and also sees the masked write-up. Its request carries no zero-retention flag. Say "skip the check" to skip it for one grill. On the installed tool you can also switch it off in Grill's settings. The website counts visits without cookies. /start sets no cookie while sign-up is open. When sign-up needs an invitation, a /start link with a source tag sets one cookie holding that tag for 30 days. Signing in sets sign-in cookies.
- Grill news line: until 13 November 2026, after a finished grill, at most once a session, and only within 7 days of a release or on the first 3 days of a month, the installed tool could show a line with a link to a launch list for a planned Pro plan. No paid plan is on sale. Showing the line sends nothing. Hide it with the "Show Grill news" setting, or `GRILL_NEWS=off`. It stops on its own after that date.
- Anonymous usage stats: off by default. One metadata ping to Grill's website after the first successful grill, and never again. Never the decision, the question, the verdict, or your key.

Where your decision goes on each route, and what is kept and for how long: [grillyour.ai/data-flow](https://grillyour.ai/data-flow/).

What we will and won't do with your data, and how we build: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).

### Turn anonymous usage stats on

Leave them off and the tool calls Grill only when you react to a grill (helped or meh). To opt in:

- **Claude Desktop:** in the install dialog, switch on "Send anonymous usage stats (optional)".
- **Claude Code:** `/plugin` → Configure options, the same switch.
- **stdio, npx or Docker:** set `GRILL_USAGE_STATS=on`.

Turn them off in the same place, or set `GRILL_PING=off`. `DO_NOT_TRACK=1` also disables the ping. The paste route does not send it.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Weekly review

Optional, in Claude, when you keep your own decision log: [docs/WEEKLY-REVIEW.md](docs/WEEKLY-REVIEW.md).

## License

MIT. See [LICENSE](LICENSE). The code that handles your decision stays MIT for good ([docs/PRINCIPLES.md](docs/PRINCIPLES.md#open-source)). The name and logo are not part of the license: [TRADEMARKS.md](TRADEMARKS.md).
