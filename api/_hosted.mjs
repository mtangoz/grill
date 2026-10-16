/**
 * Hosted Grill: the in-chat connector. Off unless GRILL_HOSTED=on.
 *
 * The judge is always scripts/judge.mjs with model openrouter/auto. This file never
 * sets JUDGE_MODEL and never passes a fallback model list. The company excluded is
 * the one that wrote the write-up, not whichever chat the person is sitting in.
 *
 * Request and response bodies are not logged. Errors return a fixed sentence and a
 * request id. A rejected bearer on /mcp logs the reason and public claims only:
 * never the token, and never an email.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCappedKey, esc, page, readManagedKey, removeManagedKey, WELCOME_HEADERS } from "./_pro.mjs";
import { isThinGrill, normalizeDetail, renderLayers } from "../scripts/judgeCore.mjs";
import {
  REVIEW_DAYS,
  addDays,
  changeCountLines,
  changeExample,
  changeSummary,
  changesText,
  changesView,
  decidedLine,
  decisionTitle,
  goalFromSubject,
  guardrailsFromSubject,
  isoDate,
  lookBack,
  outcomesForSaved,
  parseRecords,
  plainVerdict,
  predictionFromSubject,
  recordBlock,
} from "../scripts/reflection.mjs";
import {
  CAP_RETRY_TEXT,
  CONSENT_TEXT,
  CREDIT_CACHE_MS,
  DAILY_GRILL_LIMIT,
  HOSTED_INSTRUCTIONS,
  INVITE_ONLY,
  JOB_TTL_SECONDS,
  MAX_PASTE_CHARS,
  MAX_QUESTION_CHARS,
  MAX_SUBJECT_CHARS,
  ONCE_DISCLOSURE,
  OUT_OF_CREDIT,
  RUNNING_JOB_LIMIT,
  CAP_COUNTER_TTL_SECONDS,
  allowlistAllows,
  authorForJudge,
  calendarFeed,
  calendarTokenHash,
  calendarTokenShape,
  daysOverdue,
  formatDay,
  dueForLookBack,
  dueReminderLine,
  newCalendarToken,
  capBlock,
  chargeableUsd,
  chainIds,
  decisionHabits,
  decryptString,
  encryptString,
  hostedEnabled,
  hostedStillRunningText,
  hostedTools,
  isoDay,
  isoMonth,
  judgeFailureText,
  keyFromEnv,
  linkChains,
  mcpResource,
  negotiateProtocol,
  newJobCredential,
  parseJobCredential,
  protectedResourceMetadata,
  publicOrigin,
  queryHasToken,
  recordsForLookBack,
  savedConfirmation,
  serviceFailureText,
  signInUrl,
  sourceAppFromClient,
  starterCreditUsd,
  toMicros,
  wwwAuthenticate,
} from "../scripts/hostedCore.mjs";

const JUDGE = fileURLToPath(new URL("../scripts/judge.mjs", import.meta.url));
const CLERK_API = "https://api.clerk.com";
// Clerk Backend: GET /v1/users/{user_id}/oauth_access_tokens/oauth_agentid
const AGENTID_PROVIDER = "oauth_agentid";
// userinfo_endpoint from AgentID's openid-configuration.
const AGENTID_USERINFO = "https://auth.agentid.com/v0/userinfo";
const OWNER_CACHE_SECONDS = 10 * 60;
// A link the person may click to subscribe in Google Calendar. Grill's server never fetches it.
const GOOGLE_CALENDAR_SUBSCRIBE = "https://calendar.google.com/calendar/r";
const VERSION = "0.1.1";
const jwksCache = new Map();
const userCache = new Map();
const creditCache = new Map();
// Clerk's authorization-server documents, keyed by the upstream URL. Public metadata only.
const authMetadataCache = new Map();
export const AUTH_METADATA_CACHE_MS = 60_000;

export function resetHostedCaches() {
  jwksCache.clear();
  userCache.clear();
  creditCache.clear();
  authMetadataCache.clear();
}

class Coded extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function logHosted(requestId, code) {
  console.error(`[grill-hosted] ${requestId} ${code}`);
}

function requestId() {
  return randomBytes(4).toString("hex");
}

function notFound() {
  return new Response("not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

function fixedError(id, status = 500, code = "") {
  return new Response(serviceFailureText(code, id), {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function unauthorized(origin) {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "WWW-Authenticate": wwwAuthenticate(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** MCP Implementation.icons: the pitchfork mark, served from this same site. */
function serverIcons(origin) {
  return [
    { src: `${origin}/brand/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
    { src: `${origin}/brand/icon-192.png`, mimeType: "image/png", sizes: ["192x192"] },
    { src: `${origin}/brand/favicon-32.png`, mimeType: "image/png", sizes: ["32x32"] },
  ];
}

function methodNotAllowed() {
  return new Response("That request isn't supported.", {
    status: 405,
    headers: { Allow: "GET, POST", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** `__route` only selects a handler inside api/hosted.js. It is not a parameter of these handlers. */
function pageUrl(request) {
  const url = new URL(request.url);
  url.searchParams.delete("__route");
  return url;
}

function toolText(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

function cookieValue(header, name) {
  const parts = String(header || "").split(";");
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

async function redis(deps, args) {
  if (typeof deps.redis === "function") return deps.redis(args);
  const url = deps.env.UPSTASH_REDIS_REST_URL;
  const token = deps.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Coded("store");
  let res;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      redirect: "error",
    });
  } catch {
    throw new Coded("store");
  }
  if (!res.ok) throw new Coded("store");
  const body = await res.json().catch(() => null);
  return body?.result ?? null;
}

function acctKey(id) {
  return `grill:hosted:acct:${id}`;
}
/**
 * Grill owns the person ID. The sign-in provider's user ID only points at it, per
 * issuer, so a new provider or a new Clerk instance links back by verified email
 * instead of starting a fresh account.
 */
function identKey(env, sub) {
  const issuer = String(env.CLERK_ISSUER || "").trim().replace(/\/$/, "");
  const ns = createHash("sha256").update(issuer).digest("hex").slice(0, 16);
  return `grill:hosted:ident:${ns}:${sub}`;
}
/** Every provider link a person has, so deleting the account removes them all. */
function identsOf(id) {
  return `grill:hosted:idents:${id}`;
}
function personIndex(email) {
  return `grill:hosted:person:${createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex")}`;
}
function emailIndex(email) {
  return `grill:hosted:email:${createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex")}`;
}
function recordRedisKey(userId, id) {
  return `grill:hosted:record:${userId}:${id}`;
}
function recordIndex(userId) {
  return `grill:hosted:records:${userId}`;
}
function jobRedisKey(id) {
  return `grill:hosted:job:${id}`;
}
function runningKey(userId) {
  return `grill:hosted:running:${userId}`;
}
function pendingIndex(userId) {
  return `grill:hosted:pendings:${userId}`;
}
function pendingRedisKey(userId, id) {
  return `grill:hosted:pending:${userId}:${id}`;
}
const PENDING_TTL_SECONDS = 14 * 24 * 60 * 60;
/**
 * Fields that a running grill changes live in their own keys, written with atomic
 * commands, so two grills finishing at once can't overwrite each other's copy of
 * the account record.
 */
function spendLogKey(userId) {
  return `grill:hosted:spendlog:${userId}`;
}
function disclosedKey(userId) {
  return `grill:hosted:disclosed:${userId}`;
}
function recordKeyRedisKey(userId) {
  return `grill:hosted:rkey:${userId}`;
}
/** The calendar link, by the hash of its secret: which account, and whether titles are on. */
function calendarFeedKey(hash) {
  return `grill:hosted:calfeed:${hash}`;
}
/** The account's current calendar link hash, so off, reset and delete can find it. */
function calendarOfKey(userId) {
  return `grill:hosted:calof:${userId}`;
}
/** Set once a UTC day when grill_decided showed the look-back line. */
function remindedKey(userId, day) {
  return `grill:hosted:reminded:${userId}:${day}`;
}
/** Month spend counters for the caps, in micro-dollars. The person key is a hash of the email, never the email. */
function serviceSpendKey(month) {
  return `grill:hosted:capspend:all:${month}`;
}
function personSpendKey(email, month) {
  const hash = createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex");
  return `grill:hosted:capspend:person:${hash}:${month}`;
}
const SPEND_LOG_MAX = 400;
/**
 * Active-user counts for the operator's metrics summary. Each key is an Upstash HyperLogLog:
 * it holds an approximate count of distinct members and cannot list them back. The member is
 * a keyed hash (HMAC-SHA256) of the person the starter cap belongs to, salted with
 * GRILL_METRICS_SALT (or GRILL_RECORD_KEY when that isn't set), so it isn't an email, an
 * account id, or a hash anyone could match to an email without the salt. No content, no model.
 */
const ACTIVE_TTL_SECONDS = { day: 120 * 86400, week: 400 * 86400, month: 800 * 86400 };
export function isoWeek(ms = Date.now()) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export function activeKeys(ms = Date.now()) {
  return {
    day: `grill:hosted:active:day:${isoDay(ms)}`,
    week: `grill:hosted:active:week:${isoWeek(ms)}`,
    month: `grill:hosted:active:month:${isoMonth(ms)}`,
  };
}
export function activeMember(person, env = {}) {
  const salt = String(env.GRILL_METRICS_SALT || env.GRILL_RECORD_KEY || "").trim();
  if (!salt || !person) return "";
  return createHmac("sha256", salt).update(`active:${String(person).trim().toLowerCase()}`).digest("hex").slice(0, 32);
}
/** Best effort: a counting failure never blocks or fails a tool call. */
async function countActive(account, deps) {
  try {
    const member = activeMember(capPerson(account), deps.env);
    if (!member) return;
    const keys = activeKeys(typeof deps.now === "number" ? deps.now : Date.now());
    for (const period of ["day", "week", "month"]) {
      await redis(deps, ["PFADD", keys[period], member]);
      await redis(deps, ["EXPIRE", keys[period], String(ACTIVE_TTL_SECONDS[period])]);
    }
  } catch {
    // ignored on purpose
  }
}
function dayKey(userId, day) {
  return `grill:hosted:day:${userId}:${day}`;
}

async function loadJwks(url, fetchImpl) {
  const hit = jwksCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.keys;
  const res = await fetchImpl(url, { redirect: "error" });
  if (!res.ok) throw new Coded("jwks");
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}

function blankAuthClaims() {
  return { iss: "", aud: "", azp: "", client_id: "", exp: null, expired: false };
}

/**
 * Claims that may be written when a bearer is rejected. The 60 second leeway
 * matches the check below. Email, subject and every other claim are left out.
 */
function jwtPublicClaims(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const exp = typeof body.exp === "number" ? body.exp : null;
  const now = Math.floor(Date.now() / 1000);
  let aud = "";
  if (typeof body.aud === "string") aud = body.aud;
  else if (Array.isArray(body.aud)) aud = body.aud.filter((item) => typeof item === "string");
  return {
    iss: typeof body.iss === "string" ? body.iss : "",
    aud,
    azp: typeof body.azp === "string" ? body.azp : "",
    client_id: typeof body.client_id === "string" ? body.client_id : "",
    exp,
    expired: exp === null || exp + 60 < now,
  };
}

function authRejectLog(request, reason, claims) {
  const safe = claims || blankAuthClaims();
  const ua = String(request.headers.get("user-agent") || "").replace(/[\r\n]+/g, " ").slice(0, 300);
  return `[grill-hosted] auth-reject ${JSON.stringify({
    reason,
    iss: safe.iss,
    aud: safe.aud,
    azp: safe.azp,
    client_id: safe.client_id,
    exp: safe.exp,
    expired: safe.expired === true,
    user_agent: ua,
  })}`;
}

/** One warning line for a presented bearer that did not verify. */
function logBearerReject(request, reason, claims) {
  const text = authRejectLog(request, reason, claims);
  console.warn(text);
}

function jwtFail(reason, claims) {
  return { reason, claims: claims || blankAuthClaims() };
}

/** RS256 signature against the Clerk JWKS. Returns the payload, or null. Claims are not checked here. */
async function verifiedPayload(token, jwksUrl, fetchImpl) {
  const checked = await readSignedPayload(token, jwksUrl, fetchImpl);
  return checked.payload || null;
}

async function readSignedPayload(token, jwksUrl, fetchImpl) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return jwtFail("malformed");
  const [h64, p64, s64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p64, "base64url").toString("utf8"));
  } catch {
    return jwtFail("malformed");
  }
  const claims = jwtPublicClaims(payload);
  if (header.alg !== "RS256" || !header.kid) return jwtFail("alg", claims);
  const keys = await loadJwks(jwksUrl, fetchImpl);
  const jwk = keys.find((key) => key.kid === header.kid) || null;
  if (!jwk) return jwtFail("kid", claims);
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, Buffer.from(s64, "base64url"), Buffer.from(`${h64}.${p64}`));
  if (!ok) return jwtFail("signature", claims);
  return { payload };
}

