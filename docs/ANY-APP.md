# Grill in any app that runs MCP servers

This page covers Cursor, VS Code with Copilot, Codex, Gemini CLI, Windsurf, Zed, and any other app that runs a local MCP server. It works with your own OpenRouter key or a Grill Pro key. You need [Node.js](https://nodejs.org) 20 or later.

## 1. Save your key once

```bash
npx -y grillyour --set-key
```

Paste the key, press Enter, then Ctrl-D (on Windows: Ctrl-Z, then Enter). It goes to `~/.config/grill/key`, which only you can read. The configs below don't contain the key, so they're safe to share or commit. Every Grill on this computer reads the same file, including Claude Code's.

Check it any time: `npx -y grillyour --key-status`. It says where the key comes from without printing it.

## 2. Add Grill to your app

Every app starts the same command, `npx -y grillyour`. Two optional settings go in `env`:

- `GRILL_AUTHOR`: the company of the AI you think with, for example `openai`, `google`, `x-ai` or `deepseek`. Grill tells the router to leave that company's models out, checks the model that answered, and gives no verdict if it came from that company. Common names such as `xai`, `grok`, `gemini`, `chatgpt` and `claude` are understood. `none`, or a name Grill does not know as a model company, is ignored. Grill also reads the app's name when it connects. An app that names itself Claude, ChatGPT, Grok or Gemini is recognised without the setting. Leave it out in apps that switch between companies (Cursor, VS Code). There the assistant should name its own company on each call.
- `JUDGE_MODEL`: a pinned judge, from your Pro setup page. Leave it out for Grill's default: the router picks the judge, and Grill leaves out the company that wrote the write-up when it can tell which that is.

When nothing names a company, Grill cannot tell who wrote the write-up. It rules out Anthropic only, and the verdict ends with one line that starts "Independence not verified:". Set `GRILL_AUTHOR` when the app runs one company's models, or have the assistant name its company on the call, and the line goes away.

**Cursor**: [one-click install](https://cursor.com/en/install-mcp?name=grill&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdyaWxseW91ciJdfQ==), or put this in `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "grill": { "command": "npx", "args": ["-y", "grillyour"] } } }
```

**VS Code with Copilot**: [one-click install](https://insiders.vscode.dev/redirect/mcp/install?name=grill&config=%7B%22name%22%3A%22grill%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22grillyour%22%5D%7D), or run **MCP: Open User Configuration** and add:

```json
{ "servers": { "grill": { "type": "stdio", "command": "npx", "args": ["-y", "grillyour"] } } }
```

**Codex** (CLI and IDE): add to `~/.codex/config.toml`:

```toml
[mcp_servers.grill]
command = "npx"
args = ["-y", "grillyour"]
env = { GRILL_AUTHOR = "openai" }
```

**Gemini CLI**: add to `~/.gemini/settings.json`:

```json
{ "mcpServers": { "grill": { "command": "npx", "args": ["-y", "grillyour"], "env": { "GRILL_AUTHOR": "google" } } } }
```

**Windsurf, Zed, or anything else**: add a stdio server named `grill` with command `npx` and args `-y grillyour`. Add `GRILL_AUTHOR` when the app runs only one company's models.

**A project shared by a team**: commit the config to the repository, for example `.cursor/mcp.json`, `.vscode/mcp.json` or `.mcp.json`. It holds no key. Each person runs `--set-key` once on their own machine.

## 3. Use it

Restart the app, then ask: *"Grill this: we're moving our launch to March. I'm 70% sure it gets us more signups."* The assistant writes the decision up and shows it to you. Grill sends it only after you approve.

## ChatGPT and claude.ai in a browser

Use the hosted connector: [https://grillyour.ai/mcp](https://grillyour.ai/mcp). Steps for each app are in the [README](../README.md#grill-in-chat).

## Without npm

`npx -y github:mtangoz/grill` runs the same code straight from this repository. Nothing is installed, and no install script runs.
