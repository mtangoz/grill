/**
 * Grill Pro accounts. The free tool never reaches this file.
 *
 * Sign-in is an email magic link: no password, and no third-party login. The link and the
 * session cookie are HMAC-signed with GRILL_SESSION_SECRET, so we don't keep a session table.
 * The link is single-use. The raw key is shown when it is created or rotated, then dropped.
 * What we keep is the router's key hash, plus a SHA-256 of the key so a later paste can be
 * checked without storing the key itself.
 *
 * Where that record lives:
 *   - GRILL_PRO_TEST_MODE=1 (never when NODE_ENV or VERCEL_ENV is production): a local file,
 *     so the whole flow can be tried before Stripe exists. OpenRouter's key API is mocked
 *     by the dev server; tests pass their own fetch.
 *   - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN: Upstash Redis from the Vercel
 *     Marketplace. This is the production store.
 *   - Otherwise, if STRIPE_SECRET_KEY is set: the Stripe customer is the record, the same
 *     place key hashes already live, so the subscription webhook keeps working with no
 *     extra database.
 * Key hashes are still written onto the Stripe customer whenever a customer id is known.
 * api/stripe-webhook.js keeps switching those keys off and on; it also updates the account.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  UpstreamError,
  createCappedKey,
  disableManagedKeys,
  esc,
  isStripeCustomerId,
  keyMetadataField,
  page,
  portalUrl,
  proClients,
  readManagedKey,
  removeManagedKey,
} from "./_pro.mjs";
import { startFakeOpenRouter } from "../scripts/fixtures/fake-openrouter.mjs";

const JUDGE = fileURLToPath(new URL("../scripts/judge.mjs", import.meta.url));
const USABLE_FIXTURE = fileURLToPath(new URL("../scripts/fixtures/usable-response.json", import.meta.url));

export const SESSION_COOKIE = "grill_pro";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAGIC_TTL_SECONDS = 20 * 60;
const LINK_COOLDOWN_MS = 20 * 1000;

/** Assistants someone might think with, and the company behind each. Copilot is its own case. */
export const ASSISTANTS = Object.freeze([
  { id: "claude-desktop", label: "Claude Desktop", company: "anthropic", route: "extension" },
  { id: "claude-web", label: "claude.ai", company: "anthropic", route: "skill" },
  { id: "claude-code", label: "Claude Code", company: "anthropic", route: "plugin" },
  { id: "chatgpt", label: "ChatGPT", company: "openai", route: "paste" },
  { id: "copilot", label: "Copilot", company: "copilot", route: "paste" },
  { id: "gemini", label: "Gemini", company: "google", route: "paste" },
  { id: "grok", label: "Grok", company: "xai", route: "paste" },
  { id: "muse", label: "Muse", company: "meta", route: "paste" },
]);

/** Judges a Pro setup can pin. The slug is what Grill's JUDGE_MODEL setting receives. */
export const JUDGES = Object.freeze([
  { id: "openai/gpt-5.6-sol", company: "openai", label: "OpenAI" },
  { id: "google/gemini-2.5-pro", company: "google", label: "Google Gemini" },
  { id: "x-ai/grok-4", company: "xai", label: "xAI Grok" },
  { id: "deepseek/deepseek-chat", company: "deepseek", label: "DeepSeek" },
  { id: "anthropic/claude-sonnet-4.5", company: "anthropic", label: "Anthropic Claude" },
]);

const COPILOT_BLOCKED = new Set(["openai", "anthropic", "xai"]);
const PASTE_NAME = {
  openai: "ChatGPT",
  google: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  anthropic: "Claude",
  meta: "Muse",
};

export function assistantById(id) {
  return ASSISTANTS.find((a) => a.id === id) ?? null;
}

export function judgeById(id) {
  return JUDGES.find((j) => j.id === id) ?? null;
}

/**
 * The judge has to be a different company from the assistant. Copilot can run OpenAI,
 * Anthropic or xAI models, so those three are not safe judges for it.
 */
export function judgeAllowed(assistantId, judgeId) {
  const assistant = assistantById(assistantId);
  const judge = judgeById(judgeId);
  if (!assistant || !judge) return false;
  if (assistant.company === "copilot") return !COPILOT_BLOCKED.has(judge.company);
  return judge.company !== assistant.company;
}

export function defaultJudge(assistantId) {
  return JUDGES.find((j) => judgeAllowed(assistantId, j.id))?.id ?? "";
}

/** Family of a model slug, for the "different company" rule. Empty for the Auto Router. */
export function familyOfModel(slug) {
  const primary = String(slug ?? "").split(",")[0].trim().toLowerCase();
  if (!primary || primary.startsWith("openrouter/")) return "";
  if (/(^|[/.])claude[-.\d]/.test(primary)) return "anthropic";
  const head = primary.split("/")[0];
  if (head === "x-ai" || head === "xai") return "xai";
  if (head === "anthropic") return "anthropic";
  return head;
}

export function familyOfAuthor(author) {
  const s = String(author ?? "").trim().toLowerCase();
  if (!s) return "anthropic";
  if (s === "x-ai" || s === "xai") return "xai";
  if (s === "claude") return "anthropic";
  return s;
}

/** True when a pinned judge is the same company as the assistant that wrote the subject. */
export function judgePinConflicts(model, author) {
  const pin = familyOfModel(model);
  if (!pin) return false;
  return pin === familyOfAuthor(author);
}

/**
 * Test mode simulates a purchase and shows the magic link on the page.
 * It cannot turn on in production, even if the flag is set there.
 */
export function testModeEnabled(env = {}) {
  if (String(env.GRILL_PRO_TEST_MODE ?? "").trim() !== "1") return false;
  if (env.VERCEL_ENV === "production") return false;
  if (env.NODE_ENV === "production") return false;
  return true;
}

