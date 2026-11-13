/**
 * Pure helpers for hosted Grill. No network and no logging.
 * The installed local tool does not import this file.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { addDays, confidenceValue, isoDate, lookBackPrompt, parseDecided, parseOutcomes, parseRecords, plainVerdict, REVIEW_DAYS, reviewDateFor, shortDecision } from "./reflection.mjs";
import { CHALLENGE_KINDS, SCOPE_GUARD, VERDICTS, clientCompanyHint } from "./judgeCore.mjs";
import { INDEPENDENCE_NOT_VERIFIED, INDEPENDENCE_RELAY, buildGrillTools, groundedAuthor } from "../server/index.mjs";
import { FEEDBACK_KEEP_DAYS, FEEDBACK_POINTER } from "./feedbackCore.mjs";

export { SCOPE_GUARD };

/** First use only. One line. The privacy page holds the rest. Same words as the local server. */
export const ONCE_DISCLOSURE =
  "This goes to an outside judge from a different company, and the router does not keep it. https://grillyour.ai/#privacy";

/**
 * The same line on a run that ruled nobody out, because Grill could not tell who wrote the
 * write-up. It is the sentence above without the company claim, built from it so the two
 * cannot drift apart. Same words as the local server.
 */
export const ONCE_DISCLOSURE_UNVERIFIED = ONCE_DISCLOSURE.replace(" from a different company", "");

export { INDEPENDENCE_NOT_VERIFIED };

export const HOSTED_PROTOCOLS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26"]);
export const CLAUDE_WEB_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
export const TYPICAL_GRILL_USD = 0.03;
export const MAX_SUBJECT_CHARS = 200_000;
/** A /judge link carries the decision in the query string. Longer than this is refused and not sent. */
export const JUDGE_PACKET_MAX = 4000;
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
/**
 * The person's router key has no allowance left this month, or the judge answered 402.
 * The name is older than the wording: no tool text says "credit", and
 * scripts/platformPolicy.test.mjs holds that line.
 */
export const OUT_OF_CREDIT =
  "You've reached this month's free limit, so this one didn't run. It resets on the 1st. Nothing was charged to you. Questions: support@grillyour.ai.";
/** One email, two sign-ins, and the second one cannot share the first one's account. */
export const EMAIL_CLAIMED_TEXT =
  "This email is already set up with Grill on another sign-in. Sign in with that one instead, or write to support@grillyour.ai if you've lost it.";
/** The invite-only reply. `origin` makes the redeem link absolute for the host they are on. */
export function inviteOnlyText(origin = "") {
  const base = String(origin || "").replace(/\/$/, "");
  const redeem = base ? `${base}/redeem` : "/redeem";
  return `Grill in chat is invite-only for now, and this email isn't on the list yet. If you were invited, disconnect Grill, connect again, and sign in with the email your invite went to. If you have an invite code, enter it at ${redeem}. To ask for an invite, write to support@grillyour.ai.`;
}

export const INVITE_ONLY = inviteOnlyText();
/** The page that says what goes where and what is kept. The records note points at it. */
export const DATA_FLOW_URL = "https://grillyour.ai/data-flow/";

/** The one question. /judge shows this line above its Yes and No buttons. It does not change. */
export const RECORDS_QUESTION = "Keep a record of your decisions on your Grill account? Yes / No";

/**
 * What the person reads under the question, before anything is sent: where the decision goes
 * whichever way they answer, and what a yes adds. It asks nothing, so the first reply still
 * holds one question. It makes no claim about which company the judge is from, because this
 * is shown before Grill has looked at who is asking.
 */
export const RECORDS_NOTE = `Either way, your decision goes through Grill's server to an outside AI judge that OpenRouter picks, and to a quality check by TypeSafe. If you say yes, Grill keeps an encrypted record that its operators could open, and emails you on Mondays when a look-back is due unless you turn that off. What is kept and for how long: ${DATA_FLOW_URL}`;

export const CONSENT_TEXT = [
  RECORDS_QUESTION,
  "",
  RECORDS_NOTE,
  "",
  "Ask that once, and show the paragraph under the question with it. Then call grill again with keep_records true or false. Do not send the decision until they answer.",
].join("\n");

/**
 * What the person is told after a reaction when the grill itself was not sent. It names what
 * buildFeedbackRecord stores that came from them or from the grill, and for how long.
 */
export const FEEDBACK_KEPT_TEXT = `Noted. Grill keeps the rating, your one-line reason, the verdict label and the judge model for ${FEEDBACK_KEEP_DAYS} days. Not the decision.`;

/** The reply to grill_feedback. `record` is what was stored: it holds the grill only when they said yes to sending it. */
export function hostedFeedbackReply(share, record) {
  if (share && (record?.subject || record?.layer1)) return "Noted. This grill was sent so Grill can learn from it.";
  if (share) return "Noted. The rating was stored. That grill's text was no longer available to send.";
  return FEEDBACK_KEPT_TEXT;
}

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
    scopes_supported: ["openid", "profile", "email", "offline_access"],
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
 * clientInfo from initialize, then a User-Agent that says Cursor, then a hint
 * remembered from this client's own handshake, then the rest of the User-Agent
 * list. An unknown client still excludes nothing.
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
  // OpenRouter serves Meta's models under meta-llama/, so that prefix is the family to leave out.
  if (redirectHost === "agent.meta.ai" || clientHost === "agent.meta.ai") {
    return { company: "meta-llama", sourceApp: "muse" };
  }

  // Cursor is not one model company, so the judge still excludes nobody.
  // The name is stored on new records. Older ones stay unknown.
  const named = String(clientInfo?.name || clientInfo?.title || "");
  if (/\bcursor\b/i.test(named)) return { company: "", sourceApp: "cursor" };
  if (/\b(?:muse|meta)\b/i.test(named)) return { company: "meta-llama", sourceApp: "muse" };
  const fromName = clientCompanyHint({ clientInfo });
  if (fromName) return fromName;
  // Read before the remembered hint, so a company kept from a handshake is never used for Cursor.
  if (/\bcursor\b/i.test(String(userAgent || ""))) return { company: "", sourceApp: "cursor" };
  const kept = rememberedHint(remembered);
  if (kept) return kept;
  const fromAgent = clientCompanyHint({ userAgent });
  if (fromAgent) return fromAgent;
  return { company: "", sourceApp: "unknown" };
}

/**
 * Which company the judge must not come from.
 *
 * A company named on the call wins when it is one the router uses, after common names are
 * mapped to the router's prefix (`xai` to `x-ai`, `claude` to `anthropic`). That holds even
 * when it differs from the recognised client's company. Whether it should is an open owner
 * decision.
 *
 * `none`, or any name the router does not use, is not a company. It never replaces the
 * recognised client's company, so the assistant cannot switch the exclusion off.
 *
 * With no company from either, the author is `none`: nobody is excluded, and the verdict
 * says independence was not verified.
 */
