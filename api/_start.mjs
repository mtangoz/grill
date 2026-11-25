/**
 * Serve /start. Count a view, and record ?ref= as a counter. A crawler, a link-preview fetch
 * and any request that is not a GET get the page and are not counted.
 * The ref cookie is first-touch: a valid ?ref= is stored when the browser has none yet.
 * A later ?ref= does not replace it. The waitlist form reads the same cookie.
 * The only script copies the starter prompts, the server URL, and the ChatGPT tab link.
 * An unknown or empty ref is not stored. A missing store still shows the page.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { redisCommand } from "./_account.mjs";
import { COUNT_ONCE_SCRIPT, hostedAccountKey, isInternalAccount, keyFromEnv } from "../scripts/hostedCore.mjs";

export const REF_COOKIE = "grill_ref";
/** About 90 days. A first-touch label should still be there after sign-in. */
export const REF_MAX_AGE = 90 * 24 * 60 * 60;

/** Every /start view by a browser, tagged or not. A number only. */
export const START_VIEWS_KEY = "grill:metric:start_views";

/**
 * Words a crawler, a link-preview fetcher, a script or an uptime check puts in its user-agent.
 * The header is read here, once, only to tell such a request from a visit. It is not stored,
 * not logged and not counted. `bot` skips the letters `cubot`, which is a phone maker's name
 * in a real browser's user-agent. `node` is a script only when it is the whole user-agent,
 * which is what Node sends when a script sets none.
 *
 * The list names what has been seen. A script that sends some other name, or a browser's
 * name, is still counted. A request with no user-agent counts as a visit too: nothing here
 * can show that every real browser sends one, so it is not treated as automated.
 */
const AUTOMATED_AGENT =
  /(?<!cu)bot(?![a-z])|crawl|spider|preview|facebookexternalhit|whatsapp|embedly|iframely|vercel-screenshot|chatgpt-user|claude-user|perplexity-user|curl|wget|python-requests|^node$|go-http-client|axios|okhttp|postman|uptime|monitor|headless/i;

/** True for a GET from something that is not a known crawler, preview fetcher or script. */
export function countsAsVisit(request) {
  if (request.method !== "GET") return false;
  return !AUTOMATED_AGENT.test(request.headers.get("user-agent") || "");
}

// What a link preview shows when someone posts the /start address. The same card as the
// other pages on the site: the address here is the canonical one, never the request's own,
// so a ?ref= label is not echoed into a preview.
export const START_CANONICAL = "https://grillyour.ai/start/";
export const START_DESCRIPTION = "Pick your AI, then connect Grill and paste one message.";
export const START_OG_IMAGE = "https://grillyour.ai/brand/og-image.png";
export const START_ICONS = [
  '<link rel="icon" href="/favicon.ico" sizes="any">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/brand/icon-192.png">',
  '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">',
];
const START_OG_IMAGE_ALT =
  "Grill: a pitchfork mark and the words Grill your AI before you send it to your boss. A second opinion before you decide. grillyour.ai";

function previewTags(title) {
  const safeTitle = esc(title);
  const description = esc(START_DESCRIPTION);
  return [
    ...START_ICONS,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${START_CANONICAL}">`,
    `<meta property="og:url" content="${START_CANONICAL}">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${description}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:image" content="${START_OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${esc(START_OG_IMAGE_ALT)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${safeTitle}">`,
    `<meta name="twitter:image" content="${START_OG_IMAGE}">`,
  ].join("\n");
}

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

