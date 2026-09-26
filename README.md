# 🔥 Grill

**A second opinion on your decisions, from an AI that isn't Claude.**

Say **"grill this"** in any Claude chat. Claude writes up your decision, and you check it. Then an outside judge, a model from a different company, argues the strongest case against it. It names the cheapest test that would settle each doubt, and gives a verdict.

> **Verdict: 🟠 WEAK.** The plan assumes customers stay at the new price, and nothing in it tests that.
> **Falsifier:** show the new price to one in ten new signups for two weeks, and compare how many start paying.

## Set up

### Claude Desktop (Mac or Windows): the one-click judge, 2 minutes

1. **Get a key.** Go to [openrouter.ai/keys](https://openrouter.ai/keys), sign in, click **Create key**, and add $5 of credit. A grill costs about a cent.
2. **Install Grill.** Download **[grill.mcpb](https://github.com/mtangoz/grill/releases/latest/download/grill.mcpb)** and double-click it, or drag it onto the Claude window. Paste your key when Claude asks. There's nothing else to install; Claude Desktop runs it.
3. **Try it.** In any chat, type:
   *Grill this: we're moving our launch to March. I'm 70% sure it gets us more signups.*

### claude.ai on the web or your phone: no key needed

1. Download **[grill-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/grill-skill.zip)**. In Claude, open **Customize → Skills**, upload it, and switch it on.
   To add everything at once instead, go to **Customize → Plugins → Add → Add marketplace** and enter `mtangoz/grill`.
2. Say *"grill this: …"*. Claude writes the judge's prompt. Tap **Open in ChatGPT**, or paste it into Gemini, then paste the answer back into Claude.

Want it in one step? Use Claude Desktop, above.

### Claude Code

```
/plugin marketplace add mtangoz/grill
/plugin install grill@grill
```

It asks for your OpenRouter key, or uses `OPENROUTER_API_KEY` if it's already set.

## The weekly review (optional)

Say **"run my weekly decision review"**. Claude reads the tools you've connected (**Customize → Connectors**: Gmail, Google Calendar, Google Drive, Notion, Granola and the like). Then it:
- lists the decisions you made this week;
- asks you to put a number on each: what you expect, by when, and how sure you are;
- grills the one that matters most;
- brings back the ones whose results are in.

Your log lives in a Google Drive folder or Notion database you choose. Once a month, you bet on how many of your calls will come true.

**Install:** upload [weekly-review-skill.zip](https://github.com/mtangoz/grill/releases/latest/download/weekly-review-skill.zip) the same way, or add the plugin.

## What it costs

| | Cost |
|---|---|
| Grill | Free |
| The one-click judge | Your own OpenRouter credit: about a cent a grill, so $5 lasts hundreds |
| The paste route | Free, on your ChatGPT or Gemini account |

## Privacy

- **Your notes stay in your tools.** Only the write-up you approve leaves:
  - on the one-click route, it goes to OpenRouter's zero-data-retention endpoints;
  - on the paste route, it goes to the assistant you paste it into, under that app's own settings.
- **Your key** is masked, stored by Claude, and sent only to OpenRouter.
- **Nothing else:** no servers, no accounts, no tracking.

Details: [docs/PRIVACY.md](docs/PRIVACY.md).

## Why not just ask Claude?

Claude helped you think it through, so its critique shares your blind spots. A judge from another company doesn't. Grill keeps Claude models out of the judging, and tells you if a run ever lands on one anyway.

The judge must argue your side before it attacks, quote the words it targets, and give every challenge a test that would settle it. A verdict of "holds" with no challenges is a real answer; it's told a made-up objection is worse than none.

## If something's off

| You see | It means |
|---|---|
| "Grill isn't set up yet" | Your key is missing. Claude Desktop: **Settings → Extensions → Grill** |
| "Still grilling (job …)" | Normal. Claude collects the report itself; it takes 1–3 minutes |
| A 402 or credit error | Add credit at [openrouter.ai/credits](https://openrouter.ai/credits) |
| A warning banner in the report | The judge couldn't see everything, for example a subject that was too long. The report says what |

## Develop

```bash
node --test scripts/*.test.mjs   # no network, no key
npm run build:extension          # dist/grill.mcpb
```

- **Layout:**
  - `skills/`: what Claude reads in chat;
  - `server/`: the Desktop extension's tool;
  - `scripts/judge.mjs`: the judge itself, which also runs on its own (`node scripts/judge.mjs --help`).
- **Release:** tag `vX.Y.Z` and the release workflow publishes the extension and the skill zips.
