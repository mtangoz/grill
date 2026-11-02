/**
 * Waitlist for someone who reached /start or the invite wall without a code.
 * Email and the ?ref= source only. Stored in the existing Redis. No new env var,
 * no email, and no automatic approval. Confirming is a second POST.
 * Approving mints a single-use invite code and does not let them in until they redeem it.
 */
import { createHash, randomBytes } from "node:crypto";
import { normalizeEmail, redisCommand } from "./_account.mjs";
import { saveStoredInviteCode, inviteCodeHash } from "../scripts/hostedCore.mjs";
import { normalizeRef, refFromCookie } from "./_start.mjs";
import { esc, page } from "./_pro.mjs";

export const WAITLIST_SIGNUPS = "grill:metric:waitlist_signup";
const INDEX_KEY = "grill:hosted:waitlist:index";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function waitlistKey(email) {
  return `grill:hosted:waitlist:${sha256(email)}`;
}

function html(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...HEADERS, ...extra } });
}

async function commandOf(deps) {
  if (typeof deps.redis === "function") return deps.redis;
  const env = deps.env ?? {};
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return redisCommand(env, deps.fetch);
}

export function waitlistFormHtml({ email = "", ref = "" } = {}) {
  const value = email ? ` value="${esc(email)}"` : "";
  const refField = ref ? `<input type="hidden" name="ref" value="${esc(ref)}">` : "";
  return `<form method="post" action="/waitlist">
<label for="waitlist-email">Email</label>
<input id="waitlist-email" name="email" type="email" required autocomplete="email" maxlength="254"${value}>
${refField}
<p class="row"><input type="submit" value="Join the waitlist"></p>
</form>`;
}

function closedPage() {
  return html(
    200,
    page(
      "Waitlist isn't open · Grill",
      `<h1>The waitlist isn't open right now.</h1><p>Nothing was saved.</p><p><a href="/start">Back to the setup guide</a></p>`,
    ),
  );
}

function formPage(error = "") {
  const note = error ? `<p><strong>${esc(error)}</strong></p>` : "";
  return html(
    error ? 400 : 200,
    page(
      "Join the waitlist · Grill",
      `<h1>Join the waitlist</h1>
<p>Grill in chat is invite-only. Leave an email and the source you came from. Nothing is emailed, and joining does not let you in.</p>
${note}
${waitlistFormHtml()}
<p><a href="/">Back to Grill</a></p>`,
    ),
  );
}

function confirmPage(email, ref) {
  const source = ref ? `<p>Source: ${esc(ref)}</p>` : "";
  return html(
    200,
    page(
      "Join the waitlist? · Grill",
      `<h1>Join the waitlist?</h1>
<p>This saves ${esc(email)}. Nothing is emailed, and this does not let you in.</p>
${source}
<form method="post" action="/waitlist">
<input type="hidden" name="email" value="${esc(email)}">
<input type="hidden" name="ref" value="${esc(ref)}">
<input type="hidden" name="confirm" value="join">
<p class="row"><input type="submit" value="Join the waitlist"></p>
</form>
<p><a href="/waitlist">Use a different email</a></p>`,
    ),
  );
}

function thanksPage() {
  return html(
    200,
    page(
      "You're on the list · Grill",
      `<h1>You're on the list.</h1>
<p>Nothing was emailed. Once you're let in, you can use the free option right away in your own AI chat, via the connector.</p>
<p>The setup guide is <a href="/start">here</a>.</p>
<p><a href="/">Back to Grill</a></p>`,
    ),
  );
}

async function loadRow(command, email) {
  const raw = await command(["GET", waitlistKey(email)]);
  if (typeof raw !== "string" || !raw) return null;
  try {
    const row = JSON.parse(raw);
    if (!row || row.email !== email) return null;
    return row;
  } catch {
    return null;
  }
}

export async function readWaitlist(command) {
  const ids = (await command(["LRANGE", INDEX_KEY, "0", "-1"])) || [];
  const rows = [];
  for (const id of ids) {
    const raw = await command(["GET", `grill:hosted:waitlist:${id}`]);
    if (typeof raw !== "string" || !raw) continue;
    try {
      rows.push(JSON.parse(raw));
    } catch {
      // A bad row is skipped. It is not an approval.
    }
  }
  return rows;
}

/**
 * Mint a single-use code for this email. Does not email, does not grant access,
 * and does not add them to the allowlist. They still redeem the code at /redeem.
 * The code is returned once and is not stored.
 */
export async function approveWaitlist(command, email, now = new Date().toISOString()) {
  const who = normalizeEmail(email);
  if (!who) return { ok: false, reason: "bad" };
  const row = await loadRow(command, who);
  if (!row) return { ok: false, reason: "missing" };
  if (row.codeHash) return { ok: true, already: true };
  const code = `lead-${randomBytes(6).toString("hex")}`;
  const saved = await saveStoredInviteCode(command, code, { max: 1, lead: `w${sha256(who).slice(0, 20)}` });
  if (!saved.ok) return saved;
  row.codeHash = inviteCodeHash(code);
  row.approvedAt = now;
  await command(["SET", waitlistKey(who), JSON.stringify(row)]);
  return { ok: true, code };
}

export async function handleWaitlist(request, deps) {
  const command = await commandOf(deps);
  if (!command) return closedPage();
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    if (url.searchParams.get("done") === "1") return thanksPage();
    return formPage();
  }
  if (request.method !== "POST") return html(405, page("Waitlist · Grill", "<h1>That request isn't supported.</h1>"));
  const form = new URLSearchParams(await request.text());
  const email = normalizeEmail(form.get("email"));
  const ref = normalizeRef(form.get("ref")) || refFromCookie(request.headers.get("cookie"));
  if (!email) return formPage("That doesn't look like an email address.");
  if (form.get("confirm") !== "join") return confirmPage(email, ref);
  const key = waitlistKey(email);
  const existing = await loadRow(command, email);
  if (existing) return html(303, "", { Location: `${url.origin}/waitlist?done=1` });
  const row = { email, ref, at: new Date(deps.now ?? Date.now()).toISOString() };
  const claimed = await command(["SET", key, JSON.stringify(row), "NX"]);
  if (!claimed) return html(303, "", { Location: `${url.origin}/waitlist?done=1` });
  await command(["RPUSH", INDEX_KEY, sha256(email)]);
  await command(["INCR", WAITLIST_SIGNUPS]);
  return html(303, "", { Location: `${url.origin}/waitlist?done=1` });
}