export function authorForJudge({ explicit = "", company = "" } = {}) {
  const given = String(explicit || "").trim().toLowerCase();
  if (given && !AUTHOR_RE.test(given)) return { error: "author must be a lowercase model-family name, like openai." };
  const named = groundedAuthor(given);
  if (named) return { author: named };
  const client = groundedAuthor(company);
  if (client) return { author: client };
  return { author: "none" };
}

/** Companies a served model slug can be named as, in plain words. One word each, so the note stays short. */
const JUDGE_COMPANY_NAMES = Object.freeze({
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "x-ai": "xAI",
  xai: "xAI",
  deepseek: "DeepSeek",
  "meta-llama": "Meta",
  meta: "Meta",
  mistralai: "Mistral",
  mistral: "Mistral",
});

/**
 * The company behind the model that answered, as a person would say it.
 * Empty when the slug does not name one of those companies, so a reply never invents one.
 */
export function judgeCompanyName(servedModel) {
  const slug = String(servedModel || "").trim().toLowerCase();
  if (!slug || slug.startsWith("openrouter/")) return "";
  if (/(^|[/.])claude[-.\d]/.test(slug)) return "Anthropic";
  return JUDGE_COMPANY_NAMES[slug.split("/")[0]] || "";
}

/** The plain name for a company id from sourceAppFromClient, or "" when Grill has no name for it. */
export function companyLabel(company) {
  const id = String(company || "").trim().toLowerCase();
  return Object.hasOwn(JUDGE_COMPANY_NAMES, id) ? JUDGE_COMPANY_NAMES[id] : "";
}

/**
 * One line on every hosted verdict that excluded nobody. `author` is what authorForJudge
 * returned: `none` means neither the client nor the call named a company the router uses.
 *
 * An unknown client is told which company judged, when Grill has a name for it, so the person
 * can see whether it matches their own assistant. Cursor runs several companies' models, and
 * some served models come from a company Grill has no name for: those get the plain line.
 * Anything but a named company counts as `none`, so a caller that forgets `author` still
 * gets the line.
 */
export function independenceLine({ author = "none", sourceApp = "", servedModel = "" } = {}) {
  if (groundedAuthor(author)) return "";
  const company = String(sourceApp || "") === "unknown" ? judgeCompanyName(servedModel) : "";
  if (company) {
    return `${INDEPENDENCE_NOT_VERIFIED} Grill couldn't tell which AI you're using. This judge is from ${company}. If yours is too, name it next time.`;
  }
  return `${INDEPENDENCE_NOT_VERIFIED} Grill couldn't tell which company's model wrote this, so no company was ruled out.`;
}

/** The first-use line for this run: without the company claim when nobody was excluded. */
export function onceDisclosureFor(author) {
  return groundedAuthor(author) ? ONCE_DISCLOSURE : ONCE_DISCLOSURE_UNVERIFIED;
}

/** On /judge, above the button, when the link named no assistant whose company Grill knows. */
export const JUDGE_PAGE_UNVERIFIED_LINE = `${INDEPENDENCE_NOT_VERIFIED} Grill can't tell which company's model wrote this, so no company is ruled out.`;

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

/** How many stored codes exist. Redeem stays off when this is 0 and GRILL_INVITE_CODES is empty. */
export const STORED_INVITE_COUNT_KEY = "grill:hosted:invite:stored:count";

/** A lead label an operator makes up. Not an email. One stored code per label. */
export function normalizeLead(raw) {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(text)) return "";
  return text;
}

export function storedInviteHashKey(hash) {
  if (!/^[a-f0-9]{64}$/.test(String(hash || ""))) return "";
  return `grill:hosted:invite:stored:${hash}`;
}

/** The store key for a code. The value is the max uses. The code itself is not the key. */
export function storedInviteKey(code) {
  return storedInviteHashKey(inviteCodeHash(code));
}

export function storedInviteLeadKey(lead) {
  const normalized = normalizeLead(lead);
  if (!normalized) return "";
  return `grill:hosted:invite:lead:${createHash("sha256").update(normalized).digest("hex")}`;
}

/**
 * Save one code in the existing store. `max` defaults to 1, so a lead's code is single-use.
 * A lead label can have only one code. The plaintext code is not written.
 * `command` is a Redis command function. This does not change open sign-up or the allowlist.
 */
export async function saveStoredInviteCode(command, code, { max = 1, lead = "" } = {}) {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return { ok: false, reason: "bad" };
  if (!Number.isInteger(max) || max < 1 || max > INVITE_MAX_USES) return { ok: false, reason: "bad" };
  const leadKey = lead ? storedInviteLeadKey(lead) : "";
  if (lead && !leadKey) return { ok: false, reason: "lead" };
  if (leadKey && (await command(["GET", leadKey]))) return { ok: false, reason: "lead" };
  const key = storedInviteKey(normalized);
  if (!key) return { ok: false, reason: "bad" };
  const claimed = await command(["SET", key, String(max), "NX"]);
  if (!claimed) return { ok: false, reason: "exists" };
  try {
    if (leadKey) {
      const linked = await command(["SET", leadKey, inviteCodeHash(normalized), "NX"]);
      if (!linked) {
        await command(["DEL", key]);
        return { ok: false, reason: "lead" };
      }
    }
    await command(["INCR", STORED_INVITE_COUNT_KEY]);
  } catch (error) {
    await command(["DEL", key]);
    if (leadKey) await command(["DEL", leadKey]);
    throw error;
  }
  return { ok: true, max };
}

/** Max uses for a stored code, or null when this code is not in the store. */
export async function readStoredInviteMax(command, code) {
  const key = storedInviteKey(code);
  if (!key) return null;
  const raw = await command(["GET", key]);
  if (raw == null) return null;
  const max = Number(raw);
  if (!Number.isInteger(max) || max < 0 || max > INVITE_MAX_USES) return null;
  return max;
}

/** True when a redeemed hash still belongs to a stored code. */
export async function storedInviteListed(command, codeHash) {
  const key = storedInviteHashKey(codeHash);
  if (!key) return false;
  return (await command(["GET", key])) != null;
}

