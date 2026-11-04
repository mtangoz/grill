#!/usr/bin/env node
/**
 * Print paid-intent and free-to-paid lines. These are not users.
 *   node scripts/weekly-metrics.mjs
 * scripts/snapshot.sh appends that output to metrics.jsonl.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWeeklyMetrics, weeklyMetricLines } from "./weeklyMetricsCore.mjs";

async function main() {
  try {
    const report = await readWeeklyMetrics(process.env, globalThis.fetch);
    process.stdout.write(`${weeklyMetricLines(report).join("\n")}\n`);
  } catch (e) {
    if (e?.code === "unconfigured") console.error("Weekly metrics aren't configured.");
    else console.error("Weekly metrics couldn't be read.");
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
