#!/usr/bin/env node
/**
 * Copy a built grill.mcpb to grill-smithery.mcpb and add each tool's inputSchema from the
 * server's tools/list. The Desktop bundle stays without that field: published mcpb rejects it,
 * and the Smithery registry requires it.
 *
 *   node scripts/build-smithery-bundle.mjs dist/grill.mcpb dist/grill-smithery.mcpb
 *
 * When the bundle contains server/index.mjs, RELEASE_DATE in that copy is stamped to the build's
 * UTC day, or to GRILL_RELEASE_DATE. The checkout is not rewritten.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseDateForBuild, stampReleaseDateFile } from "./releaseDate.mjs";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "index.mjs");

export function listTools(serverPath = SERVER) {
  const child = spawn(process.execPath, [serverPath], {
    env: { PATH: process.env.PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const waiting = new Map();
  let buffer = "";
  let nextId = 1;
  let settled = false;
  const done = (fn) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    child.kill();
    fn();
  };
  const timer = setTimeout(() => done(() => rejectOnce(new Error("tools/list timed out"))), 10_000);
  let rejectOnce = () => {};
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const resolve = waiting.get(msg.id);
      if (resolve) {
        waiting.delete(msg.id);
        resolve(msg);
      }
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return new Promise((resolve, reject) => {
    rejectOnce = reject;
    child.on("error", (err) => done(() => reject(err)));
    child.on("close", (code) => {
      if (!settled && waiting.size) done(() => reject(new Error(`server exited (${code}) before tools/list`)));
    });
    (async () => {
      await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "grill-smithery-bundle", version: "0" },
      });
      const listed = (await request("tools/list", {})).result?.tools;
      if (!Array.isArray(listed) || listed.length === 0) throw new Error("tools/list returned no tools");
      done(() => resolve(listed));
    })().catch((err) => done(() => reject(err)));
  });
}

export async function buildSmitheryBundle(mcpbPath, outPath, serverPath = SERVER, { releaseDate = releaseDateForBuild() } = {}) {
  const src = resolve(mcpbPath);
  const dest = resolve(outPath);
  if (!existsSync(src)) throw new Error(`missing bundle: ${src}`);
  const dir = mkdtempSync(join(tmpdir(), "grill-smithery-"));
  try {
    const unzipped = spawnSync("unzip", ["-q", "-o", src, "-d", dir], { stdio: "inherit" });
    if (unzipped.status !== 0) throw new Error(`unzip failed (${unzipped.status})`);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("bundle has no manifest.json at its root");
    const bundledServer = join(dir, "server", "index.mjs");
    if (existsSync(bundledServer)) stampReleaseDateFile(bundledServer, releaseDate);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) throw new Error("manifest tools must be a non-empty array");
    const tools = await listTools(serverPath);
    const names = manifest.tools.map((tool) => tool.name);
    const listedNames = tools.map((tool) => tool.name);
    if (names.join("\0") !== listedNames.join("\0")) {
      throw new Error(`manifest tools (${names.join(", ")}) differ from tools/list (${listedNames.join(", ")})`);
    }
    for (const tool of manifest.tools) {
      const listed = tools.find((entry) => entry.name === tool.name);
      if (!listed?.inputSchema || listed.inputSchema.type !== "object") {
        throw new Error(`${tool.name} has no object inputSchema in tools/list`);
      }
      tool.inputSchema = structuredClone(listed.inputSchema);
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { force: true });
    // -D: directory entries make `mcpb unpack` try to open a directory as a file.
    const zipped = spawnSync("zip", ["-r", "-D", "-X", "-q", dest, "."], { cwd: dir, stdio: "inherit" });
    if (zipped.status !== 0) throw new Error(`zip failed (${zipped.status})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error("usage: node scripts/build-smithery-bundle.mjs <grill.mcpb> <grill-smithery.mcpb>");
    process.exit(1);
  }
  buildSmitheryBundle(src, dest).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
