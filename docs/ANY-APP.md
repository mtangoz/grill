# Grill in any app that runs MCP servers

This page covers Cursor, VS Code with Copilot, Codex, Gemini CLI, Windsurf, Zed, and any other app that runs a local MCP server. It works with your own OpenRouter key or a Grill Pro key. You need [Node.js](https://nodejs.org) 20 or later.

## 1. Save your key once

```bash
npx -y github:mtangoz/grill --set-key
```

Paste the key, press Enter, then Ctrl-D (on Windows: Ctrl-Z, then Enter). It goes to `~/.config/grill/key`, which only you can read. The configs below don't contain the key, so they're safe to share or commit. Every Grill on this computer reads the same file, including Claude Code's. Claude Code does not ask for the key, so save it before you install the plugin.

Check it any time: `npx -y github:mtangoz/grill --key-status`. It says where the key comes from without printing it.

Once the `grillyour` package is on npm, `npx -y grillyour --set-key` and `npx -y grillyour --key-status` are the same commands.

## 2. Add Grill to your app

Every app starts the same command, `npx -y github:mtangoz/grill`. Once `grillyour` is on npm, `npx -y grillyour` is the same command. Two optional settings go in `env`:

- `GRILL_AUTHOR`: the company of the AI you think with: `openai`, `google`, `xai`, `deepseek`. The judge is never from that company. Leave it out for Claude, which is the default. Leave it out in apps that switch between companies (Cursor, VS Code); the assistant states its own company on each call instead.
- `JUDGE_MODEL`: a pinned judge, from your Pro setup page. Leave it out for Grill's default, which picks a judge automatically from a different company.

**Cursor**: [one-click install](https://cursor.com/en/install-mcp?name=grill&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1YjptdGFuZ296L2dyaWxsIl19), or put this in `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "grill": { "command": "npx", "args": ["-y", "github:mtangoz/grill"] } } }
```

**VS Code with Copilot**: [one-click install](https://insiders.vscode.dev/redirect/mcp/install?name=grill&config=%7B%22name%22%3A%22grill%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22github%3Amtangoz%2Fgrill%22%5D%7D), or run **MCP: Open User Configuration** and add:

```json
{ "servers": { "grill": { "type": "stdio", "command": "npx", "args": ["-y", "github:mtangoz/grill"] } } }
```

**Codex** (CLI and IDE): add to `~/.codex/config.toml`:

```toml
[mcp_servers.grill]
command = "npx"
args = ["-y", "github:mtangoz/grill"]
env = { GRILL_AUTHOR = "openai" }
```

**Gemini CLI**: add to `~/.gemini/settings.json`:

```json
{ "mcpServers": { "grill": { "command": "npx", "args": ["-y", "github:mtangoz/grill"], "env": { "GRILL_AUTHOR": "google" } } } }
```

**Windsurf, Zed, or anything else**: add a stdio server named `grill` with command `npx` and args `-y github:mtangoz/grill`. Add `GRILL_AUTHOR` when the app runs only one company's models.

**A project shared by a team**: commit the config to the repository, for example `.cursor/mcp.json`, `.vscode/mcp.json` or `.mcp.json`. It holds no key. Each person runs `--set-key` once on their own machine.

## 3. Use it

Restart the app, then ask: *"Grill this: we're moving our launch to March. I'm 70% sure it gets us more signups."* The assistant writes the decision up and shows it to you. Grill sends it only after you approve.

## In a browser, or in claude.ai and Gemini

Those apps cannot start this local server. With an OpenRouter key, use [Grill in your browser](https://grillyour.ai/judge). Paste the key and the write-up there. The page calls OpenRouter from the browser. Grill does not receive either one ([PRIVACY.md](PRIVACY.md)). The copy-and-paste route in the [README](../README.md#chatgpt-copilot-gemini-grok-or-muse-no-install-no-key) still needs no key.

## Without the npm package

`npx -y github:mtangoz/grill` is the command above. It runs this repository and needs git. Nothing is installed, and no install script runs. When `grillyour` is published on npm, `npx -y grillyour` works the same way.
