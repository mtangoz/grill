/**
 * POST /api/ping — anonymous usage counts for people who opted in.
 *
 * Daily counters, plus a peppered hash of the install id when GRILL_PING_PEPPER is set.
 * The hash expires after 90 days. The counters are aggregates and stay. No install id is
 * stored raw. Nothing about who connected is read, logged or stored. If Upstash is not
 * configured, the answer is still 204 and nothing is written.
 */
import { createHash } from "node:crypto";
import { redisCommand } from "./_account.mjs";

export const PING_MAX_BYTES = 512;
export const PING_ID_TTL_SECONDS = 90 * 24 * 60 * 60;
export const PING_KEYS = ["v", "id", "ver", "client", "route", "ok", "ms", "ts"];
const CLIENTS = new Set(["mcpb", "stdio", "smithery", "other"]);
const ROUTES = new Set(["one_click", "plugin"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VER_RE = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function trimmed(env, name) {
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
}

export function pingConfigured(env = {}) {
  return trimmed(env, "UPSTASH_REDIS_REST_URL").startsWith("https://") && trimmed(env, "UPSTASH_REDIS_REST_TOKEN").length > 0;
}

/** Default 120 a minute, shared by every caller. Not keyed by address. */
export function rateCap(env = {}) {
  const n = Number(trimmed(env, "GRILL_PING_RATE_PER_MINUTE"));
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 120;
}

export function pepperedId(id, pepper) {
  return createHash("sha256").update(`${pepper}\n${id}`, "utf8").digest("hex");
}

function realDay(value) {
  const match = DAY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
}

/** The body, or null when it is the wrong shape. Unknown keys are rejected. */
export function parsePing(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > PING_MAX_BYTES || Buffer.byteLength(raw) === 0) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  if (keys.length !== PING_KEYS.length) return null;
  for (const key of PING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) return null;
  }
  if (data.v !== "1") return null;
  if (typeof data.id !== "string" || !UUID_V4.test(data.id)) return null;
  if (typeof data.ver !== "string" || !VER_RE.test(data.ver)) return null;
  if (typeof data.client !== "string" || !CLIENTS.has(data.client)) return null;
  if (typeof data.route !== "string" || !ROUTES.has(data.route)) return null;
  if (typeof data.ok !== "boolean") return null;
  if (typeof data.ms !== "number" || !Number.isInteger(data.ms) || data.ms < 0 || data.ms > 3_600_000) return null;
  if (typeof data.ts !== "string" || !realDay(data.ts)) return null;
  return {
    v: "1",
    id: data.id,
    ver: data.ver,
    client: data.client,
    route: data.route,
    ok: data.ok,
    ms: data.ms,
    ts: data.ts,
  };
}

function empty(status) {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

export async function handlePing(request, { env = {}, fetch: fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (request.method !== "POST") return empty(405);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > PING_MAX_BYTES) return empty(400);
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return empty(400);
  }
  const ping = parsePing(raw);
  if (!ping) return empty(400);
  if (!pingConfigured(env)) return empty(204);
  try {
    const cmd = redisCommand(env, fetchImpl);
    const minute = new Date(now).toISOString().slice(0, 16);
    const rateKey = `grill:ping:rate:${minute}`;
    const n = Number(await cmd(["INCR", rateKey]));
    if (n === 1) await cmd(["EXPIRE", rateKey, "120"]);
    if (n > rateCap(env)) return empty(429);
    const countKey = `grill:ping:n:${ping.ts}:${ping.ok ? "1" : "0"}:${ping.client}:${ping.route}:${ping.ver}`;
    await cmd(["INCR", countKey]);
    const pepper = trimmed(env, "GRILL_PING_PEPPER");
    if (pepper) {
      const seenKey = `grill:ping:id:${pepperedId(ping.id, pepper)}`;
      const set = await cmd(["SET", seenKey, "1", "NX", "EX", String(PING_ID_TTL_SECONDS)]);
      if (set === "OK") {
        await cmd(["INCR", "grill:ping:unique"]);
        await cmd(["INCR", `grill:ping:unique:${ping.ts}`]);
      }
    }
  } catch {
    // A store error stores nothing further and tells the client the ping is done.
    return empty(204);
  }
  return empty(204);
}
