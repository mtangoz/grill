#!/usr/bin/env node
/**
 * Stage the Claude Desktop extension: the manifest, the MCP server, the judge and the opt-in
 * usage ping, and nothing else.
 *
 *   node scripts/build-extension.mjs              # stages dist/extension/
 *   npx -y @anthropic-ai/mcpb pack dist/extension dist/grill.mcpb
 *
 * The staged tree keeps the repo's relative layout (server/ beside scripts/), because the server
 * finds the judge at ../scripts/judge.mjs. The release workflow runs both commands, then
 * scripts/build-smithery-bundle.mjs for the Smithery registry asset.
 *
 * The staged server's RELEASE_DATE is the build's UTC day, or GRILL_RELEASE_DATE. The checkout
 * is not rewritten.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stampReleaseDateFile } from "./releaseDate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "extension");
const FILES = ["manifest.json", "server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "scripts/reflection.mjs", "scripts/usageStats.mjs", "docs/PRIVACY.md", "LICENSE"];

rmSync(OUT, { recursive: true, force: true });
for (const file of FILES) {
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  cpSync(join(ROOT, file), join(OUT, file));
}
stampReleaseDateFile(join(OUT, "server/index.mjs"));
console.log(`staged ${FILES.length} files in dist/extension`);