export async function storedInvitesEnabled(command) {
  return (Number(await command(["GET", STORED_INVITE_COUNT_KEY])) || 0) > 0;
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

// Each says what happened and when it starts again. Neither offers a way to get more:
// a directory reads that as a sale.
export const SERVICE_CAP_TEXT =
  "Grill has used up this month's free grills for everyone, so this one didn't run. It starts again on the 1st. Nothing was charged to you. Questions: support@grillyour.ai.";
export const USER_CAP_TEXT =
  "You've used this month's free grills, so this one didn't run. It starts again on the 1st. Nothing was charged to you. Questions: support@grillyour.ai.";

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
 * A completed grill is one the judge actually judged. A run that exits with no
 * recognisable verdict, including after its own retries, is not a check.
 */
export function completedGrill(parsed) {
  const verdict = typeof parsed?.verdict === "string" ? parsed.verdict.trim().toLowerCase() : "";
  return VERDICTS.includes(verdict);
}

/** Completed checks for one account in a UTC month. This is the usage number. */
export function monthlyCheckKey(accountId, month) {
  return `grill:hosted:checks:${accountId}:${month}`;
}

/** Completed checks for one account on a UTC day. The daily limit reads this, not attempts. */
export function dailyCheckKey(accountId, day) {
  return `grill:hosted:day:${accountId}:${day}`;
}

/** One count per run. A second compose of the same run does not add another check. */
export function checkOnceKey(runId) {
  return `grill:hosted:counted:${runId}`;
}

/**
 * A short-lived lock so an automatic retry of the same decision is the same run.
 * Empty when there is no server secret: nothing derived from the decision is stored.
 */
export function runFingerprint(accountId, subject, env = {}) {
  const salt = String(env.GRILL_METRICS_SALT || env.GRILL_RECORD_KEY || "").trim();
  if (!salt || !accountId) return "";
  const body = `${accountId}\n${String(subject || "").trim()}`;
  return createHmac("sha256", salt).update(body).digest("hex").slice(0, 32);
}

export function runLockKey(accountId, fingerprint) {
  return `grill:hosted:run:${accountId}:${fingerprint}`;
}

/** What /account and /decisions show, and what a support lookup reads. */
export function checksLine(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `${n} ${n === 1 ? "check" : "checks"} this month.`;
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
    return "The only judge available was from the same company that wrote this, so Grill held back the verdict. Try again in a few minutes.";
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
      return `Grill couldn't finish setting up your account just now. Try again in a few minutes; if it keeps happening, write to support@grillyour.ai${ref(requestId)}.`;
    case "key-encryption":
    case "record-key":
      return `Grill isn't fully set up on the server right now, so it can't run this. We've logged it; write to support@grillyour.ai if you need it sooner${ref(requestId)}.`;
    case "clerk-delete":
      return `Grill couldn't finish deleting your sign-in. Your records are untouched. Try again in a minute, or write to support@grillyour.ai${ref(requestId)}.`;
    default:
      return `Something on Grill's side broke while handling this. Try again in a minute; if it keeps happening, write to support@grillyour.ai${ref(requestId)}.`;
  }
}

/**
 * One optional line after the verdict, only for a call worth looking back on.
 * A quick take, a burst, a check, and a one-off life choice get nothing.
 */
export function lookbackOffer(text, { thin = false, burst = false, now = new Date() } = {}) {
  if (thin || burst) return "";
  const source = String(text || "");
  if (/\b(is this|review this|rewrite this|what is the|who has the higher)\b/i.test(source)) return "";
  const anchor = now instanceof Date ? now : new Date(now);
  const today = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  const named = reviewDateFor(source, anchor);
  const fallback = isoDate(addDays(today, REVIEW_DAYS));
  const ship = /\b(ship|shipping|launch|deploy|beta)\b/i.test(source);
  const money = /\b(price|prices|pricing|spend|budget|invoice)\b/i.test(source) || /\$\d/.test(source);
  const forecast = /\bforecast\b|\bpredict\b/i.test(source);
  const weekly = /\b(captain|gameweek|game week|waiver|slate|start\/sit)\b/i.test(source);
  const hire = /\b(hire|hiring|vendor|contractor|payroll)\b/i.test(source);
  const life = /\b(apartment|lease|wedding|sabbatical|doctor|medical)\b/i.test(source);
  const encouraged = ship || money || weekly || ((forecast || hire) && named !== fallback);
  if (!encouraged || (life && !ship && !money && !weekly)) return "";
  const day = formatDay(named);
  return day ? `Look back on ${day}. One tap when it is due.` : "";
}