export function sessionSecret(env = {}) {
  const s = typeof env.GRILL_SESSION_SECRET === "string" ? env.GRILL_SESSION_SECRET.trim() : "";
  return s.length >= 16 ? s : "";
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function signPayload(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readPayload(token, secret) {
  if (typeof token !== "string" || typeof secret !== "string" || !secret) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const got = Buffer.from(sig);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function keyCheck(key) {
  return createHash("sha256").update(String(key), "utf8").digest("hex");
}

export function checksMatch(stored, key) {
  if (typeof stored !== "string" || !stored || typeof key !== "string" || !key) return false;
  const got = Buffer.from(keyCheck(key));
  const exp = Buffer.from(stored);
  return got.length === exp.length && timingSafeEqual(got, exp);
}

export function normalizeEmail(raw) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

export function cookieValue(header, name) {
  if (typeof header !== "string") return "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

function sessionCookie(token, request, maxAge = SESSION_TTL_SECONDS) {
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "HttpOnly", "SameSite=Lax", "Path=/", `Max-Age=${maxAge}`];
  if (secure && maxAge > 0) parts.push("Secure");
  return parts.join("; ");
}

function blankAccount(email) {
  return {
    id: `acct_${randomBytes(8).toString("hex")}`,
    email,
    createdAt: new Date().toISOString(),
    stripeCustomerId: null,
    subscription: "none",
    assistant: null,
    judgeModel: null,
    keys: [],
    activeHash: null,
    lastLinkAt: 0,
    saveReports: false,
    reports: [],
  };
}

function activeRecord(account) {
  return account?.keys?.find((k) => k.hash === account.activeHash && !k.disabled) ?? null;
}

// ── Stores ───────────────────────────────────────────────────────────────────

export function memoryStore() {
  const accounts = new Map();
  const byEmail = new Map();
  const byStripe = new Map();
  const nonces = new Map();
  const api = {
    kind: "memory",
    async getById(id) {
      const row = accounts.get(id);
      return row ? structuredClone(row) : null;
    },
    async getByEmail(email) {
      const id = byEmail.get(email);
      return id ? api.getById(id) : null;
    },
    async getByStripeCustomer(customerId) {
      const id = byStripe.get(customerId);
      return id ? api.getById(id) : null;
    },
    async put(account) {
      const prev = accounts.get(account.id);
      if (prev?.email && prev.email !== account.email) byEmail.delete(prev.email);
      if (prev?.stripeCustomerId && prev.stripeCustomerId !== account.stripeCustomerId) byStripe.delete(prev.stripeCustomerId);
      accounts.set(account.id, structuredClone(account));
      byEmail.set(account.email, account.id);
      if (account.stripeCustomerId) byStripe.set(account.stripeCustomerId, account.id);
    },
    async putNonce(hash, expMs) {
      nonces.set(hash, expMs);
    },
    async takeNonce(hash, now) {
      const exp = nonces.get(hash);
      if (exp === undefined) return false;
      nonces.delete(hash);
      return exp > now;
    },
    dump() {
      return structuredClone({ accounts: Object.fromEntries(accounts), nonces: Object.fromEntries(nonces) });
    },
  };
  return api;
}

export function fileStore(path) {
  const mem = memoryStore();
  const load = () => {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      for (const account of Object.values(parsed.accounts ?? {})) mem.put(account);
      for (const [hash, exp] of Object.entries(parsed.nonces ?? {})) mem.putNonce(hash, exp);
    } catch {
      // A missing file is an empty store.
    }
  };
  load();
  let chain = Promise.resolve();
  const save = () => {
    const snap = mem.dump();
    chain = chain.then(() => {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(snap));
      renameSync(tmp, path);
    });
    return chain;
  };
  return {
    kind: "file",
    path,
    async getById(id) {
      return mem.getById(id);
    },
    async getByEmail(email) {
      return mem.getByEmail(email);
    },
    async getByStripeCustomer(id) {
      return mem.getByStripeCustomer(id);
    },
    async put(account) {
      await mem.put(account);
      await save();
    },
    async putNonce(hash, exp) {
      await mem.putNonce(hash, exp);
      await save();
    },
    async takeNonce(hash, now) {
      const ok = await mem.takeNonce(hash, now);
      await save();
      return ok;
    },
    dump: () => mem.dump(),
  };
}

function redisCmd(env, fetchImpl) {
  return async (args) => {
    let res;
    try {
      res = await fetchImpl(env.UPSTASH_REDIS_REST_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        redirect: "error",
      });
    } catch (e) {
      throw new UpstreamError(`account store: ${e.message}`);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new UpstreamError(`account store returned ${res.status}`);
    return body?.result ?? null;
  };
}

export function redisStore(env, fetchImpl) {
  const cmd = redisCmd(env, fetchImpl);
  const acct = (id) => `grill:acct:${id}`;
  const emailKey = (email) => `grill:email:${createHash("sha256").update(email).digest("hex")}`;
  const stripeKey = (id) => `grill:stripe:${id}`;
  return {
    kind: "redis",
    async getById(id) {
      const raw = await cmd(["GET", acct(id)]);
      return raw ? JSON.parse(raw) : null;
    },
    async getByEmail(email) {
      const id = await cmd(["GET", emailKey(email)]);
      return id ? this.getById(id) : null;
    },
    async getByStripeCustomer(id) {
      const accountId = await cmd(["GET", stripeKey(id)]);
      return accountId ? this.getById(accountId) : null;
    },
    async put(account) {
      const prev = await this.getById(account.id);
      if (prev?.email && prev.email !== account.email) await cmd(["DEL", emailKey(prev.email)]);
      if (prev?.stripeCustomerId && prev.stripeCustomerId !== account.stripeCustomerId) await cmd(["DEL", stripeKey(prev.stripeCustomerId)]);
      await cmd(["SET", acct(account.id), JSON.stringify(account)]);
      await cmd(["SET", emailKey(account.email), account.id]);
      if (account.stripeCustomerId) await cmd(["SET", stripeKey(account.stripeCustomerId), account.id]);
    },
    async putNonce(hash, expMs) {
      const seconds = Math.max(1, Math.ceil((expMs - Date.now()) / 1000));
      await cmd(["SET", `grill:nonce:${hash}`, "1", "EX", seconds]);
    },
    async takeNonce(hash, now) {
      const key = `grill:nonce:${hash}`;
      const hit = await cmd(["GETDEL", key]);
      return hit != null;
    },
  };
}

function accountFromStripeCustomer(customer) {
  const md = customer?.metadata ?? {};
  const keys = [];
  for (const [field, hash] of Object.entries(md)) {
    if (!field.startsWith("grill_key_") || typeof hash !== "string" || !hash) continue;
    const prefix = field.slice("grill_key_".length);
    keys.push({
      hash,
      check: typeof md[`grill_chk_${prefix}`] === "string" ? md[`grill_chk_${prefix}`] : "",
      createdAt: md.grill_issued_at || customer.created || "",
      disabled: md[`grill_off_${prefix}`] === "1",
    });
  }
  const active = typeof md.grill_active === "string" ? md.grill_active : keys.at(-1)?.hash ?? null;
  return {
    id: customer.id,
    email: normalizeEmail(customer.email) || String(customer.email ?? "").trim().toLowerCase(),
    createdAt: md.grill_issued_at || new Date().toISOString(),
    stripeCustomerId: customer.id,
    subscription: md.grill_sub === "active" || md.grill_sub === "canceled" ? md.grill_sub : "none",
    assistant: assistantById(md.grill_assistant) ? md.grill_assistant : null,
    judgeModel: judgeById(md.grill_judge) ? md.grill_judge : null,
    keys,
    activeHash: active,
    lastLinkAt: Number(md.grill_link_at) || 0,
  };
}

export function stripeStore(env, fetchImpl) {
  const { stripe } = proClients(env, fetchImpl);
  const formFor = (account, extra = {}) => {
    const form = {
      "metadata[grill_sub]": account.subscription,
      "metadata[grill_assistant]": account.assistant || "",
      "metadata[grill_judge]": account.judgeModel || "",
      "metadata[grill_active]": account.activeHash || "",
      "metadata[grill_link_at]": String(account.lastLinkAt || 0),
      ...extra,
    };
    for (const k of account.keys) {
      const prefix = k.hash.slice(0, 24);
      form[`metadata[${keyMetadataField(k.hash)}]`] = k.hash;
      form[`metadata[grill_chk_${prefix}]`] = k.check || "";
      form[`metadata[grill_off_${prefix}]`] = k.disabled ? "1" : "";
    }
    return form;
  };
  return {
    kind: "stripe",
    async getById(id) {
      if (!isStripeCustomerId(id)) return null;
      const c = await stripe.get(`/v1/customers/${id}`);
      if (c.status === 404) return null;
      if (!c.ok) throw new UpstreamError(`Stripe returned ${c.status} for the customer`);
      return accountFromStripeCustomer(c.body);
    },
    async getByEmail(email) {
      const c = await stripe.get(`/v1/customers?${new URLSearchParams({ email, limit: "1" })}`);
      if (!c.ok) throw new UpstreamError(`Stripe returned ${c.status} for the customer search`);
      const row = c.body?.data?.[0];
      return row ? accountFromStripeCustomer(row) : null;
    },
    async getByStripeCustomer(id) {
      return this.getById(id);
    },
    async put(account) {
      const id = account.stripeCustomerId || account.id;
      if (!isStripeCustomerId(id)) throw new UpstreamError("the account is not a Stripe customer");
      const saved = await stripe.post(`/v1/customers/${id}`, formFor(account));
      if (!saved.ok) throw new UpstreamError(`couldn't save the account (${saved.status})`);
      account.id = id;
      account.stripeCustomerId = id;
    },
    async putNonce(hash, expMs) {
      // The nonce is stored on the customer inside put(); this records it on the last account
      // the caller saved. Callers pass the customer id by putting the account first.
      this._nonce = { hash, expMs };
    },
    async takeNonce(hash, now) {
      return this._take ? this._take(hash, now) : false;
    },
    /** Bind nonce operations to one customer. Magic-link code calls this before putNonce. */
    bind(customerId) {
      const parent = this;
      return {
        ...parent,
        async putNonce(hash, expMs) {
          const saved = await stripe.post(`/v1/customers/${customerId}`, {
            "metadata[grill_nonce]": hash,
            "metadata[grill_nonce_exp]": String(expMs),
          });
          if (!saved.ok) throw new UpstreamError(`couldn't save the sign-in link (${saved.status})`);
        },
        async takeNonce(hash, now) {
          const c = await stripe.get(`/v1/customers/${customerId}`);
          const md = c.body?.metadata ?? {};
          if (!c.ok || md.grill_nonce !== hash) return false;
          await stripe.post(`/v1/customers/${customerId}`, { "metadata[grill_nonce]": "", "metadata[grill_nonce_exp]": "" });
          return Number(md.grill_nonce_exp) > now;
        },
      };
    },
  };
}

/**
 * Pick the store for this process.
 * Test mode wins, so a laptop never writes to Redis or Stripe by accident.
 */
export function openStore(env = {}, fetchImpl = globalThis.fetch) {
  if (testModeEnabled(env)) {
    const path = typeof env.GRILL_PRO_STORE === "string" && env.GRILL_PRO_STORE.trim() ? env.GRILL_PRO_STORE.trim() : join(tmpdir(), "grill-pro-dev.json");
    return fileStore(path);
  }
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return redisStore(env, fetchImpl);
  if (typeof env.STRIPE_SECRET_KEY === "string" && env.STRIPE_SECRET_KEY.trim()) return stripeStore(env, fetchImpl);
  return null;
}

function storeFor(account, store) {
  return store.kind === "stripe" && account?.id ? store.bind(account.id) : store;
}

// ── Pages ────────────────────────────────────────────────────────────────────

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function html(status, body, extra = {}) {
  const headers = { ...HEADERS, ...extra };
  return new Response(body, { status, headers });
}

function testBanner(env) {
  if (!testModeEnabled(env)) return "";
  return `<p class="banner">Test mode is on. Purchases are simulated, and the sign-in link is shown here instead of emailed. This stays off in production.</p>`;
}

function dollars(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`;
}

function signInPage(env, { error = "" } = {}) {
  return page(
    "Sign in · Grill Pro",
    `${testBanner(env)}
<h1>Sign in to Grill Pro</h1>
<p>Grill Pro is the only part of Grill with an account. The free tool never asks you to sign in, and it has no account.</p>
<p>We'll email you a link. It works once, for 20 minutes. We don't use a password.</p>
${error ? `<p><strong>${esc(error)}</strong></p>` : ""}
<form method="post" action="/pro/auth">
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" required>
<div class="row"><button type="submit">Email me a sign-in link</button></div>
</form>
<p class="small">The free ways to use Grill are on <a href="/#setup">the site</a>.</p>`,
  );
}

function sentPage(env, email, devLink) {
  const link = devLink
    ? `<p>Test mode, so nothing was emailed. <a id="magic" href="${esc(devLink)}">Sign in as ${esc(email)}</a>.</p>`
    : `<p>If that address can have a Grill Pro account, the link is on its way. It works once, for 20 minutes.</p>`;
  return page("Check your email · Grill Pro", `${testBanner(env)}<h1>Check your email</h1>${link}`);
}

function missingSetupPage(env) {
  return page(
    "Pro accounts aren't configured · Grill",
    `<h1>Grill Pro accounts aren't configured yet.</h1>
<p>The free tool is unchanged, and it still has no account. To turn Pro accounts on, set <code>GRILL_SESSION_SECRET</code> and a place to keep the account. The README lists each variable.</p>
<p class="small">${esc(setupHint(env))}</p>`,
  );
}

function setupHint(env) {
  const missing = [];
  if (!sessionSecret(env)) missing.push("GRILL_SESSION_SECRET");
  if (!testModeEnabled(env) && !(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) && !env.STRIPE_SECRET_KEY) {
    missing.push("an account store (Upstash Redis, or STRIPE_SECRET_KEY)");
  }
  return missing.length ? `Missing: ${missing.join(", ")}.` : "";
}

export function renderSetupConfig({ assistant, judge, key }) {
  const a = assistantById(assistant);
  const j = judgeById(judge);
  if (!a || !j) return "";
  const keyLine = key || "PASTE_YOUR_KEY";
  const judgeLine = j.id;
  const where = PASTE_NAME[j.company] || j.label;
  const lines = [
    `Grill Pro setup`,
    `Assistant: ${a.label}`,
    `Judge: ${j.label} (${judgeLine})`,
    `The judge is ${where}, a different company from ${a.label}.`,
    ``,
  ];
  if (a.route === "paste" || a.route === "skill") {
    lines.push(
      `This route does not use the key. Paste the judge prompt into ${where}.`,
      `Do not paste the key into the chat.`,
      ``,
      `Tell ${a.label}: when you write the judge prompt, the judge is ${where}.`,
      ``,
      `The managed key is for Claude Desktop or Claude Code, if you want the one-click check:`,
    );
  }
  if (a.route === "extension" || a.route === "plugin" || a.route === "paste" || a.route === "skill") {
    lines.push(
      `Model router key: ${keyLine}`,
      `Judge model: ${judgeLine}`,
    );
  }
  if (a.route === "extension") {
    lines.push(
      ``,
      `Claude Desktop: download grill.mcpb, double-click it, and paste those two into Grill's settings when asked.`,
      `Leave Judge model blank only if you want Grill's default chain.`,
    );
  }
  if (a.route === "plugin") {
    lines.push(
      ``,
      `Claude Code:`,
      `/plugin marketplace add mtangoz/grill`,
      `/plugin install grill@grill`,
      `When it asks, paste the model router key and the judge model above.`,
    );
  }
  if (a.route === "skill") {
    lines.push(
      ``,
      `claude.ai: Customize, then Skills, and upload grill-skill.zip.`,
      `The skill writes a prompt. Paste that prompt into ${where}, not into Claude.`,
    );
  }
  return lines.join("\n");
}

