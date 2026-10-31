/**
 * Pure helpers for hosted Grill. No network and no logging.
 * The installed local tool does not import this file.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { confidenceValue, parseRecords } from "./reflection.mjs";
import { SCOPE_GUARD, clientCompanyHint } from "./judgeCore.mjs";
import { buildGrillTools } from "../server/index.mjs";

export { SCOPE_GUARD };

/** First use only. One line. The privacy page holds the rest. Same words as the local server. */
export const ONCE_DISCLOSURE =
  "This goes to an outside judge from a different company, and the router does not keep it. https://grillyour.ai/#privacy";

export const HOSTED_PROTOCOLS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26"]);
export const CLAUDE_WEB_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
export const TYPICAL_GRILL_USD = 0.03;
export const MAX_SUBJECT_CHARS = 200_000;
export const MAX_QUESTION_CHARS = 600;
export const MAX_PASTE_CHARS = 100_000;
export const JOB_TTL_SECONDS = 15 * 60;
/**
 * The hosted judge has to finish inside the function that runs it (vercel.json maxDuration
 * for api/hosted.js). Past that, Vercel kills the function, nothing is stored, and the job
 * reads as expired. Leave 30 seconds to write the result; a test pins this to vercel.json.
 */
export const HOSTED_JUDGE_DEADLINE_MS = 270_000;
/** One judge attempt, so a hung first attempt still leaves room for one retry inside the deadline. */
export const HOSTED_JUDGE_ATTEMPT_MS = 180_000;
export const DAILY_GRILL_LIMIT = 30;
export const RUNNING_JOB_LIMIT = 3;
export const CREDIT_CACHE_MS = 60_000;
export const OUT_OF_CREDIT = "You're out of grill credit for this month, so this one didn't run. It starts again on the 1st. Nothing was charged to you. If you need more sooner, write to support@grillyour.ai.";
/** The invite-only reply. `origin` makes the redeem link absolute for the host they are on. */
export function inviteOnlyText(origin = "") {
  const base = String(origin || "").replace(/\/$/, "");
  const redeem = base ? `${base}/redeem` : "/redeem";
  return `Grill in chat is invite-only for now, and this email isn't on the list yet. If you were invited, disconnect Grill, connect again, and sign in with the email your invite went to. If you have an invite code, enter it at ${redeem}. To ask for an invite, write to support@grillyour.ai.`;
}

export const INVITE_ONLY = inviteOnlyText();
export const CONSENT_TEXT = [
  "Keep a record of your decisions on your Grill account? Yes / No",
  "",
  "Ask that once, then call grill again with keep_records true or false. Do not send the decision until they answer.",
].join("\n");

/** When three grills are still running after the wait. The assistant retries. The person is not asked for a job id. */
export const CAP_RETRY_TEXT =
  "Three grills are still running. Wait about 2 minutes, then call grill again yourself. Do not ask the person for a job id.";

const AUTHOR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function hostedEnabled(env = {}) {
  return env.GRILL_HOSTED === "on";
}

export function negotiateProtocol(asked) {
  return HOSTED_PROTOCOLS.includes(asked) ? asked : HOSTED_PROTOCOLS[0];
}

export function publicOrigin(request) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = (forwardedHost ? forwardedHost.split(",")[0].trim() : url.host) || url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = (forwardedProto ? forwardedProto.split(",")[0].trim() : url.protocol.replace(":", "")) || "https";
  return `${proto}://${host}`;
}

export function mcpResource(origin) {
  return `${String(origin).replace(/\/$/, "")}/mcp`;
}

export function wwwAuthenticate(origin) {
  const base = String(origin).replace(/\/$/, "");
  return `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}

export function protectedResourceMetadata(origin, issuer) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [String(issuer || "").trim()],
    scopes_supported: ["openid", "profile", "email"],
    bearer_methods_supported: ["header"],
  };
}

export function queryHasToken(url) {
  const params = new URL(url).searchParams;
  return params.has("token") || params.has("access_token");
}

/**
 * Account Portal sign-in URL. The Frontend API host (CLERK_ISSUER) does not serve /sign-in.
 * Development `name.clerk.accounts.dev` becomes `name.accounts.dev`. Staging
 * `name.clerk.accountsstage.dev` becomes `name.accountsstage.dev`. Production
 * `clerk.example.com` becomes `accounts.example.com`. An absolute CLERK_SIGN_IN_URL wins.
 * Returns "" when the host cannot be derived and no override is set.
 */
export function signInUrl(env, redirectUrl) {
  const chosen = absoluteHttpUrl(env?.CLERK_SIGN_IN_URL) || derivedSignIn(env?.CLERK_ISSUER);
  if (!chosen) return "";
  const url = new URL(chosen);
  if (redirectUrl) url.searchParams.set("redirect_url", String(redirectUrl));
  return url.toString();
}

function absoluteHttpUrl(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function derivedSignIn(issuer) {
  let host = "";
  try {
    host = new URL(String(issuer || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host) return "";
  // Same host rewrite Clerk uses for the Account Portal (buildAccountsBaseUrl).
  const mapped = host.replace(/clerk\.accountsstage\./, "accountsstage.").replace(/clerk\.accounts\.|clerk\./, "accounts.");
  if (mapped === host) return "";
  return `https://${mapped}/sign-in`;
}

