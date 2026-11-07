// Public copy must not state Grill's AI input costs: no judge-spend amount, no
// "of AI time", and no per-check cent. Prices a person pays ($9 a month, $90 a
// year) stay, and so does the early-tester line. The dollar caps in code stay.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMockManagement } from "../api/_mockRouter.mjs";
import { handlePro, handleProAuth, memoryStore } from "../api/_account.mjs";
import { handlePricing } from "../api/_pricing.mjs";
import { renderCheckoutError, renderWelcome } from "../api/_pro.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = join(ROOT, "server/index.mjs");

// Phrases Tony asked to take off customer-facing copy, and the same kind of
// per-check or per-key dollar cost. A price such as "$9 a month" does not match.
const FORBIDDEN = [
  [/\$\d+(?:\.\d+)? of judge spend/i, "a dollar amount of judge spend"],
  [/judge spend/i, "judge spend"],
  [/of AI time/i, "of AI time"],
  [/costs about a cent/i, "costs about a cent"],
  [/about a cent or two/i, "about a cent or two"],
  [/few dollars of credit/i, "a few dollars of credit"],
  [/\$\d+(?:\.\d+)? of credit\b/i, "a dollar amount of credit"],
  [/up to \$\d+(?:\.\d+)? of/i, "up to a dollar amount of AI use"],
];

const STARTER = "A starter key is free. No card. It includes a one-time allowance of checks for one verified email and does not refill.";
const PRO = /Each paid key includes a generous monthly allowance of checks\. It resets each month and doesn['\u2019]t roll over\./;

const ENV = {
  GRILL_PRO_TEST_MODE: "1",
  GRILL_SESSION_SECRET: "test-session-secret-32",
  OPENROUTER_MANAGEMENT_KEY: "mgmt_test",
  NODE_ENV: "test",
};

function hits(text) {
  const found = [];
  for (const [re, name] of FORBIDDEN) {
    const match = text.match(re);
    if (match) found.push(`${name} (${match[0]})`);
  }
  return found;
}

function assertClean(label, text) {
  const found = hits(text);
  assert.deepEqual(found, [], `${label} states an AI input cost: ${found.join("; ")}`);
}

function builtPages(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { cwd: ROOT, stdio: "pipe", env });
  const pages = [];
  for (const name of readdirSync(join(ROOT, "_site"), { recursive: true })) {
    const path = join(ROOT, "_site", String(name));
    if (!/\.(html|md|txt)$/.test(path)) continue;
    pages.push([String(name), readFileSync(path, "utf8")]);
  }
  return pages;
}

function deps(store, fetch, env = ENV) {
  return { env, fetch, store, now: Date.UTC(2026, 10, 7, 12, 0, 0) };
}

async function signedIn(email, d) {
  const sent = await handleProAuth(
    new Request("https://grillyour.ai/pro/auth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email }).toString(),
    }),
    d,
  );
  const link = (await sent.text()).match(/id="magic" href="([^"]+)"/)?.[1];
  const token = new URL(link, "https://grillyour.ai").searchParams.get("token");
  const authed = await handleProAuth(new Request(`https://grillyour.ai/pro/auth?token=${encodeURIComponent(token)}`), d);
  const raw = authed.headers.get("set-cookie") || "";
  const cookie = raw.match(/grill_pro=([^;]+)/);
  assert.ok(cookie, "a sign-in should set a session");
  return `grill_pro=${cookie[1]}`;
}

async function accountHtml(env, { issue = false } = {}) {
  const store = memoryStore();
  const fetch = createMockManagement();
  const d = deps(store, fetch, env);
  const cookie = await signedIn(`starter-${issue ? "on" : "off"}@example.com`, d);
  if (issue) {
    const issued = await handlePro(
      new Request("https://grillyour.ai/pro", {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ action: "starter" }).toString(),
      }),
      d,
    );
    assert.equal(issued.status, 200);
  }
  const home = await handlePro(new Request("https://grillyour.ai/pro", { headers: { cookie } }), d);
  return home.text();
}

function setupReply() {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, GRILL_KEY_FILE: join(tmpdir(), "grill-public-cost-no-key", "key") },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && waiting.has(msg.id)) waiting.get(msg.id)(msg);
    }
  });
  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 8000);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  return (async () => {
    try {
      await request(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
      const res = await request(2, "tools/call", { name: "grill", arguments: { subject: "Raise prices or hold them." } });
      return res.result.content.map((part) => part.text).join("\n");
    } finally {
      child.kill("SIGKILL");
    }
  })();
}

describe("public copy states no AI input cost", () => {
  it("fails when a rendered page or the install copy states a per-check or per-key dollar cost", async () => {
    const problems = [];
    const check = (label, text) => {
      for (const hit of hits(text)) problems.push(`${label}: ${hit}`);
    };

    for (const [name, html] of builtPages({ GRILL_MISS: "1" })) check(`site ${name}`, html);
    for (const [name, html] of builtPages({ GRILL_STARTER_ALLOWANCE_USD: "1.25", GRILL_PRO_BILLING: "subscription" })) {
      check(`site with a custom allowance ${name}`, html);
    }

    for (const limitUsd of [0.5, 1.25, 3, 12]) {
      check(`welcome $${limitUsd}`, renderWelcome({ state: "issued", key: "sk-or-v1-test", limitUsd }, {}));
    }
    for (const state of ["ready", "already", "unpaid", "expired", "invalid", "error"]) {
      check(`welcome ${state}`, renderWelcome({ state, key: "sk-or-v1-test", limitUsd: 3 }, {}));
    }
    for (const state of ["invalid", "unconfigured", "billing-off"]) check(`checkout ${state}`, renderCheckoutError(state));

    check("starter offer", await accountHtml(ENV));
    check("starter offer at $1.25", await accountHtml({ ...ENV, GRILL_STARTER_ALLOWANCE_USD: "1.25" }));
    check("starter key on", await accountHtml(ENV, { issue: true }));

    const pricing = await handlePricing(new Request("https://grillyour.ai/pricing"), { env: ENV, fetch: () => Promise.reject(new Error("no network")) });
    check("pricing", await pricing.text());

    check("readme", readFileSync(join(ROOT, "README.md"), "utf8"));
    check("extension manifest", readFileSync(join(ROOT, "manifest.json"), "utf8"));
    check("plugin manifest", readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
    check("setup reply", await setupReply());

    assert.deepEqual(problems, []);
  });

  it("keeps the approved allowance wording, and keeps the prices a person pays", async () => {
    const terms = builtPages().find(([name]) => name === "terms/index.html")?.[1] || "";
    assert.match(terms, new RegExp(STARTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(terms, PRO);
    assert.match(terms, /\$9 a month or \$90 a year/);
    assert.match(terms, /\$5 of use each month/);

    const welcome = renderWelcome({ state: "issued", key: "sk-or-v1-test", limitUsd: 3 }, {});
    assert.match(welcome, PRO);
    assert.doesNotMatch(welcome, /\$3/);

    const offer = await accountHtml({ ...ENV, GRILL_STARTER_ALLOWANCE_USD: "1.25" });
    assert.match(offer, new RegExp(STARTER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(offer, /\$1\.25/);

    const pricing = await handlePricing(new Request("https://grillyour.ai/pricing"), { env: ENV, fetch: () => Promise.reject(new Error("no network")) });
    const html = await pricing.text();
    assert.match(html, /\$9 a month/);
    assert.match(html, /\$90 a year/);
  });
});