function setupFields(account, { error = "", key = "", assistant = "", judge = "" } = {}) {
  const chosenAssistant = assistant && assistantById(assistant) ? assistant : account.assistant || "claude-desktop";
  const chosenJudge =
    judge && judgeById(judge)
      ? judge
      : account.judgeModel && judgeAllowed(chosenAssistant, account.judgeModel)
        ? account.judgeModel
        : defaultJudge(chosenAssistant);
  const assistantRadios = ASSISTANTS.map((a) => {
    const checked = a.id === chosenAssistant ? " checked" : "";
    return `<label class="choice"><input type="radio" name="assistant" value="${esc(a.id)}" data-company="${esc(a.company)}"${checked}> ${esc(a.label)}</label>`;
  }).join("");
  const judgeRadios = JUDGES.map((j) => {
    const checked = j.id === chosenJudge ? " checked" : "";
    return `<label class="choice"><input type="radio" name="judge" value="${esc(j.id)}" data-company="${esc(j.company)}"${checked}> ${esc(j.label)} <span class="small">(${esc(j.id)})</span></label>`;
  }).join("");
  return `${error ? `<p class="banner"><strong>${esc(error)}</strong></p>` : ""}
<form method="post" action="/pro">
<input type="hidden" name="action" value="setup">
<fieldset><legend>Assistant</legend>${assistantRadios}</fieldset>
<fieldset><legend>Judge</legend>${judgeRadios}
<p class="small" id="judge-note"></p></fieldset>
<label for="key">Your Grill Pro key, so the config can include it</label>
<input id="key" name="key" type="text" autocomplete="off" value="${esc(key)}" aria-label="Your Grill Pro key">
<p class="small">Leave this blank if you don't have the key handy. The config will say PASTE_YOUR_KEY, and you can rotate the key to see a new one.</p>
<div class="row"><button type="submit">Save setup</button></div>
</form>
<script>
(function () {
  var note = document.getElementById("judge-note");
  var assistants = document.querySelectorAll('input[name="assistant"]');
  var judges = document.querySelectorAll('input[name="judge"]');
  function picked(list) {
    for (var i = 0; i < list.length; i++) if (list[i].checked) return list[i];
    return null;
  }
  function blocked(assistantCompany, judgeCompany) {
    if (assistantCompany === "copilot") return judgeCompany === "openai" || judgeCompany === "anthropic" || judgeCompany === "xai";
    return assistantCompany === judgeCompany;
  }
  function align() {
    var assistant = picked(assistants);
    var current = picked(judges);
    if (!assistant || !current) return;
    if (!blocked(assistant.getAttribute("data-company"), current.getAttribute("data-company"))) {
      note.textContent = "";
      return;
    }
    for (var i = 0; i < judges.length; i++) {
      if (blocked(assistant.getAttribute("data-company"), judges[i].getAttribute("data-company"))) continue;
      judges[i].checked = true;
      note.textContent = "That assistant can't be judged by the same company, so this judge is selected instead.";
      return;
    }
  }
  for (var i = 0; i < assistants.length; i++) assistants[i].addEventListener("change", align);
})();
</script>`;
}