function hostOf(raw) {
  try {
    return new URL(String(raw)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isLoopbackRedirect(raw) {
  try {
    const url = new URL(String(raw));
    const host = url.hostname.toLowerCase();
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") return false;
    return url.pathname === "/callback" || url.pathname.endsWith("/callback");
  } catch {
    return false;
  }
}

function rememberedHint(remembered) {
  const company = String(remembered?.company || "").trim().toLowerCase();
  const sourceApp = String(remembered?.sourceApp || "").trim().toLowerCase();
  if (!AUTHOR_RE.test(company) || !AUTHOR_RE.test(sourceApp)) return null;
  return { company, sourceApp };
}

/**
 * Map an OAuth client to the company to exclude and the source_app to store.
 * The OAuth client wins. Otherwise the same name list as the local server:
 * clientInfo from initialize, then a hint remembered from that handshake,
 * then the User-Agent. An unknown client still excludes nothing.
 */
export function sourceAppFromClient({ redirectUri = "", clientId = "", clientInfo = null, userAgent = "", remembered = null } = {}) {
  const redirect = String(redirectUri || "").trim();
  const client = String(clientId || "").trim();
  const redirectHost = hostOf(redirect);
  const clientHost = hostOf(client);

  if (redirect === CLAUDE_WEB_REDIRECT || redirect.startsWith(`${CLAUDE_WEB_REDIRECT}?`)) {
    return { company: "anthropic", sourceApp: "claude" };
  }
  if (client === CLAUDE_CODE_CLIENT_ID || (isLoopbackRedirect(redirect) && /claude-code/i.test(client))) {
    return { company: "anthropic", sourceApp: "claude-code" };
  }
  if (redirectHost === "claude.ai" || (clientHost === "claude.ai" && !/claude-code/i.test(client))) {
    return { company: "anthropic", sourceApp: "claude" };
  }
  if (["chatgpt.com", "chat.openai.com"].includes(redirectHost) || ["chatgpt.com", "chat.openai.com"].includes(clientHost)) {
    return { company: "openai", sourceApp: "chatgpt" };
  }
  if (
    redirectHost === "grok.com" ||
    redirectHost.endsWith(".grok.com") ||
    redirectHost === "grok.x.ai" ||
    clientHost === "grok.com" ||
    clientHost === "grok.x.ai"
  ) {
    return { company: "x-ai", sourceApp: "grok" };
  }
  if (
    redirectHost === "gemini.google.com" ||
    redirectHost === "aistudio.google.com" ||
    clientHost === "gemini.google.com" ||
    clientHost === "aistudio.google.com"
  ) {
    return { company: "google", sourceApp: "gemini" };
  }

  const fromName = clientCompanyHint({ clientInfo });
  if (fromName) return fromName;
  const kept = rememberedHint(remembered);
  if (kept) return kept;
  const fromAgent = clientCompanyHint({ userAgent });
  if (fromAgent) return fromAgent;
  return { company: "", sourceApp: "unknown" };
}

/** An explicit author wins. Unknown clients exclude nothing beyond that, which means `--author none`. */
export function authorForJudge({ explicit = "", company = "" } = {}) {
  const given = String(explicit || "").trim().toLowerCase();
  if (given) {
    if (!AUTHOR_RE.test(given)) return { error: "author must be a lowercase model-family name, like openai." };
    return { author: given };
  }
  if (company && AUTHOR_RE.test(company)) return { author: company };
  return { author: "none" };
}

export function starterCreditUsd(env = {}) {
  const n = Number(env.GRILL_STARTER_CREDIT_USD);
  if (Number.isFinite(n) && n > 0 && n <= 50) return Math.round(n * 100) / 100;
  return 1;
}

/** Open sign-up is off unless GRILL_OPEN_SIGNUP is exactly "on". Turn it on only once the spending caps are set. */
export function openSignup(env = {}) {
  return env.GRILL_OPEN_SIGNUP === "on";
}

/**
 * Who may grill. With open sign-up on, any verified email. Otherwise only the
 * emails on GRILL_HOSTED_ALLOWLIST; an empty or unset list lets nobody in, so a
 * missing setting can never open the door by accident.
 */
export function allowlistAllows(email, env = {}) {
  const who = String(email || "").trim().toLowerCase();
  if (!who) return false;
  if (openSignup(env)) return true;
  const raw = typeof env.GRILL_HOSTED_ALLOWLIST === "string" ? env.GRILL_HOSTED_ALLOWLIST.trim() : "";
  if (!raw) return false;
  const list = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  return list.includes(who);
}

const INVITE_CODE_MAX_LEN = 80;
const INVITE_MAX_USES = 1_000_000;

/** A shareable code: trimmed, lowercased, at most 80 characters, no control characters. */
export function normalizeInviteCode(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text || text.length > INVITE_CODE_MAX_LEN) return "";
  if (/[\u0000-\u001f\u007f]/.test(text)) return "";
  return text;
}

/**
 * GRILL_INVITE_CODES: comma-separated codes. A trailing `:N` (a whole number, 0 to
 * 1,000,000) is that code's max uses. No count means no limit. A colon that is not
 * a use count skips that entry, so a typo cannot become an unlimited code. The first
 * copy of a code wins. Unset, blank, or nothing valid means the feature is off.
 * This does not change the $5 or $20 caps.
 */
export function parseInviteCodes(env = {}) {
  const raw = typeof env.GRILL_INVITE_CODES === "string" ? env.GRILL_INVITE_CODES : "";
  if (!raw.trim()) return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const counted = piece.match(/^(.*):(\d+)$/);
    let code = "";
    let max = null;
    if (counted) {
      code = normalizeInviteCode(counted[1]);
      max = Number(counted[2]);
      if (!code || !Number.isInteger(max) || max > INVITE_MAX_USES) continue;
    } else if (piece.includes(":")) {
      continue;
    } else {
      code = normalizeInviteCode(piece);
      if (!code) continue;
    }
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, max });
  }
  return out;
}

