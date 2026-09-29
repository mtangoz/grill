#!/usr/bin/env node
/**
 * Tool input schemas have to be in manifest.json: Smithery's server card requires
 * `inputSchema` on every tool. The latest `mcpb` tool's strict schema allows only
 * `name` and `description` on a tool, so `mcpb validate` exits 1 when the field is
 * present. This runs that same validator on a copy with `inputSchema` removed, and
 * refuses a tool that has no object schema. The file on disk keeps the schemas.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function manifestForMcpbValidate(manifest) {
  const tools = manifest?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error("manifest tools must be a non-empty array");
  }
  for (const tool of tools) {
    const schema = tool?.inputSchema;
    if (!tool?.name || !schema || schema.type !== "object" || !schema.properties || !Array.isArray(schema.required)) {
      throw new Error(`${tool?.name || "a tool"} needs an object inputSchema with properties and required`);
    }
  }
  const copy = structuredClone(manifest);
  for (const tool of copy.tools) delete tool.inputSchema;
  return copy;
}

function runCli() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/validate-manifest.mjs <manifest.json>");
    process.exit(1);
  }
  let projected;
  try {
    projected = manifestForMcpbValidate(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const copyPath = join(mkdtempSync(join(tmpdir(), "grill-mcpb-")), "manifest.json");
  writeFileSync(copyPath, JSON.stringify(projected));
  const result = spawnSync("npx", ["-y", "@anthropic-ai/mcpb@latest", "validate", copyPath], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
