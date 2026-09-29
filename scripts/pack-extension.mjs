#!/usr/bin/env node
/**
 * Pack dist/extension into an .mcpb. `mcpb pack` validates with the strict tool
 * schema first and refuses `inputSchema`, so the archive is a zip of the staged
 * tree. manifest.json stays at the archive root, schemas included.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function pack(outPath = "dist/grill.mcpb") {
  const out = resolve(outPath);
  const dir = resolve("dist/extension");
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  // -D: directory entries make `mcpb unpack` try to open a directory as a file.
  const result = spawnSync("zip", ["-r", "-D", "-X", "-q", out, "."], { cwd: dir, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pack(process.argv[2]);
}