/** Payload when the token is accepted, otherwise null. Page sign-in uses this. */
async function verifyJwt(token, options) {
  const checked = await checkJwt(token, options);
  return checked.payload || null;
}

async function checkJwt(token, { issuer, jwksUrl, resource, fetchImpl, requireAudience }) {
  const signed = await readSignedPayload(token, jwksUrl, fetchImpl);
  if (!signed.payload) return signed.reason ? signed : jwtFail("malformed");
  const payload = signed.payload;
  const claims = jwtPublicClaims(payload);
  const iss = String(payload.iss || "").replace(/\/$/, "");
  const want = String(issuer || "").replace(/\/$/, "");
  if (!want || iss !== want) return jwtFail("issuer", claims);
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + 60 < now) {
    claims.expired = true;
    return jwtFail("expired", claims);
  }
  claims.expired = false;
  if (typeof payload.nbf === "number" && payload.nbf - 60 > now) return jwtFail("nbf", claims);
  if (typeof payload.sub !== "string" || !payload.sub) return jwtFail("sub", claims);
  if (requireAudience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : typeof payload.aud === "string" ? [payload.aud] : [];
    if (!aud.includes(resource)) return jwtFail("audience", claims);
  }
  return { payload };
}

function jwksUrl(env) {
  if (typeof env.CLERK_JWKS_URL === "string" && env.CLERK_JWKS_URL.trim()) return env.CLERK_JWKS_URL.trim();
  const issuer = String(env.CLERK_ISSUER || "").replace(/\/$/, "");
  return issuer ? `${issuer}/.well-known/jwks.json` : "";
}