function setupForm(account, env, opts = {}) {
  return page(
    "Set up Grill Pro",
    `${testBanner(env)}
<h1>Set up the assistant you think with</h1>
<p>Pick who you think with, then a judge from a different company. Copilot can run OpenAI, Anthropic or xAI, so Gemini or DeepSeek is the safe judge for it. We'll fill in a config you can copy. The key is only included if you paste it here. We don't save the key.</p>
${setupFields(account, opts)}
<p class="small"><a href="/pro">Back to your account</a></p>`,
  );
}

function configPage(account, env, { key = "", report = "" } = {}) {
  const config = renderSetupConfig({ assistant: account.assistant, judge: account.judgeModel, key });
  const tryForm = testModeEnabled(env)
    ? `<h2>Try a grill</h2>
<p>Test mode only. This runs a sample through Grill's judge with your managed key and the judge you picked. In production your write-up goes from your assistant straight to the router, and never through this server.</p>
<form method="post" action="/pro/try">
<label for="subject">A sample decision</label>
<textarea id="subject" name="subject">We're moving our launch to March. I'm 70% sure it gets us more signups.</textarea>
<label for="trykey">Key</label>
<input id="trykey" name="key" type="text" autocomplete="off" value="${esc(key)}" aria-label="Key for the sample grill">
<div class="row"><button type="submit">Run a sample grill</button></div>
</form>`
    : "";
  return page(
    "Your setup · Grill Pro",
    `${testBanner(env)}
<h1>Copy this into ${esc(assistantById(account.assistant)?.label || "your assistant")}</h1>
<p>The judge is filled in. ${key ? "The key is filled in on this page only. We still don't store it." : "Paste your key over PASTE_YOUR_KEY, or rotate it if you don't have it."}</p>
<pre class="config" id="config">${esc(config)}</pre>
${report ? `<h2>Sample grill</h2><pre class="config">${esc(report)}</pre>` : ""}
<p class="small"><a href="/pro/reports">Reports</a> keeps a copy only if you turn saving on. It is off until you do.</p>
${tryForm}
<p class="small"><a href="/pro">Back to your account</a></p>`,
  );
}

function keyPage(account, env, key, heading) {
  return page(
    "Your key · Grill Pro",
    `${testBanner(env)}
<h1>${esc(heading)}</h1>
<p>Copy it now. We only show it once, and we store only a hash of it.</p>
<div class="key"><input id="k" type="text" readonly value="${esc(key)}" aria-label="Your Grill Pro key"><button type="button" id="copy">Copy</button></div>
<h2>Now link your assistant</h2>
<p>The key is filled in below so the config can include it. Copilot can run OpenAI, Anthropic or xAI models, so Gemini or DeepSeek is the safe judge for it.</p>
${setupFields(account, { key })}
<p class="small"><a href="/pro">Back to your account</a></p>
<script>document.getElementById("copy").addEventListener("click",function(){var k=document.getElementById("k");k.select();(navigator.clipboard?navigator.clipboard.writeText(k.value):Promise.reject()).then(function(){document.getElementById("copy").textContent="Copied";},function(){document.execCommand("copy");document.getElementById("copy").textContent="Copied";});});</script>`,
  );
}

