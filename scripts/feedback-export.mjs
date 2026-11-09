#!/usr/bin/env node
/**
 * Weekly review of reactions. Counts by rating, judge model and week, then the
 * grills someone chose to send, one JSON object per line.
 *   node scripts/feedback-export.mjs
 * Needs UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN and GRILL_RECORD_KEY.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { redisCommand } from "../api/_account.mjs";
import { feedbackKeyFromEnv, formatFeedbackReport, readFeedbackRecords } from "./feedbackCore.mjs";

async function main() {
  const key = feedbackKeyFromEnv(process.env.GRILL_RECORD_KEY);
  const url = typeof process.env.UPSTASH_REDIS_REST_URL === "string" ? process.env.UPSTASH_REDIS_REST_URL.trim() : "";
  const token = typeof process.env.UPSTASH_REDIS_REST_TOKEN === "string" ? process.env.UPSTASH_REDIS_REST_TOKEN.trim() : "";
  if (!key || !url || !token) {
    console.error("Feedback export isn't configured.");
    process.exit(1);
  }
  try {
    const records = await readFeedbackRecords(redisCommand(process.env, globalThis.fetch), key);
    const report = formatFeedbackReport(records);
    const body = report.jsonl ? `${report.lines.join("\n")}\n\n${report.jsonl}\n` : `${report.lines.join("\n")}\n`;
    process.stdout.write(body);
  } catch {
    console.error("Feedback export couldn't be read.");
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
