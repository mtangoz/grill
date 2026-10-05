/**
 * Hosted Grill: the in-chat connector. Off unless GRILL_HOSTED=on.
 *
 * The judge is always scripts/judge.mjs with model openrouter/auto. This file never
 * sets JUDGE_MODEL and never passes a fallback model list. The company excluded is
 * the one that wrote the write-up, not whichever chat the person is sitting in.
 *
 * Request and response bodies are not logged. Errors return a fixed sentence and a
 * request id.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCappedKey, esc, page, readManagedKey, removeManagedKey, WELCOME_HEADERS } from "./_pro.mjs";
import { appendReflection, lookBack, parseRecords, recordBlock } from "../scripts/reflection.mjs";
import {
  CONSENT_TEXT,
  CREDIT_CACHE_MS,
  DAILY_GRILL_LIMIT,
  HOSTED_INSTRUCTIONS,
  INVITE_ONLY,
  JOB_TTL_SECONDS,
  MAX_PASTE_CHARS,
  MAX_QUESTION_CHARS,
  MAX_SUBJECT_CHARS,
  OUT_OF_CREDIT,
  RUNNING_JOB_LIMIT,
  allowlistAllows,
  authorForJudge,
  chainIds,
  decryptString,
  encryptString,
  footerLine,
  hostedEnabled,
  hostedTools,
  isoDay,
  keyFromEnv,
  linkChains,
  mcpResource,
  negotiateProtocol,
  newJobCredential,
  parseJobCredential,
  protectedResourceMetadata,
  publicOrigin,
  queryHasToken,
  recordFence,
  recordsForLookBack,
  signInUrl,
  sourceAppFromClient,
  starterCreditUsd,
  topChallengeLines,
  wwwAuthenticate,
} from "../scripts/hostedCore.mjs";

const JUDGE = fileURLToPath(new URL("../scripts/judge.mjs", import.meta.url));
const CLERK_API = "https://api.clerk.com";
const VERSION = "0.1.1";
const jwksCache = new Map();
const userCache = new Map();
const creditCache = new Map();

export function resetHostedCaches() {
  jwksCache.clear();
  userCache.clear();
  creditCache.clear();
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

function fixedError(id, status = 500) {
  logHosted(id, "error");
  return new Response(`Something went wrong (${id}). Write to support@grillyour.ai.`, {
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

async function verifyJwt(token, { issuer, jwksUrl, resource, fetchImpl, requireAudience }) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [h64, p64, s64] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(h64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  const keys = await loadJwks(jwksUrl, fetchImpl);
  const jwk = keys.find((key) => key.kid === header.kid) || null;
  if (!jwk) return null;
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, Buffer.from(s64, "base64url"), Buffer.from(`${h64}.${p64}`));
  if (!ok) return null;
  const iss = String(payload.iss || "").replace(/\/$/, "");
  const want = String(issuer || "").replace(/\/$/, "");
  if (!want || iss !== want) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + 60 < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf - 60 > now) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (requireAudience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : typeof payload.aud === "string" ? [payload.aud] : [];
    if (!aud.includes(resource)) return null;
  }
  return payload;
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

async function loadAccount(id, deps) {
  const raw = await redis(deps, ["GET", acctKey(id)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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

async function ensureAccount(userId, email, deps) {
  let account = await loadAccount(userId, deps);
  if (!account) {
    account = {
      id: userId,
      email,
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
  } else if (account.email !== email) {
    account.email = email;
    await saveAccount(account, deps);
  }
  if (account.keyCipher && account.keyHash) return account;
  const prior = await redis(deps, ["GET", emailIndex(email)]);
  if (prior && prior !== userId) {
    account.creditBlocked = "email";
    return account;
  }
  const name = `grill-h-${randomBytes(8).toString("hex")}`;
  const master = keyFromEnv(deps.env, "GRILL_KEY_ENCRYPTION_KEY");
  if (!master) throw new Coded("key-encryption");
  const made = await createCappedKey({
    env: deps.env,
    fetch: deps.fetch,
    name,
    limit: starterCreditUsd(deps.env),
    reset: null,
  });
  account.keyCipher = encryptString(made.key, master);
  account.keyHash = made.hash;
  account.keyLimitUsd = made.limitUsd;
  account.keyName = name;
  await redis(deps, ["SET", emailIndex(email), userId]);
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
  const dataKey = randomBytes(32);
  account.recordKeyCipher = encryptString(dataKey.toString("base64"), master);
  await saveAccount(account, deps);
  return dataKey;
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

async function composeReport({ outcome, subject, sourceApp, account, credit, supersedes, changed, deps }) {
  const stderr = String(outcome?.stderr || "");
  if (!outcome || outcome.code !== 0 || !String(outcome.report || "").trim()) {
    if (/correlated verdict|excluded company/i.test(stderr)) {
      return { text: "The judge was served by the same company that wrote this, so Grill refused the verdict.", isError: true };
    }
    if (/\b402\b|insufficient credits|key limit exceeded/i.test(stderr)) {
      return { text: OUT_OF_CREDIT, isError: true };
    }
    return { text: `The grill did not finish (${deps.requestId}). Write to support@grillyour.ai.`, isError: true };
  }
  const keep = account.records === "keep";
  const report = appendReflection(outcome.report, {
    subject,
    now: typeof deps.now === "number" ? new Date(deps.now) : new Date(),
    route: keep ? "account" : "mcp",
      sourceApp: sourceApp || "unknown",
      supersedes: keep && typeof supersedes === "string" ? supersedes : "",
      changed: keep && typeof changed === "string" ? changed : "",
  });
  const cost = Number(outcome.parsed?.costUsd) || 0;
  const model = typeof outcome.parsed?.servedModel === "string" ? outcome.parsed.servedModel : "";
  account.spend = [...(account.spend || []), { at: new Date().toISOString(), costUsd: cost, model }];
  if (account.spend.length > 400) account.spend = account.spend.slice(-400);
  await saveAccount(account, deps);
  creditCache.delete(account.id);
  const parsed = parseRecords(report)[0] || {};
  if (keep) {
    const block = recordFence(report);
    if (block) {
      await writeRecord(account, deps, {
        id: randomBytes(8).toString("hex"),
        createdAt: new Date().toISOString(),
        block,
        sourceApp: sourceApp || "unknown",
        challenges: topChallengeLines(report, 3),
        lookback: null,
        date: parsed.date || "",
        title: parsed.title || "",
        verdict: parsed.verdict || "",
        review: parsed.review || "",
        supersedes: parsed.supersedes || "",
      });
    }
  }
  const footer = footerLine({
    saved: keep,
    review: parsed.review || "",
    remainingUsd: Math.max(0, (credit?.remaining || 0) - cost),
  });
  return { text: `${report.trim()}\n\n${footer}\n`, isError: false };
}

async function storeJobResult(credential, result, deps) {
  const cipher = encryptString(JSON.stringify({ text: result.text, isError: result.isError }), credential.key);
  await redis(deps, ["SET", jobRedisKey(credential.id), cipher, "EX", JOB_TTL_SECONDS]);
}

async function callGrill(args, account, payload, params, deps) {
  if (account.creditBlocked === "email") {
    return toolText("This email already has a Grill starter credit on another sign-in. Use that account, or write to support@grillyour.ai.", true);
  }
  const credit = await creditOf(account, deps);
  if (credit.out) return toolText(OUT_OF_CREDIT, true);
  const keepArg = args.keep_records;
  if (account.records !== "keep" && account.records !== "off" && typeof keepArg !== "boolean") {
    return toolText(CONSENT_TEXT);
  }
  if (typeof keepArg === "boolean") {
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
    return toolText("Grill can't keep records right now. Write to support@grillyour.ai.", true);
  }
  const running = Number(await redis(deps, ["SCARD", runningKey(account.id)])) || 0;
  if (running >= RUNNING_JOB_LIMIT) {
    return toolText("Three grills are already running on this account. Collect one with grill_result, then try again.", true);
  }
  const today = isoDay(Date.now());
  const used = Number(await redis(deps, ["GET", dayKey(account.id, today)])) || 0;
  if (used >= DAILY_GRILL_LIMIT) return toolText("This account has used today's 30 grills. It resets tomorrow.", true);
  await redis(deps, ["INCR", dayKey(account.id, today)]);
  await redis(deps, ["EXPIRE", dayKey(account.id, today), 172800]);
  const apiKey = openSecret(account.keyCipher, deps.env, "GRILL_KEY_ENCRYPTION_KEY");
  if (!apiKey) return toolText(`The grill did not finish (${deps.requestId}). Write to support@grillyour.ai.`, true);
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
  return toolText(
    `Still grilling (job ${credential.jobId}). Call grill_result with job_id "${credential.jobId}" to collect the report. A grill usually takes 1–3 minutes.`,
  );
}

async function callResult(args, account, deps) {
  const credential = parseJobCredential(typeof args.job_id === "string" ? args.job_id : "");
  if (!credential) return toolText("No grill is running with that job id. It may already have been collected.", true);
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
    if (!running) return toolText("No grill is running with that job id. It may already have been collected.", true);
    return toolText(
      `Still grilling (job ${credential.jobId}). Call grill_result with job_id "${credential.jobId}" to collect the report. A grill usually takes 1–3 minutes.`,
    );
  }
  await redis(deps, ["DEL", jobRedisKey(credential.id)]);
  let stored;
  try {
    stored = JSON.parse(decryptString(cipher, credential.key));
  } catch {
    return toolText(`The grill did not finish (${deps.requestId}). Write to support@grillyour.ai.`, true);
  }
  return toolText(String(stored.text || ""), Boolean(stored.isError));
}

async function callLookBack(args, account, deps) {
  const records = typeof args.records === "string" ? args.records : "";
  const happened = typeof args.happened === "string" ? args.happened : "";
  if (records.length > MAX_PASTE_CHARS || happened.length > MAX_PASTE_CHARS) {
    return toolText("That paste is too long. Split it under 100,000 characters.", true);
  }
  const saved = account.records === "keep" ? await loadRecords(account, deps) : [];
  if (!records.trim() && account.records !== "keep") {
    return toolText("Paste one or more decision records. Saving is off on this account, so Grill has none to read. Grill stores nothing either way.", true);
  }
  const picked = recordsForLookBack(saved, { records, now: Date.now() });
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
        at: new Date().toISOString(),
        happened: happened.replace(/\s+/g, " ").trim().slice(0, 2000),
      };
      await writeRecord(account, deps, row);
      savedAny = true;
    }
  }
  return toolText(savedAny ? `${text}\n\nSaved with your decision record.` : text);
}

async function callDecided(args, account, deps) {
  if (account.records !== "keep") return toolText("Decision records are off for this account, so there is nowhere to add that.", true);
  const decided = typeof args.decided === "string" ? args.decided.replace(/\s+/g, " ").trim() : "";
  if (!decided) return toolText("Add the decided line only in the person's own words. Grill will not invent one.", true);
  const ref = typeof args.record_ref === "string" ? args.record_ref.trim() : "";
  const rows = await loadRecords(account, deps);
  const needle = ref.toLowerCase();
  const row = rows.find(
    (item) => item.id === ref || `${item.date} ${item.title}`.toLowerCase() === needle || String(item.title || "").toLowerCase() === needle,
  );
  if (!row) return toolText("No saved record matched that reference.", true);
  const parsed = parseRecords(row.block)[0];
  if (!parsed) return toolText(`The grill did not finish (${deps.requestId}). Write to support@grillyour.ai.`, true);
  row.block = recordBlock({ ...parsed, decided });
  row.decided = decided;
  await writeRecord(account, deps, row);
  return toolText(`Added your words to the decided line of "${row.title}".`);
}

async function identity(request, deps, { audience }) {
  if (queryHasToken(pageUrl(request).href)) return { error: unauthorized(publicOrigin(request)) };
  const origin = publicOrigin(request);
  const token = audience ? (request.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1] || "" : cookieValue(request.headers.get("cookie"), "__session");
  if (!token) return { error: audience ? unauthorized(origin) : null, missing: true };
  const url = jwksUrl(deps.env);
  if (!url || !deps.env.CLERK_ISSUER) throw new Coded("clerk");
  const payload = await verifyJwt(token, {
    issuer: deps.env.CLERK_ISSUER,
    jwksUrl: url,
    resource: mcpResource(origin),
    fetchImpl: deps.fetch,
    requireAudience: audience,
  });
  if (!payload) return { error: audience ? unauthorized(origin) : null, missing: true };
  return { payload, origin };
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
    if (rpcId === undefined || rpcId === null) return new Response(null, { status: 202 });
    if (msg.method === "initialize") {
      return rpcResponse(
        rpcId,
        {
          protocolVersion: negotiateProtocol(msg.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "grill", title: "Grill", version: VERSION },
          instructions: HOSTED_INSTRUCTIONS,
        },
        request,
      );
    }
    if (msg.method === "ping") return rpcResponse(rpcId, {}, request);
    if (msg.method === "tools/list") return rpcResponse(rpcId, { tools: hostedTools() }, request);
    if (msg.method === "tools/call") {
      const user = await clerkUser(who.payload.sub, deps);
      const email = verifiedEmail(user);
      if (!email) return rpcResponse(rpcId, toolText("Grill needs a verified email on this account before it can run.", true), request);
      if (!allowlistAllows(email, deps.env)) return rpcResponse(rpcId, toolText(INVITE_ONLY, true), request);
      const account = await ensureAccount(who.payload.sub, email, deps);
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      let result;
      if (name === "grill") result = await callGrill(args, account, who.payload, msg.params, deps);
      else if (name === "grill_result") result = await callResult(args, account, deps);
      else if (name === "grill_look_back") result = await callLookBack(args, account, deps);
      else if (name === "grill_decided") result = await callDecided(args, account, deps);
      else result = toolText(`Unknown tool: ${name}`, true);
      return rpcResponse(rpcId, result, request);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpcId, error: { code: -32601, message: `Method not found: ${msg.method}` } }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof Coded) logHosted(id, error.code);
    else logHosted(id, "error");
    return fixedError(id);
  }
}

export async function handleProtectedResource(request, deps) {
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method === "DELETE") return methodNotAllowed();
  const origin = publicOrigin(request);
  const issuer = typeof deps.env.CLERK_ISSUER === "string" ? deps.env.CLERK_ISSUER.trim() : "";
  if (!issuer) return fixedError(requestId());
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

function signInMissed(request, deps) {
  const again = signInUrl(deps.env, returnTo(request));
  const link = again ? `<p><a href="${esc(again)}">Try sign-in again</a></p>` : "";
  return page(
    "Grill",
    `<h1>Sign-in didn't come back to this page.</h1>
    <p>The sign-in page is open, but this browser has no session for this site. Add this site's address to Clerk's allowed origins, or open Grill on your own domain, then try again.</p>
    ${link}`,
  );
}

async function pageUser(request, deps) {
  const who = await identity(request, deps, { audience: false });
  if (who.error) return { redirect: who.error };
  if (who.missing || !who.payload) {
    if (pageUrl(request).searchParams.get("from") === "signin") return { html: signInMissed(request, deps) };
    const redirect = signInRedirect(request, deps);
    if (!redirect) return { html: page("Grill", "<h1>Sign-in isn't set up.</h1><p>Set CLERK_SIGN_IN_URL to your Clerk Account Portal sign-in page.</p>") };
    return { redirect };
  }
  const user = await clerkUser(who.payload.sub, deps);
  if (!user) return { missing: true };
  const email = verifiedEmail(user);
  if (!email) return { html: page("Grill", "<h1>Grill needs a verified email on this account.</h1>") };
  if (!allowlistAllows(email, deps.env)) return { html: page("Grill", `<h1>${esc(INVITE_ONLY)}</h1>`) };
  const account = await ensureAccount(who.payload.sub, email, deps);
  return { account, email };
}

function html(status, body) {
  return new Response(body, { status, headers: WELCOME_HEADERS });
}

function chainNote(row, byId) {
  const parts = [];
  if (row.replacesId && byId.get(row.replacesId)) {
    const prev = byId.get(row.replacesId);
    parts.push(`Replaces ${prev.date} ${prev.title}.`);
  }
  if (row.replacedByIds?.length) {
    const next = row.replacedByIds.map((id) => byId.get(id)).filter(Boolean);
    if (next.length) parts.push(`Later call: ${next.map((item) => `${item.date} ${item.title}`).join("; ")}.`);
  }
  return parts.join(" ");
}

function renderDecisions(account, rows, credit) {
  const linked = linkChains(rows);
  const byId = new Map(linked.map((row) => [row.id, row]));
  const cards = [...linked].reverse().map((row) => {
    const look = row.lookback?.happened ? `<p>Look-back: ${esc(row.lookback.happened)}</p>` : "<p>Look-back: not yet.</p>";
    const chain = chainNote(row, byId);
    return `<article class="banner">
      <h2>${esc(row.title || "Untitled")}</h2>
      <p>${esc(row.date || "")} · ${esc(row.verdict || "")} · ${esc(row.sourceApp || "unknown")} · review ${esc(row.review || "")}</p>
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
    <p>${credit?.out ? esc(OUT_OF_CREDIT) : `About ${Math.max(0, Math.floor((credit?.remaining || 0) / 0.03))} grills of credit left.`}</p>
    <p>Records are ${keeping ? "on" : account.records === "off" ? "off" : "not chosen yet"}. Turning this off leaves the ones already here until you delete them.</p>
    <form method="post" action="/decisions" class="row">
      <input type="hidden" name="action" value="records">
      <button type="submit" name="value" value="keep">Keep my decision records</button>
      <button type="submit" name="value" value="off">Don't keep records</button>
    </form>
    <p class="row"><a class="button" href="/decisions?export=text">Export as text</a> <a class="button" href="/decisions?export=json">Export as JSON</a> <a href="/account">Account</a></p>
    ${cards.join("\n") || "<p>No records yet.</p>"}
    <form method="post" action="/decisions"><input type="hidden" name="action" value="delete-all"><input type="hidden" name="confirm" value="delete"><button type="submit">Delete all records</button></form>`,
  );
}

function renderAccount(account, credit) {
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
    <form method="post" action="/account">
      <input type="hidden" name="action" value="delete-account">
      <input type="hidden" name="confirm" value="delete">
      <button type="submit">Delete this account</button>
    </form>
    <p class="small">Deleting the account removes your records, switches off the model-router key, and deletes the sign-in.</p>`,
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

async function deleteAccount(account, deps) {
  if (account.keyHash) {
    try {
      await removeManagedKey(account.keyHash, { env: deps.env, fetch: deps.fetch });
    } catch {
      logHosted(deps.requestId || "account", "key-revoke");
    }
  }
  const secret = deps.env.CLERK_SECRET_KEY;
  if (!secret) throw new Coded("clerk");
  const res = await deps.fetch(`${CLERK_API}/v1/users/${encodeURIComponent(account.id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "error",
  });
  if (!res.ok && res.status !== 404) throw new Coded("clerk-delete");
  const ids = (await redis(deps, ["ZRANGE", recordIndex(account.id), "0", "-1"])) || [];
  await deleteRecordIds(account, deps, ids);
  await redis(deps, ["DEL", recordIndex(account.id)]);
  await redis(deps, ["DEL", acctKey(account.id)]);
  await redis(deps, ["DEL", emailIndex(account.email)]);
  userCache.delete(account.id);
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
    if (session.missing) return html(200, page("Grill", "<h1>This account has been deleted.</h1>"));
    if (session.html) return html(200, session.html);
    const url = pageUrl(request);
    if (request.method === "GET" && url.searchParams.get("export") === "text") return exportRecords(session.account, deps, "text");
    if (request.method === "GET" && url.searchParams.get("export") === "json") return exportRecords(session.account, deps, "json");
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
      }
    }
    const rows = await loadRecords(session.account, deps);
    const credit = session.account.keyHash ? await creditOf(session.account, deps) : { remaining: 0, out: false };
    return html(200, renderDecisions(session.account, rows, credit));
  } catch (error) {
    if (error instanceof Coded) logHosted(id, error.code);
    else logHosted(id, "error");
    return fixedError(id);
  }
}

export async function handleAccount(request, deps) {
  const id = requestId();
  deps = { ...deps, requestId: id };
  if (!hostedEnabled(deps.env)) return notFound();
  if (request.method === "DELETE") return methodNotAllowed();
  try {
    const session = await pageUser(request, deps);
    if (session.redirect) return session.redirect;
    if (session.missing) return html(200, page("Grill", "<h1>This account has been deleted.</h1>"));
    if (session.html) return html(200, session.html);
    if (request.method === "POST") {
      const form = new URLSearchParams(await request.text());
      if (form.get("action") === "records") {
        const value = form.get("value");
        if (value === "keep" || value === "off") {
          session.account.records = value;
          await saveAccount(session.account, deps);
        }
      }
      if (form.get("action") === "delete-account" && form.get("confirm") === "delete") {
        await deleteAccount(session.account, deps);
        return html(200, page("Account deleted · Grill", "<h1>Your Grill account is deleted.</h1><p>The records and the model-router key are gone.</p>"));
      }
    }
    const credit = session.account.keyHash ? await creditOf(session.account, deps) : { remaining: 0, out: false };
    return html(200, renderAccount(session.account, credit));
  } catch (error) {
    if (error instanceof Coded) logHosted(id, error.code);
    else logHosted(id, "error");
    return fixedError(id);
  }
}