async function dashboard(account, deps) {
  const env = deps.env;
  const record = activeRecord(account);
  let usage = "";
  if (record && deps.fetch) {
    try {
      const live = await readManagedKey(record.hash, deps);
      if (!live) usage = `<p>The router no longer has this key.</p>`;
      else if (live.disabled || record.disabled) usage = `<p>This key is switched off.</p>`;
      else usage = `<p>Used ${esc(dollars(live.usageUsd))} of ${esc(dollars(live.limitUsd ?? 3))} this month. That is cost and model, never the text of a check.</p>`;
    } catch {
      usage = `<p>Usage isn't available right now. Your key is unchanged.</p>`;
    }
  } else if (account.keys?.some((k) => k.disabled)) {
    usage = `<p>This key is switched off.</p>`;
  }
  const sub =
    account.subscription === "active"
      ? "Pro is on."
      : account.subscription === "canceled"
        ? "Pro is cancelled. The key is off."
        : "Pro isn't on for this account yet.";
  const assistant = assistantById(account.assistant);
  const judge = judgeById(account.judgeModel);
  const setupLine = assistant && judge ? `${assistant.label}, judged by ${judge.label}.` : "You haven't picked an assistant yet.";
  const portal = portalUrl(env);
  const purchase = testModeEnabled(env) && account.subscription !== "active"
    ? `<form method="post" action="/pro"><input type="hidden" name="action" value="purchase"><button type="submit">Simulate purchase</button></form>`
    : account.subscription !== "active"
      ? `<p><a class="button" href="/checkout?plan=month">Subscribe</a></p><p class="small">Checkout uses Stripe. Until those price ids are set, this link explains that payment isn't ready.</p>`
      : "";
  const manage = account.subscription === "active"
    ? `<div class="row">
<form method="post" action="/pro"><input type="hidden" name="action" value="rotate"><button type="submit">Rotate key</button></form>
<form method="post" action="/pro"><input type="hidden" name="action" value="revoke"><button type="submit">Revoke key</button></form>
${testModeEnabled(env) ? `<form method="post" action="/pro"><input type="hidden" name="action" value="cancel"><button type="submit">Cancel Pro</button></form>` : ""}
</div>
${portal ? `<p class="small">Cancel the subscription itself here: <a href="${esc(portal)}">your subscription</a>. The key keeps working until the period you've paid for, then the webhook switches it off.</p>` : testModeEnabled(env) ? `<p class="small">In test mode, Cancel Pro switches the key off now. With Stripe, it stays on until the end of the period you've paid for.</p>` : ""}`
    : "";
  return page(
    "Your account · Grill Pro",
    `${testBanner(env)}
<h1>Grill Pro</h1>
<p>Signed in as ${esc(account.email)}. ${esc(sub)}</p>
${usage}
<p>${esc(setupLine)} <a href="/pro?view=setup">Set up</a> · <a href="/pro/reports">Reports</a></p>
${purchase}
${manage}
<form method="post" action="/pro"><input type="hidden" name="action" value="signout"><button type="submit">Sign out</button></form>
<p class="small">This account is only for Pro. The free tool has no account and doesn't know you're here.</p>`,
  );
}

// ── Account actions ──────────────────────────────────────────────────────────

async function loadSession(request, store, secret, now) {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  const payload = readPayload(token, secret);
  if (!payload || payload.t !== "s" || typeof payload.sub !== "string" || !(payload.exp > now / 1000)) return null;
  return store.getById(payload.sub);
}

async function rememberKey(account, made, store) {
  const check = keyCheck(made.key);
  account.keys = account.keys.filter((k) => k.hash !== made.hash);
  account.keys.push({ hash: made.hash, check, createdAt: new Date().toISOString(), disabled: false });
  account.activeHash = made.hash;
  await store.put(account);
  return check;
}

async function mirrorHashes(account, deps) {
  if (testModeEnabled(deps.env)) return;
  if (!deps.env.STRIPE_SECRET_KEY || !isStripeCustomerId(account.stripeCustomerId)) return;
  if (deps.store?.kind === "stripe") return; // put() already wrote the customer
  const { stripe } = proClients(deps.env, deps.fetch);
  const form = { "metadata[grill_sub]": account.subscription, "metadata[grill_active]": account.activeHash || "" };
  for (const k of account.keys) {
    const prefix = k.hash.slice(0, 24);
    form[`metadata[${keyMetadataField(k.hash)}]`] = k.hash;
    form[`metadata[grill_chk_${prefix}]`] = k.check || "";
    form[`metadata[grill_off_${prefix}]`] = k.disabled ? "1" : "";
  }
  const saved = await stripe.post(`/v1/customers/${account.stripeCustomerId}`, form);
  if (!saved.ok) throw new UpstreamError(`couldn't record the key on the customer (${saved.status})`);
}

export async function startMagicLink(email, deps) {
  const now = deps.now ?? Date.now();
  const secret = sessionSecret(deps.env);
  const store = deps.store;
  let account = await store.getByEmail(email);
  if (!account && store.kind === "stripe") {
    const { stripe } = proClients(deps.env, deps.fetch);
    const created = await stripe.post("/v1/customers", { email, "metadata[grill_sub]": "none" });
    if (!created.ok || !isStripeCustomerId(created.body?.id)) throw new UpstreamError(`couldn't start the account (${created.status})`);
    account = accountFromStripeCustomer({ ...created.body, email, metadata: { grill_sub: "none" } });
    await store.put(account);
  }
  if (!account) {
    account = blankAccount(email);
    await store.put(account);
  }
  if (now - (account.lastLinkAt || 0) < LINK_COOLDOWN_MS) return { throttled: true, account };
  const nonce = randomBytes(16).toString("hex");
  const nonceHash = createHash("sha256").update(nonce).digest("hex");
  const expMs = now + MAGIC_TTL_SECONDS * 1000;
  await storeFor(account, store).putNonce(nonceHash, expMs);
  account.lastLinkAt = now;
  await store.put(account);
  const token = signPayload({ t: "m", email, sub: account.id, nonce, exp: Math.floor(expMs / 1000) }, secret);
  return { account, token };
}

export async function consumeMagicLink(token, deps) {
  const now = deps.now ?? Date.now();
  const secret = sessionSecret(deps.env);
  const payload = readPayload(token, secret);
  if (!payload || payload.t !== "m" || !(payload.exp > now / 1000) || typeof payload.nonce !== "string") return null;
  const nonceHash = createHash("sha256").update(payload.nonce).digest("hex");
  const account = payload.sub ? await deps.store.getById(payload.sub) : await deps.store.getByEmail(payload.email);
  if (!account || account.email !== payload.email) return null;
  const ok = await storeFor(account, deps.store).takeNonce(nonceHash, now);
  if (!ok) return null;
  if (!testModeEnabled(deps.env) && deps.env.STRIPE_SECRET_KEY && !account.stripeCustomerId && deps.store.kind !== "stripe") {
    const { stripe } = proClients(deps.env, deps.fetch);
    const found = await stripe.get(`/v1/customers?${new URLSearchParams({ email: account.email, limit: "1" })}`);
    const customer = found.ok ? found.body?.data?.[0] : null;
    if (customer && isStripeCustomerId(customer.id)) {
      const adopted = accountFromStripeCustomer(customer);
      account.stripeCustomerId = customer.id;
      if (adopted.keys.length) account.keys = adopted.keys;
      if (adopted.subscription === "active") account.subscription = "active";
      if (adopted.activeHash) account.activeHash = adopted.activeHash;
      await deps.store.put(account);
    }
  }
  return { account, session: signPayload({ t: "s", sub: account.id, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS }, secret) };
}