export function formatDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${Number(match[3])} ${month}`;
}

/** Public site for links a person can open. There is no separate host setting; this is the default. */
export const PUBLIC_SITE_ORIGIN = "https://grillyour.ai";

/** Funnel counts. Integers only. The weekly report reads the same strings. No decision text. */
export const FUNNEL_KEYS = Object.freeze({
  grills: "grill:metric:funnel_grills",
  choices: "grill:metric:funnel_choices",
  lookbacksSet: "grill:metric:funnel_lookbacks_set",
  lookbacksDone: "grill:metric:funnel_lookbacks_done",
});

/** Saved line in chat. Points at Your grills. No confidence nag, and nothing about what is left this month. */
export function savedConfirmation(review) {
  const day = formatDay(review);
  const where = `Your grills: ${PUBLIC_SITE_ORIGIN}/decisions`;
  return day ? `Saved. Look-back ${day}. ${where}` : `Saved. ${where}`;
}

export function isoDay(ms = Date.now()) {
  const date = new Date(ms);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A look-back is done only when the note has words. A blank note is not a look-back. */
export function hasLookback(row) {
  return Boolean(String(row?.lookback?.happened || "").trim());
}

/** Recorded before the review day. It does not count until that day. */
export function earlyRead(row, now = Date.now()) {
  if (!hasLookback(row)) return false;
  const review = String(row?.review || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(review) && review > isoDay(now);
}

/**
 * A stored look-back note, including one that was saved as a single line
 * (`came_true: no happened: ...`). Display only. Nothing here is stored.
 */
function readStoredOutcome(note) {
  const lined = parseOutcomes(note)[0];
  if (lined?.happened || (lined?.cameTrue && note.includes("\n"))) return lined;
  const came = note.match(/\bcame_true:\s*(\S+)/i)?.[1] || "";
  const happened = note.match(/\bhappened:\s*(.+)$/i)?.[1]?.trim() || "";
  if (!came && !happened) return lined || null;
  return parseOutcomes(`came_true: ${came}\nhappened: ${happened}`)[0] || lined || null;
}

/** Plain look-back status for one saved record. Worked out when the page renders. */
export function lookbackStatus(row, now = Date.now()) {
  const note = String(row?.lookback?.happened || "").replace(/\s+/g, " ").trim();
  if (note) {
    const outcome = readStoredOutcome(note);
    if (outcome?.cameTrue === "yes" || outcome?.cameTrue === "no") {
      const head = outcome.cameTrue === "yes" ? "It came true." : "It did not come true.";
      return { state: "done", text: outcome.happened ? `${head} ${outcome.happened}` : head };
    }
    return { state: "done", text: note };
  }
  const review = String(row?.review || "");
  const today = isoDay(now);
  if (/^\d{4}-\d{2}-\d{2}$/.test(review) && review <= today) {
    return { state: "due", text: `Due for a look-back since ${formatDay(review)}. Not looked back.` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(review)) {
    return { state: "waiting", text: `Look back on ${formatDay(review)}. Not yet.` };
  }
  return { state: "none", text: "No look-back date." };
}

/** Categories a person can filter. Order is the keyword order: first match wins. */
export const DECISION_TYPES = Object.freeze([
  { id: "fantasy", label: "Fantasy sports" },
  { id: "product", label: "Product/code" },
  { id: "money", label: "Money" },
  { id: "work", label: "Work" },
  { id: "personal", label: "Personal" },
  { id: "other", label: "Other" },
]);

const DECISION_TYPE_RULES = Object.freeze([
  ["fantasy", [/\bfantasy\b/i, /\bwaiver wire\b/i, /\bsleeper\b/i, /\bdynasty league\b/i, /\bredraft\b/i, /\bppr\b/i, /\bstart\/sit\b/i]],
  ["product", [/\b(ship|shipping|launch|feature|bug|api|deploy|repo|roadmap|beta|refactor|codebase|github)\b/i, /\bpull request\b/i, /\bproduct\b/i, /\bcode\b/i]],
  ["money", [/\$\d/, /\b(budget|salary|invoice|mortgage|rent|invest|investment|revenue|fundraising|fundraise|equity|pricing|price|profit|wage|tuition|debt|loan|runway)\b/i, /\bseed round\b/i]],
  ["work", [/\b(hire|hiring|contractor|employee|manager|promotion|resign|resignation|layoff|career|coworker|boss|office)\b/i, /\bjob\b/i]],
  ["personal", [/\b(family|health|doctor|wedding|relationship|vacation|apartment|marriage|therapy)\b/i, /\b(kid|kids|child|children|friend)\b/i]],
]);

function textType(text) {
  const value = String(text || "");
  for (const [id, patterns] of DECISION_TYPE_RULES) {
    if (patterns.some((pattern) => pattern.test(value))) return id;
  }
  return "other";
}

/**
 * A category for one saved record, from the words already stored.
 * The title wins. The rest of the record is used only when the title matches nothing.
 * No model call, and nothing is stored.
 */
export function decisionType(row) {
  const parsed = parseRecords(row?.block || "")[0] || {};
  const fromTitle = textType(`${row?.title || ""}\n${parsed.title || ""}`);
  if (fromTitle !== "other") return fromTitle;
  return textType([row?.decided, parsed.decided, parsed.prediction, parsed.goal, parsed.guardrails, row?.block].join("\n"));
}

export function decisionTypeLabel(id) {
  return DECISION_TYPES.find((item) => item.id === id)?.label || "Other";
}

/** A type query, or "" when it is not one of the categories. */
export function decisionTypeId(value) {
  const id = String(value || "").trim().toLowerCase();
  return DECISION_TYPES.some((item) => item.id === id) ? id : "";
}

/**
 * Counts for the takeaways block. Worked out from the records on the page.
 * A verdict held up when a solid call came true, or a doubted call did not.
 * Nothing here is stored.
 */
export function decisionTakeaways(rows, { waiting = 0, now = Date.now(), filtered = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const count = list.length;
  const looked = list.filter((row) => hasLookback(row) && !earlyRead(row, now)).length;
  const today = isoDay(now);
  const dueOpen = list.filter((row) => {
    const review = String(row?.review || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(review) && review <= today && !hasLookback(row);
  }).length;
  let scored = 0;
  let held = 0;
  for (const row of list) {
    if (earlyRead(row, now)) continue;
    const note = String(row?.lookback?.happened || "").replace(/\s+/g, " ").trim();
    if (!note) continue;
    const outcome = readStoredOutcome(note);
    const came = outcome?.cameTrue;
    if (came !== "yes" && came !== "no") continue;
    const verdict = plainVerdict(parseRecords(row?.block || "")[0]?.verdict || row?.verdict || "");
    const doubt = verdict === "shaky" || verdict === "doesn't hold up";
    const allowed = verdict === "solid" || verdict === "solid if";
    if (!doubt && !allowed) continue;
    scored += 1;
    if ((doubt && came === "no") || (allowed && came === "yes")) held += 1;
  }
  const withConfidence = list.filter((row) => confidenceValue(parseRecords(row?.block || "")[0]?.confidence) != null).length;
  const nudges = [];
  if (!filtered && waiting > 0) nudges.push("Log your choice after a grill so it counts.");
  else if (count > 0 && withConfidence * 2 < count) nudges.push("Add how sure you were. A rough percent is enough.");
  return { count, looked, dueOpen, scored, held, nudges };
}

/** Where a saved grill came from. Claude Code sits with Claude. Anything else known is Other. */
export const DECISION_SOURCES = Object.freeze([
  { id: "claude", label: "Claude" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "cursor", label: "Cursor" },
  { id: "grok", label: "Grok Bot" },
  { id: "other", label: "Other" },
  { id: "unknown", label: "Unknown" },
]);

export function decisionSource(row) {
  const parsed = parseRecords(row?.block || "")[0] || {};
  const raw = String(row?.sourceApp || parsed.source_app || "").trim().toLowerCase();
  if (!raw || raw === "unknown") return "unknown";
  if (raw === "claude" || raw === "claude-code") return "claude";
  if (raw === "chatgpt") return "chatgpt";
  if (raw === "cursor") return "cursor";
  if (raw === "grok") return "grok";
  return "other";
}

export function decisionSourceId(value) {
  const id = String(value || "").trim().toLowerCase();
  return DECISION_SOURCES.some((item) => item.id === id) ? id : "";
}

export function decisionSourceLabel(id) {
  return DECISION_SOURCES.find((item) => item.id === id)?.label || "Unknown";
}

/** due when the review day has come and there is no look-back. closed when a look-back counts. An early read stays open. */
export function decisionGroup(row, now = Date.now()) {
  if (hasLookback(row) && !earlyRead(row, now)) return "closed";
  const review = String(row?.review || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(review) && review <= isoDay(now)) return "due";
  return "open";
}

function tappedOutcome(row) {
  const status = lookbackStatus(row);
  if (status.text.startsWith("It came true.")) return "Held up";
  if (status.text.startsWith("It did not come true.")) return "Didn't";
  if (/^Mixed\b/i.test(status.text)) return "Mixed";
  return status.state === "done" ? status.text : "";
}

/** Short outcome for a list row. */
export function outcomeLine(row, now = Date.now()) {
  const tapped = tappedOutcome(row);
  if (earlyRead(row, now) && tapped) return `Early: ${tapped}`;
  if (decisionGroup(row, now) === "due") return "Due";
  if (tapped) return tapped;
  if (lookbackStatus(row, now).state === "waiting") {
    const day = formatDay(row?.review);
    return day ? `Look back ${day}` : "Not yet";
  }
  return "";
}

export function outcomeNoteText(happened) {
  const match = String(happened || "").match(/^note:\s*(.+)$/im);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

/** One line for three or more decisions in view. The held-up clause waits for three looked-back records. */
export function scorecardLine(rows, { type = "", source = "" } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length < 3) return "";
  const summary = decisionTakeaways(list);
  const pct = Math.round((summary.looked / summary.count) * 100);
  const scope =
    type && source
      ? `${decisionTypeLabel(type)} from ${decisionSourceLabel(source)} · `
      : type
        ? `${decisionTypeLabel(type)} · `
        : source
          ? `${decisionSourceLabel(source)} · `
          : "";
  let line = `${scope}${summary.count} decisions · ${pct}% looked back`;
  if (summary.looked >= 3 && summary.scored > 0) line += ` · verdict held up in ${summary.held} of ${summary.scored}`;
  return line;
}

export const LOOKBACK_HOW =
  "A look-back is due 14 days after you choose. Say “look back” in your chat and say what happened.";

/** How long a grill waits for a stated choice before its draft is deleted. */
export const PENDING_KEEP_DAYS = 14;

/**
 * /decisions, when a grill has a verdict and no stated choice yet. A count only: the page
 * shows no title, verdict or text from a draft.
 */
export function waitingGrillLine(count) {
  const n = Math.floor(Number(count) || 0);
  if (n < 1) return "";
  return n === 1 ? "1 grill is waiting for your call." : `${n} grills are waiting for your call.`;
}
export const WAITING_GRILL_HOW = `In a chat where Grill is connected, tell your AI what you chose, for example “I’m going ahead”. It is saved here with a look-back date. A waiting grill is deleted after ${PENDING_KEEP_DAYS} days.`;

/** What the records switch and Delete all do to a waiting grill, said on the page next to each. */
export const RECORDS_OFF_DELETES_WAITING = "A grill still waiting for your call is deleted.";
export const RECORDS_OFF_NOTE = `Turning records off leaves the decisions already saved until you delete them. ${RECORDS_OFF_DELETES_WAITING}`;
export const DELETE_ALL_ALSO_WAITING = "It also removes any grill still waiting for your call.";

/** A judge kind that flags a source, a fact, or a figure. The flag is not proof it was wrong. */
export const FLAG_KINDS = Object.freeze(["unsupported-claim", "evidence-mismatch", "wrong-cost-model"]);

/** Up to two kinds, in the same order as the stored challenge lines. An unknown kind is blank. */
export function challengeKindList(challenges) {
  const list = Array.isArray(challenges) ? challenges.slice(0, 2) : [];
  return list.map((row) => {
    const kind = String(row && typeof row === "object" ? row.kind : "").trim().toLowerCase();
    return CHALLENGE_KINDS.includes(kind) ? kind : "";
  });
}

function impactTap(row) {
  return row?.impact === "changed" || row?.impact === "kept" ? row.impact : "";
}

function statedChange(row) {
  const parsed = parseRecords(row?.block || "")[0] || {};
  const decided = parseDecided(parsed.decided || row?.decided || "");
  const supersedes = String(parsed.supersedes || row?.supersedes || "").trim();
  return Boolean(decided.after) || Boolean(supersedes);
}

function flaggedKind(row) {
  const list = Array.isArray(row?.challengeKinds) ? row.challengeKinds : [];
  return list.some((kind) => FLAG_KINDS.includes(String(kind || "").trim().toLowerCase()));
}

/**
 * How often a grill changed the call. A Yes tap, an after mark, or a supersedes line counts.
 * A doesn't-hold verdict counts only after Yes. A No tap is kept, and stays out of the lines.
 * A source, fact, or figure kind is flagged, and is never a change.
 */
export function grillImpact(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const summary = { count: list.length, changed: 0, doubted: 0, unknown: 0, kept: 0, flagged: 0 };
  for (const row of list) {
    const tap = impactTap(row);
    const parsed = parseRecords(row?.block || "")[0] || {};
    const verdict = plainVerdict(parsed.verdict || row?.verdict || "");
    if (tap === "kept") summary.kept += 1;
    else if (tap === "changed" || statedChange(row)) summary.changed += 1;
    else if (verdict === "doesn't hold up") summary.doubted += 1;
    else summary.unknown += 1;
    if (flaggedKind(row)) summary.flagged += 1;
  }
  return summary;
}

/**
 * One quiet line under the impact headline. A zero count is left out.
 * Unknown means the impact tap is still unconfirmed. Called out is a doesn't-hold verdict
 * that is not yet a confirmed change. Flagged is a source, fact, or figure kind, and is not proof.
 */
export function impactDetailLine({ unknown = 0, doubted = 0, flagged = 0 } = {}) {
  const parts = [];
  if (unknown) parts.push(`${unknown} unknown (impact not confirmed)`);
  if (doubted) parts.push(`${doubted} called out (not a confirmed change)`);
  if (flagged) parts.push(`${flagged} flagged (not proof)`);
  return parts.join(" · ");
}

/** The impact block. Empty when there is no saved grill. A No tap adds no line. */
export function impactLines(rows) {
  const summary = grillImpact(rows);
  if (!summary.count) return [];
  const lines = [
    summary.changed
      ? `${summary.changed} of ${summary.count} ${summary.count === 1 ? "grill" : "grills"} changed the call.`
      : "No grill is marked as changing a call yet.",
  ];
  const detail = impactDetailLine(summary);
  if (detail) lines.push(detail);
  return lines;
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

// A look-back answered in chat.
// With one saved decision in view, one answer is that decision's answer. With two or more,
// the chat names each one, and an answer is saved only on the decision it names.

/** How many decisions one chat reply names. The page lists the rest. */
export const LOOKBACK_LIST_MAX = 5;

const LOOKBACK_NOTE_MAX = 2000;

function squash(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** A name without its case, spacing, closing full stop or cut-off mark, so two spellings of one title match. */
function nameKey(text) {
  return squash(text)
    .replace(/[….\s]+$/u, "")
    .toLowerCase();
}

/** How the chat names one saved decision: its title as the list shows it, and the day its look-back falls due. */
export function lookbackLabel(row) {
  const title = shortDecision(row?.title);
  const day = formatDay(row?.review);
  return day ? `${title} (due ${day})` : title;
}

/**
 * The saved decisions a name points at. A name is a title, the label the chat showed, or a
 * date and a title. Only an exact match counts, so an answer never lands on a near miss.
 */
export function rowsNamed(rows, name) {
  const needle = nameKey(name);
  if (!needle) return [];
  return (rows || []).filter((row) => {
    const title = String(row?.title || "");
    if (!title.trim()) return false;
    return [title, shortDecision(title), lookbackLabel(row), `${row?.date || ""} ${title}`].some((form) => nameKey(form) === needle);
  });
}

/**
 * The saved decisions one look-back call is about. Pasted records point at the saved
 * decisions with the same date and title. With nothing pasted they are the ones that are due,
 * or the ones a name matched. A name that fits a saved decision exactly wins over a loose match.
 */
export function lookBackTargets(saved, picked, name = "") {
  if (picked?.mode === "pasted") {
    const pasted = picked.parsed || [];
    return (saved || []).filter((row) => pasted.some((item) => item.date === row.date && item.title === row.title));
  }
  const rows = picked?.rows || [];
  if (picked?.mode !== "named") return rows;
  const exact = rowsNamed(saved, name);
  return exact.length ? exact : rows;
}

/** An answer split at its `title:` lines. Lines above the first title belong to no decision. */
export function titledAnswers(happened) {
  const answers = [];
  let current = null;
  for (const raw of String(happened || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s*/, "");
    const title = line.match(/^title\s*:\s*(.*)$/i);
    if (title) {
      current = { title: squash(title[1]), lines: [] };
      answers.push(current);
    } else if (current && line) current.lines.push(line);
  }
  return answers.filter((answer) => answer.title).map((answer) => ({ title: answer.title, text: answer.lines.join("\n") }));
}

/**
 * Which saved decisions an answer is saved on, and with which words.
 * One decision in view: the whole answer is its answer.
 * Two or more: a decision gets an answer only when the answer names it on a `title:` line,
 * and it gets only the lines under that title. An answer that names none is saved nowhere.
 * `unmatched` lists titles that fit no single decision in view.
 */
export function lookbackSaves(targets, happened) {
  const rows = targets || [];
  const whole = squash(happened).slice(0, LOOKBACK_NOTE_MAX);
  if (!whole || !rows.length) return { saves: [], unmatched: [] };
  if (rows.length === 1) return { saves: [{ row: rows[0], happened: whole, lines: String(happened) }], unmatched: [] };
  const saves = [];
  const unmatched = [];
  for (const answer of titledAnswers(happened)) {
    const named = rowsNamed(rows, answer.title);
    const words = squash(answer.text).slice(0, LOOKBACK_NOTE_MAX);
    if (named.length !== 1) unmatched.push(answer.title);
    else if (words && !saves.some((save) => save.row === named[0])) saves.push({ row: named[0], happened: words, lines: answer.text });
  }
  return { saves, unmatched };
}

/**
 * Write a look-back onto a saved record. `lookback.at` is the time of this edit, as it always
 * was, or the time already there when `keepAt` is set (a note keeps the time of the tap).
 * `lookbackFirstAt` is the time the record first got a look-back with words, from a chat
 * answer, a tap or a note. It is set once and never moved: a later edit, a second tap and a
 * cleared note all leave it alone. Returns true only on that first time.
 */
export function setLookback(row, happened, now = Date.now(), { keepAt = false } = {}) {
  const when = new Date(now).toISOString();
  const before = row.lookback || null;
  // A record looked back before this field existed: the time it carries is the only one known.
  if (!row.lookbackFirstAt && hasLookback(row)) row.lookbackFirstAt = before.at || when;
  const words = String(happened || "");
  row.lookback = words.trim() ? { at: keepAt && before?.at ? before.at : when, happened: words } : null;
  if (row.lookbackFirstAt || !hasLookback(row)) return false;
  row.lookbackFirstAt = when;
  return true;
}

function lookbackLine(row) {
  return `${lookbackLabel(row)}: ${lookBackPrompt(parseRecords(row?.block || "")[0] || {})}`;
}

function lookbackLines(rows) {
  const list = rows || [];
  const lines = list.slice(0, LOOKBACK_LIST_MAX).map(lookbackLine);
  const more = list.length - lines.length;
  if (more > 0) lines.push(`${more} more ${more === 1 ? "is" : "are"} on ${PUBLIC_SITE_ORIGIN}/decisions`);
  return lines;
}

export const LOOKBACK_ASK_WHICH = "Say which one, and what happened.";
export const LOOKBACK_NOT_NAMED = "Nothing was saved. That answer did not name one of these decisions. Which one is it about?";
/** What the one-decision reply ends with when the answer was saved. */
export const LOOKBACK_SAVED = "Saved with your decision record.";

/** Several saved decisions are in view and nothing was said yet: one line each, by name. */
export function lookbackAskText(rows) {
  return [...lookbackLines(rows), LOOKBACK_ASK_WHICH].join("\n");
}

/** An answer came in for several decisions and named none of them. Nothing is saved on a guess. */
export function lookbackWhichText(rows) {
  return [LOOKBACK_NOT_NAMED, ...lookbackLines(rows)].join("\n");
}

// The reading is written for the paste route, which stores nothing and says so. When an answer
// was saved, those words would be false, so they are taken out before the reply says "Saved".
const PASTE_STORES_NOTHING = "Nothing is stored. This reading stays in the chat.\n\n";
const PASTE_NOT_SCORED = "Nothing is stored. Those notes did not say whether each call came true, so nothing was scored.";
const NOT_SCORED = "Those notes did not say whether each call came true, so nothing was scored.";

function readingForSaved(reading, pasted) {
  const text = String(reading || "").replace(PASTE_STORES_NOTHING, "");
  if (text.includes(PASTE_NOT_SCORED)) return pasted ? text.replace(PASTE_NOT_SCORED, NOT_SCORED).trim() : `## Look back\n\n${NOT_SCORED}`;
  return (pasted ? text : text.split("\nStill to answer:")[0]).trim();
}