export function inviteCodesEnabled(env = {}) {
  return parseInviteCodes(env).length > 0;
}

export function inviteCodeHash(code) {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex");
}

// ── Spending caps ────────────────────────────────────────────────────────────
// Two hard caps on what Grill pays for starter credit, counted in Upstash in
// micro-dollars (whole numbers, so INCRBY stays atomic and exact):
//   - one for the whole service per calendar month (UTC), GRILL_MONTHLY_CAP_USD, default $20;
//   - one per person per calendar month, GRILL_USER_MONTHLY_CAP_USD, default $5: the early-tester
//     allowance, free for life, which resets on the 1st. Each person's router key is minted at the
//     same amount with a monthly reset.
// A person is keyed by the human email the starter credit belongs to, so an agent
// signed in for someone shares that person's cap. Each person's router key is
// still capped by the router itself; these counters are the second lock.

export const DEFAULT_MONTHLY_CAP_USD = 20;
/** Early testers: free for life, $5 of use each month, reset on the 1st (UTC). */
export const TESTER_MONTHLY_USD = 5;
export const DEFAULT_USER_MONTHLY_CAP_USD = TESTER_MONTHLY_USD;
export const CAP_COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60;

export const SERVICE_CAP_TEXT =
  "Grill has used up this month's free grills for everyone, so this one didn't run. It starts again on the 1st. Nothing was charged to you. If you need a grill sooner, write to support@grillyour.ai.";
export const USER_CAP_TEXT =
  "You've used this month's free grills, so this one didn't run. It starts again on the 1st. Nothing was charged to you. If you need more sooner, write to support@grillyour.ai.";

function capFromEnv(value, fallback) {
  const n = Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 10_000) {
    return Math.round(n * 100) / 100;
  }
  return fallback;
}

export function monthlyCapUsd(env = {}) {
  return capFromEnv(env.GRILL_MONTHLY_CAP_USD, DEFAULT_MONTHLY_CAP_USD);
}

export function userMonthlyCapUsd(env = {}) {
  return capFromEnv(env.GRILL_USER_MONTHLY_CAP_USD, DEFAULT_USER_MONTHLY_CAP_USD);
}

/** The allowance line /decisions and /account show, with what is left of this month's use. */
export function allowanceLine(remainingUsd, env = {}) {
  const cap = userMonthlyCapUsd(env);
  const whole = Number.isInteger(cap) ? String(cap) : cap.toFixed(2);
  const left = Math.max(0, Number(remainingUsd) || 0).toFixed(2);
  return `Free for life: $${whole} of use each month, resets on the 1st. $${left} left this month.`;
}

/** "2026-10" in UTC. */
export function isoMonth(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 7);
}

export function toMicros(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 1_000_000);
}

/**
 * The cost to count for one finished grill. When the judge reports no cost we
 * count a typical grill rather than zero, so a missing number can't slip past the cap.
 */
export function chargeableUsd(costUsd) {
  const n = Number(costUsd);
  return Number.isFinite(n) && n > 0 ? n : TYPICAL_GRILL_USD;
}

/**
 * Which cap, if any, stops the next grill. `serviceMicros` and `userMicros` are the
 * month's counters. A grill is allowed while the spend so far is under the cap, so
 * one grill can finish a little over; the next one is stopped.
 */
export function capBlock({ serviceMicros = 0, userMicros = 0, env = {} } = {}) {
  if ((Number(serviceMicros) || 0) >= toMicros(monthlyCapUsd(env)) ) return { text: SERVICE_CAP_TEXT, which: "service" };
  if ((Number(userMicros) || 0) >= toMicros(userMonthlyCapUsd(env))) return { text: USER_CAP_TEXT, which: "user" };
  return null;
}

// ── Plain-language failures ──────────────────────────────────────────────────
// What the person sees when something breaks. No codes, no stack traces. The short
// reference at the end is only so support can find the server log line.