export async function issueManagedKey(account, deps) {
  const made = await createCappedKey({ env: deps.env, fetch: deps.fetch, name: `grill-pro-${account.id}` });
  try {
  await rememberKey(account, made, deps.store);
  await mirrorHashes(account, deps);
  } catch (e) {
    await removeManagedKey(made.hash, deps).catch(() => {});
    throw e;
  }
  return made;
}

export async function attachIssuedKey(request, { customerId, hash, key }, deps) {
  const secret = sessionSecret(deps.env);
  const store = deps.store ?? openStore(deps.env, deps.fetch);
  if (!secret || !store || !hash || !key) return { linked: false };
  const now = deps.now ?? Date.now();
  const account = await loadSession(request, store, secret, now);
  if (!account) return { linked: false };
  account.stripeCustomerId = customerId || account.stripeCustomerId;
  account.subscription = "active";
  await rememberKey(account, { key, hash }, store);
  await mirrorHashes(account, { ...deps, store });
  return { linked: true };
}

async function disableActive(account, deps) {
  const hashes = account.keys.filter((k) => !k.disabled).map((k) => k.hash);
  if (hashes.length) await disableManagedKeys(hashes, deps);
  for (const k of account.keys) k.disabled = true;
  account.activeHash = null;
  await deps.store.put(account);
  await mirrorHashes(account, deps);
}

export async function syncAccountSubscription(event, deps) {
  const store = deps.store ?? openStore(deps.env, deps.fetch);
  if (!store) return { action: "no-store" };
  const type = event?.type;
  const object = event?.data?.object ?? {};
  if (type === "customer.deleted") {
    const account = (await store.getByStripeCustomer(object.id)) || (store.kind === "stripe" ? await store.getById(object.id) : null);
    if (!account) return { action: "no-account" };
    account.subscription = "canceled";
    for (const k of account.keys) k.disabled = true;
    account.activeHash = null;
    await store.put(account);
    return { action: "canceled" };
  }
  if (!["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(type)) {
    return { action: "ignored" };
  }
  const customerId = object.customer;
  if (!isStripeCustomerId(customerId)) return { action: "ignored" };
  const account = (await store.getByStripeCustomer(customerId)) || (store.kind === "stripe" ? await store.getById(customerId) : null);
  if (!account) return { action: "no-account" };
  const { stripe } = proClients(deps.env, deps.fetch);
  const subs = await stripe.get(`/v1/subscriptions?customer=${customerId}&status=all&limit=100`);
  if (!subs.ok) throw new UpstreamError(`Stripe returned ${subs.status} for the subscriptions`);
  const live = (subs.body?.data ?? []).some((s) => ["active", "trialing", "past_due"].includes(s?.status));
  account.subscription = live ? "active" : "canceled";
  if (!live) {
    for (const k of account.keys) k.disabled = true;
    account.activeHash = null;
  }
  await store.put(account);
  return { action: account.subscription };
}

function originOf(request, env) {
  const set = typeof env.GRILL_PRO_ORIGIN === "string" ? env.GRILL_PRO_ORIGIN.trim().replace(/\/$/, "") : "";
  if (/^https:\/\/[A-Za-z0-9.-]+$/.test(set)) return set;
  return new URL(request.url).origin;
}

async function deliverLink({ env, fetch: fetchImpl, email, url }) {
  if (testModeEnabled(env)) return { devLink: url };
  const key = typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  const from = typeof env.GRILL_PRO_EMAIL_FROM === "string" ? env.GRILL_PRO_EMAIL_FROM.trim() : "";
  if (!key || !from) return { unconfigured: true };
  let res;
  try {
    res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Your Grill Pro sign-in link",
        text: `Sign in to Grill Pro:\n\n${url}\n\nThis link works for 20 minutes and only once. If you didn't ask for it, ignore this email.\n`,
      }),
      redirect: "error",
    });
  } catch (e) {
    throw new UpstreamError(`email wasn't sent: ${e.message}`);
  }
  if (!res.ok) throw new UpstreamError(`email wasn't sent (${res.status})`);
  return { sent: true };
}