/**
 * The reply after an answer was saved on the one saved decision in view. It is the paste
 * route's reading, sentence for sentence, without that route's words about storing nothing.
 * The answer was stored, so the reply must not say otherwise. Nothing else is changed.
 */
export function lookbackSavedOneText(reading) {
  const text = String(reading || "").replace(PASTE_STORES_NOTHING, "").replace(PASTE_NOT_SCORED, NOT_SCORED);
  return `${text}\n\n${LOOKBACK_SAVED}`;
}

/**
 * The reply after an answer was saved while several saved decisions were in view. It says
 * which decisions the answer went on, which named titles fit none, and what is still open.
 */
export function lookbackSavedText({ reading = "", saved = [], unmatched = [], remaining = [], pasted = false } = {}) {
  const lines = [];
  const body = readingForSaved(reading, pasted);
  if (body) lines.push(body, "");
  lines.push("Saved with your decision record:", ...saved.map((row) => shortDecision(row?.title)));
  if (unmatched.length) {
    const names = unmatched.map((title) => `"${squash(title).slice(0, 120)}"`).join(", ");
    lines.push("", `Nothing was saved for ${names}. That title matches no single decision here.`);
  }
  if (remaining.length) lines.push("", "Still to answer:", ...lookbackLines(remaining));
  return lines.join("\n");
}