async function clerkUser(userId, deps) {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < CREDIT_CACHE_MS) return hit.user;
  const secret = deps.env.CLERK_SECRET_KEY;
  if (!secret) throw new Coded("clerk");
  const res = await deps.fetch(`${CLERK_API}/v1/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "error",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Coded("clerk");
  const user = await res.json();
  userCache.set(userId, { at: Date.now(), user });
  return user;
}

function verifiedEmail(user) {
  const emails = Array.isArray(user?.email_addresses) ? user.email_addresses : [];
  const primary = emails.find((row) => row.id === user.primary_email_address_id) || emails[0];
  if (!primary || primary.verification?.status !== "verified") return "";
  return String(primary.email_address || "").trim().toLowerCase();
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^@\s]+@[^@\s]+$/.test(email)) return "";
  return email;
}

/** Clerk's AgentID connection. The strategy on the external account is oauth_agentid. */
function agentIdSignIn(user) {
  const accounts = Array.isArray(user?.external_accounts) ? user.external_accounts : [];
  return accounts.some((row) => {
    const provider = String(row?.provider || "");
    const strategy = String(row?.verification?.strategy || "");
    return provider === AGENTID_PROVIDER || strategy === AGENTID_PROVIDER;
  });
}

function ownerCacheKey(userId) {
  return `grill:hosted:owner:${userId}`;
}

function scopeNames(scopes) {
  if (Array.isArray(scopes)) return scopes.map((item) => String(item).trim()).filter(Boolean);
  if (typeof scopes === "string" && scopes.trim()) return scopes.split(/[\s,]+/).filter(Boolean);
  return null;
}

/** Clerk returns a list, or `{ data: [...] }` on the current API. The token is not kept. */
function agentIdAccessToken(body) {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  const row = rows[0];
  const token = typeof row?.token === "string" ? row.token.trim() : "";
  if (!token) return "";
  const scopes = scopeNames(row?.scopes);
  if (scopes && !scopes.includes("owner_email")) return "";
  return token;
}

/**
 * The human owner's email, from AgentID, for an agent whose own email is not
 * already allowed. Empty means not allowed: a failed call, no token, no
 * owner_email scope, a missing address, or an owner email that is not verified.
 * The token is not stored and not logged.
 */
async function readOwnerEmail(userId, deps) {
  const secret = deps.env.CLERK_SECRET_KEY;
  if (!secret || !userId) return "";
  let tokenRes;
  try {
    tokenRes = await deps.fetch(`${CLERK_API}/v1/users/${encodeURIComponent(userId)}/oauth_access_tokens/${AGENTID_PROVIDER}`, {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "error",
    });
  } catch {
    return "";
  }
  if (!tokenRes.ok) return "";
  const token = agentIdAccessToken(await tokenRes.json().catch(() => null));
  if (!token) return "";
  let infoRes;
  try {
    infoRes = await deps.fetch(AGENTID_USERINFO, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
    });
  } catch {
    return "";
  }
  if (!infoRes.ok) return "";
  const info = await infoRes.json().catch(() => null);
  if (info?.owner_email_verified !== true) return "";
  return cleanEmail(info?.owner_email);
}

/** Remember the owner lookup for ten minutes, including a miss, so it is not repeated on every request. */
async function cachedOwnerEmail(userId, deps) {
  const key = ownerCacheKey(userId);
  try {
    const cached = await redis(deps, ["GET", key]);
    if (cached === "-") return "";
    const email = typeof cached === "string" ? cleanEmail(cached) : "";
    if (email) return email;
  } catch {
    // A store miss is not a grant. Ask AgentID for this request.
  }
  const owner = await readOwnerEmail(userId, deps);
  try {
    await redis(deps, ["SET", key, owner || "-", "EX", OWNER_CACHE_SECONDS]);
  } catch {
    // This request still uses the answer it just got.
  }
  return owner;
}

/**
 * Allowed when their own verified email is on the list, or when an AgentID
 * sign-in names a verified owner email that is. The owner is looked up only
 * for an AgentID sign-in whose own email is not already allowed. `human` is
 * the email the starter cap is keyed to: the owner for an agent admitted that
 * way, otherwise their own email.
 */
async function admit(user, deps, userId) {
  const email = verifiedEmail(user);
  if (!email) return { email: "", human: "", allowed: false };
  if (!agentIdSignIn(user) || allowlistAllows(email, deps.env)) {
    return { email, human: email, allowed: allowlistAllows(email, deps.env) };
  }
  const owner = await cachedOwnerEmail(user?.id || userId, deps);
  const allowed = Boolean(owner) && allowlistAllows(owner, deps.env);
  return { email, human: allowed ? owner : email, allowed };
}

async function loadAccount(id, deps) {
  const raw = await redis(deps, ["GET", acctKey(id)]);
  if (!raw) return null;
  let account;
  try {
    account = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!account.recordKeyCipher) {
    const cipher = await redis(deps, ["GET", recordKeyRedisKey(id)]);
    if (typeof cipher === "string" && cipher) account.recordKeyCipher = cipher;
  }
  return account;
}

async function saveAccount(account, deps) {
  const copy = {
    id: account.id,
    email: account.email,
    records: account.records ?? null,
    keyCipher: account.keyCipher || null,
    keyHash: account.keyHash || null,
    keyLimitUsd: account.keyLimitUsd ?? null,
    keyName: account.keyName || null,
    recordKeyCipher: account.recordKeyCipher || null,
    spend: (account.spend || []).map((row) => ({
      at: row.at,
      costUsd: Number(row.costUsd) || 0,
      model: typeof row.model === "string" ? row.model : "",
    })),
    createdAt: account.createdAt,
  };
  if (account.disclosed === true) copy.disclosed = true;
  // The person the starter cap belongs to, when this sign-in is an agent.
  if (account.human && account.human !== account.email) copy.human = account.human;
  // Set when this sign-in spends a key minted for someone else. Deleting it must not revoke that key.
  if (account.capFrom) copy.capFrom = account.capFrom;
  await redis(deps, ["SET", acctKey(account.id), JSON.stringify(copy)]);
}

function openSecret(cipher, env, name) {
  const master = keyFromEnv(env, name);
  if (!master || !cipher) return null;
  try {
    return decryptString(cipher, master);
  } catch {
    return null;
  }
}

/**
 * The Grill ID for a signed-in person. Order: this provider's ID already linked;
 * else the person with this verified email; else an account made before Grill IDs,
 * which keeps the provider's ID as its Grill ID so no data moves; else a new ID.
 * Only a verified email may link, or anyone could claim someone else's records.
 */
async function resolvePerson(sub, email, deps) {
  const ident = identKey(deps.env, sub);
  const known = await redis(deps, ["GET", ident]);
  if (known) return known;
  const own = cleanEmail(email);
  let id = own ? await redis(deps, ["GET", personIndex(own)]) : null;
  if (!id) {
    // Accounts made before Grill IDs keep the provider's ID they were filed under:
    // this provider's own, or the one the starter-credit claim for this email names.
    let legacy = (await redis(deps, ["GET", acctKey(sub)])) ? sub : "";
    if (!legacy && own) {
      const claim = await redis(deps, ["GET", emailIndex(own)]);
      const held = claim ? await loadAccount(claim, deps) : null;
      if (held && held.email === own) legacy = claim;
    }
    const mine = legacy || `g_${randomUUID()}`;
    id = mine;
    if (own) {
      const claimed = await redis(deps, ["SET", personIndex(own), mine, "NX"]);
      if (claimed !== "OK") id = (await redis(deps, ["GET", personIndex(own)])) || mine;
    }
  }
  const linked = await redis(deps, ["SET", ident, id, "NX"]);
  if (linked !== "OK") return (await redis(deps, ["GET", ident])) || id;
  await redis(deps, ["SADD", identsOf(id), ident]);
  return id;
}

async function ensureAccount(userId, email, deps, human) {
  const own = String(email || "").trim().toLowerCase();
  const capEmail = cleanEmail(human) || own;
  let account = await loadAccount(userId, deps);
  if (!account) {
    account = {
      id: userId,
      email: own,
      human: capEmail,
      records: null,
      keyCipher: null,
      keyHash: null,
      keyLimitUsd: null,
      keyName: null,
      recordKeyCipher: null,
      spend: [],
      createdAt: new Date().toISOString(),
    };
    await saveAccount(account, deps);
  } else if (account.email !== own) {
    // Move the email link with the account, so a reassigned old address can't link in.
    if (account.email) {
      const holder = await redis(deps, ["GET", personIndex(account.email)]);
      if (holder === userId) await redis(deps, ["DEL", personIndex(account.email)]);
    }
    if (own) await redis(deps, ["SET", personIndex(own), userId, "NX"]);
    account.email = own;
    await saveAccount(account, deps);
  }
  if (account.keyCipher && account.keyHash) return account;
  if ((account.human || account.email) !== capEmail) {
    account.human = capEmail;
    await saveAccount(account, deps);
  }
  const prior = await redis(deps, ["GET", emailIndex(capEmail)]);
  if (prior && prior !== userId) {
    // An agent spends the key already minted for this person. A second sign-in
    // with the same email still does not get a second key.
    if (capEmail !== own) {
      const holder = await loadAccount(prior, deps);
      if (holder?.keyCipher && holder.keyHash) {
        account.keyCipher = holder.keyCipher;
        account.keyHash = holder.keyHash;
        account.keyLimitUsd = holder.keyLimitUsd ?? null;
        account.keyName = holder.keyName || null;
        account.capFrom = prior;
        account.human = capEmail;
        await saveAccount(account, deps);
        return account;
      }
    }
    account.creditBlocked = "email";
    return account;
  }
  const name = `grill-h-${randomBytes(8).toString("hex")}`;
  const master = keyFromEnv(deps.env, "GRILL_KEY_ENCRYPTION_KEY");
  if (!master) throw new Coded("key-encryption");
  let made;
  try {
    made = await createCappedKey({
      env: deps.env,
      fetch: deps.fetch,
      name,
      limit: starterCreditUsd(deps.env),
      reset: null,
    });
  } catch {
    throw new Coded("starter-key");
  }
  // Claim the email atomically. If a second request for the same person got there
  // first, switch off the key just minted so no one ends up with two starter credits.
  const claimed = await redis(deps, ["SET", emailIndex(capEmail), userId, "NX"]);
  const holderId = claimed === "OK" ? userId : await redis(deps, ["GET", emailIndex(capEmail)]);
  if (holderId !== userId) {
    await removeManagedKey(made.hash, { env: deps.env, fetch: deps.fetch }).catch(() => logHosted(deps.requestId, "key-revoke"));
    account.creditBlocked = "email";
    return account;
  }
  const fresh = await loadAccount(userId, deps);
  if (fresh?.keyCipher && fresh.keyHash) {
    await removeManagedKey(made.hash, { env: deps.env, fetch: deps.fetch }).catch(() => logHosted(deps.requestId, "key-revoke"));
    return fresh;
  }
  account.keyCipher = encryptString(made.key, master);
  account.keyHash = made.hash;
  account.keyLimitUsd = made.limitUsd;
  account.keyName = name;
  await saveAccount(account, deps);
  return account;
}

async function creditOf(account, deps) {
  const now = Date.now();
  const hit = creditCache.get(account.id);
  if (hit && now - hit.at < CREDIT_CACHE_MS) return hit;
  if (!account.keyHash) return { at: now, remaining: 0, out: true };
  const live = await readManagedKey(account.keyHash, { env: deps.env, fetch: deps.fetch });
  if (!live || live.disabled) {
    const row = { at: now, remaining: 0, out: true };
    creditCache.set(account.id, row);
    return row;
  }
  const usage = Number(live.usageTotalUsd) || 0;
  const limit = Number.isFinite(live.limitUsd) ? live.limitUsd : Number(account.keyLimitUsd) || 0;
  const remaining = Math.max(0, limit - usage);
  const row = { at: now, remaining, out: remaining <= 0 };
  creditCache.set(account.id, row);
  return row;
}

async function dataKeyFor(account, deps) {
  const master = keyFromEnv(deps.env, "GRILL_RECORD_KEY");
  if (!master) throw new Coded("record-key");
  if (account.recordKeyCipher) {
    const raw = decryptString(account.recordKeyCipher, master);
    return Buffer.from(raw, "base64");
  }
  // Two grills can reach here at once. SET NX lets exactly one data key win; the
  // other reads the winner back, so no record is ever sealed with a key that is then lost.
  const mine = encryptString(randomBytes(32).toString("base64"), master);
  await redis(deps, ["SET", recordKeyRedisKey(account.id), mine, "NX"]);
  const winner = await redis(deps, ["GET", recordKeyRedisKey(account.id)]);
  if (typeof winner !== "string" || !winner) throw new Coded("store");
  account.recordKeyCipher = winner;
  return Buffer.from(decryptString(winner, master), "base64");
}

async function loadRecords(account, deps) {
  if (!account.recordKeyCipher) return [];
  const ids = (await redis(deps, ["ZRANGE", recordIndex(account.id), "0", "-1"])) || [];
  let dataKey;
  try {
    dataKey = await dataKeyFor(account, deps);
  } catch {
    return [];
  }
  const rows = [];
  for (const id of ids) {
    const cipher = await redis(deps, ["GET", recordRedisKey(account.id, id)]);
    if (typeof cipher !== "string" || !cipher) continue;
    try {
      rows.push(JSON.parse(decryptString(cipher, dataKey)));
    } catch {
      // A record we cannot read is skipped. It is not logged.
    }
  }
  return rows;
}

async function writeRecord(account, deps, row) {
  const dataKey = await dataKeyFor(account, deps);
  const cipher = encryptString(JSON.stringify(row), dataKey);
  await redis(deps, ["SET", recordRedisKey(account.id, row.id), cipher]);
  await redis(deps, ["ZADD", recordIndex(account.id), Date.parse(row.createdAt) || Date.now(), row.id]);
}

async function calendarState(account, deps) {
  const hash = await redis(deps, ["GET", calendarOfKey(account.id)]);
  if (typeof hash !== "string" || !hash) return { on: false, titles: false };
  const raw = await redis(deps, ["GET", calendarFeedKey(hash)]);
  let feed = null;
  try {
    feed = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    feed = null;
  }
  if (!feed || feed.id !== account.id) return { on: false, titles: false };
  return { on: true, titles: feed.titles === true };
}

async function calendarOff(account, deps) {
  const hash = await redis(deps, ["GET", calendarOfKey(account.id)]);
  if (typeof hash === "string" && hash) await redis(deps, ["DEL", calendarFeedKey(hash)]);
  await redis(deps, ["DEL", calendarOfKey(account.id)]);
}

/** A new secret link. Any old one stops working. The raw token is returned once and not stored. */
async function calendarOn(account, deps, titles) {
  await calendarOff(account, deps);
  const token = newCalendarToken();
  const hash = calendarTokenHash(token);
  await redis(deps, ["SET", calendarFeedKey(hash), JSON.stringify({ id: account.id, titles: titles === true })]);
  await redis(deps, ["SET", calendarOfKey(account.id), hash]);
  return token;
}

/** Titles on or off for the link already issued. The link itself does not change. */
async function calendarTitles(account, deps, titles) {
  const hash = await redis(deps, ["GET", calendarOfKey(account.id)]);
  if (typeof hash !== "string" || !hash) return;
  await redis(deps, ["SET", calendarFeedKey(hash), JSON.stringify({ id: account.id, titles: titles === true })]);
}

/** Form actions shared by /decisions and /account. Returns a fresh link token when one was made. */
async function calendarAction(account, deps, value) {
  if (value === "on") {
    const state = await calendarState(account, deps);
    if (state.on) return "";
    return calendarOn(account, deps, false);
  }
  if (value === "reset") {
    const state = await calendarState(account, deps);
    return calendarOn(account, deps, state.titles);
  }
  if (value === "off") await calendarOff(account, deps);
  else if (value === "titles-on") await calendarTitles(account, deps, true);
  else if (value === "titles-off") await calendarTitles(account, deps, false);
  return "";
}

async function deleteRecordIds(account, deps, ids) {
  for (const id of ids) {
    await redis(deps, ["DEL", recordRedisKey(account.id, id)]);
    await redis(deps, ["ZREM", recordIndex(account.id), id]);
  }
}

function judgeChildEnv(apiKey, deps) {
  const env = {
    PATH: process.env.PATH || "",
    TMPDIR: process.env.TMPDIR || tmpdir(),
    OPENROUTER_API_KEY: apiKey,
  };
  if (deps.judgeOpenRouterUrl) env.JUDGE_OPENROUTER_URL = deps.judgeOpenRouterUrl;
  if (deps.judgeDecisionsUrl) env.JUDGE_DECISIONS_URL = deps.judgeDecisionsUrl;
  return env;
}

function startJudge({ subject, question, author, check, apiKey, deps }) {
  const dir = mkdtempSync(join(tmpdir(), "grill-hosted-"));
  const args = [JUDGE, "--json", "--out", join(dir, "report.md"), "--author", author];
  if (question) args.push("--question", question);
  if (check) args.push("--check");
  const child = spawn(process.execPath, args, { env: judgeChildEnv(apiKey, deps), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const job = { done: false };
  job.promise = new Promise((resolve) => {
    const finish = (code) => {
      if (job.done) return;
      let report = "";
      try {
        report = readFileSync(join(dir, "report.md"), "utf8");
      } catch {
        report = "";
      }
      rmSync(dir, { recursive: true, force: true });
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
      job.done = true;
      job.outcome = { code: code ?? 1, report, stderr, parsed };
      resolve(job.outcome);
    };
    child.on("close", (code) => finish(code));
    child.on("error", () => finish(1));
  });
  child.stdin.on("error", () => {});
  child.stdin.end(subject);
  return job;
}

async function waitFor(job, ms) {
  const deadline = Date.now() + ms;
  while (!job.done && Date.now() < deadline) {
    let timer;
    const tick = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.min(200, Math.max(0, deadline - Date.now())));
    });
    await Promise.race([job.promise, tick]);
    clearTimeout(timer);
  }
  return job.done;
}

function schedule(promise, deps, id) {
  if (Array.isArray(deps.backgrounds)) deps.backgrounds.push(promise);
  try {
    const holder = globalThis[Symbol.for("@vercel/request-context")];
    const ctx = typeof holder?.get === "function" ? holder.get() : holder;
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(promise);
  } catch {
    // The promise still runs here. waitUntil is what keeps it alive on Vercel after the response.
  }
  promise.catch(() => logHosted(id, "background"));
}

function clientFromToken(payload, params) {
  const clientInfo = params?._meta?.clientInfo || params?.clientInfo || null;
  return sourceAppFromClient({
    redirectUri: typeof payload.redirect_uri === "string" ? payload.redirect_uri : "",
    clientId: typeof payload.client_id === "string" ? payload.client_id : typeof payload.azp === "string" ? payload.azp : "",
    clientInfo,
  });
}

function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function draftFromGrill({ subject, parsed, sourceApp, supersedes, changed, now, layers }) {
  const when = now instanceof Date ? now : new Date(now);
  const challenges = Array.isArray(parsed?.challenges) ? parsed.challenges : [];
  const falsifier = oneLine(challenges[0]?.falsifier) || "none named";
  const thin = isThinGrill(parsed, subject);
  const verdict = thin ? "quick take" : plainVerdict(parsed?.verdict);
  return {
    id: randomBytes(8).toString("hex"),
    createdAt: when.toISOString(),
    date: isoDate(when),
    title: decisionTitle(subject),
    prediction: predictionFromSubject(subject),
    verdict: verdict === "unknown" ? "" : verdict,
    falsifier,
    goal: goalFromSubject(subject),
    guardrails: guardrailsFromSubject(subject),
    sourceApp: sourceApp || "unknown",
    supersedes: oneLine(supersedes),
    changed: oneLine(changed),
    challenges: challenges.slice(0, 2).map((row, index) => {
      const line = `${index + 1}. ${oneLine(row.challenge)} — ${oneLine(row.falsifier)}`;
      return line.length > 400 ? `${line.slice(0, 399)}…` : line;
    }),
    layers: layers || null,
  };
}

async function loadPendings(account, deps) {
  if (!account.recordKeyCipher && account.records !== "keep") return [];
  const ids = (await redis(deps, ["ZRANGE", pendingIndex(account.id), "0", "-1"])) || [];
  if (!ids.length) return [];
  let dataKey;
  try {
    dataKey = await dataKeyFor(account, deps);
  } catch {
    return [];
  }
  const rows = [];
  for (const id of ids) {
    const cipher = await redis(deps, ["GET", pendingRedisKey(account.id, id)]);
    if (typeof cipher !== "string" || !cipher) continue;
    try {
      rows.push(JSON.parse(decryptString(cipher, dataKey)));
    } catch {
      // A draft we cannot read is skipped. It is not logged.
    }
  }
  return rows;
}

async function writePending(account, deps, row) {
  const dataKey = await dataKeyFor(account, deps);
  const cipher = encryptString(JSON.stringify(row), dataKey);
  await redis(deps, ["SET", pendingRedisKey(account.id, row.id), cipher, "EX", PENDING_TTL_SECONDS]);
  await redis(deps, ["ZADD", pendingIndex(account.id), Date.parse(row.createdAt) || Date.now(), row.id]);
  await redis(deps, ["EXPIRE", pendingIndex(account.id), PENDING_TTL_SECONDS]);
}

async function deletePending(account, deps, id) {
  await redis(deps, ["DEL", pendingRedisKey(account.id, id)]);
  await redis(deps, ["ZREM", pendingIndex(account.id), id]);
}

/** The person the starter credit and the per-person cap belong to. */
function capPerson(account) {
  return account.human || account.email || account.id;
}

async function countSpend(account, deps, costUsd) {
  const month = isoMonth(typeof deps.now === "number" ? deps.now : Date.now());
  const micros = toMicros(chargeableUsd(costUsd));
  for (const key of [serviceSpendKey(month), personSpendKey(capPerson(account), month)]) {
    await redis(deps, ["INCRBY", key, String(micros)]);
    await redis(deps, ["EXPIRE", key, String(CAP_COUNTER_TTL_SECONDS)]);
  }
}

async function capReached(account, deps) {
  const month = isoMonth(typeof deps.now === "number" ? deps.now : Date.now());
  const serviceMicros = Number(await redis(deps, ["GET", serviceSpendKey(month)])) || 0;
  const userMicros = Number(await redis(deps, ["GET", personSpendKey(capPerson(account), month)])) || 0;
  return capBlock({ serviceMicros, userMicros, env: deps.env });
}

/** True exactly once per account, even when two grills finish together. */
async function firstDisclosure(account, deps) {
  if (account.disclosed === true) return false;
  const won = await redis(deps, ["SET", disclosedKey(account.id), "1", "NX"]);
  account.disclosed = true;
  return won === "OK";
}

async function composeReport({ outcome, subject, sourceApp, account, credit, supersedes, changed, deps }) {
  const stderr = String(outcome?.stderr || "");
  const parsed = outcome?.parsed || null;
  if (!outcome || outcome.code !== 0 || (!parsed && !String(outcome.report || "").trim())) {
    logHosted(deps.requestId, `judge-exit ${outcome?.code ?? "none"}`);
    return { text: judgeFailureText(stderr, deps.requestId), isError: true };
  }
  const now = typeof deps.now === "number" ? new Date(deps.now) : new Date();
  const layers = renderLayers(parsed || {}, { subject });
  const keep = account.records === "keep";
  if (keep) {
    await writePending(
      account,
      deps,
      draftFromGrill({
        subject,
        parsed,
        sourceApp,
        supersedes: typeof supersedes === "string" ? supersedes : "",
        changed: typeof changed === "string" ? changed : "",
        now,
        layers,
      }),
    );
  }
  const cost = Number(parsed?.costUsd) || 0;
  const model = typeof parsed?.servedModel === "string" ? parsed.servedModel : "";
  // Atomic appends and counters only. The account record itself is not rewritten
  // here, so a grill finishing in the background can't undo another one's changes.
  await redis(deps, ["RPUSH", spendLogKey(account.id), JSON.stringify({ at: new Date().toISOString(), costUsd: cost, model })]);
  await redis(deps, ["LTRIM", spendLogKey(account.id), String(-SPEND_LOG_MAX), "-1"]);
  await countSpend(account, deps, cost);
  let text = layers.brief.trim();
  if (await firstDisclosure(account, deps)) text = `${ONCE_DISCLOSURE}\n\n${text}`;
  creditCache.delete(account.id);
  return { text: `${text.trim()}\n`, layers, isError: false };
}

async function storeJobResult(credential, result, deps) {
  const cipher = encryptString(
    JSON.stringify({ text: result.text, layers: result.layers || null, isError: result.isError }),
    credential.key,
  );
  await redis(deps, ["SET", jobRedisKey(credential.id), cipher, "EX", JOB_TTL_SECONDS]);
}

function layerFromStored(stored, detail) {
  const key = detail === "more" || detail === "options" || detail === "full" ? detail : "brief";
  if (key === "brief") return String(stored?.text || stored?.layers?.brief || "");
  const layer = stored?.layers?.[key];
  return typeof layer === "string" && layer.trim() ? layer : "";
}

async function callGrill(args, account, payload, params, deps) {
  if (account.creditBlocked === "email") {
    return toolText("This email already has Grill's free starter credit on another sign-in. Sign in with that account instead, or write to support@grillyour.ai if you've lost it.", true);
  }
  const capped = await capReached(account, deps);
  if (capped) {
    logHosted(deps.requestId, `cap-${capped.which}`);
    return toolText(capped.text);
  }
  const credit = await creditOf(account, deps);
  if (credit.out) return toolText(OUT_OF_CREDIT, true);
  const keepArg = args.keep_records;
  if (account.records !== "keep" && account.records !== "off" && typeof keepArg !== "boolean") {
    return toolText(CONSENT_TEXT);
  }
  if (typeof keepArg === "boolean" && account.records !== (keepArg ? "keep" : "off")) {
    account.records = keepArg ? "keep" : "off";
    await saveAccount(account, deps);
  }
  const subject = typeof args.subject === "string" ? args.subject : "";
  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!subject.trim()) return toolText("There's no subject to grill. Write it, show it to the person, then call again.", true);
  if (subject.length > MAX_SUBJECT_CHARS) return toolText(`The subject is ${subject.length} characters; trim it under ${MAX_SUBJECT_CHARS}.`, true);
  if (question.length > MAX_QUESTION_CHARS) return toolText(`The question is over ${MAX_QUESTION_CHARS} characters; shorten it.`, true);
  const client = clientFromToken(payload, params);
  const author = authorForJudge({ explicit: args.author, company: client.company });
  if (author.error) return toolText(author.error, true);
  if (account.records === "keep" && !keyFromEnv(deps.env, "GRILL_RECORD_KEY")) {
    logHosted(deps.requestId, "record-key");
    return toolText("Grill can't save decision records right now because of a setup problem on our side. Turn records off on your account page to grill without saving, or write to support@grillyour.ai.", true);
  }
  const slotWait = Number.isInteger(deps.waitMs) ? deps.waitMs : 45_000;
  const slotDeadline = Date.now() + Math.max(0, slotWait);
  let running = Number(await redis(deps, ["SCARD", runningKey(account.id)])) || 0;
  while (running >= RUNNING_JOB_LIMIT && Date.now() < slotDeadline) {
    const pause = Math.min(250, slotDeadline - Date.now());
    if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
    running = Number(await redis(deps, ["SCARD", runningKey(account.id)])) || 0;
  }
  if (running >= RUNNING_JOB_LIMIT) return toolText(CAP_RETRY_TEXT, true);
  const today = isoDay(Date.now());
  const used = Number(await redis(deps, ["GET", dayKey(account.id, today)])) || 0;
  if (used >= DAILY_GRILL_LIMIT) return toolText(`You've used today's ${DAILY_GRILL_LIMIT} grills on this account. It resets tomorrow (UTC).`);
  await redis(deps, ["INCR", dayKey(account.id, today)]);
  await redis(deps, ["EXPIRE", dayKey(account.id, today), 172800]);
  const apiKey = openSecret(account.keyCipher, deps.env, "GRILL_KEY_ENCRYPTION_KEY");
  if (!apiKey) {
    logHosted(deps.requestId, "key-open");
    return toolText(serviceFailureText("key-encryption", deps.requestId), true);
  }
  const credential = newJobCredential();
  await redis(deps, ["SADD", runningKey(account.id), credential.id]);
  await redis(deps, ["EXPIRE", runningKey(account.id), JOB_TTL_SECONDS]);
  const job = startJudge({
    subject,
    question,
    author: author.author,
    check: args.quality_check !== false,
    apiKey,
    deps,
  });
  const waitMs = Number.isInteger(deps.waitMs) ? deps.waitMs : 45_000;
  const release = async () => {
    await redis(deps, ["SREM", runningKey(account.id), credential.id]);
  };
  const done = await waitFor(job, waitMs);
  if (done) {
    await release();
    const result = await composeReport({
      outcome: job.outcome,
      subject,
      sourceApp: client.sourceApp,
      account,
      credit,
      supersedes: args.supersedes,
      changed: args.changed,
      deps,
    });
    if (account.records !== "keep" && !result.isError) {
      const credential = newJobCredential();
      await storeJobResult(credential, result, deps);
      return toolText(`${result.text.trim()}\n\nfollow: ${credential.jobId}\n`, false);
    }
    return toolText(result.text, result.isError);
  }
  const pending = job.promise.then(async (outcome) => {
    try {
      const result = await composeReport({
        outcome,
        subject,
        sourceApp: client.sourceApp,
        account,
        credit,
        supersedes: args.supersedes,
        changed: args.changed,
        deps,
      });
      await storeJobResult(credential, result, deps);
    } finally {
      await release();
    }
  });
  schedule(pending, deps, deps.requestId);
  return toolText(hostedStillRunningText(credential.jobId));
}

async function layerFromPending(account, deps, detail) {
  if (account.records !== "keep") return "";
  const pendings = await loadPendings(account, deps);
  const pending = pendings[pendings.length - 1];
  const layer = pending?.layers?.[detail];
  return typeof layer === "string" ? layer : "";
}

async function callResult(args, account, deps) {
  const detail = normalizeDetail(args.detail);
  const credential = parseJobCredential(typeof args.job_id === "string" ? args.job_id : "");
  if (!credential) {
    const layer = await layerFromPending(account, deps, detail);
    if (!layer.trim()) {
      return toolText("No stored layer for that. Pass the job id from the grill, including a follow: line, and do not show that line.", true);
    }
    return toolText(`${layer.trim()}\n`);
  }
  const waitMs = Number.isInteger(deps.waitMs) ? deps.waitMs : 45_000;
  const deadline = Date.now() + waitMs;
  let cipher = null;
  while (Date.now() <= deadline) {
    cipher = await redis(deps, ["GET", jobRedisKey(credential.id)]);
    if (typeof cipher === "string" && cipher) break;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(200, deadline - Date.now())));
  }
  if (typeof cipher !== "string" || !cipher) {
    const running = Number(await redis(deps, ["SISMEMBER", runningKey(account.id), credential.id])) || 0;
    if (!running) return toolText("No grill is running with that job id. It may already have expired.", true);
    return toolText(hostedStillRunningText(credential.jobId));
  }
  let stored;
  try {
    stored = JSON.parse(decryptString(cipher, credential.key));
  } catch {
    logHosted(deps.requestId, "job-decrypt");
    return toolText("Grill couldn't read that stored result. Run the grill again to get a fresh one.", true);
  }
  const layer = layerFromStored(stored, detail);
  if (!layer.trim()) return toolText("That layer is not stored for this grill.", true);
  return toolText(layer.endsWith("\n") ? layer : `${layer}\n`, Boolean(stored.isError));
}

async function callLookBack(args, account, deps) {
  const records = typeof args.records === "string" ? args.records : "";
  const happened = typeof args.happened === "string" ? args.happened : "";
  if (records.length > MAX_PASTE_CHARS || happened.length > MAX_PASTE_CHARS) {
    return toolText("That paste is too long. Split it under 100,000 characters.", true);
  }
  const saved = account.records === "keep" ? await loadRecords(account, deps) : [];
  if (args.view === "changes") return toolText(changesForAccount(records, happened, account, saved));
  if (!records.trim() && account.records !== "keep") {
    return toolText("Paste one or more decision records. Saving is off on this account, so Grill has none to read. Grill stores nothing either way.", true);
  }
  const now = typeof deps.now === "number" ? deps.now : Date.now();
  const picked = recordsForLookBack(saved, { records, now });
  if (!picked.text.trim()) {
    if (picked.mode === "due") return toolText("No saved decision is due for a look-back yet. Name one by its title, or paste a record.");
    if (picked.mode === "named") return toolText("No saved decision matched that name.");
    return toolText("Paste one or more decision records. Grill stores nothing until you choose to keep them.", true);
  }
  const text = lookBack({ records: picked.text, happened });
  let savedAny = false;
  if (happened.trim() && account.records === "keep") {
    const scored = parseRecords(picked.text);
    for (const row of saved) {
      const hit = scored.some((item) => item.date === row.date && item.title === row.title);
      if (!hit) continue;
      row.lookback = {
        at: new Date(now).toISOString(),
        happened: happened.replace(/\s+/g, " ").trim().slice(0, 2000),
      };
      await writeRecord(account, deps, row);
      savedAny = true;
    }
  }
  return toolText(savedAny ? `${text}\n\nSaved with your decision record.` : text);
}

/** "What has Grill done for me?" A paste wins; otherwise every saved record, with its own look-back notes. */
function changesForAccount(records, happened, account, saved) {
  if (parseRecords(records).length) return changesView({ records, happened });
  if (account.records !== "keep") {
    return "Saving is off on this account, so Grill has no records to read. Paste one or more decision records. Grill stores nothing either way.";
  }
  const rows = saved.slice(-200);
  const parsed = rows.map((row) => parseRecords(row.block || "")[0]).filter(Boolean);
  if (!parsed.length) return "No saved decisions yet. After a grill, say what you chose and it is saved here.";
  const summary = changeSummary({ records: parsed, outcomes: outcomesForSaved(rows) });
  return changesText(summary, { storedNote: "Read from the records you chose to keep. Nothing new is stored." });
}

function matchesRef(item, ref) {
  const needle = String(ref || "").trim().toLowerCase();
  if (!needle) return false;
  const title = String(item.title || "").toLowerCase();
  const stamp = `${item.date || ""} ${item.title || ""}`.trim().toLowerCase();
  return item.id === ref || stamp === needle || (title && (title === needle || needle.includes(title)));
}

async function callDecided(args, account, deps) {
  if (account.records !== "keep") return toolText("Decision records are off for this account, so there is nowhere to add that.", true);
  const decided = typeof args.decided === "string" ? args.decided.replace(/\s+/g, " ").trim() : "";
  if (!decided) return toolText("Add the decided line only in the person's own words. Grill will not invent one.", true);
  const confidence = typeof args.confidence === "string" ? args.confidence.replace(/\s+/g, " ").trim() : "";
  const prediction = typeof args.prediction === "string" ? args.prediction.replace(/\s+/g, " ").trim() : "";
  const proposedBy = typeof args.proposed_by === "string" ? args.proposed_by : "";
  const after = typeof args.after === "string" || typeof args.after === "number" ? String(args.after) : "";
  const decidedText = decidedLine(decided, after);
  const ref = typeof args.record_ref === "string" ? args.record_ref.trim() : "";
  const rows = await loadRecords(account, deps);
  const saved = ref ? rows.find((item) => matchesRef(item, ref)) : null;
  if (saved) {
    const parsed = parseRecords(saved.block)[0];
    if (!parsed) {
      logHosted(deps.requestId, "record-parse");
      return toolText("That saved record couldn't be read, so nothing was changed. Open your decisions page to check it, or grill the decision again.", true);
    }
    saved.block = recordBlock({
      ...parsed,
      decided: decidedText,
      proposed_by: proposedBy || parsed.proposed_by,
      confidence: confidence || parsed.confidence,
      prediction: prediction || parsed.prediction,
    });
    saved.decided = decided;
    await writeRecord(account, deps, saved);
    return toolText(withReminder(savedConfirmation(parsed.review), await reminderLine(account, deps, rows, saved.id)));
  }
  const pendings = await loadPendings(account, deps);
  const pending = ref ? pendings.find((item) => matchesRef(item, ref)) : pendings[pendings.length - 1];
  if (!pending) return toolText("No grill is waiting for a choice. A record is saved only after the person states one.", true);
  const now = typeof deps.now === "number" ? new Date(deps.now) : new Date();
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(pending.date) ? new Date(`${pending.date}T00:00:00Z`) : now;
  const review = isoDate(addDays(anchor, REVIEW_DAYS));
  const fields = {
    date: pending.date || isoDate(now),
    title: pending.title,
    prediction: prediction || pending.prediction || "",
    verdict: pending.verdict || "unknown",
    falsifier: pending.falsifier || "none named",
    confidence,
    review,
    goal: pending.goal || "",
    guardrails: pending.guardrails || "",
    source_app: pending.sourceApp || "",
    proposed_by: proposedBy,
    decided: decidedText,
    supersedes: pending.supersedes || "",
    changed: pending.changed || "",
  };
  const block = recordBlock(fields);
  await writeRecord(account, deps, {
    id: pending.id,
    createdAt: pending.createdAt || now.toISOString(),
    block,
    sourceApp: pending.sourceApp || "unknown",
    challenges: pending.challenges || [],
    lookback: null,
    date: fields.date,
    title: fields.title,
    verdict: fields.verdict,
    review,
    supersedes: fields.supersedes,
    decided,
  });
  await deletePending(account, deps, pending.id);
  return toolText(withReminder(savedConfirmation(review), await reminderLine(account, deps, rows, pending.id)));
}

function withReminder(confirmation, line) {
  return line ? `${confirmation}\n${line}` : confirmation;
}

/**
 * At most once a UTC day: how many other saved calls wait for a look-back. A count only.
 * The once-a-day mark is set with SET NX, so two decisions at once show it once.
 */
async function reminderLine(account, deps, rows, exceptId) {
  const now = typeof deps.now === "number" ? deps.now : Date.now();
  const due = dueForLookBack(rows, now).filter((row) => row.id !== exceptId);
  if (!due.length) return "";
  try {
    const won = await redis(deps, ["SET", remindedKey(account.id, isoDay(now)), "1", "NX", "EX", String(2 * 24 * 60 * 60)]);
    if (won !== "OK") return "";
  } catch {
    return "";
  }
  return dueReminderLine(due.length);
}

async function identity(request, deps, { audience }) {
  if (queryHasToken(pageUrl(request).href)) return { error: unauthorized(publicOrigin(request)) };
  const origin = publicOrigin(request);
  const token = audience ? (request.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1] || "" : cookieValue(request.headers.get("cookie"), "__session");
  if (!audience) {
    // Clerk's session token lives about a minute. After a handshake, Grill's own signed
    // cookie keeps the person signed in to these pages for a few hours.
    const clerk = token ? await clerkCookieIdentity(request, deps) : null;
    if (clerk) return clerk;
    const sub = readPageCookie(cookieValue(request.headers.get("cookie"), PAGE_COOKIE), deps.env, deps.now);
    return sub ? { payload: { sub }, origin } : { error: null, missing: true };
  }
  if (!token) return { error: unauthorized(origin), missing: true };
  const url = jwksUrl(deps.env);
  if (!url || !deps.env.CLERK_ISSUER) throw new Coded("clerk");
  const checked = await checkJwt(token, {
    issuer: deps.env.CLERK_ISSUER,
    jwksUrl: url,
    resource: mcpResource(origin),
    fetchImpl: deps.fetch,
    requireAudience: true,
  });
  if (!checked.payload) {
    logBearerReject(request, checked.reason, checked.claims);
    return { error: unauthorized(origin), missing: true };
  }
  return { payload: checked.payload, origin };
}

async function clerkCookieIdentity(request, deps) {
  const origin = publicOrigin(request);
  const token = cookieValue(request.headers.get("cookie"), "__session");
  const url = jwksUrl(deps.env);
  if (!url || !deps.env.CLERK_ISSUER) throw new Coded("clerk");
  const payload = await verifyJwt(token, { issuer: deps.env.CLERK_ISSUER, jwksUrl: url, fetchImpl: deps.fetch, requireAudience: false });
  return payload ? { payload, origin } : null;
}

// Grill's pages run no Clerk script. A production Clerk instance only hands this site a
// session through its handshake: the browser visits Clerk's Frontend API, which sends it
// back with a one-time nonce that the server trades for the session cookie. This is the
// same exchange Clerk's own server SDK does (format "nonce").
const PAGE_COOKIE = "__Host-grill_page";
const FLASH_COOKIE = "__Host-grill_flash";
const FLASH_SECONDS = 120;
const HANDSHAKE_STATE_COOKIE = "__Host-grill_hs";
const HANDSHAKE_MARK = "__grill_hs";
const PAGE_SESSION_SECONDS = 12 * 60 * 60;
const CLERK_API_VERSION = "2026-05-12";
const CLERK_HANDSHAKE_PARAMS = ["__clerk_handshake", "__clerk_handshake_nonce", "__clerk_help", "__clerk_db_jwt", "__clerk_hs_reason"];

function pageSessionKey(env) {
  const master = keyFromEnv(env, "GRILL_RECORD_KEY");
  return master ? createHmac("sha256", master).update("grill-page-session-v1").digest() : null;
}

function pageCookieValue(sub, env, now) {
  const key = pageSessionKey(env);
  if (!key || !sub) return "";
  const at = typeof now === "number" ? now : Date.now();
  const body = Buffer.from(JSON.stringify({ sub, exp: Math.floor(at / 1000) + PAGE_SESSION_SECONDS })).toString("base64url");
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

function readPageCookie(value, env, now) {
  const key = pageSessionKey(env);
  const [body, mac, extra] = String(value || "").split(".");
  if (!key || !body || !mac || extra !== undefined) return "";
  const want = createHmac("sha256", key).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return "";
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return "";
  }
  const at = Math.floor((typeof now === "number" ? now : Date.now()) / 1000);
  if (typeof claims?.sub !== "string" || !claims.sub || typeof claims.exp !== "number" || claims.exp < at) return "";
  return claims.sub;
}

function pageCookieHeader(value, maxAge = PAGE_SESSION_SECONDS) {
  return `${PAGE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/** The new calendar link, carried to the next GET and then forgotten. Not stored on the server. */
function flashCookieHeader(value, maxAge = FLASH_SECONDS) {
  return `${FLASH_COOKIE}=${value ? encodeURIComponent(value) : ""}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function readFlashLink(request) {
  const value = cookieValue(request.headers.get("cookie"), FLASH_COOKIE);
  if (!value) return "";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "";
  }
  if (url.origin !== publicOrigin(request)) return "";
  if (!/^\/decisions\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(url.pathname)) return "";
  return url.toString();
}

function seeOther(location, cookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** The page path and query this request was for, on the public origin, without handshake leftovers. */
function cleanPageUrl(request, { keepMark = false } = {}) {
  const url = pageUrl(request);
  const clean = new URL(`${publicOrigin(request)}${url.pathname}`);
  for (const [k, v] of url.searchParams) {
    if (CLERK_HANDSHAKE_PARAMS.includes(k) || k === HANDSHAKE_MARK) continue;
    clean.searchParams.append(k, v);
  }
  if (keepMark) clean.searchParams.set(HANDSHAKE_MARK, "done");
  return clean;
}

/** A browser that may be signed in to Clerk: Clerk's client marker is set, or it just came back from sign-in. */
function mayBeSignedIn(request) {
  const uat = Number(cookieValue(request.headers.get("cookie"), "__client_uat"));
  return (Number.isFinite(uat) && uat > 0) || pageUrl(request).searchParams.get("from") === "signin";
}

function handshakeStart(request, deps) {
  if (request.method !== "GET" || pageUrl(request).searchParams.has(HANDSHAKE_MARK) || !mayBeSignedIn(request)) return null;
  const issuer = String(deps.env.CLERK_ISSUER || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(issuer)) return null;
  const state = randomBytes(16).toString("base64url");
  const back = cleanPageUrl(request);
  back.searchParams.set(HANDSHAKE_MARK, state);
  const to = new URL(`${issuer}/v1/client/handshake`);
  to.searchParams.set("redirect_url", back.toString());
  to.searchParams.set("__clerk_api_version", CLERK_API_VERSION);
  to.searchParams.set("suffixed_cookies", "false");
  to.searchParams.set("__clerk_hs_reason", "grill-page");
  to.searchParams.set("format", "nonce");
  const headers = new Headers({ Location: to.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", `${HANDSHAKE_STATE_COOKIE}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  return new Response(null, { status: 307, headers });
}

/** The cookie directives Clerk sent back: from the nonce (Backend API) or a signed handshake token. */
async function handshakeDirectives(request, deps) {
  const url = pageUrl(request);
  const cookies = request.headers.get("cookie");
  const nonce = url.searchParams.get("__clerk_handshake_nonce") || cookieValue(cookies, "__clerk_handshake_nonce");
  const token = url.searchParams.get("__clerk_handshake") || cookieValue(cookies, "__clerk_handshake");
  if (nonce) {
    const secret = deps.env.CLERK_SECRET_KEY;
    if (!secret) throw new Coded("clerk");
    const res = await deps.fetch(`${CLERK_API}/v1/clients/handshake_payload?nonce=${encodeURIComponent(nonce)}`, {
      headers: { Authorization: `Bearer ${secret}`, "Clerk-API-Version": CLERK_API_VERSION },
      redirect: "error",
    });
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    return Array.isArray(body?.directives) ? body.directives.filter((x) => typeof x === "string") : [];
  }
  if (token) {
    const payload = await verifiedPayload(token, jwksUrl(deps.env), deps.fetch);
    return Array.isArray(payload?.handshake) ? payload.handshake.filter((x) => typeof x === "string") : [];
  }
  return null;
}

/**
 * Back from Clerk's handshake. Only a return that carries the state this browser was sent
 * with is used, so a link with someone else's nonce cannot sign this browser in as them.
 */
async function handshakeReturn(request, deps) {
  if (request.method !== "GET") return null;
  const url = pageUrl(request);
  const mark = url.searchParams.get(HANDSHAKE_MARK) || "";
  const state = cookieValue(request.headers.get("cookie"), HANDSHAKE_STATE_COOKIE);
  if (!mark || mark === "done") return null;
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", `${HANDSHAKE_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  let sub = "";
  if (state && state.length === mark.length && timingSafeEqual(Buffer.from(state), Buffer.from(mark))) {
    const directives = (await handshakeDirectives(request, deps)) || [];
    let session = "";
    for (const directive of directives) {
      const name = directive.slice(0, directive.indexOf("=")).trim();
      // Clerk's own cookies only, as Clerk sent them: the session, its client marker, and handshake clean-up.
      if (!/^__(session|client_uat|refresh|clerk_[a-z_]+)$/.test(name) || /[\r\n]/.test(directive)) continue;
      headers.append("Set-Cookie", directive);
      if (name === "__session") session = directive.slice(directive.indexOf("=") + 1).split(";")[0].trim();
    }
    if (session) {
      const payload = await verifyJwt(session, { issuer: deps.env.CLERK_ISSUER, jwksUrl: jwksUrl(deps.env), fetchImpl: deps.fetch, requireAudience: false });
      if (payload?.sub) sub = payload.sub;
    }
  }
  if (sub) {
    const value = pageCookieValue(sub, deps.env, deps.now);
    if (value) headers.append("Set-Cookie", pageCookieHeader(value));
    const clean = cleanPageUrl(request);
    clean.searchParams.delete("from");
    headers.set("Location", clean.toString());
  } else {
    headers.set("Location", cleanPageUrl(request, { keepMark: true }).toString());
  }
  return new Response(null, { status: 303, headers });
}

function sseWanted(request) {
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/event-stream") && !accept.includes("application/json");
}

function rpcResponse(id, result, request) {
  const body = { jsonrpc: "2.0", id, result };
  if (sseWanted(request)) {
    return new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
    });
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function handleMcp(request, deps) {
  const id = requestId();
  deps = { ...deps, requestId: id };
  if (!hostedEnabled(deps.env)) return notFound();
  let toolCallId;
  try {
    const origin = publicOrigin(request);
    if (queryHasToken(pageUrl(request).href)) return unauthorized(origin);
    if (request.method === "DELETE") {
      const who = await identity(request, deps, { audience: true });
      if (who.error) return who.error;
      return new Response(null, { status: 204 });
    }
    if (request.method !== "POST") return unauthorized(origin);
    const who = await identity(request, deps, { audience: true });
    if (who.error) return who.error;
    const raw = await request.text();
    if (raw.length > 1_500_000) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const rpcId = msg.id;
    toolCallId = msg.method === "tools/call" ? rpcId : undefined;
    if (rpcId === undefined || rpcId === null) return new Response(null, { status: 202 });
    if (msg.method === "initialize") {
      return rpcResponse(
        rpcId,
        {
          protocolVersion: negotiateProtocol(msg.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "grill", title: "Grill", version: VERSION, websiteUrl: origin, icons: serverIcons(origin) },
          instructions: HOSTED_INSTRUCTIONS,
        },
        request,
      );
    }
    if (msg.method === "ping") return rpcResponse(rpcId, {}, request);
    if (msg.method === "tools/list") return rpcResponse(rpcId, { tools: hostedTools() }, request);
    if (msg.method === "tools/call") {
      const user = await clerkUser(who.payload.sub, deps);
      const gate = await admit(user, deps, who.payload.sub);
      if (!gate.email) return rpcResponse(rpcId, toolText("Grill needs a verified email on this account before it can run.", true), request);
      if (!gate.allowed) return rpcResponse(rpcId, toolText(INVITE_ONLY, true), request);
      const personId = await resolvePerson(who.payload.sub, gate.email, deps);
      const account = await ensureAccount(personId, gate.email, deps, gate.human);
      await countActive(account, deps);
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      let result;
      if (name === "grill") result = await callGrill(args, account, who.payload, msg.params, deps);
      else if (name === "grill_result") result = await callResult(args, account, deps);
      else if (name === "grill_look_back") result = await callLookBack(args, account, deps);
      else if (name === "grill_decided") result = await callDecided(args, account, deps);
      else result = toolText(`Grill has no tool called ${JSON.stringify(String(name ?? ""))}. The tools are grill, grill_result, grill_look_back and grill_decided.`, true);
      return rpcResponse(rpcId, result, request);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpcId, error: { code: -32601, message: `Method not found: ${msg.method}` } }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof Coded ? error.code : "";
    if (code) logHosted(id, code);
    else logHosted(id, `error ${describeError(error)}`);
    // Inside a tool call, answer as a tool result so the chat shows one plain sentence, not a failed request.
    if (toolCallId !== undefined && toolCallId !== null) {
      return rpcResponse(toolCallId, toolText(serviceFailureText(code, id), true), request);
    }
    return fixedError(id, 500, code);
  }
}

/**
 * Error name and a clipped message for the server log only. Anything shaped like a
 * key, token or long secret is cut before it is written. Never request or response bodies.
 */
export function describeError(error) {
  const message = String(error?.message || "")
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, "$1…")
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, "<redacted>")
    .slice(0, 160);
  return `${error?.name || "Error"}/${error?.constructor?.name || "?"}: ${message}`;
}

