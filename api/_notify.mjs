/**
 * Pro launch list. The installed Grill tool never reaches this file.
 *
 * Someone leaves an email on the site. We email a confirmation link. Nothing is stored
 * except a 24-hour hash, until they press Confirm. The link is ciphertext: the address
 * is not readable in the URL. Resend then keeps the address as a contact, with no other
 * details. Counts are numbers only, reported as Pro interest, never as users.
 *
 * The launch email itself is a template in this file. Nothing here sends it.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizeEmail, redisCommand } from "./_account.mjs";
import { esc, page } from "./_pro.mjs";

export const CONFIRM_TTL_MS = 48 * 60 * 60 * 1000;
export const MIN_SUBMIT_MS = 3_000;
export const MAX_SUBMIT_MS = 2 * 60 * 60 * 1000;
export const COOLDOWN_SECONDS = 86_400;
export const DAILY_TTL_SECONDS = 172_800;
export const POSTAL_PLACEHOLDER = "NOTIFY_POSTAL_ADDRESS";
export const LAUNCH_SUBJECT = "Grill Pro is ready: saved history and look-back reminders";
export const CONFIRM_SUBJECT = "Confirm: tell me when Grill Pro is ready";
const PRIVACY_URL = "https://github.com/mtangoz/grill/blob/main/docs/PRIVACY.md#the-pro-launch-list";
const VIAS = ["tool", "paste", "site"];

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function html(status, body) {
  return new Response(body, { status, headers: HEADERS });
}

function logStatus(where, status) {
  const code = Number.isInteger(status) ? status : 0;
  console.error(`[grill-notify] ${where} ${code}`);
}

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function keyFrom(secret) {
  return createHash("sha256").update(String(secret), "utf8").digest();
}

function trimmed(env, name) {
  const value = env?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function idOk(value) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

export function dailyCap(env = {}) {
  const n = Number(trimmed(env, "GRILL_NOTIFY_DAILY_CAP"));
  return Number.isInteger(n) && n >= 1 && n <= 100_000 ? n : 200;
}

/** Resend and Upstash have to be set, or the form says sign-ups aren't open yet. */
export function notifyConfigured(env = {}) {
  if (!trimmed(env, "RESEND_API_KEY") || !trimmed(env, "GRILL_PRO_EMAIL_FROM")) return false;
  if (!trimmed(env, "UPSTASH_REDIS_REST_URL").startsWith("https://") || !trimmed(env, "UPSTASH_REDIS_REST_TOKEN")) return false;
  if (trimmed(env, "GRILL_NOTIFY_SECRET").length < 16) return false;
  if (!idOk(trimmed(env, "RESEND_NOTIFY_SEGMENT_ID")) || !idOk(trimmed(env, "RESEND_NOTIFY_TOPIC_ID"))) return false;
  return true;
}

export function viaOf(value) {
  const via = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VIAS.includes(via) ? via : "site";
}

export function sealNotifyToken(payload, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function openNotifyToken(token, secret, now) {
  if (typeof token !== "string" || !secret || token.length < 24 || token.length > 2000) return null;
  let buf;
  try {
    buf = Buffer.from(token, "base64url");
  } catch {
    return null;
  }
  if (buf.length < 12 + 16 + 2) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8"));
    if (!data || typeof data.email !== "string" || typeof data.exp !== "number") return null;
    if (!(data.exp > now)) return null;
    const email = normalizeEmail(data.email);
    if (!email) return null;
    return { email, via: viaOf(data.via), exp: data.exp };
  } catch {
    return null;
  }
}

