#!/usr/bin/env node
/**
 * Local Grill Pro, with test mode on, so the account flow can be tried before Stripe.
 *
 *   GRILL_SESSION_SECRET=replace-me node scripts/pro-dev-server.mjs
 *
 * Test mode is forced on here, and this process is not a production deploy.
 * OpenRouter's key API is mocked in this process. The sample grill uses loopback.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createMockManagement } from "../api/_mockRouter.mjs";
import { GET as proGet, POST as proPost } from "../api/pro.js";
import { GET as authGet, POST as authPost } from "../api/pro-auth.js";
import { GET as tryGet, POST as tryPost } from "../api/pro-try.js";
import { GET as reportsGet, POST as reportsPost } from "../api/pro-reports.js";
import { GET as welcomeGet, POST as welcomePost } from "../api/welcome.js";
import { GET as checkoutGet } from "../api/checkout.js";
import { POST as webhookPost } from "../api/stripe-webhook.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.VERCEL_ENV;
if (process.env.NODE_ENV === "production") delete process.env.NODE_ENV;
process.env.GRILL_PRO_TEST_MODE = "1";
process.env.GRILL_SESSION_SECRET ||= "dev-only-session-secret-change-me";
process.env.OPENROUTER_MANAGEMENT_KEY ||= "mgmt_test_mode";
process.env.GRILL_PRO_STORE ||= join(tmpdir(), "grill-pro-browser.json");

const mock = createMockManagement();
const realFetch = globalThis.fetch.bind(globalThis);
const wrapped = async (url, init) => {
  if (String(url).startsWith("https://openrouter.ai/api/v1/keys")) return mock(url, init);
  return realFetch(url, init);
};
wrapped.noteUsage = mock.noteUsage;
globalThis.fetch = wrapped;

execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "inherit" });

const port = Number(process.env.PORT) || 4173;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function web(req) {
  const host = req.headers.host || `127.0.0.1:${port}`;
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await readBody(req);
  return new Request(url, init);
}

const routes = {
  "GET /pro": proGet,
  "POST /pro": proPost,
  "GET /pro/auth": authGet,
  "POST /pro/auth": authPost,
  "GET /pro/try": tryGet,
  "POST /pro/try": tryPost,
  "GET /pro/reports": reportsGet,
  "POST /pro/reports": reportsPost,
  "GET /welcome": welcomeGet,
  "POST /welcome": welcomePost,
  "GET /checkout": checkoutGet,
  "POST /api/stripe-webhook": webhookPost,
};

function staticPage(path) {
  const html = readFileSync(path, "utf8").replace(
    "<body>",
    `<body><p style="max-width:44rem;margin:0 auto;padding:12px 20px 0;font:600 0.95rem system-ui">Test mode: <a href="/pro">open Grill Pro</a> to simulate a purchase without Stripe.</p>`,
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const key = `${req.method} ${url.pathname.replace(/\/$/, "") || "/"}`;
  try {
    let response;
    if (routes[key]) response = await routes[key](await web(req));
    else if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) response = staticPage(join(ROOT, "_site/index.html"));
    else if (req.method === "GET" && url.pathname.replace(/\/$/, "") === "/terms") response = staticPage(join(ROOT, "_site/terms/index.html"));
    else response = new Response("not found", { status: 404 });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Grill Pro test mode: http://127.0.0.1:${port}/pro`);
  console.log(`Account file: ${process.env.GRILL_PRO_STORE}`);
});