/**
 * What only the hosted grill tool says, after the text it shares with the installed tool.
 * Each sentence is here once. The shared text already covers the layers, deepen, the
 * first-use line and the scope rule, so this does not say them again.
 */
const HOSTED_GRILL_TAIL =
  "The judge is always picked by openrouter/auto, excluding only the company that wrote the write-up, when Grill can tell which that is. It never falls back to this chat's own model, for speed or cost, and it never pins a model. If the result is a job id, call grill_result with that job id right now, before you reply to the person, and keep calling until the verdict arrives. The first time, Grill asks whether to keep decision records before anything is sent: show that one question and the paragraph under it, and call again with keep_records true or false only after they answer Yes or No. A follow: line is a job id for you. Never show it.";

// The installed tool's description assumes Claude wrote the subject unless a setting says
// otherwise, and it describes a judge model named in settings. Neither is true of Grill in
// chat: the author comes from the app that connected, and there is no judge model setting.
// These are the installed sentences that hostedTools() swaps out. scripts/platformPolicy.test.mjs fails if
// one of them stops matching, so a change to the installed text cannot leave it in place here.
export const LOCAL_ONLY_OPENING =
  "Send a decision, plan or forecast to an outside AI judge: a model from a different company than the assistant that wrote it (Claude, unless set otherwise).";