export function signIssued(now, secret) {
  const body = String(now);
  const sig = createHmac("sha256", secret).update(`issued:${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function issuedStatus(token, secret, now) {
  if (typeof token !== "string" || !secret) return "bad";
  const i = token.lastIndexOf(".");
  if (i <= 0) return "bad";
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret).update(`issued:${body}`).digest("base64url");
  const got = Buffer.from(sig);
  const exp = Buffer.from(expected);
  if (got.length !== exp.length || !timingSafeEqual(got, exp)) return "bad";
  if (!/^\d+$/.test(body)) return "bad";
  const at = Number(body);
  const age = now - at;
  if (age < MIN_SUBMIT_MS) return "fast";
  if (age > MAX_SUBMIT_MS) return "stale";
  return "ok";
}

export function confirmEmailText(url) {
  return `Someone (hopefully you) asked to hear when Grill Pro is ready.

Confirm here: ${url}

That link works for 48 hours. If you don't click it, nothing is saved and you won't hear from us again.

What you'll get: one email when saved history and look-back reminders are available. No newsletter.

Grill, made by Hold. Questions: support@grillyour.ai
`;
}

/**
 * The launch email, for a later Resend broadcast. This function only fills in the text.
 * It does not send. The postal line stays the env var name until NOTIFY_POSTAL_ADDRESS is set.
 */
export function launchEmailText(env = {}) {
  const postal = trimmed(env, "NOTIFY_POSTAL_ADDRESS") || POSTAL_PLACEHOLDER;
  return `You asked us to tell you when Grill Pro was ready. It is.

What Pro adds:
- Saved decision history across the assistants you use: Claude, Claude Code, ChatGPT, Gemini, Grok.
- A reminder when a look-back is due, and a monthly look-back report.

What doesn't change:
- The free tool stays free and account-free. Bring your own key, no sign-in, nothing stored.
- Pro is opt-in. Saving history means Grill stores your decision records on your account, and you can delete them anytime. What's kept and where: ${PRIVACY_URL}

Try it: https://grillyour.ai/pro

This is the only email this list gets. We delete the list 60 days after this email.

Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}
Grill, made by Hold · ${postal} · support@grillyour.ai
`;
}

const INTEREST_KEYS = [
  ["notify_list", "grill:metric:notify_confirmed"],
  ["notify_tool", "grill:metric:notify_confirmed_via_tool"],
  ["notify_paste", "grill:metric:notify_confirmed_via_paste"],
  ["notify_site", "grill:metric:notify_confirmed_via_site"],
];

/** Four counters, side by side. Not a user count, and not summed into one. */
export async function readNotifyInterest(env = {}, fetchImpl = globalThis.fetch) {
  if (!trimmed(env, "UPSTASH_REDIS_REST_URL") || !trimmed(env, "UPSTASH_REDIS_REST_TOKEN")) {
    const err = new Error("not configured");
    err.code = "unconfigured";
    throw err;
  }
  const cmd = redisCommand(env, fetchImpl);
  const out = { label: "Pro interest", countsAsUsers: false };
  for (const [field, key] of INTEREST_KEYS) {
    out[field] = Number(await cmd(["GET", key])) || 0;
  }
  return out;
}

function originOf(request, env) {
  const set = trimmed(env, "GRILL_PRO_ORIGIN").replace(/\/$/, "");
  if (/^https:\/\/[A-Za-z0-9.-]+$/.test(set)) return set;
  try {
    return new URL(request.url).origin;
  } catch {
    return "https://grillyour.ai";
  }
}

function notOpenPage() {
  return html(
    200,
    page(
      "Not open yet · Grill",
      `<h1>Sign-ups aren't open yet.</h1><p>Nothing was saved. The free tool is unchanged: no account, and nothing stored.</p><p><a href="https://grillyour.ai/">Back to Grill</a></p>`,
    ),
  );
}

function checkInboxPage() {
  return html(
    200,
    page(
      "Check your inbox · Grill",
      `<h1>Check your inbox.</h1><p>We sent a link to confirm. Nothing is saved until you click it.</p><p class="small">Questions? Email <a href="mailto:support@grillyour.ai">support@grillyour.ai</a>.</p>`,
    ),
  );
}

function pausedPage() {
  return html(
    200,
    page(
      "Paused for today · Grill",
      `<h1>Sign-ups are paused for today, try tomorrow.</h1><p>Nothing was saved.</p><p><a href="/notify">Back</a></p>`,
    ),
  );
}

function tryAgainPage() {
  return html(
    200,
    page(
      "Try again · Grill",
      `<h1>Something went wrong.</h1><p>Nothing was saved. Try again in a minute.</p><p><a href="/notify">Back</a></p>`,
    ),
  );
}

function formCopy() {
  return `<h1>Coming later: saved history and look-back reminders</h1>
<p>An optional Pro plan will keep your decision records across the assistants you use (Claude, ChatGPT, Gemini, Grok), remind you when a look-back is due, and send a monthly look-back report. The free tool stays free, with no account.</p>
<p>Want to hear when it's ready? Leave your email.</p>`;
}