function rawRefCookie(header) {
  const parts = String(header || "").split(";");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== REF_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

/** The label in grill_ref. The cookie is `label.seconds.signature`; an older cookie is `label` or `label.seconds`. */
export function refFromCookie(header) {
  return normalizeRef(rawRefCookie(header).split(".")[0]);
}

/**
 * The key that signs the cookie's time, derived from GRILL_RECORD_KEY, or null when it is unset.
 * HttpOnly only keeps scripts out; a person can still edit the cookie, and the time decides
 * whether a link came before an account. So the time counts only when this key signed it.
 */
function refCookieKey(env) {
  const master = keyFromEnv(env, "GRILL_RECORD_KEY");
  return master ? createHmac("sha256", master).update("grill-ref-cookie-v1").digest() : null;
}

function refSignature(key, label, seconds) {
  return createHmac("sha256", key).update(`${label}.${seconds}`).digest("base64url").slice(0, 22);
}

/** The cookie value for a label set at `seconds`: signed when the key is set, `label.seconds` when not. */
export function refCookieValue(label, seconds, env) {
  const safe = normalizeRef(label);
  if (!safe) return "";
  const key = refCookieKey(env);
  return key ? `${safe}.${seconds}.${refSignature(key, safe, seconds)}` : `${safe}.${seconds}`;
}

/**
 * When grill_ref was set, in milliseconds, or 0 when that cannot be trusted: an older cookie with
 * no time, a time with no signature or a wrong one, or no signing key on this server.
 */
export function refSetAt(header, env = {}) {
  const raw = rawRefCookie(header);
  const label = refFromCookie(header);
  if (!label) return 0;
  const match = /^[^.]+\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/.exec(raw);
  const key = refCookieKey(env);
  if (!match || !key) return 0;
  const want = Buffer.from(refSignature(key, label, match[1]));
  const got = Buffer.from(match[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 0;
  return Number(match[1]) * 1000;
}

export function signupRefKey(ref) {
  const safe = normalizeRef(ref);
  return safe ? `grill:metric:signup_ref:${safe}` : "";
}

export function firstGrillRefKey(ref) {
  const safe = normalizeRef(ref);
  return safe ? `grill:metric:first_grill_ref:${safe}` : "";
}

/** One mark per account, so a sign-up and a first grill are each counted once. */
export function refOnceKey(accountId, kind) {
  const id = String(accountId || "").trim();
  if (!id || (kind !== "signup" && kind !== "grill")) return "";
  return `grill:hosted:refmark:${id}:${kind}`;
}

/**
 * Add one to this account's ref counter, once. An account on GRILL_INTERNAL_EMAILS
 * is left out. A second call for the same account adds nothing.
 */
export async function countAccountRef(command, account, env, kind) {
  const label = normalizeRef(account?.ref);
  const counter = kind === "signup" ? signupRefKey(label) : kind === "grill" ? firstGrillRefKey(label) : "";
  const once = refOnceKey(account?.id, kind);
  if (!label || !counter || !once || typeof command !== "function") return false;
  if (isInternalAccount(account, env)) return false;
  // The mark and the count are one atomic step. If this throws, either nothing ran (a later call
  // counts it) or it ran and only the reply was lost (a later call finds the mark and adds nothing).
  // The script writes nothing once the account is gone, so a count racing a delete leaves no mark.
  const counted = await command(["EVAL", COUNT_ONCE_SCRIPT, 3, once, counter, hostedAccountKey(account.id)]);
  return Number(counted) > 0;
}

function refCookie(ref, request, env) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const value = refCookieValue(ref, Math.floor(Date.now() / 1000), env);
  const parts = [`${REF_COOKIE}=${encodeURIComponent(value)}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${REF_MAX_AGE}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Set-Cookie for a first-touch source, or "" when this request should not set one.
 * A valid ?ref= is stored only when the browser does not already have grill_ref.
 * A browser whose grill_ref has no signed time (one set before times were signed) keeps its label
 * and gets it back with a signed time from now, so a later account can still be credited to it.
 * Nothing can show when that older cookie was really set, so an account made before this visit is not.
 * A crawler, a request that is not a GET, and a bad label set nothing.
 */
export function firstTouchCookie(request, env = {}) {
  if (!countsAsVisit(request)) return "";
  const header = request.headers.get("cookie");
  const held = refFromCookie(header);
  if (held) return refCookieKey(env) && !refSetAt(header, env) ? refCookie(held, request, env) : "";
  const ref = normalizeRef(new URL(request.url).searchParams.get("ref"));
  if (!ref) return "";
  return refCookie(ref, request, env);
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

/** The start page. Public copy does not advertise founding spots. */
export function renderStartPage() {
  const source = readFileSync(new URL("../site/start.html", import.meta.url), "utf8");
  const title = source.match(/<title>([^<]*)<\/title>/)?.[1] || "Start using Grill";
  const body = source.replace(/<title>[^<]*<\/title>\s*/, "");
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n${previewTags(title)}\n${siteStyle()}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/**
 * Show /start. A visit adds one to the view count and, with a valid ?ref=, one to that source's
 * count. A crawler, a link-preview fetch and a request that is not a GET get the same page and
 * add nothing. The cookie is first-touch: the first valid ?ref= is kept, and a later one is not.
 * The only script copies text the person asks to copy.
 */
export async function handleStart(request, deps) {
  const visit = countsAsVisit(request);
  const ref = visit ? normalizeRef(new URL(request.url).searchParams.get("ref")) : "";
  if (visit) {
    try {
      const command = await commandOf(deps);
      if (command) await command(["INCR", START_VIEWS_KEY]);
    } catch {
      // The page still loads. A missed counter is not a blocked visit.
    }
  }
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
  const cookie = firstTouchCookie(request, deps.env ?? {});
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(renderStartPage(), { status: 200, headers });
}
