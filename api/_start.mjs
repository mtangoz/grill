/**
 * Record ?ref= on /start. A counter per source, plus a cookie the later form can read.
 * No script. An unknown or empty ref is not stored. A missing store still sends the person to the page.
 */
import { redisCommand } from "./_account.mjs";

export const REF_COOKIE = "grill_ref";
const REF_MAX_AGE = 30 * 24 * 60 * 60;

/** A source label such as askgrill. Anything else, including an email, is dropped. */
export function normalizeRef(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(text)) return "";
  return text;
}

export function startRefKey(ref) {
  const safe = normalizeRef(ref);
  return safe ? `grill:metric:start_ref:${safe}` : "";
}

export function refFromCookie(header) {
  const parts = String(header || "").split(";");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== REF_COOKIE) continue;
    return normalizeRef(decodeURIComponent(part.slice(i + 1).trim()));
  }
  return "";
}

function refCookie(ref, request) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const parts = [`${REF_COOKIE}=${encodeURIComponent(ref)}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${REF_MAX_AGE}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function originOf(request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = (forwardedHost ? forwardedHost.split(",")[0].trim() : url.host) || url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = (forwardedProto ? forwardedProto.split(",")[0].trim() : url.protocol.replace(":", "")) || "https";
  return `${proto}://${host}`;
}

async function commandOf(deps) {
  if (typeof deps.redis === "function") return deps.redis;
  const env = deps.env ?? {};
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return redisCommand(env, deps.fetch);
}

/** Increment the counter for this source. Returns false when there is nothing to record. */
export async function recordStartRef(deps, ref) {
  const safe = normalizeRef(ref);
  const key = startRefKey(safe);
  if (!key) return false;
  const command = await commandOf(deps);
  if (!command) return false;
  await command(["INCR", key]);
  return true;
}

/**
 * Accept ?ref=, record it, and send the person to the static /start page.
 * The cookie carries the source for a later form. The redirect URL does not.
 */
export async function handleStart(request, deps) {
  const ref = normalizeRef(new URL(request.url).searchParams.get("ref"));
  if (ref) {
    try {
      await recordStartRef(deps, ref);
    } catch {
      // The page still loads. A missed counter is not a blocked visit.
    }
  }
  const headers = {
    Location: `${originOf(request)}/start/`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  };
  if (ref) headers["Set-Cookie"] = refCookie(ref, request);
  return new Response(null, { status: 303, headers });
}
