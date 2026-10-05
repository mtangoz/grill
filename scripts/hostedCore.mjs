/**
 * Pure helpers for hosted Grill. No network and no logging.
 * The installed local tool does not import this file.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseRecords } from "./reflection.mjs";
import { buildGrillTools } from "../server/index.mjs";

export const HOSTED_PROTOCOLS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26"]);
export const CLAUDE_WEB_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const CLAUDE_CODE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
export const TYPICAL_GRILL_USD = 0.03;
export const MAX_SUBJECT_CHARS = 200_000;
export const MAX_QUESTION_CHARS = 600;
export const MAX_PASTE_CHARS = 100_000;
export const JOB_TTL_SECONDS = 15 * 60;
export const DAILY_GRILL_LIMIT = 30;
export const RUNNING_JOB_LIMIT = 3;
export const CREDIT_CACHE_MS = 60_000;
export const OUT_OF_CREDIT = "You're out of grill credit. More is coming soon. Write to support@grillyour.ai for a top-up.";
export const INVITE_ONLY = "Grill in chat is invite-only for now.";
export const CONSENT_TEXT = [
  "The approved write-up passes through Grill's server in memory. It is never logged or stored.",
  "",
  "Keep a record of your decisions on your Grill account? Yes / No",
  "",
  "Ask the person, then call grill again with keep_records true or false. Do not send the write-up until they answer.",
].join("\n");

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

function hintFromClientInfo(clientInfo) {
  const name = String(clientInfo?.name || clientInfo?.title || "").trim();
  if (!name) return null;
  if (/\bclaude[- ]code\b/i.test(name)) return { company: "anthropic", sourceApp: "claude-code" };
  if (/\bclaude\b/i.test(name)) return { company: "anthropic", sourceApp: "claude" };
  if (/\b(?:chatgpt|openai)\b/i.test(name)) return { company: "openai", sourceApp: "chatgpt" };
  if (/\bgrok\b/i.test(name)) return { company: "x-ai", sourceApp: "grok" };
  if (/\bgemini\b/i.test(name)) return { company: "google", sourceApp: "gemini" };
  return null;
}

/**
 * Map an OAuth client to the company to exclude and the source_app to store.
 * clientInfo is used only when the OAuth client itself is unknown.
 */
export function sourceAppFromClient({ redirectUri = "", clientId = "", clientInfo = null } = {}) {
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

  return hintFromClientInfo(clientInfo) || { company: "", sourceApp: "unknown" };
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

/** When the allowlist is unset, it does not filter. The owner sets it before anyone is invited. */
export function allowlistAllows(email, env = {}) {
  const raw = typeof env.GRILL_HOSTED_ALLOWLIST === "string" ? env.GRILL_HOSTED_ALLOWLIST.trim() : "";
  if (!raw) return true;
  const list = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(email || "").trim().toLowerCase());
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
    const today = isoDay(now);
    const due = (saved || []).filter((row) => row.review && row.review <= today);
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
  "Usually takes 1–3 minutes and uses a little of the person's Grill credit. The judge is always picked by openrouter/auto, excluding only the company that wrote the write-up. It never falls back to this chat's own model, for speed or cost. If the result is a job id, call grill_result until the verdict arrives. The first time, Grill asks whether to keep decision records before anything is sent: show that question, and call again with keep_records true or false only after the person answers Yes or No.";

/** Same clerk / show-first text as the local server, plus the hosted account fields. */
export function hostedTools() {
  const [grill, result, look] = buildGrillTools({ checkOn: true });
  const localCost =
    "Costs about a cent on the user's own key, or on a Grill Pro key, and usually takes 1–3 minutes. If the result is a job id, call grill_result with it.";
  return [
    {
      ...grill,
      description: grill.description.replace(localCost, HOSTED_COST_LINE),
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
    result,
    {
      ...look,
      description:
        "Score decision records against what actually happened. If they have not said what happened, ask. With no records argument, read this account's saved records that are due, or the ones they named. When they chose to keep records, save the look-back answers. The judge's verdict is not revised.",
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
        "Add the person's own words as the decided line on a saved record. Call only after they say what they chose. Never invent the line. record_ref is the record's date and title, or its id.",
      inputSchema: {
        type: "object",
        properties: {
          record_ref: { type: "string", description: "Which record: its date and title, or its id." },
          decided: { type: "string", description: "What they chose, in their words." },
        },
        required: ["record_ref", "decided"],
        additionalProperties: false,
      },
      annotations: { title: "Add what you decided", readOnlyHint: false, openWorldHint: false },
    },
  ];
}

export const HOSTED_INSTRUCTIONS = [
  "Grill sends an approved decision to an outside judge picked by openrouter/auto.",
  "Exclude only the company that wrote the write-up. Never use this chat's own model as the judge, and never pin a model.",
  "Write the subject as a clerk, not an advocate. Show it to the person and get their OK before calling grill.",
  "The first time, grill asks whether to keep decision records before anything is sent. Relay that question and call again with keep_records true or false only after they answer.",
  "If grill returns a job id, call grill_result until the report arrives. Do not ask the person to check.",
  "Relay the verdict first, then the challenges with their falsifiers, quoting the judge.",
  "The verdict never becomes the decision. Show Before you decide and the decision record.",
  "When they say what they chose, call grill_decided with their words. Never invent a decided line.",
  "Add supersedes and changed only when they say the choice changed, in their words. A re-run with nothing changed leaves those off.",
  "When they say look back, call grill_look_back. With a Grill account it can read saved records, so they do not have to paste.",
].join(" ");

/** A tiny Redis used by tests. Production talks to Upstash over fetch instead. */
export function createMemoryRedis() {
  const strings = new Map();
  const sets = new Map();
  const zsets = new Map();
  const expiry = new Map();
  const live = (key) => {
    const exp = expiry.get(key);
    if (exp && Date.now() > exp) {
      strings.delete(key);
      sets.delete(key);
      zsets.delete(key);
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
          strings.set(key, String(args[2]));
          const ex = args.findIndex((value, index) => index > 2 && String(value).toUpperCase() === "EX");
          if (ex >= 0) expiry.set(key, Date.now() + Number(args[ex + 1]) * 1000);
          return "OK";
        }
        case "DEL": {
          const had = strings.delete(key) || sets.delete(key) || zsets.delete(key);
          expiry.delete(key);
          return had ? 1 : 0;
        }
        case "INCR": {
          const next = (Number(strings.get(key)) || 0) + 1;
          strings.set(key, String(next));
          return next;
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
        case "SCARD":
          return sets.get(key)?.size || 0;
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