function formPage({ via, email = "", issued = "", message = "", error = "" }) {
  const note = message ? `<p class="banner">${esc(message)}</p>` : "";
  const err = error ? `<p class="banner">${esc(error)}</p>` : "";
  return html(
    error ? 400 : 200,
    page(
      "Hear when Grill Pro is ready",
      `${formCopy()}
${note}${err}
<form method="post" action="/notify">
<input type="hidden" name="via" value="${esc(via)}">
<input type="hidden" name="issued" value="${esc(issued)}">
<p hidden><label>Leave this blank <input type="text" name="leave_blank" tabindex="-1" autocomplete="off"></label></p>
<label for="notify-email">Email</label>
<input id="notify-email" type="email" name="email" required autocomplete="email" value="${esc(email)}">
<p class="row"><button type="submit">Notify me</button></p>
</form>
<p class="small">We'll email you once to confirm, and once when Pro is ready. We store only your email address, in Resend, our email provider. It's never linked to anything you grill. Unsubscribe with one click, or email <a href="mailto:support@grillyour.ai">support@grillyour.ai</a>. <a href="${PRIVACY_URL}" rel="noreferrer">Privacy</a></p>`,
    ),
  );
}

function issuedMessage(status) {
  if (status === "fast") return "Wait a few seconds, then press Notify me again.";
  if (status === "stale") return "This form expired. Press Notify me again.";
  return "Press Notify me once more to send the confirmation.";
}

async function redis(env, fetchImpl, args) {
  try {
    return await redisCommand(env, fetchImpl)(args);
  } catch {
    logStatus("store", 0);
    throw new Error("store");
  }
}

