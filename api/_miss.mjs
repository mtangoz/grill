// grillyour.ai/miss/send: a miss card goes into a private queue for maintainers.
//
// Off unless GRILL_MISS=1. Takes only the card's fields, checks them again on the server (the
// page's check against the person's real text runs in their browser and is never sent), and
// stores the card with the UTC day only: no IP, no account, no install id, no user agent.
// Nothing is published from the queue. A maintainer turns a card into a synthetic eval case.
import { checkMissCard, normaliseMissCard } from "../scripts/missCore.mjs";
import { redisCommand } from "./_account.mjs";

export const MISS_QUEUE_KEY = "grill:miss:queue";
export const MISS_QUEUE_MAX = 5000;
const DEFAULT_DAILY_CAP = 100;

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function escape(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function page(status, title, body) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 16px;color:#1d1b19;background:#fbf8f3}a{color:#b2401c}@media (prefers-color-scheme:dark){body{color:#f1ece4;background:#191714}a{color:#f08a5d}}</style></head>
<body><h1>${escape(title)}</h1>${body}<p><a href="/miss/">Back to the form</a> · <a href="/">Grill</a></p></body></html>`;
  return new Response(html, { status, headers: HEADERS });
}

export function missEnabled(env = {}) {
  return env.GRILL_MISS === "1" && Boolean(env.UPSTASH_REDIS_REST_URL) && Boolean(env.UPSTASH_REDIS_REST_TOKEN);
}

function dailyCap(env) {
  const n = Number.parseInt(env.GRILL_MISS_DAILY_CAP ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export async function handleMiss(request, { env = {}, fetch: fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!missEnabled(env)) {
    return page(503, "Not open yet", "<p>Sharing a miss isn't switched on yet. Nothing was sent.</p>");
  }
  if (request.method !== "POST") {
    return new Response(null, { status: 303, headers: { Location: "/miss/", "Cache-Control": "no-store" } });
  }
  const form = new URLSearchParams(await request.text());
  if (form.get("leave_blank")) return page(200, "Thanks", "<p>Got it.</p>");

  const fields = {};
  for (const [key, value] of form) fields[key] = value;
  const card = normaliseMissCard(fields);
  const { ok, problems } = checkMissCard(card);
  if (!ok) {
    const list = problems.map((p) => `<li><strong>${escape(p.field)}</strong>: ${escape(p.reason)}</li>`).join("");
    return page(422, "Not sent yet", `<p>Nothing was stored. Fix these and send again:</p><ul>${list}</ul>`);
  }

  const redis = redisCommand(env, fetchImpl);
  const day = utcDay(now);
  try {
    const count = await redis(["INCR", `grill:miss:count:${day}`]);
    if (count === 1) await redis(["EXPIRE", `grill:miss:count:${day}`, 172800]);
    if (Number(count) > dailyCap(env)) {
      return page(429, "Full for today", "<p>Grill has had all the misses it can read today. Nothing was stored. Try again tomorrow.</p>");
    }
    await redis(["LPUSH", MISS_QUEUE_KEY, JSON.stringify({ v: 1, day, ...card })]);
    await redis(["LTRIM", MISS_QUEUE_KEY, 0, MISS_QUEUE_MAX - 1]);
  } catch {
    console.error("[grill-miss] store 0");
    return page(503, "Not sent", "<p>Grill couldn't store it just now. Nothing was kept. Try again in a minute.</p>");
  }
  return page(
    200,
    "Thanks. That helps.",
    "<p>Your miss card is in a private queue. Only Grill's maintainers read it. It holds no IP address, no account and no install ID. A maintainer turns it into a made-up test case that the judge has to catch. Nothing from it is published as you wrote it.</p>",
  );
}
