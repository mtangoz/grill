# Bring your own connections

The weekly review reads the tools you already use, through connections **you** switch on. Grill ships no credentials and asks for none. Connect only what you want read.

## In Claude chat (web, desktop, phone)

Open **Customize → Connectors** and switch on what you use, for example:

| Connector | What the review gets from it |
|---|---|
| **Gmail** | Promises to customers, investors and candidates, from your sent mail especially |
| **Google Calendar** | Who you met, and review reminders |
| **Google Drive** or **Notion** | Your notes, and a home for your decision log |
| **Granola**, or your note-taker's connector | Meetings, where most decisions are made out loud |

If a tool you use has no connector, tell Claude what you decided and it works from that.

## In Claude Code

- **MCP servers:** add them with `claude mcp add …`, following each vendor's instructions. Check them with `/mcp`.
- **Local files** (an Obsidian vault, exported notes): no connector needed. Tell the review the folder's path.

## Where your log lives (pick one)

| Log | Setup |
|---|---|
| **A Google Drive folder** | Drive connector. One doc per record; records are write-once, so a revision is a new record and a review is a new note |
| **A Notion database** | Notion connector |
| **A local markdown folder** | Claude Code only: `~/decision-log/`, which Obsidian can open |
| **Your own notes** | No connector: Claude gives you each record to save |

If a source isn't connected, the review says which one and runs on what's there.
