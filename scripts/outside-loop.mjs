#!/usr/bin/env node
/**
 * Print the outside loop readout: outside people who grilled, who came back, records on and
 * off, choices, first grills by app, and the kill threshold for the record bet.
 *   node scripts/outside-loop.mjs
 * Reads the counters with the same Upstash settings scripts/weekly-metrics.mjs uses. It reads
 * whole numbers only: no account, no email, no title, and no kept record. The rules are in
 * scripts/outsideLoopCore.mjs.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { redisCommand } from "../api/_account.mjs";
import { OUTSIDE_KEYS, OUTSIDE_LIVE_KEY, outsideLines, outsideReading, utcDay } from "./outsideLoopCore.mjs";

export const NOT_CONFIGURED_LINE = "Outside loop readout: the Upstash settings are not set here, so nothing was read.";

function setting(env, name) {
  return typeof env?.[name] === "string" ? env[name].trim() : "";
}

/** One HGETALL per counter and one GET for the day counting began. Nothing is written. */
export async function readOutsideCounters(command) {
  const raw = {};
  for (const [name, key] of Object.entries(OUTSIDE_KEYS)) raw[name] = await command(["HGETALL", key]);
  raw.live = await command(["GET", OUTSIDE_LIVE_KEY]);
  return raw;
}

/** The lines to print, or null when the Upstash settings are missing. */
export async function outsideLoopLines({ env = {}, fetch: fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!setting(env, "UPSTASH_REDIS_REST_URL") || !setting(env, "UPSTASH_REDIS_REST_TOKEN")) return null;
  const raw = await readOutsideCounters(redisCommand(env, fetchImpl));
  return outsideLines(outsideReading(raw, utcDay(now)));
}

async function main() {
  let lines;
  try {
    lines = await outsideLoopLines({ env: process.env, fetch: globalThis.fetch, now: Date.now() });
  } catch {
    console.error("The outside loop counters couldn't be read.");
    process.exit(1);
  }
  process.stdout.write(`${(lines || [NOT_CONFIGURED_LINE]).join("\n")}\n`);
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
