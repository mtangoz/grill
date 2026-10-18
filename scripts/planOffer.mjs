#!/usr/bin/env node
/**
 * Claude Code plugin hook: offer a grill before the person approves a plan.
 *
 * hooks/hooks.json runs this on PreToolUse for ExitPlanMode, the moment Claude Code shows a plan
 * for approval. It prints one line for the person (`systemMessage`) and nothing else: it makes no
 * permission decision, so the approval prompt is unchanged. Claude grills only if the person then
 * asks. Off with GRILL_PLAN_OFFER=off (also false, 0, no).
 *
 * At most once per Claude Code session. The only thing it keeps is an empty marker file, named by
 * a hash of the session id, in the plugin's data folder; markers older than two days are removed.
 * Claude Code passes it the plan; it ignores that text, sends nothing, and calls no network.
 *
 * It always fails open: any error, bad input or slow stdin ends with exit 0 and no output, so it
 * can never block or interrupt a plan approval.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const OFFER_LINE = 'Grill: want an outside judge, from a different company than Claude, on this plan first? Keep planning and say "grill this plan".';
export const STDIN_TIMEOUT_MS = 2000;
const MARKER_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const OFF_VALUES = new Set(["false", "0", "off", "no"]);

/** On unless GRILL_PLAN_OFFER says off. An unset or empty value keeps it on. */
export function planOfferEnabled(env = process.env) {
  const value = typeof env.GRILL_PLAN_OFFER === "string" ? env.GRILL_PLAN_OFFER.trim().toLowerCase() : "";
  return !OFF_VALUES.has(value);
}

/** The plugin's data folder when Claude Code gives one, else a folder under the system temp dir. */
export function markerDir(env = process.env) {
  const data = typeof env.CLAUDE_PLUGIN_DATA === "string" ? env.CLAUDE_PLUGIN_DATA.trim() : "";
  return data ? join(data, "plan-offer") : join(tmpdir(), "grill-plan-offer");
}

function pruneOld(dir, now) {
  for (const name of readdirSync(dir)) {
    if (!/^[0-9a-f]{32}$/.test(name)) continue;
    const path = join(dir, name);
    if (now - statSync(path).mtimeMs > MARKER_MAX_AGE_MS) rmSync(path, { force: true });
  }
}

/**
 * The hook's stdout for one PreToolUse event, or "" for nothing. Pure apart from the marker file.
 * `input` is the parsed hook JSON; only tool_name and session_id are read.
 */
export function planOffer(input, env = process.env, now = Date.now()) {
  if (!input || typeof input !== "object" || input.tool_name !== "ExitPlanMode") return "";
  if (!planOfferEnabled(env)) return "";
  const session = typeof input.session_id === "string" ? input.session_id : "";
  if (session) {
    const dir = markerDir(env);
    mkdirSync(dir, { recursive: true });
    pruneOld(dir, now);
    const marker = join(dir, createHash("sha256").update(session).digest("hex").slice(0, 32));
    try {
      writeFileSync(marker, "", { flag: "wx" });
    } catch (err) {
      if (err?.code === "EEXIST") return "";
      throw err;
    }
  }
  return JSON.stringify({ systemMessage: OFFER_LINE });
}

async function main() {
  const timer = setTimeout(() => process.exit(0), STDIN_TIMEOUT_MS);
  try {
    process.stdin.setEncoding("utf8");
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const out = planOffer(JSON.parse(raw));
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // Fail open: never block a plan approval over an offer.
  }
  clearTimeout(timer);
  process.exit(0);
}

function runAsScript() {
  try {
    return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (runAsScript()) main();