async function resend(env, fetchImpl, path, { method = "POST", body } = {}) {
  const headers = { Authorization: `Bearer ${trimmed(env, "RESEND_API_KEY")}` };
  const init = { method, headers, redirect: "error" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetchImpl(`https://api.resend.com${path}`, init);
  } catch {
    logStatus("resend", 0);
    throw new Error("resend");
  }
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    logStatus("resend", res.status);
    const err = new Error("resend");
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

export async function handleNotify(request, deps) {
  const env = deps.env ?? {};
  const fetchImpl = deps.fetch;
  const now = deps.now ?? Date.now();
  if (request.method === "GET") {
    if (!notifyConfigured(env)) return notOpenPage();
    const via = viaOf(new URL(request.url).searchParams.get("via"));
    return formPage({ via, issued: signIssued(now, trimmed(env, "GRILL_NOTIFY_SECRET")) });
  }
  if (request.method !== "POST") return html(405, page("Notify · Grill", "<h1>That request isn't supported.</h1>"));
  if (!notifyConfigured(env)) return notOpenPage();

  const form = new URLSearchParams(await request.text());
  const via = viaOf(form.get("via"));
  const email = normalizeEmail(form.get("email"));
  const secret = trimmed(env, "GRILL_NOTIFY_SECRET");
  if (String(form.get("leave_blank") ?? "").trim()) return checkInboxPage();
  if (!email) return formPage({ via, issued: signIssued(now, secret), error: "That doesn't look like an email address." });

  const timing = issuedStatus(form.get("issued"), secret, now);
  if (timing !== "ok") return formPage({ via, email, issued: signIssued(now, secret), message: issuedMessage(timing) });

  const coolKey = `grill:notify:cool:${sha256(email)}`;
  let reserved = false;
  try {
    const day = new Date(now).toISOString().slice(0, 10);
    const sentKey = `grill:notify:sent:${day}`;
    const current = Number(await redis(env, fetchImpl, ["GET", sentKey])) || 0;
    if (current >= dailyCap(env)) return pausedPage();

    const set = await redis(env, fetchImpl, ["SET", coolKey, "1", "NX", "EX", String(COOLDOWN_SECONDS)]);
    if (set !== "OK") return checkInboxPage();
    reserved = true;

    const token = sealNotifyToken({ email, via, exp: now + CONFIRM_TTL_MS }, secret);
    const url = `${originOf(request, env)}/notify/confirm?t=${token}`;
    await resend(env, fetchImpl, "/emails", {
      body: {
        from: trimmed(env, "GRILL_PRO_EMAIL_FROM"),
        to: email,
        subject: CONFIRM_SUBJECT,
        text: confirmEmailText(url),
      },
    });
    await redis(env, fetchImpl, ["INCR", sentKey]);
    await redis(env, fetchImpl, ["EXPIRE", sentKey, String(DAILY_TTL_SECONDS)]);
    return checkInboxPage();
  } catch {
    if (reserved) {
      try {
        await redis(env, fetchImpl, ["DEL", coolKey]);
      } catch {
        // The address can try again after the cooldown if this delete also fails.
      }
    }
    return tryAgainPage();
  }
}

function confirmButton(token) {
  return html(
    200,
    page(
      "Confirm · Grill",
      `<h1>Confirm you want to hear when Grill Pro is ready.</h1>
<p>One email when saved history and look-back reminders are available. No newsletter. Nothing is saved until you press the button.</p>
<form method="post" action="/notify/confirm">
<input type="hidden" name="t" value="${esc(token)}">
<p class="row"><button type="submit">Confirm</button></p>
</form>`,
    ),
  );
}

function badLinkPage() {
  return html(
    200,
    page(
      "Link not recognised · Grill",
      `<h1>This confirmation link doesn't work.</h1><p>It may have expired. Nothing was saved. <a href="/notify">Ask again</a>.</p>`,
    ),
  );
}

function onTheListPage() {
  return html(
    200,
    page(
      "You're on the list · Grill",
      `<h1>You're on the list.</h1><p>We'll email you once when Pro is ready. Changed your mind? Use the unsubscribe link in that email, or write to <a href="mailto:support@grillyour.ai">support@grillyour.ai</a>.</p><p class="small"><a href="${PRIVACY_URL}" rel="noreferrer">Privacy</a></p>`,
    ),
  );
}

async function dropContact(env, fetchImpl, id) {
  try {
    await resend(env, fetchImpl, `/contacts/${id}`, { method: "DELETE" });
  } catch {
    logStatus("resend", 0);
  }
}

export async function handleNotifyConfirm(request, deps) {
  const env = deps.env ?? {};
  const fetchImpl = deps.fetch;
  const now = deps.now ?? Date.now();
  if (!notifyConfigured(env)) return notOpenPage();
  const secret = trimmed(env, "GRILL_NOTIFY_SECRET");

  if (request.method === "GET") {
    const token = new URL(request.url).searchParams.get("t") ?? "";
    if (!openNotifyToken(token, secret, now)) return badLinkPage();
    return confirmButton(token);
  }
  if (request.method !== "POST") return html(405, page("Confirm · Grill", "<h1>That request isn't supported.</h1>"));

  const form = new URLSearchParams(await request.text());
  const token = form.get("t") ?? "";
  const opened = openNotifyToken(token, secret, now);
  if (!opened) return badLinkPage();

  const segmentId = trimmed(env, "RESEND_NOTIFY_SEGMENT_ID");
  const topicId = trimmed(env, "RESEND_NOTIFY_TOPIC_ID");
  let contactId = "";
  try {
    let created;
    try {
      created = await resend(env, fetchImpl, "/contacts", {
        body: { email: opened.email, unsubscribed: false },
      });
    } catch (e) {
      if (e.status === 409) return onTheListPage();
      throw e;
    }
    contactId = typeof created?.id === "string" ? created.id : "";
    if (!idOk(contactId)) {
      logStatus("resend", 0);
      return tryAgainPage();
    }
    await resend(env, fetchImpl, `/contacts/${contactId}/segments/${segmentId}`);
    await resend(env, fetchImpl, `/contacts/${contactId}/topics`, {
      method: "PATCH",
      body: [{ id: topicId, subscription: "opt_in" }],
    });
    const countedKey = `grill:notify:counted:${sha256(opened.email)}`;
    const counted = await redis(env, fetchImpl, ["SET", countedKey, "1", "NX", "EX", String(DAILY_TTL_SECONDS)]);
    if (counted === "OK") {
      await redis(env, fetchImpl, ["INCR", "grill:metric:notify_confirmed"]);
      await redis(env, fetchImpl, ["INCR", `grill:metric:notify_confirmed_via_${opened.via}`]);
    }
    return onTheListPage();
  } catch {
    if (contactId) await dropContact(env, fetchImpl, contactId);
    return tryAgainPage();
  }
}