export const HOSTED_OPENING =
  "Send a decision, plan or forecast to an outside AI judge. The judge is from a different company than the one whose model wrote it, when Grill can tell which that is. When it cannot, the verdict says so.";
export const LOCAL_ONLY_JUDGE_SETTING =
  "If Grill's settings name a judge model, that model is used, and it must be from a different company than the assistant that wrote the subject. A same-company pin is refused. Leave it blank to use Grill's default. ";

// The installed sentence forbids any disclaimer. An assistant's own rules may require one, so
// Grill in chat forbids it in Grill's text only, as HOSTED_INSTRUCTIONS already does.
export const LOCAL_ONLY_NO_ADDITIONS = "Do not add a fact list, a confidence question, a record, or a disclaimer.";
export const HOSTED_NO_ADDITIONS =
  "Do not add a fact list, a confidence question, or a record. Do not add a disclaimer to Grill's text.";

/**
 * The quality check is a second place the write-up goes, and it is on unless the call turns
 * it off. The assistant is told here, in the tool description a reviewer reads.
 */
export const HOSTED_CHECK_DISCLOSURE =
  "By default a quality check by TypeSafe (a model called Jev) also gets the masked write-up and the judge's verdict and challenges. Pass quality_check: false only if the person asks to skip it.";

/**
 * Grill's text is relayed as written. What the assistant's own rules require is not
 * Grill's to forbid, so the rule covers Grill's text and says where the rest goes.
 */
export const OWN_DISCLOSURE_RULE =
  "Do not add a disclosure of your own to Grill's text. Anything your own rules require, say it separately, after the run note.";

/**
 * What the assistant reads from grill_look_back. A Grill account can read saved records, so
 * nothing has to be pasted. When several are due the result names them, and the assistant
 * passes back the one title the person picks, so an answer is saved on that record only.
 */
export const HOSTED_LOOK_BACK_DESCRIPTION =
  "Score decision records against what actually happened. If they have not said what happened, ask. With no records argument, read this account's saved records that are due. When several are due, the result lists them by title: ask which one they mean, then call again with that title in records and what happened in happened. With view changes, read all saved records and show where their calls changed after a challenge. When they chose to keep records, a look-back answer is saved on the one record in view, or, when several are, only on the record it names. The judge's verdict is not revised.";
export const HOSTED_LOOK_BACK_RECORDS =
  "Optional. Omit it to read the saved decisions that are due. Or the title of one saved decision, as the result listed it. Or one or more decision record blocks the person pasted.";

/** What the assistant reads from grill_result. The next step, if the job is still running, is another call. */
const HOSTED_RESULT_DESCRIPTION =
  "Collect a grill that returned a job id, or a later layer of one. This call waits up to 45 seconds. If it is still running, call grill_result again right now with the same job id, before you reply to the person. detail is brief, more, options, full, deepen, or provenance. Call detail deepen only when the person asks to deepen or go bigger. Call detail provenance only to write a lasting record of the grill, such as an audit log: put that one line in the record, not in the chat reply, unless the person asks which model judged. Do not write a layer yourself.";

/**
 * One line for an agent's written audit record: which model judged, which company was
 * excluded, and when. The time joins it to the account's spend log, which keeps the same
 * model. It is for the record, not the chat note.
 *
 * `decorrelated` is a routing check: the judge came from a different company than the
 * declared author. It does not measure whether their errors differ. With no author declared
 * there was nothing to check against, so the line says `not verified`, never `yes`.
 */