function ref(requestId) {
  return requestId ? ` (reference ${requestId})` : "";
}

/** For a judge run that ended without a verdict, read from the judge's own error lines. */
export function judgeFailureText(stderr = "", requestId = "") {
  const s = String(stderr || "");
  if (/correlated verdict|excluded company/i.test(s)) {
    return "The only judge available was from the same company that wrote this, so Grill held back the verdict rather than give you a biased one. Try again in a few minutes.";
  }
  if (/\b402\b|insufficient credits|key limit exceeded/i.test(s)) return OUT_OF_CREDIT;
  if (/looks like .*(key|token)|Nothing was sent/i.test(s)) {
    return "This write-up seems to contain a password, key or token, so Grill didn't send it. Take that out and try again.";
  }
  if (/(?:\b|_)429\b|rate.?limit/i.test(s)) {
    return `The judge service is busy right now and turned the request away. Try again in a minute or two.${ref(requestId)}`;
  }
  if (/abandon|deadline|timed? ?out|timeout/i.test(s)) {
    return `The judge took too long and Grill stopped waiting. Try again; a shorter write-up usually helps.${ref(requestId)}`;
  }
  if (/transport|ECONN|ENOTFOUND|fetch failed|network|(?:\b|_)50[0-9]\b/i.test(s)) {
    return `Grill couldn't reach the judge service just now. Try again in a minute.${ref(requestId)}`;
  }
  return `The judge didn't send back a verdict this time. Try again; if it keeps happening, write to support@grillyour.ai${ref(requestId)}.`;
}

/** For a failure inside Grill's own server, by the internal code that was logged. */
export function serviceFailureText(code = "", requestId = "") {
  switch (code) {
    case "store":
      return `Grill's storage didn't answer just now. Try again in a minute; if it keeps happening, write to support@grillyour.ai${ref(requestId)}.`;
    case "clerk":
    case "jwks":
      return `Grill couldn't check your sign-in just now. Try again in a minute; if it keeps happening, reconnect Grill in your chat app's settings${ref(requestId)}.`;
    case "starter-key":
      return `Grill couldn't set up your free starter credit just now. Try again in a few minutes; if it keeps happening, write to support@grillyour.ai${ref(requestId)}.`;
    case "key-encryption":
    case "record-key":
      return `Grill isn't fully set up on the server right now, so it can't run this. We've logged it; write to support@grillyour.ai if you need it sooner${ref(requestId)}.`;
    case "clerk-delete":
      return `Grill couldn't finish deleting your sign-in. Your records are untouched. Try again in a minute, or write to support@grillyour.ai${ref(requestId)}.`;
    default:
      return `Something on Grill's side broke while handling this. Try again in a minute; if it keeps happening, write to support@grillyour.ai${ref(requestId)}.`;
  }
}

export function grillsLeft(remainingUsd) {
  if (!(Number(remainingUsd) > 0)) return 0;
  return Math.floor(Number(remainingUsd) / TYPICAL_GRILL_USD);
}