const AUTH_METADATA_CORS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
});

function authMetadataPreflight() {
  return new Response(null, {
    status: 204,
    headers: { ...AUTH_METADATA_CORS, "Access-Control-Max-Age": "600", "Cache-Control": "no-store" },
  });
}

function authMetadataMethodNotAllowed() {
  return new Response("That request isn't supported.", {
    status: 405,
    headers: {
      ...AUTH_METADATA_CORS,
      Allow: "GET, HEAD, OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function authMetadataRedirect(location) {
  return new Response(null, {
    status: 302,
    headers: { ...AUTH_METADATA_CORS, Location: location, "Cache-Control": "no-store" },
  });
}

function authMetadataJson(body, method) {
  return new Response(method === "HEAD" ? null : JSON.stringify(body), {
    status: 200,
    headers: {
      ...AUTH_METADATA_CORS,
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${AUTH_METADATA_CACHE_MS / 1000}`,
    },
  });
}

/**
 * Which Clerk document to serve. Path insertion (`/mcp`) is how the client
 * names our resource. It is not part of Clerk's issuer, so both the root
 * and the /mcp form read the same upstream document.
 */
function authMetadataKind(request) {
  return new URL(request.url).pathname.includes("openid-configuration") ? "openid-configuration" : "oauth-authorization-server";
}

/**
 * Authorization-server metadata for older MCP clients that look it up on the
 * connector host (RFC 8414 path insertion included) instead of only following
 * authorization_servers on the protected-resource document. The body is Clerk's
 * document at CLERK_ISSUER, returned as JSON with CORS, cached briefly. A failed
 * read redirects to that same document. Protected-resource metadata is untouched.
 */
export async function handleAuthorizationServer(request, deps) {
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method === "OPTIONS") return authMetadataPreflight();
  if (request.method !== "GET" && request.method !== "HEAD") return authMetadataMethodNotAllowed();
  const issuer = String(deps.env.CLERK_ISSUER || "").trim().replace(/\/+$/, "");
  if (!issuer) {
    const id = requestId();
    logHosted(id, "clerk-issuer");
    return fixedError(id, 500, "clerk");
  }
  const upstream = `${issuer}/.well-known/${authMetadataKind(request)}`;
  const now = typeof deps.now === "number" ? deps.now : Date.now();
  const hit = authMetadataCache.get(upstream);
  if (hit && now - hit.at < AUTH_METADATA_CACHE_MS) return authMetadataJson(hit.body, request.method);
  let res;
  try {
    res = await deps.fetch(upstream, { headers: { accept: "application/json" }, redirect: "follow" });
  } catch {
    return authMetadataRedirect(upstream);
  }
  if (!res?.ok) return authMetadataRedirect(upstream);
  let body;
  try {
    body = await res.json();
  } catch {
    return authMetadataRedirect(upstream);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return authMetadataRedirect(upstream);
  authMetadataCache.set(upstream, { at: now, body });
  return authMetadataJson(body, request.method);
}

export async function handleProtectedResource(request, deps) {
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method === "DELETE") return methodNotAllowed();
  const origin = publicOrigin(request);
  const issuer = typeof deps.env.CLERK_ISSUER === "string" ? deps.env.CLERK_ISSUER.trim() : "";
  if (!issuer) {
    const id = requestId();
    logHosted(id, "clerk-issuer");
    return fixedError(id, 500, "clerk");
  }
  return new Response(JSON.stringify(protectedResourceMetadata(origin, issuer)), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function returnTo(request) {
  const back = new URL(`${publicOrigin(request)}${pageUrl(request).pathname}`);
  back.searchParams.set("from", "signin");
  return back.toString();
}

function signInRedirect(request, deps) {
  const location = signInUrl(deps.env, returnTo(request));
  if (!location) return null;
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

function terminal(title, inner) {
  return page(title, `${inner}<p><a href="/">Back to Grill</a></p>`);
}

function signInMissed(request, deps) {
  const again = signInUrl(deps.env, returnTo(request));
  const link = again ? `<p><a href="${esc(again)}">Try sign-in again</a></p>` : "";
  return terminal(
    "Sign-in didn't come back · Grill",
    `<h1>Sign-in didn't come back to this page.</h1>
    <p>This browser has no session for this site. Try signing in again. If it still doesn't come back, write to support@grillyour.ai.</p>
    ${link}`,
  );
}

async function pageUser(request, deps) {
  const who = await identity(request, deps, { audience: false });
  if (who.error) return { redirect: who.error };
  if (who.missing || !who.payload) {
    const back = await handshakeReturn(request, deps);
    if (back) return { redirect: back };
    if (request.method === "POST") {
      // A form sent after the session lapsed: go back to the page, which signs in again. The form is not applied.
      return { redirect: new Response(null, { status: 303, headers: { Location: cleanPageUrl(request).toString(), "Cache-Control": "no-store" } }) };
    }
    const start = handshakeStart(request, deps);
    if (start) return { redirect: start };
    if (pageUrl(request).searchParams.get("from") === "signin") return { html: signInMissed(request, deps) };
    const redirect = signInRedirect(request, deps);
    if (!redirect) return { html: terminal("Sign-in isn't set up · Grill", "<h1>Sign-in isn't set up.</h1><p>This page can't open a sign-in right now. Write to support@grillyour.ai.</p>") };
    return { redirect };
  }
  const user = await clerkUser(who.payload.sub, deps);
  if (!user) return { missing: true };
  const gate = await admit(user, deps, who.payload.sub);
  if (!gate.email) return { html: terminal("Verified email needed · Grill", "<h1>Grill needs a verified email on this account.</h1><p>Add one with your sign-in company, then come back.</p>") };
  if (!gate.allowed) return { html: terminal("Invite only · Grill", `<h1>${esc(INVITE_ONLY)}</h1>`) };
  const personId = await resolvePerson(who.payload.sub, gate.email, deps);
  const account = await ensureAccount(personId, gate.email, deps, gate.human);
  return { account, email: gate.email, sub: who.payload.sub };
}

function html(status, body) {
  return new Response(body, { status, headers: WELCOME_HEADERS });
}

function htmlPage(body, { clearFlash = false } = {}) {
  const res = html(200, body);
  if (clearFlash) res.headers.append("Set-Cookie", flashCookieHeader("", 0));
  return res;
}

function showDay(iso) {
  return formatDay(iso) || String(iso || "");
}

function chainNote(row, byId) {
  const parts = [];
  if (row.replacesId && byId.get(row.replacesId)) {
    const prev = byId.get(row.replacesId);
    parts.push(`Replaces ${showDay(prev.date)} ${prev.title}.`);
  }
  if (row.replacedByIds?.length) {
    const next = row.replacedByIds.map((id) => byId.get(id)).filter(Boolean);
    if (next.length) parts.push(`Later call: ${next.map((item) => `${showDay(item.date)} ${item.title}`).join("; ")}.`);
  }
  return parts.join(" ");
}

function renderHabits(habits) {
  if (!habits || habits.decided + habits.waiting === 0) return "";
  const h = habits;
  return `<section class="banner">
    <h2>Your habits</h2>
    <p>Only you see this. It is worked out from the records on this page each time you open it, and is not stored.</p>
    <p>Grills you answered with a choice: ${h.decided}. Waiting for your choice: ${h.waiting} (these expire after 14 days). Said how sure you were: ${h.withConfidence} of ${h.decided}. Changed course on an earlier call: ${h.changedCourse}. Look-backs done: ${h.lookedBack} of ${h.due} due.</p>
    ${h.prompt ? `<p>${esc(h.prompt)}</p>` : ""}
  </section>`;
}

function inlineBold(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Where your calls changed: one count line and at most three examples, worked out on each visit. */
export function renderChanges(rows) {
  const parsed = (rows || []).map((row) => parseRecords(row.block || "")[0]).filter(Boolean);
  const summary = changeSummary({ records: parsed, outcomes: outcomesForSaved(rows || []) });
  if (!summary.changed.length) return "";
  const examples = summary.changed.slice(0, 3).map((item) => `<li>${inlineBold(changeExample(item))}</li>`).join("");
  return `<section class="banner">
    <h2>Where your calls changed</h2>
    <p>${esc(changeCountLines(summary).join(" "))}</p>
    <ul>${examples}</ul>
    <p>These are your calls. Grill argued the other side; you chose.</p>
  </section>`;
}

/** Records waiting for a look-back, oldest first. Titles are shown: this page is the person's own. */
function renderDue(rows, now) {
  const due = dueForLookBack(rows, now);
  if (!due.length) return "";
  const items = due
    .map((row) => {
      const late = daysOverdue(row.review, now);
      const when = late === 0 ? "due today" : `${late} day${late === 1 ? "" : "s"} overdue`;
      return `<li>${esc(row.title || "Untitled")} · review ${esc(showDay(row.review))} · ${esc(when)}</li>`;
    })
    .join("");
  return `<section class="banner">
    <h2>Due for a look-back</h2>
    <ul>${items}</ul>
    <p>Say "look back" in your chat. Grill reads these for you, so there is nothing to paste.</p>
  </section>`;
}

function calendarUrl(origin, token) {
  return `${String(origin).replace(/\/$/, "")}/decisions/calendar/${token}.ics`;
}

/** The calendar switch. A fresh link is shown once, right after it is made. */
function renderCalendar(action, calendar, freshUrl) {
  const form = (value, label) =>
    `<form method="post" action="${action}"><input type="hidden" name="action" value="calendar"><button type="submit" name="value" value="${value}">${label}</button></form>`;
  if (!calendar?.on) {
    return `<section class="banner">
    <h2>Look-back reminders in your calendar</h2>
    <p>Off. Switch it on to get a private link your calendar app can subscribe to. Each saved decision shows up on its look-back date as "Grill look-back due", with no title unless you add titles. Your calendar company fetches the link to show it.</p>
    ${form("on", "Get a calendar link")}
  </section>`;
  }
  const webcal = freshUrl.replace(/^https?:/, "webcal:");
  const fresh = freshUrl
    ? `<p><strong>Copy this link now. It is shown only once.</strong></p>
    <p><input readonly style="width:100%;box-sizing:border-box" value="${esc(freshUrl)}" aria-label="Calendar link"></p>
    <p class="row"><a class="button" href="${esc(webcal)}">Open in my calendar app</a> <a class="button" href="${GOOGLE_CALENDAR_SUBSCRIBE}?cid=${encodeURIComponent(webcal)}">Add to Google Calendar</a></p>
    <p class="small">In another calendar, choose "subscribe" or "add from URL" and paste the link. Anyone with the link can see your look-back dates${calendar.titles ? " and titles" : ""}.</p>`
    : `<p>On. The link was shown when you made it. Lost it? Get a new link; the old one stops working.</p>`;
  return `<section class="banner">
    <h2>Look-back reminders in your calendar</h2>
    ${fresh}
    <p>Titles in the calendar: ${calendar.titles ? "on" : "off"}.</p>
    <div class="row">${calendar.titles ? form("titles-off", "Hide titles") : form("titles-on", "Show titles")} ${form("reset", "Get a new link")} ${form("off", "Turn off")}</div>
  </section>`;
}

function renderDecisions(account, rows, credit, habits, extra = {}) {
  const linked = linkChains(rows);
  const byId = new Map(linked.map((row) => [row.id, row]));
  const cards = [...linked].reverse().map((row) => {
    const look = row.lookback?.happened ? `<p>Look-back: ${esc(row.lookback.happened)}</p>` : "<p>Look-back: not yet.</p>";
    const chain = chainNote(row, byId);
    return `<article class="banner">
      <p class="record-title">${esc(row.title || "Untitled")}</p>
      <p>${esc(showDay(row.date))} · ${esc(row.verdict || "")} · ${esc(row.sourceApp || "unknown")} · review ${esc(showDay(row.review))}</p>
      ${chain ? `<p>${esc(chain)}</p>` : ""}
      ${look}
      <form method="post" action="/decisions"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${esc(row.id)}"><button type="submit">Delete this record</button></form>
      <form method="post" action="/decisions"><input type="hidden" name="action" value="delete-chain"><input type="hidden" name="id" value="${esc(row.id)}"><button type="submit">Delete this chain</button></form>
    </article>`;
  });
  const keeping = account.records === "keep";
  return page(
    "Your decisions · Grill",
    `<style>@media (max-width: 40rem){button,.button{width:100%;box-sizing:border-box;text-align:center}}</style>
    <h1>Your decisions</h1>
    ${renderDue(rows, extra.now)}
    <p>${credit?.out ? esc(OUT_OF_CREDIT) : `About ${Math.max(0, Math.floor((credit?.remaining || 0) / 0.03))} grills of credit left.`}</p>
    <p>Records are ${keeping ? "on" : account.records === "off" ? "off" : "not chosen yet"}. Turning this off leaves the ones already here until you delete them.</p>
    <form method="post" action="/decisions" class="row">
      <input type="hidden" name="action" value="records">
      <button type="submit" name="value" value="keep">Keep my decision records</button>
      <button type="submit" name="value" value="off">Don't keep records</button>
    </form>
    <p class="row"><a class="button" href="/decisions?export=text">Export as text</a> <a class="button" href="/decisions?export=json">Export as JSON</a> <a href="/account">Account</a></p>
    ${renderCalendar("/decisions", extra.calendar, extra.freshUrl || "")}
    ${renderHabits(habits)}
    ${renderChanges(rows)}
    ${cards.join("\n") || "<p>No records yet.</p>"}
    <p><a class="button" href="/decisions?confirm=delete-all">Delete all records</a></p>`,
  );
}

/** A page the person has to read. The confirm value is the button they press, not a hidden field. */
function renderDeleteAllConfirm() {
  return page(
    "Delete all records? · Grill",
    `<style>@media (max-width: 40rem){button,.button{width:100%;box-sizing:border-box;text-align:center}}</style>
    <h1>Delete all records?</h1>
    <p>This removes every saved decision on this page. Export first if you want a copy. This cannot be undone.</p>
    <form method="post" action="/decisions">
      <input type="hidden" name="action" value="delete-all">
      <button type="submit" name="confirm" value="delete">Delete all records</button>
    </form>
    <p><a href="/decisions">Keep them</a></p>`,
  );
}

function renderAccount(account, credit, extra = {}) {
  const keeping = account.records === "keep" ? "On" : account.records === "off" ? "Off" : "Not chosen yet";
  return page(
    "Your Grill account",
    `<style>@media (max-width: 40rem){button,.button{width:100%;box-sizing:border-box;text-align:center}}</style>
    <h1>Your account</h1>
    <p>${esc(account.email)}</p>
    <p>Records: ${esc(keeping)}. ${credit?.out ? esc(OUT_OF_CREDIT) : `About ${Math.max(0, Math.floor((credit?.remaining || 0) / 0.03))} grills of credit left.`}</p>
    <p>Grill holds a model-router key for you. It is not shown here. The write-up you approve passes through Grill's server in memory and is not stored.</p>
    <form method="post" action="/account" class="row">
      <input type="hidden" name="action" value="records">
      <button type="submit" name="value" value="keep">Keep my decision records</button>
      <button type="submit" name="value" value="off">Don't keep records</button>
    </form>
    <p><a href="/decisions">Your decisions</a></p>
    ${renderCalendar("/account", extra.calendar, extra.freshUrl || "")}
    <p><a class="button" href="/account?confirm=delete">Delete this account</a></p>
    <p class="small">Deleting the account removes your records, switches off the model-router key, and deletes the sign-in.</p>`,
  );
}

function renderDeleteAccountConfirm() {
  return page(
    "Delete this account? · Grill",
    `<style>@media (max-width: 40rem){button,.button{width:100%;box-sizing:border-box;text-align:center}}</style>
    <h1>Delete this account?</h1>
    <p>This removes your records, switches off the model-router key, and deletes the sign-in. This cannot be undone.</p>
    <form method="post" action="/account">
      <input type="hidden" name="action" value="delete-account">
      <button type="submit" name="confirm" value="delete">Delete this account</button>
    </form>
    <p><a href="/account">Keep this account</a></p>`,
  );
}

async function exportRecords(account, deps, kind) {
  const rows = await loadRecords(account, deps);
  if (kind === "json") {
    const body = JSON.stringify(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        source_app: row.sourceApp,
        challenges: row.challenges || [],
        lookback: row.lookback || null,
        block: row.block,
      })),
      null,
      2,
    );
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="grill-records.json"',
        "Cache-Control": "no-store",
      },
    });
  }
  const text = rows.map((row) => row.block).filter(Boolean).join("\n\n");
  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="grill-records.txt"',
      "Cache-Control": "no-store",
    },
  });
}

async function deleteAccount(account, deps, sub) {
  if (account.keyHash && !account.capFrom) {
    try {
      await removeManagedKey(account.keyHash, { env: deps.env, fetch: deps.fetch });
    } catch {
      logHosted(deps.requestId || "account", "key-revoke");
    }
  }
  const secret = deps.env.CLERK_SECRET_KEY;
  if (!secret) throw new Coded("clerk");
  const res = await deps.fetch(`${CLERK_API}/v1/users/${encodeURIComponent(sub)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "error",
  });
  if (!res.ok && res.status !== 404) throw new Coded("clerk-delete");
  const ids = (await redis(deps, ["ZRANGE", recordIndex(account.id), "0", "-1"])) || [];
  await deleteRecordIds(account, deps, ids);
  await redis(deps, ["DEL", recordIndex(account.id)]);
  const pendingIds = (await redis(deps, ["ZRANGE", pendingIndex(account.id), "0", "-1"])) || [];
  for (const id of pendingIds) await deletePending(account, deps, id);
  await redis(deps, ["DEL", pendingIndex(account.id)]);
  await redis(deps, ["DEL", acctKey(account.id)]);
  await redis(deps, ["DEL", spendLogKey(account.id)]);
  await redis(deps, ["DEL", disclosedKey(account.id)]);
  await redis(deps, ["DEL", recordKeyRedisKey(account.id)]);
  await calendarOff(account, deps);
  // A borrowing agent does not hold the cap, so their delete leaves the shared key and its index.
  if (!account.capFrom) {
    const indexEmail = account.human || account.email;
    const holder = await redis(deps, ["GET", emailIndex(indexEmail)]);
    if (!holder || holder === account.id) await redis(deps, ["DEL", emailIndex(indexEmail)]);
  }
  const idents = (await redis(deps, ["SMEMBERS", identsOf(account.id)])) || [];
  for (const key of new Set([...idents, identKey(deps.env, sub)])) await redis(deps, ["DEL", key]);
  await redis(deps, ["DEL", identsOf(account.id)]);
  if (account.email) {
    const holder = await redis(deps, ["GET", personIndex(account.email)]);
    if (holder === account.id) await redis(deps, ["DEL", personIndex(account.email)]);
  }
  await redis(deps, ["DEL", ownerCacheKey(sub)]);
  userCache.delete(sub);
  creditCache.delete(account.id);
}

export async function handleDecisions(request, deps) {
  const id = requestId();
  deps = { ...deps, requestId: id };
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method === "DELETE") return methodNotAllowed();
  try {
    const session = await pageUser(request, deps);
    if (session.redirect) return session.redirect;
    if (session.missing) return html(200, terminal("Account deleted · Grill", "<h1>This account has been deleted.</h1>"));
    if (session.html) return html(200, session.html);
    const url = pageUrl(request);
    let fresh = "";
    if (request.method === "GET" && url.searchParams.get("export") === "text") return exportRecords(session.account, deps, "text");
    if (request.method === "GET" && url.searchParams.get("export") === "json") return exportRecords(session.account, deps, "json");
    if (request.method === "GET" && url.searchParams.get("confirm") === "delete-all") return html(200, renderDeleteAllConfirm());
    if (request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      const action = form.get("action") || "";
      if (action === "records") {
        const value = form.get("value");
        if (value === "keep" || value === "off") {
          session.account.records = value;
          await saveAccount(session.account, deps);
        }
      } else if (action === "delete") {
        await deleteRecordIds(session.account, deps, [form.get("id") || ""]);
      } else if (action === "delete-chain") {
        const rows = await loadRecords(session.account, deps);
        await deleteRecordIds(session.account, deps, chainIds(rows, form.get("id") || ""));
      } else if (action === "delete-all" && form.get("confirm") === "delete") {
        const rows = await loadRecords(session.account, deps);
        await deleteRecordIds(session.account, deps, rows.map((row) => row.id));
      } else if (action === "calendar") {
        fresh = await calendarAction(session.account, deps, form.get("value") || "");
      }
      const cookies = fresh ? [flashCookieHeader(calendarUrl(publicOrigin(request), fresh))] : [];
      return seeOther(`${publicOrigin(request)}/decisions`, cookies);
    }
    const flashed = readFlashLink(request);
    const rows = await loadRecords(session.account, deps);
    const credit = session.account.keyHash ? await creditOf(session.account, deps) : { remaining: 0, out: false };
    const waiting = (await loadPendings(session.account, deps)).length;
    const now = typeof deps.now === "number" ? deps.now : Date.now();
    const habits = decisionHabits({ records: rows, waiting, now });
    const calendar = await calendarState(session.account, deps);
    return htmlPage(renderDecisions(session.account, rows, credit, habits, { now, calendar, freshUrl: flashed }), { clearFlash: Boolean(flashed) });
  } catch (error) {
    const code = error instanceof Coded ? error.code : "";
    if (code) logHosted(id, code);
    else logHosted(id, `error ${describeError(error)}`);
    return fixedError(id, 500, code);
  }
}

export async function handleAccount(request, deps) {
  const id = requestId();
  deps = { ...deps, requestId: id };
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method === "DELETE") return methodNotAllowed();
  if (request.method === "GET" && pageUrl(request).searchParams.get("deleted") === "1") {
    return html(200, terminal("Account deleted · Grill", "<h1>Your Grill account is deleted.</h1><p>The records and the model-router key are gone.</p>"));
  }
  try {
    const session = await pageUser(request, deps);
    if (session.redirect) return session.redirect;
    if (session.missing) return html(200, terminal("Account deleted · Grill", "<h1>This account has been deleted.</h1>"));
    if (session.html) return html(200, session.html);
    if (request.method === "GET" && pageUrl(request).searchParams.get("confirm") === "delete") return html(200, renderDeleteAccountConfirm());
    let fresh = "";
    if (request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      if (form.get("action") === "calendar") fresh = await calendarAction(session.account, deps, form.get("value") || "");
      if (form.get("action") === "records") {
        const value = form.get("value");
        if (value === "keep" || value === "off") {
          session.account.records = value;
          await saveAccount(session.account, deps);
        }
      }
      if (form.get("action") === "delete-account" && form.get("confirm") === "delete") {
        await deleteAccount(session.account, deps, session.sub);
        return seeOther(`${publicOrigin(request)}/account?deleted=1`, [pageCookieHeader("", 0)]);
      }
      const cookies = fresh ? [flashCookieHeader(calendarUrl(publicOrigin(request), fresh))] : [];
      return seeOther(`${publicOrigin(request)}/account`, cookies);
    }
    const flashed = readFlashLink(request);
    const credit = session.account.keyHash ? await creditOf(session.account, deps) : { remaining: 0, out: false };
    const calendar = await calendarState(session.account, deps);
    return htmlPage(renderAccount(session.account, credit, { calendar, freshUrl: flashed }), { clearFlash: Boolean(flashed) });
  } catch (error) {
    const code = error instanceof Coded ? error.code : "";
    if (code) logHosted(id, code);
    else logHosted(id, `error ${describeError(error)}`);
    return fixedError(id, 500, code);
  }
}


function calendarResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="grill-look-backs.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * The private calendar feed. No sign-in: the secret in the path is the key, because calendar
 * apps cannot send a header. Unknown, malformed or switched-off links all get the same 404.
 * The token is never logged.
 */
export async function handleCalendar(request, deps) {
  const id = requestId();
  deps = { ...deps, requestId: id };
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  try {
    const url = pageUrl(request);
    const fromPath = url.pathname.match(/^\/decisions\/calendar\/([^/]+)$/)?.[1] || "";
    const token = String(url.searchParams.get("t") || fromPath).replace(/\.ics$/i, "");
    if (!calendarTokenShape(token)) return notFound();
    const raw = await redis(deps, ["GET", calendarFeedKey(calendarTokenHash(token))]);
    let feed = null;
    try {
      feed = typeof raw === "string" ? JSON.parse(raw) : null;
    } catch {
      feed = null;
    }
    if (!feed?.id) return notFound();
    const account = await loadAccount(feed.id, deps);
    if (!account) return notFound();
    const rows = await loadRecords(account, deps);
    const now = typeof deps.now === "number" ? deps.now : Date.now();
    return calendarResponse(calendarFeed({ rows, origin: publicOrigin(request), titles: feed.titles === true, now }));
  } catch (error) {
    const code = error instanceof Coded ? error.code : "";
    logHosted(id, code || "calendar");
    return fixedError(id, 500, code);
  }
}
