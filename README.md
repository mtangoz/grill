# Decision Audit

A weekly decision review for founders and operators, as a Claude Code plugin.

Once a week, Claude reads your own notes, calendar and email, and lists the decisions you made. You put a number on each: what you expect, by when, and how sure you are. The decision that matters most goes to an **outside judge**, a model from a different company, which argues the strongest case against you and names the cheap tests that would settle it. When a decision's review date comes, you see what happened. Once a month you bet on how many of your calls will come true.

It's a practice, not an app. There's no server, account or database. Everything runs in your own Claude, with **your own keys and your own connections**.

## What you bring

| | What | Why |
|---|---|---|
| **Client** | [Claude Code](https://code.claude.com) | Runs the plugin |
| **Connections** | Whatever you already use: a note-taker, calendar, email, notes app, Notion, an Obsidian vault | Where your decisions are. See [docs/CONNECTIONS.md](docs/CONNECTIONS.md) |
| **Key** | Your own [OpenRouter](https://openrouter.ai) API key | Pays for the outside judge, about a cent a challenge |
| **Runtime** | Node.js 20 or later | Runs the judge script (no npm install) |

## Install

In Claude Code:

```
/plugin marketplace add mtangoz/decision-audit
/plugin install decision-audit@decision-audit
```

## Bring your own key

The judge reads `OPENROUTER_API_KEY` from the environment Claude Code runs in. Set it in either of two places:

- **your shell profile:** `export OPENROUTER_API_KEY=sk-or-...`
- **Claude Code's settings,** `~/.claude/settings.json`:

  ```json
  { "env": { "OPENROUTER_API_KEY": "sk-or-..." } }
  ```

Never paste the key into a chat. The review works without a key; only the challenge needs one.

## Use

| Command | What it does |
|---|---|
| `/decision-audit:weekly-review` | The weekly ritual: harvest, triage, challenge, record, review, and a one-screen Decision Health note. The first run asks where your log lives |
| `/decision-audit:challenge` | Challenge one decision or forecast now |

You can also just ask: "run my decision review", or "have an outside model challenge this plan".

## How the judge works

- **A different family.** The judge excludes Anthropic models, because Claude helped write the subject. A judge from the same family as the reasoning it checks adds little. If the subject came from another assistant, pass `--author <family>` to exclude that family too.
- **A forced structure.** The judge must write:
  - a steelman of your case, then a counter-steelman;
  - challenges, each with a severity, a kind, what would have to be true, and a **falsifier**;
  - a verdict: `holds`, `holds-with-conditions`, `weak` or `refuted`.
- **Honest failure.** If the subject was clipped, a provider failed, or the answering model turned out to be from an excluded family, the report says so in a banner. "Found nothing" and "couldn't see" never render the same.
- **Privacy by default.** Every request goes to OpenRouter's zero-data-retention endpoints only (`provider.zdr`). OpenRouter and the model provider still process the subject in transit. See [docs/PRIVACY.md](docs/PRIVACY.md).

The judge also runs on its own:

```bash
node scripts/judge.mjs --file decision.md --question "Which way, and on what grounds?" --out report.md
node scripts/judge.mjs --help
```

## What it never does

- **No streaks, points or badges.** Feedback is about the calls, never about you.
- **It never fills in your prediction, confidence or outcome.**
- **It never edits a recorded confidence.** A change of mind is a new record, and both are scored.
- **Nothing is sent anywhere** except the one subject you approve, to the judge.

## Develop

```bash
node --test scripts/*.test.mjs
```

Tests need no network and no key. CI runs them on Node 20 and 22.
