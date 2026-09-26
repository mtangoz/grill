#!/usr/bin/env node
/**
 * Stage the Claude Desktop extension: the manifest, the MCP server and the judge, and nothing else.
 *
 *   node scripts/build-extension.mjs              # stages dist/extension/
 *   npx -y @anthropic-ai/mcpb pack dist/extension dist/grill.mcpb
 *
 * The staged tree keeps the repo's relative layout (server/ beside scripts/), because the server
 * finds the judge at ../scripts/judge.mjs. The release workflow runs both commands.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "extension");
const FILES = ["manifest.json", "server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "docs/PRIVACY.md", "LICENSE"];

rmSync(OUT, { recursive: true, force: true });
for (const file of FILES) {
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  cpSync(join(ROOT, file), join(OUT, file));
}
console.log(`staged ${FILES.length} files in dist/extension`);
