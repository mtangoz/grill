#!/usr/bin/env node
/**
 * Print Pro-interest counters as one JSON line. These are not users.
 *   node scripts/notify-interest.mjs
 * scripts/snapshot.sh appends that line to metrics.jsonl.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readNotifyInterest } from "../api/_notify.mjs";

async function main() {
  try {
    const report = await readNotifyInterest(process.env, globalThis.fetch);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (e) {
    if (e?.code === "unconfigured") console.error("Pro interest counters aren't configured.");
    else console.error("Pro interest counters couldn't be read.");
    process.exit(1);
  }
}

function runningAsMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

if (runningAsMain()) main();
