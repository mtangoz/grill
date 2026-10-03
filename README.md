# 🔥 Grill

**Hear the strongest case against your plan, then decide for yourself.**

**Setup guide:** [grillyour.ai](https://grillyour.ai)

Tell the assistant you think with, **"grill this"**: Claude, ChatGPT, Copilot, Gemini, Grok or Muse. It writes up your decision, and you check it. Then an outside judge, a model from a different company, argues the strongest case against it. It names the cheapest test that would settle each doubt, and gives a verdict. Before you decide, you write what you expect, how sure you are, and what would prove you wrong. You can look back later from a record you keep. Grill does not store it.

> **Verdict: shaky.** The plan assumes customers stay at the new price, and nothing in it tests that.
> **Falsifier:** show the new price to one in ten new signups for two weeks, and compare how many start paying.

## Set up

Claude Desktop and Claude Code enforce that in code. The copy-and-paste routes check it and warn you. Who to paste into is in the table below.

### Claude Desktop (Mac or Windows): the one-click judge, about 2 minutes with a key, about 10 if you need one

1. **Get a key** for Grill's model router: go to [openrouter.ai/keys](https://openrouter.ai/keys), sign in, click **Create key**, and add $5 of credit. A grill costs about a cent or two.
2. **Install Grill.** Download **[grill.mcpb](https://github.com/mtangoz/grill/releases/latest/download/grill.mcpb)** and double-click it, or drag it onto the Claude window. Paste your key when Claude asks. There's nothing else to install; Claude Desktop runs it.
3. **Try it.** In any chat, type:
   *Grill this: we're moving our launch to March. I'm 70% sure it gets us more signups.*

The extension reads `GRILL_API_KEY`. `OPENROUTER_API_KEY` works when that is unset.

### claude.ai on the web or your phone: no key needed

1. Download **[grill-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/grill-skill.zip)**. In Claude, open **Customize → Skills**, upload it, and switch it on.
   To add everything at once instead, go to **Customize → Plugins → Add → Add marketplace** and enter `mtangoz/grill`.
2. Say *"grill this: …"*. Claude writes the judge's prompt. Tap **Open in ChatGPT**, or paste it into Gemini, then paste the answer back into Claude.

Want it in one step? Use Claude Desktop, above.

### ChatGPT, Copilot, Gemini, Grok or Muse: no install, no key

1. Copy **[the Grill prompt](prompts/grill.md)** into the assistant you think with, and say what you're deciding.
2. It writes your decision up with you, then gives you a prompt for the judge.
3. Paste that into an assistant from a **different company**, then paste the answer back.

| You think with | Judge with |
|---|---|
| ChatGPT | Claude, Gemini or Grok |
| Copilot | Gemini, because Copilot can run OpenAI, Anthropic or xAI models |
| Gemini | Claude, ChatGPT or Grok |
| Grok or GrokBot | Claude, ChatGPT or Gemini |
| Muse | Claude, ChatGPT or Gemini |

### Cursor, VS Code, Codex, Gemini CLI, or any app that runs MCP servers

```bash
npx -y grillyour --set-key      # once: paste your key, Enter, then Ctrl-D
```

Then add a server named `grill` that runs `npx -y grillyour`. The config holds no key. Each app's config, and one-click installs for Cursor and VS Code, are in [docs/ANY-APP.md](docs/ANY-APP.md). A Grill Pro key works here too.

### Claude Code

```
/plugin marketplace add mtangoz/grill
/plugin install grill@grill
```

It asks for your model router key. Grill reads `GRILL_API_KEY` first. `OPENROUTER_API_KEY` works when that is unset. Or save the key once for every app on this computer with `npx -y grillyour --set-key`. It goes in `~/.config/grill/key`, outside any project's `.env`.

## What it costs

Grill is free. On your own key a grill costs about a cent or two. Copy and paste uses the assistants you already have.

Coming later: an optional Pro plan with saved decision history and look-back reminders. The free tool stays free and account-free. [Hear when it's ready](https://grillyour.ai/notify?via=site).

## Privacy

- Your notes stay in your tools. Only the write-up you approve is sent. The reflection you write stays in your chat or your own notes.
- The free tool has no account. Grill's makers never see your decisions. Anonymous usage stats are off unless you turn them on.
- A key or token in the write-up stops the run. Email addresses, phone numbers and card numbers are masked.
- The optional quality check (Jev) also sees the masked write-up; the website counts visits without cookies.
- Grill news line: after a finished grill, at most once a session, and only within 7 days of a release or on the first 3 days of a month, a line with a link to hear when an optional Pro plan is ready. Showing the line sends nothing. Hide it with the "Show Grill news" setting, or `GRILL_NEWS=off`. It stops on its own.
- Anonymous usage stats: off by default. One metadata ping to Grill's website after the first successful grill, and never again. Never the decision, the question, the verdict, or your key.

What we will and won't do with your data, and how we build: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).

### Turn anonymous usage stats on

Leave them off and the tool does not call Grill. To opt in:

- **Claude Desktop:** in the install dialog, switch on "Send anonymous usage stats (optional)".
- **Claude Code:** `/plugin` → Configure options, the same switch.
- **Smithery:** the install form, the same switch.
- **stdio, npx or Docker:** set `GRILL_USAGE_STATS=on`.

Turn them off in the same place, or set `GRILL_PING=off`. `DO_NOT_TRACK=1` also disables the ping. The paste route does not send it.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Weekly review

Optional, in Claude, when you keep your own decision log: [docs/WEEKLY-REVIEW.md](docs/WEEKLY-REVIEW.md).

## License

MIT. See [LICENSE](LICENSE).