export async function handleProAuth(request, deps) {
  const env = deps.env;
  const secret = sessionSecret(env);
  const store = deps.store ?? openStore(env, deps.fetch);
  if (!secret || !store) return html(503, missingSetupPage(env));
  const now = deps.now ?? Date.now();
  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const consumed = await consumeMagicLink(token, { ...deps, store, now });
    if (!consumed) {
      return html(400, page("Link not recognised · Grill Pro", `<h1>This sign-in link doesn't work.</h1><p>It may have been used, or it expired. <a href="/pro">Ask for a new one</a>.</p>`));
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/pro",
        "Set-Cookie": sessionCookie(consumed.session, request),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  if (request.method !== "POST") return html(405, signInPage(env));
  const form = new URLSearchParams(await request.text());
  const email = normalizeEmail(form.get("email"));
  if (!email) return html(400, signInPage(env, { error: "That doesn't look like an email address." }));
  try {
    const started = await startMagicLink(email, { ...deps, store, now });
    if (started.throttled) {
      return html(200, page("Check your email · Grill Pro", `${testBanner(env)}<h1>Check your email</h1><p>A link was just sent. Wait a moment before asking for another.</p>`));
    }
    const url = `${originOf(request, env)}/pro/auth?token=${encodeURIComponent(started.token)}`;
    const delivery = await deliverLink({ env, fetch: deps.fetch, email, url });
    if (delivery.unconfigured) {
      return html(503, page("Email isn't configured · Grill Pro", `<h1>We can't send email yet.</h1><p>Set <code>RESEND_API_KEY</code> and <code>GRILL_PRO_EMAIL_FROM</code>, or use test mode, which shows the link on the page.</p>`));
    }
    return html(200, sentPage(env, email, delivery.devLink || ""));
  } catch (e) {
    console.error(`[grill-pro] auth: ${e.message}`);
    return html(503, signInPage(env, { error: "Something went wrong sending the link. Try again in a minute." }));
  }
}

export async function handlePro(request, deps) {
  const env = deps.env;
  const secret = sessionSecret(env);
  const store = deps.store ?? openStore(env, deps.fetch);
  if (!secret || !store) return html(503, missingSetupPage(env));
  const now = deps.now ?? Date.now();
  const bound = { ...deps, store, now };
  if (request.method === "GET") {
    const account = await loadSession(request, store, secret, now);
    if (!account) return html(200, signInPage(env));
    if (new URL(request.url).searchParams.get("view") === "setup") return html(200, setupForm(account, env));
    return html(200, await dashboard(account, bound));
  }
  if (request.method !== "POST") return html(405, signInPage(env));
  const form = new URLSearchParams(await request.text());
  const action = form.get("action") || "";
  if (action === "signout") {
    return new Response(null, {
      status: 303,
      headers: { Location: "/pro", "Set-Cookie": sessionCookie("", request, 0), "Cache-Control": "no-store" },
    });
  }
  const account = await loadSession(request, store, secret, now);
  if (!account) return html(401, signInPage(env, { error: "Sign in first." }));
  try {
    if (action === "purchase") {
      if (!testModeEnabled(env)) {
        return html(400, page("Use checkout · Grill Pro", `<h1>Purchases go through Stripe.</h1><p><a href="/checkout?plan=month">Continue to checkout</a>. Test mode is how you simulate this before Stripe is connected, and it is off here.</p>`));
      }
      if (account.subscription === "active" && activeRecord(account)) {
        return html(200, await dashboard(account, bound));
      }
      account.subscription = "active";
      const made = await issueManagedKey(account, bound);
      return html(200, keyPage(account, env, made.key, "You're in. Here's your key."));
    }
    if (action === "setup") {
      const assistant = form.get("assistant") || "";
      const judge = form.get("judge") || "";
      const pasted = form.get("key") || "";
      const kept = { key: pasted, assistant, judge };
      if (!judgeAllowed(assistant, judge)) {
        return html(400, setupForm(account, env, { error: "The judge has to be a different company from the assistant you think with. For Copilot, pick Gemini or DeepSeek.", ...kept }));
      }
      const record = activeRecord(account);
      if (pasted && record && !checksMatch(record.check, pasted)) {
        return html(400, setupForm(account, env, { error: "That key doesn't match this account. Rotate it if you've lost the one we showed you.", ...kept }));
      }
      account.assistant = assistant;
      account.judgeModel = judge;
      await store.put(account);
      return html(200, configPage(account, env, { key: pasted && record ? pasted : "" }));
    }
    if (action === "rotate") {
      if (account.subscription !== "active") {
        return html(400, page("Pro isn't on · Grill Pro", `<h1>There's no active Pro subscription to rotate.</h1><p><a href="/pro">Back</a></p>`));
      }
      const previous = account.keys.filter((k) => !k.disabled).map((k) => k.hash);
      for (const k of account.keys) k.disabled = true;
      account.activeHash = null;
      await store.put(account);
      if (previous.length) await disableManagedKeys(previous, bound);
      const made = await issueManagedKey(account, bound);
      return html(200, keyPage(account, env, made.key, "Here's your new key."));
    }
    if (action === "revoke") {
      await disableActive(account, bound);
      return html(200, page("Key switched off · Grill Pro", `${testBanner(env)}<h1>Your key is switched off.</h1><p>It can't be used now. If Pro is still on, you can rotate it to get a new one.</p><p><a href="/pro">Back to your account</a></p>`));
    }
    if (action === "cancel") {
      if (!testModeEnabled(env)) {
        const portal = portalUrl(env);
        return html(400, page("Cancel in Stripe · Grill Pro", `<h1>Cancel from your subscription page.</h1><p>${portal ? `<a href="${esc(portal)}">Your subscription</a>` : "The billing portal isn't configured yet."} Your key keeps working until the period you've paid for. The webhook switches it off after that.</p>`));
      }
      await disableActive(account, bound);
      account.subscription = "canceled";
      await store.put(account);
      return html(200, page("Pro cancelled · Grill Pro", `${testBanner(env)}<h1>Pro is cancelled.</h1><p>Your key is switched off. In test mode that happens immediately. With Stripe, the key stays on until the period you've paid for, and the same webhook switches it off.</p><p><a href="/pro">Back</a></p>`));
    }
    return html(400, await dashboard(account, bound));
  } catch (e) {
    console.error(`[grill-pro] account: ${e.message}`);
    return html(503, page("Something went wrong · Grill Pro", `<h1>Something went wrong on our side.</h1><p>Nothing new was left switched on if we could help it. <a href="/pro">Try again</a>.</p>`));
  }
}

function redact(text, key) {
  if (!key) return text;
  return String(text).split(key).join("[key]");
}

export const REPORT_BODY_MAX = 20000;
export const REPORT_KEEP = 30;
const REPORT_KINDS = new Set(["grill", "weekly", "sample"]);

/**
 * Keep a copy of a report on the account. Saving is off until the owner turns it on.
 * The caller persists the account. This does not write to Stripe.
 */
export function rememberReport(account, { kind, title, body, at } = {}) {
  if (!account?.saveReports) return { saved: false, reason: "off" };
  const text = String(body ?? "").slice(0, REPORT_BODY_MAX);
  if (!text.trim()) return { saved: false, reason: "empty" };
  const report = {
    id: `rpt_${randomBytes(8).toString("hex")}`,
    kind: REPORT_KINDS.has(kind) ? kind : "grill",
    title: String(title ?? "").trim().slice(0, 200) || "Report",
    body: text,
    createdAt: at || new Date().toISOString(),
  };
  const prior = Array.isArray(account.reports) ? account.reports : [];
  account.reports = [report, ...prior].slice(0, REPORT_KEEP);
  return { saved: true, report, dropped: prior.length >= REPORT_KEEP };
}

function reportKindLabel(kind) {
  if (kind === "weekly") return "Weekly review";
  if (kind === "sample") return "Test-mode sample";
  return "Grill";
}

function reportsIntro(account, stripe) {
  const facts = `<p>Grill does not email you a verdict or a weekly note. A grill stays in the assistant you ran it in. The weekly review stays in your chat, or in an email your own mail connector sends if you ask it to. This page is where a copy would be, if you choose to keep one.</p>
<p>Saving is off until you turn it on. A saved copy is the text of the report, kept with this account, and only while you are signed in as ${esc(account.email)}. You can delete any copy, or all of them. Turning saving off stops new copies. It does not delete the ones already here. Report text is never written onto a Stripe customer.</p>`;
  if (stripe) {
    return `${facts}<p class="banner">This account is stored on your Stripe customer. Report text does not fit there, so saving stays off until the account store is set.</p>`;
  }
  return facts;
}

function reportsPage(account, env, { stripe = false, error = "" } = {}) {
  const reports = Array.isArray(account.reports) ? account.reports : [];
  const saving = account.saveReports === true && !stripe;
  const toggle = stripe
    ? ""
    : saving
      ? `<form method="post" action="/pro/reports"><input type="hidden" name="action" value="save-off"><button type="submit">Stop saving copies</button></form>`
      : `<form method="post" action="/pro/reports"><input type="hidden" name="action" value="save-on"><button type="submit">Save copies here</button></form>`;
  const rows = reports
    .map((r) => {
      const when = esc(String(r.createdAt || "").slice(0, 10));
      return `<li><a href="/pro/reports?id=${esc(r.id)}">${esc(r.title)}</a> <span class="small">${esc(reportKindLabel(r.kind))} · ${when}</span>
<form method="post" action="/pro/reports"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${esc(r.id)}"><button type="submit">Delete</button></form></li>`;
    })
    .join("");
  const list = reports.length
    ? `<ul>${rows}</ul><form method="post" action="/pro/reports"><input type="hidden" name="action" value="delete-all"><button type="submit">Delete all</button></form>`
    : `<p>${saving ? "Nothing is saved yet. A sample grill in test mode is kept here. A verdict or weekly note would be too, once Grill emails one." : "Nothing is saved. Grill keeps none of the text."}</p>`;
  const state = saving ? "<p>Saving is on.</p>" : "<p>Saving is off.</p>";
  return page(
    "Reports · Grill Pro",
    `${testBanner(env)}
<h1>Reports</h1>
${error ? `<p class="banner"><strong>${esc(error)}</strong></p>` : ""}
${reportsIntro(account, stripe)}
${state}
${toggle}
${list}
<p class="small"><a href="/pro">Back to your account</a></p>`,
  );
}

function reportView(account, env, report) {
  return page(
    `${report.title} · Grill Pro`,
    `${testBanner(env)}
<h1>${esc(report.title)}</h1>
<p class="small">${esc(reportKindLabel(report.kind))} · ${esc(String(report.createdAt || "").slice(0, 10))} · only on this account</p>
<pre class="config">${esc(report.body)}</pre>
<form method="post" action="/pro/reports"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="${esc(report.id)}"><button type="submit">Delete this report</button></form>
<p class="small"><a href="/pro/reports">All reports</a></p>`,
  );
}

export async function handleProReports(request, deps) {
  const env = deps.env;
  const secret = sessionSecret(env);
  const store = deps.store ?? openStore(env, deps.fetch);
  if (!secret || !store) return html(503, missingSetupPage(env));
  const now = deps.now ?? Date.now();
  const account = await loadSession(request, store, secret, now);
  if (!account) return html(401, signInPage(env, { error: request.method === "GET" ? "" : "Sign in first." }));
  const stripe = store.kind === "stripe";
  const show = (status, error = "") => html(status, reportsPage(account, env, { stripe, error }));
  if (request.method === "GET") {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return show(200);
    const report = (account.reports ?? []).find((r) => r.id === id);
    if (!report) return show(404, "That report isn't on this account.");
    return html(200, reportView(account, env, report));
  }
  if (request.method !== "POST") return show(405);
  const form = new URLSearchParams(await request.text());
  const action = form.get("action") || "";
  if (action === "save-on") {
    if (stripe) return show(400, "Report text is not stored on your Stripe customer. Saving stays off until the account store is set.");
    account.saveReports = true;
    if (!Array.isArray(account.reports)) account.reports = [];
    await store.put(account);
    return show(200);
  }
  if (action === "save-off") {
    account.saveReports = false;
    await store.put(account);
    return show(200);
  }
  if (action === "delete") {
    const id = form.get("id") || "";
    const prior = Array.isArray(account.reports) ? account.reports : [];
    const next = prior.filter((r) => r.id !== id);
    if (next.length === prior.length) return show(404, "That report isn't on this account.");
    account.reports = next;
    await store.put(account);
    return show(200);
  }
  if (action === "delete-all") {
    account.reports = [];
    await store.put(account);
    return show(200);
  }
  return show(400);
}

/**
 * Run one sample grill in test mode. The key is used as the bearer token and then dropped.
 * The write-up goes to a loopback stand-in for the router, never to the real network.
 */
export async function runSampleGrill({ key, model, author, subject }) {
  const fixture = JSON.parse(readFileSync(USABLE_FIXTURE, "utf8"));
  fixture.model = model;
  const fake = await startFakeOpenRouter({ chat: () => ({ text: JSON.stringify(fixture) }) });
  const dir = mkdtempSync(join(tmpdir(), "grill-pro-try-"));
  const args = [JUDGE, "--json", "--out", join(dir, "report.md")];
  if (author) args.push("--author", author);
  const child = spawn(process.execPath, args, {
    env: {
      PATH: process.env.PATH,
      OPENROUTER_API_KEY: key,
      JUDGE_MODEL: model,
      JUDGE_OPENROUTER_URL: fake.env.JUDGE_OPENROUTER_URL,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d;
  });
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.stdin.end(subject);
  const code = await new Promise((resolve) => child.on("close", resolve));
  let report = "";
  try {
    report = readFileSync(join(dir, "report.md"), "utf8");
  } catch {
    report = "";
  }
  rmSync(dir, { recursive: true, force: true });
  await fake.close();
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    parsed = null;
  }
  const seen = fake.seen.chat[0];
  return {
    code,
    report: redact(report, key),
    stderr: redact(stderr, key),
    auth: seen?.headers?.authorization ?? "",
    requestedModel: seen?.body?.model ?? "",
    costUsd: Number(parsed?.costUsd) || 0,
  };
}

export async function handleProTry(request, deps) {
  if (!testModeEnabled(deps.env)) return new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const secret = sessionSecret(deps.env);
  const store = deps.store ?? openStore(deps.env, deps.fetch);
  if (!secret || !store) return html(503, missingSetupPage(deps.env));
  if (request.method !== "POST") return html(405, page("Try a grill · Grill Pro", `<h1>Use the setup page.</h1>`));
  const now = deps.now ?? Date.now();
  const account = await loadSession(request, store, secret, now);
  if (!account) return html(401, signInPage(deps.env));
  const form = new URLSearchParams(await request.text());
  const key = form.get("key") || "";
  const subject = (form.get("subject") || "").trim();
  const record = activeRecord(account);
  if (!record || record.disabled || account.subscription !== "active") {
    return html(400, page("No key · Grill Pro", `<h1>There's no working key on this account.</h1><p><a href="/pro">Back</a></p>`));
  }
  if (!checksMatch(record.check, key)) {
    return html(400, page("Key doesn't match · Grill Pro", `<h1>That key doesn't match this account.</h1><p><a href="/pro">Back</a></p>`));
  }
  if (!account.judgeModel || !judgeAllowed(account.assistant, account.judgeModel)) {
    return html(400, page("Pick a judge first · Grill Pro", `<h1>Save a judge from a different company first.</h1><p><a href="/pro?view=setup">Set up</a></p>`));
  }
  if (!subject || subject.length > 8000) {
    return html(400, page("Need a decision · Grill Pro", `<h1>Write a short decision to grill.</h1>`));
  }
  const assistant = assistantById(account.assistant);
  const author = !assistant || assistant.company === "anthropic" ? "" : assistant.company === "copilot" ? "openai" : assistant.company === "xai" ? "x-ai" : assistant.company;
  const result = await runSampleGrill({ key, model: account.judgeModel, author, subject });
  if (typeof deps.fetch?.noteUsage === "function" && result.code === 0) {
    deps.fetch.noteUsage(record.hash, result.costUsd || 0.0123);
  }
  if (result.code !== 0 || !result.report) {
    return html(502, page("The sample didn't finish · Grill Pro", `<h1>The sample grill didn't finish.</h1><pre class="config">${esc(result.stderr.slice(0, 500))}</pre>`));
  }
  if (store.kind !== "stripe") {
    const kept = rememberReport(account, { kind: "sample", title: "Test-mode sample grill", body: result.report });
    if (kept.saved) await store.put(account);
  }
  return html(200, configPage(account, deps.env, { key, report: result.report }));
}

export function accountDeps(env, fetchImpl, store, now = Date.now()) {
  return { env, fetch: fetchImpl, store, now };
}