export function formatDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${Number(match[3])} ${month}`;
}

/** About five words. No confidence nag, and no credit line. */
export function savedConfirmation(review) {
  const day = formatDay(review);
  return day ? `Saved. Look-back ${day}.` : "Saved.";
}

export function footerLine({ saved, review = "", remainingUsd = 0 } = {}) {
  const left = grillsLeft(remainingUsd);
  const credit = `about ${left} grill${left === 1 ? "" : "s"} of credit left`;
  if (!saved) return `Not saved · ${credit}`;
  const day = formatDay(review);
  return day ? `Saved to your decisions · look-back on ${day} · ${credit}` : `Saved to your decisions · ${credit}`;
}

export function isoDay(ms = Date.now()) {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function encryptString(plain, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function decryptString(blob, key) {
  const buf = Buffer.from(String(blob), "base64url");
  if (buf.length < 29) throw new Error("cipher");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function keyFromEnv(env, name) {
  const raw = typeof env?.[name] === "string" ? env[name].trim() : "";
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function newJobCredential() {
  const id = randomBytes(16).toString("hex");
  const key = randomBytes(32);
  return { id, key, jobId: `g1.${id}.${key.toString("base64url")}` };
}

export function parseJobCredential(jobId) {
  const match = /^g1\.([0-9a-f]{32})\.([A-Za-z0-9_-]+)$/.exec(String(jobId || "").trim());
  if (!match) return null;
  const key = Buffer.from(match[2], "base64url");
  if (key.length !== 32) return null;
  return { id: match[1], key, jobId: String(jobId).trim() };
}

export function topChallengeLines(report, n = 3) {
  const re = /^### (\d+)\. ([^\n]+)\n+(?:> [^\n]*\n+)?([^\n]+)/gm;
  const out = [];
  let match;
  while ((match = re.exec(String(report || ""))) && out.length < n) {
    const line = `${match[1]}. ${match[2].trim()} — ${match[3].trim()}`;
    out.push(line.length > 400 ? `${line.slice(0, 399)}…` : line);
  }
  return out;
}

export function recordFence(text) {
  const match = String(text || "").match(/```grill-record\n[\s\S]*?\n```/);
  return match ? match[0] : "";
}

export function linkChains(records) {
  const list = (records || []).map((row) => ({ ...row, replacesId: null, replacedByIds: [] }));
  const byStamp = new Map();
  for (const row of list) {
    const stamp = `${row.date || ""} ${row.title || ""}`.trim().toLowerCase();
    if (stamp) byStamp.set(stamp, row);
  }
  for (const row of list) {
    const needle = String(row.supersedes || "").trim().toLowerCase();
    if (!needle) continue;
    const prev = byStamp.get(needle);
    if (prev && prev.id !== row.id) {
      row.replacesId = prev.id;
      prev.replacedByIds.push(row.id);
    }
  }
  return list;
}

export function chainIds(records, id) {
  const linked = linkChains(records);
  const byId = new Map(linked.map((row) => [row.id, row]));
  const seen = new Set();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current) || !byId.has(current)) continue;
    seen.add(current);
    const row = byId.get(current);
    if (row.replacesId) stack.push(row.replacesId);
    for (const child of row.replacedByIds) stack.push(child);
  }
  return [...seen];
}

export function recordsForLookBack(saved, { records = "", now = Date.now() } = {}) {
  const paste = String(records || "");
  const parsed = parseRecords(paste);
  if (parsed.length) return { mode: "pasted", text: paste, parsed };
  const named = paste.trim();
  if (!named) {
    const due = dueForLookBack(saved, now);
    return { mode: "due", text: due.map((row) => row.block).join("\n\n"), rows: due };
  }
  const needle = named.toLowerCase();
  const rows = (saved || []).filter((row) => {
    const title = String(row.title || "").toLowerCase();
    return title && (needle.includes(title) || title.includes(needle));
  });
  return { mode: "named", text: rows.map((row) => row.block).join("\n\n"), rows };
}

const HOSTED_COST_LINE =
  "Uses a little of the person's Grill credit. Do not tell them the balance or how long it takes. The judge is always picked by openrouter/auto, excluding only the company that wrote the write-up. It never falls back to this chat's own model, for speed or cost, and it never pins a model. If the result is a job id, call grill_result with that job id right now, before you reply to the person, and keep calling until the verdict arrives. Do not ask the person for a job id. The first time, Grill asks whether to keep decision records before anything is sent: show that one question, and call again with keep_records true or false only after they answer Yes or No. Do not add your own disclosure. If the result starts with the outside-judge sentence, show that one line once. Later results leave it off. Layer 1 is at most 50 words. When they say more, why, or what else, call grill_result with detail more. When they say options, help me decide, or they are stuck, call grill_result with detail options. When they say full report, call grill_result with detail full. Call grill_result with detail deepen only when the person asks to deepen or go bigger. Do not call it on a quick or bulk grill, and do not ask them to. Do not write a layer yourself. A follow: line is a job id for you. Never show it. " +
  SCOPE_GUARD;

/** What the assistant reads from grill_result. The next step, if the job is still running, is another call. */
const HOSTED_RESULT_DESCRIPTION =
  "Collect a grill that returned a job id, or a later layer of one. This call waits up to 45 seconds. If it is still running, call grill_result again right now with the same job id, before you reply to the person. detail is brief, more, options, full, deepen, or provenance. Call detail deepen only when the person asks to deepen or go bigger. Call detail provenance only to write a lasting record of the grill, such as an audit log: put that one line in the record, not in the chat reply, unless the person asks which model judged. Do not write a layer yourself.";

/**
 * One line for an agent's written audit record: which model judged, which company was
 * excluded, and when. The time joins it to the account's spend log, which keeps the same
 * model. It is for the record, not the chat note.
 */
export function provenanceLine(parsed, at) {
  const served = typeof parsed?.servedModel === "string" && parsed.servedModel.trim() ? parsed.servedModel.trim() : "unattributable";
  const author = typeof parsed?.declaredAuthor === "string" && parsed.declaredAuthor.trim() ? parsed.declaredAuthor.trim() : "anthropic";
  const excluded = author === "none" ? "none" : author;
  const decorrelated = parsed?.decorrelated === true ? "yes" : "no";
  const when = at instanceof Date && !Number.isNaN(at.getTime()) ? at.toISOString().replace(/\.\d{3}Z$/, "Z") : "unknown";
  return `Judge: ${served} · excluded: ${excluded} · decorrelated: ${decorrelated} · at: ${when}`;
}

/** What grill_result says when a job id has no stored result and nothing is running for it. */
export const NO_JOB_TEXT =
  "No result for that job id: the grill ended without one, or it finished more than 15 minutes ago. Call grill again with the same write-up. Do not ask the person for a job id.";

/** The tool result while a hosted job is still running. The next step is another grill_result call. */
export function hostedStillRunningText(jobId) {
  const id = String(jobId);
  return `Still grilling (job ${id}). Before you reply to the person, call grill_result again right now with job_id "${id}". Do not ask the person to check. That call waits up to 45 seconds, then returns the report or this same line.`;
}

/** Same clerk / show-first text as the local server, plus the hosted account fields. */
export function hostedTools() {
  const [grill, result, look] = buildGrillTools({ checkOn: true });
  const localDisclosure =
    /The first time you use Grill with this person, say once\b.*?Do not mention the judge's model, a score, a balance, or a quote check\. /;
  const hostedDisclosure =
    "Do not add a disclosure of your own. If the result starts with the outside-judge sentence, show it once. Do not mention the judge's model, a Jev score, a credit balance, or a quote check. ";
  return [
    {
      ...grill,
      description: `${grill.description.replace(localDisclosure, hostedDisclosure)} ${HOSTED_COST_LINE}`,
      inputSchema: {
        ...grill.inputSchema,
        properties: {
          ...grill.inputSchema.properties,
          keep_records: {
            type: "boolean",
            description:
              "Only after the person answers. true keeps decision records on their Grill account. false does not. Omit it until they have answered, so nothing is sent first.",
          },
          supersedes: {
            type: "string",
            description:
              "Only when the person says this choice replaced an earlier one. The earlier record's date and title, in their words. Omit it on a re-run.",
          },
          changed: {
            type: "string",
            description:
              "Only together with supersedes, in their words: evidence, goals, context, or reweighed, then a few words. Never invent it.",
          },
        },
      },
    },
    {
      ...result,
      description: HOSTED_RESULT_DESCRIPTION,
      inputSchema: {
        ...result.inputSchema,
        properties: {
          ...result.inputSchema.properties,
          detail: {
            ...result.inputSchema.properties.detail,
            enum: [...result.inputSchema.properties.detail.enum, "provenance"],
            description: `${result.inputSchema.properties.detail.description} provenance is one line naming the judge model, for a written record only.`,
          },
        },
      },
    },
    {
      ...look,
      description:
        "Score decision records against what actually happened. If they have not said what happened, ask. With no records argument, read this account's saved records that are due, or the ones they named. With view changes, read all saved records and show where their calls changed after a challenge. When they chose to keep records, save the look-back answers. The judge's verdict is not revised.",
      inputSchema: {
        type: "object",
        properties: look.inputSchema.properties,
        additionalProperties: false,
      },
    },
    {
      name: "grill_decided",
      title: "Add what you decided",
      description:
        "Save a decision record after the person states a choice, including a quick take. Pass their words as decided. Confidence is optional: omit it if they did not say a percent, and do not ask. Omit record_ref to use the latest grill they have not answered. Never invent the choice. If they never answer, do not call this.",
      inputSchema: {
        type: "object",
        properties: {
          record_ref: {
            type: "string",
            description: "Optional. A saved record's date and title, or its id. Omit it to save the latest grill they have not answered.",
          },
          decided: { type: "string", description: "What they chose, in their words." },
          confidence: {
            type: "string",
            description: "Optional. How sure they are, only if that same reply said so, such as 70%. Omit it when they did not, and do not ask.",
          },
          prediction: {
            type: "string",
            description: "Only if they stated a prediction and it is not already in the decision. Do not invent one.",
          },
          proposed_by: {
            type: "string",
            enum: ["ai", "me"],
            description: "Optional. ai when an assistant first recommended the call that was grilled, me when it was the person's own. Only when the chat makes it plain. Omit it otherwise.",
          },
          after: {
            type: "string",
            description: "Optional. Only when they changed the call because of a challenge: the challenge number, such as 2, or falsifier. Omit it when the call went ahead as stated.",
          },
        },
        required: ["decided"],
        additionalProperties: false,
      },
      annotations: { title: "Add what you decided", readOnlyHint: false, openWorldHint: false },
    },
  ];
}

export const HOSTED_INSTRUCTIONS = [
  "Grill sends the decision as the person stated it to an outside judge picked by openrouter/auto.",
  "Exclude only the company that wrote the write-up. Never use this chat's own model as the judge, and never pin a model, including for speed or cost.",
  "Do not rewrite the decision, do not add your own case against, and do not wait for an OK.",
  "Ask at most one short question, and only if the decision is truly unclear, such as what the goal is.",
  "The first time, grill asks whether to keep decision records before anything is sent. Relay that one question and call again with keep_records true or false only after they answer.",
  "If the result starts with the outside-judge sentence, show that one line once. Do not add a disclosure of your own, and do not repeat it later.",
  "If grill returns a job id, call grill_result right now with that job id, before you reply to the person, and keep calling until the note arrives. Do not ask the person to check, and do not ask them for a job id.",
  "If three grills are still running, wait about 2 minutes and call grill again yourself. Do not ask the person for a job id.",
  "Relay layer 1 as written. It is at most 50 words and already ends with the next-step line. Do not add a fact list, a confidence question, or a second line.",
  "When they say more, why, or what else, call grill_result with detail more. When they say options, help me decide, or they are stuck, call grill_result with detail options. When they say full report, call grill_result with detail full. Call grill_result with detail deepen only when the person asks to deepen or go bigger. Do not call it on a quick or bulk grill, and do not ask them to. Pass job_id if you have one. A follow: line is a job id for you. Never show it. Do not write a layer yourself.",
  "Do not show a record, the judge's model, a Jev score, a credit balance, a quote check, format rules, or a disclaimer.",
  "Call grill_result with detail provenance only when you are writing a lasting record of the grill, such as an audit log. Put that one line in the record, not in your reply, unless the person asks which model judged.",
  "The verdict never becomes the decision. If they ask whether they should do it, hand the choice back and name the cheap test.",
  "When they state a choice, such as do it, yes, keep it, or delay, call grill_decided with their words. Confidence is optional. Omit it if they did not say a percent, and do not ask. Relay the confirmation as written: about five words, and sometimes one more line saying earlier calls are due for a look-back. If they never answer, do not call it, and there is no record and no look-back.",
  "Add supersedes and changed only when they say the choice changed, in their words. A re-run with nothing changed leaves those off.",
  "When they say look back, call grill_look_back and relay its one line. With a Grill account it can read saved records, so they do not have to paste.",
  "When they ask what Grill has done for them, call grill_look_back with view changes and relay it as written.",
  SCOPE_GUARD,
].join(" ");

/** A tiny Redis used by tests. Production talks to Upstash over fetch instead. */
export function createMemoryRedis() {
  const strings = new Map();
  const sets = new Map();
  const zsets = new Map();
  const lists = new Map();
  const expiry = new Map();
  const live = (key) => {
    const exp = expiry.get(key);
    if (exp && Date.now() > exp) {
      strings.delete(key);
      sets.delete(key);
      zsets.delete(key);
      lists.delete(key);
      expiry.delete(key);
      return false;
    }
    return true;
  };
  return {
    command(args) {
      const op = String(args[0] || "").toUpperCase();
      const key = args[1] === undefined ? "" : String(args[1]);
      if (key) live(key);
      switch (op) {
        case "GET":
          return strings.has(key) ? strings.get(key) : null;
        case "SET": {
          const nx = args.some((value, index) => index > 2 && String(value).toUpperCase() === "NX");
          if (nx && strings.has(key)) return null;
          strings.set(key, String(args[2]));
          const ex = args.findIndex((value, index) => index > 2 && String(value).toUpperCase() === "EX");
          if (ex >= 0) expiry.set(key, Date.now() + Number(args[ex + 1]) * 1000);
          return "OK";
        }
        case "DEL": {
          const had = strings.delete(key) || sets.delete(key) || zsets.delete(key) || lists.delete(key);
          expiry.delete(key);
          return had ? 1 : 0;
        }
        case "INCR": {
          const next = (Number(strings.get(key)) || 0) + 1;
          strings.set(key, String(next));
          return next;
        }
        case "INCRBY": {
          const next = (Number(strings.get(key)) || 0) + Number(args[2]);
          strings.set(key, String(next));
          return next;
        }
        case "RPUSH": {
          const list = lists.get(key) || [];
          for (const value of args.slice(2)) list.push(String(value));
          lists.set(key, list);
          return list.length;
        }
        case "LTRIM": {
          const list = lists.get(key) || [];
          const len = list.length;
          let start = Number(args[2]);
          let stop = Number(args[3]);
          if (start < 0) start = Math.max(0, len + start);
          if (stop < 0) stop = len + stop;
          lists.set(key, list.slice(start, stop + 1));
          return "OK";
        }
        case "LRANGE": {
          const list = lists.get(key) || [];
          const len = list.length;
          let start = Number(args[2]);
          let stop = Number(args[3]);
          if (start < 0) start = Math.max(0, len + start);
          if (stop < 0) stop = len + stop;
          return list.slice(start, stop + 1);
        }
        case "EXPIRE":
          expiry.set(key, Date.now() + Number(args[2]) * 1000);
          return 1;
        case "SADD": {
          const set = sets.get(key) || new Set();
          set.add(String(args[2]));
          sets.set(key, set);
          return 1;
        }
        case "SREM": {
          const set = sets.get(key);
          if (!set) return 0;
          return set.delete(String(args[2])) ? 1 : 0;
        }
        case "PFADD": {
          // Exact stand-in for a HyperLogLog in tests: a set of members, read back only as a count.
          const set = sets.get(key) || new Set();
          const before = set.size;
          for (const value of args.slice(2)) set.add(String(value));
          sets.set(key, set);
          return set.size > before ? 1 : 0;
        }
        case "PFCOUNT": {
          const union = new Set();
          for (const name of args.slice(1)) {
            live(String(name));
            for (const value of sets.get(String(name)) || []) union.add(value);
          }
          return union.size;
        }
        case "SCARD":
          return sets.get(key)?.size || 0;
        case "SMEMBERS":
          return [...(sets.get(key) || [])];
        case "SISMEMBER":
          return sets.get(key)?.has(String(args[2])) ? 1 : 0;
        case "ZADD": {
          const member = String(args[3]);
          const list = (zsets.get(key) || []).filter((row) => row.member !== member);
          list.push({ score: Number(args[2]), member });
          list.sort((a, b) => a.score - b.score);
          zsets.set(key, list);
          return 1;
        }
        case "ZRANGE":
          return (zsets.get(key) || []).map((row) => row.member);
        case "ZREM": {
          const list = zsets.get(key) || [];
          const next = list.filter((row) => row.member !== String(args[2]));
          zsets.set(key, next);
          return list.length - next.length;
        }
        default:
          throw new Error(`redis ${op}`);
      }
    },
  };
}

/**
 * "Your habits" on /decisions: how the person answers grills, counted from what the account
 * already holds (saved records and undecided drafts). Shown only to that person. Nothing here
 * is stored, logged or counted for the operator; it is recomputed on each page load.
 */
export function decisionHabits({ records = [], waiting = 0, now = Date.now() } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const decided = records.length;
  const withConfidence = records.filter((row) => {
    const parsed = parseRecords(row.block || "")[0];
    return parsed && confidenceValue(parsed.confidence) != null;
  }).length;
  const changedCourse = records.filter((row) => String(row.supersedes || "").trim()).length;
  const due = records.filter((row) => row.review && row.review <= today).length;
  const lookedBack = records.filter((row) => row.lookback?.happened).length;
  let prompt = "";
  if (waiting > decided) prompt = "Most of your grills end without a choice. One line saying what you chose, after the verdict, is what makes a look-back possible.";
  else if (decided && withConfidence * 2 < decided) prompt = "You rarely say how sure you are. A rough percent makes a look-back show whether your confidence matches what happens.";
  else if (due > lookedBack) prompt = `${due - lookedBack} look-back${due - lookedBack === 1 ? " is" : "s are"} due. Say "look back" in your chat.`;
  return { decided, waiting, withConfidence, changedCourse, due, lookedBack, prompt };
}

/**
 * Saved records whose look-back date has come and that have no look-back yet, oldest date first.
 * A reminder points only at these. A record already looked back is done.
 */
export function dueForLookBack(rows, now = Date.now()) {
  const today = isoDay(now);
  return (rows || [])
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.review || "")) && row.review <= today && !row.lookback?.happened)
    .sort((a, b) => (a.review < b.review ? -1 : a.review > b.review ? 1 : 0));
}

/** The one reminder line grill_decided can add. A count only: no titles in the chat line. */
export function dueReminderLine(count) {
  const n = Math.floor(Number(count) || 0);
  if (n < 1) return "";
  return `${n} earlier call${n === 1 ? " is" : "s are"} due for a look-back. Say "look back" when you're ready.`;
}

