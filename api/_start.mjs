/**
 * Serve /start. Record ?ref= as a counter and a cookie the later form can read.
 * The page includes how many founding spots are left. No script.
 * An unknown or empty ref is not stored. A missing store still shows the page.
 */
import { readFileSync } from "node:fs";
import { redisCommand } from "./_account.mjs";
import { foundingSpotsLine, readFoundingCount } from "./_founding.mjs";

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

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

let cachedStyle = "";
function siteStyle() {
  if (cachedStyle) return cachedStyle;
  const page = readFileSync(new URL("../site/page.html", import.meta.url), "utf8");
  const start = page.indexOf("<style>");
  const end = page.indexOf("</style>");
  cachedStyle = start >= 0 && end > start ? page.slice(start, end + "</style>".length) : "";
  return cachedStyle;
}

/** The start page, with the live spots sentence in place of the source paragraph. */
export function renderStartPage(spots) {
  const source = readFileSync(new URL("../site/start.html", import.meta.url), "utf8");
  const title = source.match(/<title>([^<]*)<\/title>/)?.[1] || "Start using Grill";
  const line = `<p id="founding-spots" class="note">${esc(spots)}</p>`;
  let body = source.replace(/<title>[^<]*<\/title>\s*/, "");
  body = body.includes('id="founding-spots"')
    ? body.replace(/<p id="founding-spots"[^>]*>[\s\S]*?<\/p>/, line)
    : body.replace("</h1>", `</h1>\n  ${line}`);
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n${siteStyle()}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

async function spotsFor(deps) {
  try {
    const command = await commandOf(deps);
    if (!command) return foundingSpotsLine(0);
    return foundingSpotsLine(await readFoundingCount(command));
  } catch {
    return foundingSpotsLine(0);
  }
}

/**
 * Accept ?ref=, record it, and show /start with the founding spots that are left.
 * The cookie carries the source for a later form. The page runs no script.
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
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    Vary: "Accept",
    "X-Content-Type-Options": "nosniff",
  };
  if (ref) headers["Set-Cookie"] = refCookie(ref, request);
  return new Response(renderStartPage(await spotsFor(deps)), { status: 200, headers });
}
