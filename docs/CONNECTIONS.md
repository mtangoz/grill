# Bring your own connections

The review reads the tools you already use, through connections **you** set up in your Claude client. The plugin ships no credentials and asks for none. Connect only what you want read.

## Sources, by how much they usually yield

| Source | Why it matters | How to connect (examples) |
|---|---|---|
| **Meeting notes** | Most decisions are made out loud | Your note-taker's MCP connector (for example Granola), or the folder it exports to |
| **Agent sessions** | If you decide inside AI agents, this is often the biggest source | Point the review at recent sessions and their summaries |
| **Email, sent mail especially** | Promises to customers, investors and candidates | An email connector, read-only is enough |
| **Calendar** | Review reminders; who you met | A calendar connector; write access lets it add review events |
| **Chat channels** | Decisions made in threads | A chat connector, limited to the channels you name |

## Where your log lives (pick one)

| Log | Setup |
|---|---|
| **A local markdown folder** (default) | Nothing. Claude Code writes `~/decision-log/`, one file per record. Obsidian can open it as a vault |
| **Notion** | A Notion connector and one database |
| **Google Drive** | A Drive connector and one folder, with one doc per record. If your connector can't edit docs, records are write-once: a revision is a new record, and a review is a new note |

## Adding a connection in Claude Code

- **MCP servers:** add them with `claude mcp add …`, following each vendor's instructions. Check them with `/mcp`.
- **Local files** (an Obsidian vault, exported notes): no connector needed. Tell the review the folder's path.

If a source isn't connected, the review says which one and runs on what's there.