/** Whole days from a YYYY-MM-DD date to today (UTC). 0 on the day itself. */
export function daysOverdue(review, now = Date.now()) {
  const at = Date.parse(`${review}T00:00:00Z`);
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.round((today - at) / 86_400_000));
}

/** The calendar link's secret. 32 random bytes, base64url, 43 characters. Shown once, stored only as a hash. */
export function newCalendarToken() {
  return randomBytes(32).toString("base64url");
}

export function calendarTokenShape(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ""));
}

export function calendarTokenHash(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export const CALENDAR_EVENT_TITLE = "Grill look-back due";

/** RFC 5545 TEXT: escape backslash, semicolon, comma and line breaks. */
function icsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** RFC 5545 folding: lines longer than 75 octets continue on the next line after one space. */
function icsFold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const out = [];
  let chunk = "";
  let size = 0;
  for (const char of line) {
    const width = Buffer.byteLength(char, "utf8");
    const limit = out.length ? 74 : 75;
    if (size + width > limit) {
      out.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += char;
    size += width;
  }
  out.push(chunk);
  return out.join("\r\n ");
}

function icsDate(iso) {
  return String(iso).replace(/-/g, "");
}

function icsStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * The private calendar feed: one all-day event per saved record that has a look-back date
 * and no look-back yet. Titles appear only when the person switched them on. Nothing else
 * from the record is written: no verdict, no prediction, no choice.
 */
export function calendarFeed({ rows = [], origin = "https://grillyour.ai", titles = false, now = Date.now() } = {}) {
  const stamp = icsStamp(now);
  const link = `${String(origin).replace(/\/$/, "")}/decisions`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Grill//Look-back reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Grill look-backs",
    "X-PUBLISHED-TTL:PT6H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
  ];
  const waiting = (rows || []).filter(
    (row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.review || "")) && !row.lookback?.happened && row.id,
  );
  for (const row of waiting) {
    const end = new Date(Date.parse(`${row.review}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const summary = titles && row.title ? `${CALENDAR_EVENT_TITLE}: ${row.title}` : CALENDAR_EVENT_TITLE;
    const uid = `${String(row.id).replace(/[^A-Za-z0-9_-]/g, "")}@grillyour.ai`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(row.review)}`,
      `DTEND;VALUE=DATE:${icsDate(end)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(`Say "look back" in your chat, or open ${link}`)}`,
      `URL:${link}`,
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(CALENDAR_EVENT_TITLE)}`,
      "TRIGGER;RELATED=START:PT9H",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}
