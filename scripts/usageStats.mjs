/**
 * Opt-in anonymous usage ping. Off unless GRILL_USAGE_STATS is exactly true, 1, on or yes.
 *
 * This is the opposite of GRILL_CHECK and GRILL_NEWS, which stay on until someone turns
 * them off. An unset value, an empty one, or an unfilled ${…} placeholder (Claude Desktop
 * passes those through as text) is off. GRILL_PING=off and DO_NOT_TRACK=1 always win,
 * even when the setting is on. The two are separate because a Desktop install writes the
 * setting into the environment and cannot also leave GRILL_PING for the user to export.
 *
 * One ping after the first successful grill, then at most one per ISO week. The body is
 * metadata only. The state file is created only when the setting is on, and a failure
 * here never changes the grill.
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PING_URL = "https://grillyour.ai/api/ping";
export const PING_TIMEOUT_MS = 2000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const ON_VALUES = new Set(["true", "1", "on", "yes"]);
const KILL_VALUES = new Set(["false", "0", "off", "no"]);
const CLIENTS = new Set(["mcpb", "stdio", "smithery", "other"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VER_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

function trimmed(env, name) {
  const raw = env?.[name];
  return typeof raw === "string" ? raw.trim() : "";
}

/** GRILL_PING=off (also false, 0, no) or DO_NOT_TRACK=1. Either one disables the ping. */
export function usageStatsKilled(env = process.env) {
  if (KILL_VALUES.has(trimmed(env, "GRILL_PING").toLowerCase())) return true;
  return trimmed(env, "DO_NOT_TRACK") === "1";
}

/** True only for an explicit opt-in. Anything else, including a placeholder, is off. */
export function usageStatsEnabled(env = process.env) {
  if (usageStatsKilled(env)) return false;
  const value = trimmed(env, "GRILL_USAGE_STATS").toLowerCase();
  if (!value || value.startsWith("${")) return false;
  return ON_VALUES.has(value);
}

/**
 * The production URL, unless a test points GRILL_PING_URL at loopback. Any other override
 * is ignored, so the install id cannot be redirected at a host the code did not name.
 */
export function resolvePingUrl(raw) {
  const override = typeof raw === "string" ? raw.trim() : "";
  if (!override || override.startsWith("${")) return PING_URL;
  try {
    const host = new URL(override).hostname;
    if (LOOPBACK_HOSTS.has(host)) return override;
  } catch {
    // not a URL: keep the real endpoint
  }
  return PING_URL;
}

export function defaultStateFile() {
  return join(homedir(), ".grill", "usage-stats.json");
}

/** Coarse latency. The endpoint stores a bucket, not a stopwatch reading. */
export function bucketMs(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const rounded = Math.round(n / 100) * 100;
  return Math.min(3_600_000, rounded);
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO week of the UTC day, `YYYY-Www`. The cap is one ping per week, not per day. */
export function isoWeek(ms) {
  const date = new Date(ms);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function clientOf(env) {
  const raw = trimmed(env, "GRILL_CLIENT").toLowerCase();
  if (!raw || raw.startsWith("${")) return "stdio";
  return CLIENTS.has(raw) ? raw : "other";
}

function routeOf(env) {
  const raw = trimmed(env, "GRILL_ROUTE").toLowerCase();
  if (raw === "one_click" || raw === "plugin") return raw;
  return "one_click";
}

function readState(file) {
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data && typeof data.id === "string" && UUID_V4.test(data.id)) {
      return {
        id: data.id,
        firstSentDay: typeof data.firstSentDay === "string" ? data.firstSentDay : "",
        lastWeekly: typeof data.lastWeekly === "string" ? data.lastWeekly : "",
      };
    }
  } catch (e) {
    if (e?.code !== "ENOENT") return { corrupt: true };
    return null;
  }
  return { corrupt: true };
}

function writeState(file, state) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const body = `${JSON.stringify({
    id: state.id,
    firstSentDay: state.firstSentDay || "",
    lastWeekly: state.lastWeekly || "",
  })}\n`;
  writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

async function postPing(url, body, fetchImpl, timeoutMs) {
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > 512) return false;
  const once = async () => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    try {
      await res.body?.cancel?.();
    } catch {
      // The status is enough. The body is not the grill, and it is not logged.
    }
    return res.status;
  };
  const ok = (status) => status >= 200 && status < 300;
  const giveUp = (status) => status >= 400 && status < 500 && status !== 429;
  try {
    const status = await once();
    if (ok(status) || giveUp(status)) return ok(status);
  } catch {
    // one retry below, for a dropped connection or a 5xx
  }
  try {
    return ok(await once());
  } catch {
    return false;
  }
}

/**
 * Send the ping if this grill is the first success, or the first success of a new ISO week.
 * Returns false when the setting is off, the grill failed, or the send did not land.
 * Callers pass timing and a version. They do not pass the write-up: this function has no
 * parameter for it, so a decision cannot ride along.
 */
export async function sendUsagePing({
  ok,
  ms,
  version,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  stateFile,
  timeoutMs = PING_TIMEOUT_MS,
} = {}) {
  if (!usageStatsEnabled(env)) return false;
  if (ok !== true) return false;
  if (typeof version !== "string" || !VER_RE.test(version)) return false;
  const file = stateFile || defaultStateFile();
  let existing;
  try {
    existing = readState(file);
  } catch {
    return false;
  }
  if (existing?.corrupt) existing = null;
  const state = existing ?? { id: randomUUID(), firstSentDay: "", lastWeekly: "" };
  const ts = utcDay(now);
  const week = isoWeek(now);
  if (state.firstSentDay && state.lastWeekly === week) return false;
  const next = {
    id: state.id,
    firstSentDay: state.firstSentDay || ts,
    lastWeekly: week,
  };
  try {
    writeState(file, next);
  } catch {
    return false;
  }
  const body = {
    v: "1",
    id: state.id,
    ver: version,
    client: clientOf(env),
    route: routeOf(env),
    ok: true,
    ms: bucketMs(ms),
    ts,
  };
  return postPing(resolvePingUrl(env.GRILL_PING_URL), body, fetchImpl, timeoutMs);
}

/** Fire the ping without waiting. A slow endpoint must not hold the report. */
export function scheduleUsagePing(opts) {
  if (!usageStatsEnabled(opts?.env ?? process.env)) return;
  if (opts?.ok !== true) return;
  sendUsagePing(opts).catch(() => {});
}