export function provenanceLine(parsed, at) {
  const served = typeof parsed?.servedModel === "string" && parsed.servedModel.trim() ? parsed.servedModel.trim() : "unattributable";
  const author = typeof parsed?.declaredAuthor === "string" && parsed.declaredAuthor.trim() ? parsed.declaredAuthor.trim() : "anthropic";
  const excluded = author === "none" ? "none" : author;
  const decorrelated = parsed?.decorrelated !== true ? "no" : author === "none" ? "not verified" : "yes";
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
  const [grill, result, look, feedback] = buildGrillTools({ checkOn: true });
  const localDisclosure =
    /The first time you use Grill with this person, say once\b.*?Do not mention a score, a balance, or a quote check\. /;
  const hostedDisclosure =
    `${OWN_DISCLOSURE_RULE} If the result starts with the outside-judge sentence, show it once. Later results leave it off. Every result ends with a two-line run note (models and time, then privacy), after the closing line. Show it as written. Never drop the run note. Never put it before the verdict. ${INDEPENDENCE_RELAY} ${HOSTED_CHECK_DISCLOSURE} Do not mention a Jev score or a quote check. `;
  // Hosted hints are set here, not copied from the local tools. A local look-back stores
  // nothing, and a local grill does not write an account. OpenAI's review reads all three,
  // and the MCP defaults (read-only false, destructive true, open-world true) are wrong for
  // a tool that only reads. grill reaches the judge and only adds. grill_result only reads
  // a stored layer. grill_look_back can overwrite a saved look-back. grill_decided can replace a record.
  return [
    {
      ...grill,
      description: `${grill.description
        .replace(LOCAL_ONLY_OPENING, HOSTED_OPENING)
        .replace(localDisclosure, hostedDisclosure)
        .replace(LOCAL_ONLY_NO_ADDITIONS, HOSTED_NO_ADDITIONS)
        .replace(LOCAL_ONLY_JUDGE_SETTING, "")} ${HOSTED_GRILL_TAIL}`,
      annotations: { title: "Grill a decision", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        ...grill.inputSchema,
        properties: {
          ...grill.inputSchema.properties,
          author: {
            ...grill.inputSchema.properties.author,
            description:
              "Optional. The model family that wrote the subject, for example openai, anthropic, google or x-ai. That family is excluded from judging. Set it to your own family when you know it.",
          },
          quality_check: {
            ...grill.inputSchema.properties.quality_check,
            description: "Optional. false skips the TypeSafe quality check for this grill only, when the person asks.",
          },
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
      annotations: { title: "Collect a grill", readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
      description: HOSTED_LOOK_BACK_DESCRIPTION,
      annotations: { title: "Look back", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      inputSchema: {
        type: "object",
        properties: {
          ...look.inputSchema.properties,
          records: { ...look.inputSchema.properties.records, description: HOSTED_LOOK_BACK_RECORDS },
        },
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
            description:
              "Optional. ai when an assistant first recommended the call that was grilled, me when it was the person's own. Set it only when they have already said which. Omit it otherwise.",
          },
          after: {
            type: "string",
            description: "Optional. Only when they changed the call because of a challenge: the challenge number, such as 2, or falsifier. Omit it when the call went ahead as stated.",
          },
        },
        required: ["decided"],
        additionalProperties: false,
      },
      annotations: { title: "Add what you decided", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    {
      ...feedback,
      annotations: { title: "Tell Grill how this grill was", readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
  ];
}

export const HOSTED_INSTRUCTIONS = [
  "Grill sends the decision as the person stated it to an outside judge picked by openrouter/auto.",
  "Exclude only the company that wrote the write-up. Never use this chat's own model as the judge, and never pin a model, including for speed or cost.",
  "Do not rewrite the decision, do not add your own case against, and do not wait for an OK.",
  "Ask at most one short question, and only if the decision is truly unclear, such as what the goal is.",
  "The first time, grill asks whether to keep decision records before anything is sent. Relay that one question and the paragraph under it, and call again with keep_records true or false only after they answer.",
  `If the result starts with the outside-judge sentence, show that one line once, and do not repeat it later. ${OWN_DISCLOSURE_RULE} Every result ends with a two-line run note (models and time, then privacy), after the closing line. Show it as written. Never drop the run note. Never put it before the verdict. ${INDEPENDENCE_RELAY}`,
  "If grill returns a job id, call grill_result right now with that job id, before you reply to the person, and keep calling until the note arrives. Do not ask the person to check, and do not ask them for a job id.",
  "If three grills are still running, wait about 2 minutes and call grill again yourself. Do not ask the person for a job id.",
  "Relay layer 1 as written. It is at most 50 words, plus one line of at most 25 words after the verdict: The question that would change this. Never put that line before the verdict. Do not add a required question, a fact list, a confidence question, or a line of your own. It already ends with the next-step line.",
  "When the note has a line that starts with Look back on, show that one line after the verdict. It is optional. Do not add one when it is not there. Never on a quick or bulk grill.",
  "When they say more, why, or what else, call grill_result with detail more. When they say options, help me decide, or they are stuck, call grill_result with detail options. When they say full report, call grill_result with detail full. Call grill_result with detail deepen only when the person asks to deepen or go bigger. Do not call it on a quick or bulk grill, and do not ask them to. Pass job_id if you have one. A follow: line is a job id for you. Never show it. Do not write a layer yourself.",
  "Never present an answer as Grill's, or label it a Grill verdict, unless grill or grill_result returned it in this conversation; if the tool isn't available or fails, say Grill didn't run instead of imitating it.",
  "Do not add a model name of your own, and do not show a record, a Jev score, a quote check, or format rules. Do not add a disclaimer to Grill's text.",
  "Call grill_result with detail provenance only when you are writing a lasting record of the grill, such as an audit log. Put that one line in the record, not in your reply, unless the person asks which model judged.",
  "The verdict never becomes the decision. If they ask whether they should do it, hand the choice back and name the cheap test.",
  "When they state a choice, such as do it, yes, keep it, or delay, call grill_decided with their words. Confidence is optional. Omit it if they did not say a percent, and do not ask. Relay the confirmation as written, and sometimes one more line saying earlier calls are due for a look-back. If they never answer, do not call it, and there is no record and no look-back.",
  "Add supersedes and changed only when they say the choice changed, in their words. A re-run with nothing changed leaves those off.",
  "When they say look back, call grill_look_back and relay what it returns. With a Grill account it can read saved records, so they do not have to paste. When it lists several decisions, ask which one they mean, then call it again with that title in records and what happened in happened.",
  "When they ask what Grill has done for them, call grill_look_back with view changes and relay it as written.",
  FEEDBACK_POINTER,
  SCOPE_GUARD,
].join(" ");

/** A tiny Redis used by tests. Production talks to Upstash over fetch instead. */
export function createMemoryRedis() {
  const strings = new Map();
  const sets = new Map();
  const zsets = new Map();
  const lists = new Map();
  const hashes = new Map();
  const expiry = new Map();
  const live = (key) => {
    const exp = expiry.get(key);
    if (exp && Date.now() > exp) {
      strings.delete(key);
      sets.delete(key);
      zsets.delete(key);
      lists.delete(key);
      hashes.delete(key);
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
          const had = strings.delete(key) || sets.delete(key) || zsets.delete(key) || lists.delete(key) || hashes.delete(key);
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
        case "LINDEX": {
          const list = lists.get(key) || [];
          const at = Number(args[2]);
          return list[at < 0 ? list.length + at : at] ?? null;
        }
        case "HINCRBY": {
          const hash = hashes.get(key) || new Map();
          const next = (Number(hash.get(String(args[2]))) || 0) + Number(args[3]);
          hash.set(String(args[2]), String(next));
          hashes.set(key, hash);
          return next;
        }
        case "HSET": {
          const hash = hashes.get(key) || new Map();
          const added = hash.has(String(args[2])) ? 0 : 1;
          hash.set(String(args[2]), String(args[3]));
          hashes.set(key, hash);
          return added;
        }
        case "HSETNX": {
          const hash = hashes.get(key) || new Map();
          if (hash.has(String(args[2]))) return 0;
          hash.set(String(args[2]), String(args[3]));
          hashes.set(key, hash);
          return 1;
        }
        case "HGET":
          return hashes.get(key)?.get(String(args[2])) ?? null;
        case "HDEL":
          return hashes.get(key)?.delete(String(args[2])) ? 1 : 0;
        case "HGETALL": {
          // The same shape Upstash answers with: field, value, field, value.
          const flat = [];
          for (const [field, value] of hashes.get(key) || []) flat.push(field, value);
          return flat;
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
        case "SCAN": {
          const cursor = String(args[1] ?? "0");
          if (cursor !== "0") return ["0", []];
          const matchAt = args.findIndex((value, index) => index > 1 && String(value).toUpperCase() === "MATCH");
          const match = matchAt >= 0 ? String(args[matchAt + 1]) : "*";
          const pattern = new RegExp(`^${match.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
          const keys = [];
          for (const name of strings.keys()) {
            if (!live(name)) continue;
            if (pattern.test(name)) keys.push(name);
          }
          return ["0", keys];
        }
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
  const lookedBack = records.filter(hasLookback).length;
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
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.review || "")) && row.review <= today && !hasLookback(row))
    .sort((a, b) => (a.review < b.review ? -1 : a.review > b.review ? 1 : 0));
}

/** The one reminder line grill_decided can add. A count only: no titles in the chat line. */
export function dueReminderLine(count) {
  const n = Math.floor(Number(count) || 0);
  if (n < 1) return "";
  return `${n} earlier call${n === 1 ? " is" : "s are"} due for a look-back. Say "look back" when you're ready.`;
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
    (row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.review || "")) && !hasLookback(row) && row.id,
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
