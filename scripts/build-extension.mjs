#!/usr/bin/env node
/**
 * Stage the Claude Desktop extension: the manifest, the MCP server and the judge, and nothing else.
 *
 *   node scripts/build-extension.mjs              # stages dist/extension/
 *   node scripts/validate-manifest.mjs dist/extension/manifest.json
 *   node scripts/pack-extension.mjs dist/grill.mcpb
 *
 * The staged tree keeps the repo's relative layout (server/ beside scripts/), because the server
 * finds the judge at ../scripts/judge.mjs. The release workflow runs these commands. `mcpb pack`
 * refuses a tool inputSchema, so the archive is zipped directly and the validator runs on a copy
 * with that field removed. The staged manifest keeps the schemas.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "extension");
const FILES = ["manifest.json", "server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "scripts/reflection.mjs", "docs/PRIVACY.md", "LICENSE"];

rmSync(OUT, { recursive: true, force: true });
for (const file of FILES) {
  mkdirSync(dirname(join(OUT, file)), { recursive: true });
  cpSync(join(ROOT, file), join(OUT, file));
}
console.log(`staged ${FILES.length} files in dist/extension`);
