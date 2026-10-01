// Privacy invariants. Each test pins a promise docs/PRIVACY.md makes, so the promise can't
// quietly stop being true.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeMasked, redactSensitive } from "./judgeCore.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import { PING_URL, sendUsagePing, usageStatsEnabled } from "./usageStats.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USABLE = readFileSync(join(ROOT, "scripts/fixtures/usable-response.json"), "utf8");

describe("secrets never leave", () => {
  const secrets = {
    "an API key (sk-…)": "sk-or-v1-0123456789abcdef0123456789abcdef",
    "a Stripe key": "sk_live_abcdefghijklmnop1234",
    "a GitHub token": "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "an AWS access key": "AKIAABCDEFGHIJKLMNOP",
    "a Slack token": "xoxb-1234567890-abcdefghij",
    "a Google API key": "AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "a JSON web token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "a private key": "-----BEGIN RSA PRIVATE KEY-----",
  };
  for (const [label, value] of Object.entries(secrets)) {
    it(`finds ${label}`, () => {
      assert.ok(redactSensitive(`our plan: use ${value} in prod`).secrets.includes(label));
    });
  }

  it("leaves ordinary decision prose alone", () => {
    const prose =
      "We raise prices 20% on 2026-10-01 for Q4 2026, from $1,234 to $1,480, and expect churn under 3% by week 6. Ticket PRJ-2211 tracks it.";
    const r = redactSensitive(prose);
    assert.deepEqual(r.secrets, []);
    assert.equal(r.text, prose);
    assert.deepEqual(r.masked, { email: 0, phone: 0, card: 0 });
  });
});

describe("contact details are masked", () => {
  it("masks emails, phone numbers and Luhn-valid card numbers, and counts them", () => {
    const r = redactSensitive(
      "Ask jane.doe+ops@example.com or call (212) 555-0100, 212-555-0199 or +44 20 7946 0958. Card 4111 1111 1111 1111.",
    );
    assert.equal(
      r.text,
      "Ask [email] or call [phone], [phone] or [phone]. Card [card number].",
    );
    assert.deepEqual(r.masked, { email: 1, phone: 3, card: 1 });
  });

  it("does not mask a number that fails the card checksum", () => {
    assert.equal(redactSensitive("PO 1234 5678 9012 3456").masked.card, 0);
  });

  it("describes what was masked without the values", () => {
    assert.equal(describeMasked({ email: 2, phone: 1, card: 0 }), "2 email addresses, 1 phone number");
    assert.equal(describeMasked({ email: 0, phone: 0, card: 0 }), "");
  });
});

/** Run the judge CLI against a loopback OpenRouter that records what it receives. */
async function runAgainstLoopback(subject) {
  const seen = [];
  const fake = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      seen.push(body);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(USABLE);
    });
  });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const out = join(mkdtempSync(join(tmpdir(), "grill-privacy-")), "report.md");
  const child = spawn(process.execPath, [join(ROOT, "scripts/judge.mjs"), "--json", "--out", out], {
    env: {
      PATH: process.env.PATH,
      OPENROUTER_API_KEY: "sk-or-v1-test-key-for-loopback-only-000000",
      JUDGE_OPENROUTER_URL: `http://127.0.0.1:${fake.address().port}/api/v1/chat/completions`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.resume();
  child.stdin.end(subject);
  const code = await new Promise((r) => child.on("close", r));
  fake.close();
  let report = "";
  try {
    report = readFileSync(out, "utf8");
  } catch {
    // no report when the run was refused
  }
  return { code, stderr, seen, report };
}

describe("the judge applies it before any network call", () => {
  it("refuses a subject with a key: exit 1, and OpenRouter receives nothing", async () => {
    const r = await runAgainstLoopback("Decision: rotate sk-or-v1-0123456789abcdef0123456789abcdef weekly.");
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Nothing was sent/);
    assert.equal(r.seen.length, 0);
    assert.ok(!r.stderr.includes("0123456789abcdef"), "the error never echoes the secret");
  });

  it("sends the masked text, and the report says what was masked", async () => {
    const r = await runAgainstLoopback("Decision: hire the candidate at sam@example.com, phone 415-555-0123.");
    assert.equal(r.code, 0);
    assert.equal(r.seen.length >= 1, true);
    assert.ok(!r.seen.join("").includes("sam@example.com"), "the address never reached OpenRouter");
    assert.ok(!r.seen.join("").includes("415-555-0123"), "the phone never reached OpenRouter");
    assert.ok(r.seen.join("").includes("[email]"));
    assert.match(r.report, /masked before sending: 1 email address, 1 phone number/);
  });
});

describe("the judge still talks only to OpenRouter", () => {
  const build = readFileSync(join(ROOT, "scripts/build-extension.mjs"), "utf8");
  const shipped = JSON.parse(build.match(/const FILES = (\[[^\]]+\])/)[1]).filter((f) => f.endsWith(".mjs"));

  it("ships the server, the judge, the check's pure core and the opt-in ping, and nothing else runnable", () => {
    assert.deepEqual(shipped.sort(), [
      "scripts/checkCore.mjs",
      "scripts/judge.mjs",
      "scripts/judgeCore.mjs",
      "scripts/reflection.mjs",
      "scripts/usageStats.mjs",
      "server/index.mjs",
    ]);
  });

  it("imports only Node built-ins and its own files: no third-party code at all", () => {
    for (const f of shipped) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const [, spec] of src.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)) {
        assert.ok(spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"), `${f} imports ${spec}`);
      }
    }
  });

  // The old pin was "exactly one fetch, in the judge". That was the one-destination promise.
  // Opt-in stats add one call, and only that call: the judge's fetch stays on OpenRouter.
  it("has no raw network modules; the judge's one fetch stays put, and the only other call is the opt-in ping", () => {
    let judgeFetches = 0;
    let pingCalls = 0;
    for (const f of shipped) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.doesNotMatch(src, /["']node:(?:http|https|http2|net|tls|dgram|dns)["']/, `${f} imports a network module`);
      assert.doesNotMatch(src, /\b(?:XMLHttpRequest|WebSocket)\b/, `${f} opens another channel`);
      const fetches = (src.match(/\bfetch\(/g) ?? []).length;
      const pings = (src.match(/\bfetchImpl\(/g) ?? []).length;
      if (fetches > 0) assert.equal(f, "scripts/judge.mjs", `${f} calls fetch`);
      if (pings > 0) assert.equal(f, "scripts/usageStats.mjs", `${f} sends the ping`);
      judgeFetches += fetches;
      pingCalls += pings;
    }
    assert.equal(judgeFetches, 1);
    assert.equal(pingCalls, 1);
    const ping = readFileSync(join(ROOT, "scripts/usageStats.mjs"), "utf8");
    assert.match(ping, /^export const PING_URL = "https:\/\/grillyour\.ai\/api\/ping";$/m);
    assert.deepEqual(
      [...new Set([...ping.matchAll(/https?:\/\/[^\s"'`]+/g)].map((m) => m[0]))],
      ["https://grillyour.ai/api/ping"],
    );
    const call = readFileSync(join(ROOT, "server/index.mjs"), "utf8").match(/scheduleUsagePing\(\{[\s\S]*?\}\);/);
    assert.ok(call, "the server schedules the ping");
    assert.doesNotMatch(call[0], /subject|report|question|stderr|GRILL_API_KEY/);
  });

  it("that one fetch can reach only the two OpenRouter endpoints, or loopback in tests, and nothing else", () => {
    const judge = readFileSync(join(ROOT, "scripts/judge.mjs"), "utf8");

    // The two destinations, each spelled out exactly once.
    assert.match(judge, /^const OPENROUTER_DEFAULT_URL = "https:\/\/openrouter\.ai\/api\/v1\/chat\/completions";$/m);
    assert.match(judge, /^const DECISIONS_DEFAULT_URL = "https:\/\/openrouter\.ai\/api\/alpha\/decisions";$/m);

    // Each reaches the code only through the loopback guard, assigned once.
    assert.match(judge, /^const OPENROUTER_URL = resolveEndpoint\("JUDGE_OPENROUTER_URL", process\.env\.JUDGE_OPENROUTER_URL, OPENROUTER_DEFAULT_URL\);$/m);
    assert.match(judge, /^const DECISIONS_URL = resolveEndpoint\("JUDGE_DECISIONS_URL", process\.env\.JUDGE_DECISIONS_URL, DECISIONS_DEFAULT_URL\);$/m);
    assert.equal((judge.match(/\bOPENROUTER_URL =/g) ?? []).length, 1);
    assert.equal((judge.match(/\bDECISIONS_URL =/g) ?? []).length, 1);
    assert.match(judge, /if \(!LOOPBACK_HOSTS\.has\(host\)\)/);

    // The one fetch takes its URL from its helper's parameter, and follows no redirect...
    assert.deepEqual([...judge.matchAll(/\bfetch\(([^,]+),/g)].map((m) => m[1]), ["url"]);
    assert.match(judge, /^async function postJson\(url, body, timeoutMs\) \{$/m);
    assert.match(judge, /redirect: "error",/);

    // ...and every call of that helper passes one of the two resolved endpoints: nothing else.
    const firstArgs = [...judge.matchAll(/\bpostJson\(([^,)]*)/g)].map((m) => m[1].trim());
    assert.deepEqual(firstArgs.sort(), ["DECISIONS_URL", "OPENROUTER_URL", "url"]);

    // Any other URL in the file is prose, in a comment, never something a request could use.
    for (const line of judge.split("\n").filter((l) => /https?:\/\//.test(l))) {
      const code = line.trim();
      const isNamedUrl =
        code.startsWith("const OPENROUTER_DEFAULT_URL = ") ||
        code.startsWith("const DECISIONS_DEFAULT_URL = ") ||
        code.startsWith("const APP_REFERER = ");
      assert.ok(isNamedUrl || /^(\*|\/\/|\/\*\*)/.test(code), `a URL outside a comment: ${code}`);
    }
    for (const f of ["scripts/judgeCore.mjs", "scripts/checkCore.mjs"]) {
      assert.doesNotMatch(readFileSync(join(ROOT, f), "utf8"), /https?:\/\//, `${f} names a URL`);
    }
  });
});

describe("the quality check is a second destination, and nothing more", () => {
  it("follows no redirect on either path, so the write-up never reaches a host the code did not name", async () => {
    let sinkHits = 0;
    const sink = createServer((req, res) => {
      sinkHits += 1;
      req.resume();
      res.end("{}");
    });
    await new Promise((r) => sink.listen(0, "127.0.0.1", r));
    const elsewhere = `http://127.0.0.1:${sink.address().port}/collect`;

    const run = async (fake) => {
      try {
        const child = spawn(process.execPath, [join(ROOT, "scripts/judge.mjs"), "--check", "--json"], {
          env: { PATH: process.env.PATH, OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env },
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.resume();
        child.stdin.end("Decision: raise prices 20% in Q4.");
        const code = await new Promise((r) => child.on("close", r));
        return { code, result: JSON.parse(stdout) };
      } finally {
        await fake.close();
      }
    };

    // Closed in `finally`: an open server keeps this file's process alive, so a failing
    // assertion would otherwise hang the suite instead of failing it.
    try {
      // The check's path redirects: the check is unavailable, the grill is intact.
      const a = await run(await startFakeOpenRouter({ decisions: () => ({ redirect: elsewhere }) }));
      assert.equal(a.code, 0);
      assert.equal(a.result.verdict, "weak");
      assert.match(a.result.quality.unavailable, /unexpected redirect/);

      // The judge's path redirects: every link fails, degraded, and the check sends nothing.
      const b = await run(await startFakeOpenRouter({ chat: () => ({ redirect: elsewhere }) }));
      assert.equal(b.code, 0);
      assert.equal(b.result.verdict, null);
      assert.ok(b.result.degraded.some((d) => /no response from OpenRouter/.test(d)));
    } finally {
      sink.closeAllConnections?.();
      await new Promise((r) => sink.close(r));
    }
    assert.equal(sinkHits, 0, "a redirect target received a request");
  });

  it("refuses a --check-flaw text that holds a key: exit 1, and neither destination receives anything", async () => {
    const fake = await startFakeOpenRouter();
    let code;
    let stderr = "";
    try {
      const child = spawn(
        process.execPath,
        [join(ROOT, "scripts/judge.mjs"), "--check", "--check-flaw", "leaks sk-or-v1-0123456789abcdef0123456789abcdef"],
        { env: { PATH: process.env.PATH, OPENROUTER_API_KEY: "test-key-loopback-only", ...fake.env }, stdio: ["pipe", "pipe", "pipe"] },
      );
      child.stderr.on("data", (d) => (stderr += d));
      child.stdout.resume();
      child.stdin.end("Decision: raise prices.");
      code = await new Promise((r) => child.on("close", r));
    } finally {
      await fake.close();
    }

    assert.equal(code, 1);
    assert.match(stderr, /Nothing was sent/);
    assert.ok(!stderr.includes("0123456789abcdef"), "the error never echoes the secret");
    assert.equal(fake.seen.chat.length + fake.seen.decisions.length, 0);
  });
});

const CANARY = "CANARY-writeup-9f3a2c-do-not-send";
const PING_KEYS = ["v", "id", "ver", "client", "route", "ok", "ms", "ts"];

function connectServer(env) {
  const child = spawn(process.execPath, [join(ROOT, "server/index.mjs")], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  let buffer = "";
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      }
    }
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 8_000);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const close = () =>
    new Promise((resolve) => {
      child.on("close", resolve);
      child.stdin.end();
    });
  return { request, close, stderr: () => stderr };
}

async function startPingSink({ hang = false } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => {
      raw += d;
    });
    req.on("end", () => {
      seen.push({ url: req.url, body: raw, host: req.headers.host });
      if (hang) return;
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    seen,
    url: `http://127.0.0.1:${server.address().port}/api/ping`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

async function waitForPing(seen, ms = 2_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (seen.length > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

describe("anonymous usage stats", () => {
  it("defaults to off in every install config", () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
    const plugin = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8"));
    const mcp = JSON.parse(readFileSync(join(ROOT, ".mcp.json"), "utf8"));
    assert.equal(manifest.user_config.usage_stats.type, "boolean");
    assert.equal(manifest.user_config.usage_stats.default, false);
    assert.equal(plugin.userConfig.usage_stats.default, false);
    assert.equal(manifest.server.mcp_config.env.GRILL_USAGE_STATS, "${user_config.usage_stats}");
    assert.equal(mcp.mcpServers.grill.env.GRILL_USAGE_STATS, "${user_config.usage_stats}");
    const yaml = readFileSync(join(ROOT, "smithery.yaml"), "utf8");
    assert.match(yaml, /GRILL_USAGE_STATS: config\.usageStats === true \? "true" : "false"/);
    assert.equal(usageStatsEnabled({}), false);
    assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: "${user_config.usage_stats}" }), false);
  });

  it("when off, a finished grill makes no request to grillyour.ai and creates no state file", async () => {
    const fake = await startFakeOpenRouter();
    const ping = await startPingSink();
    const homes = [];
    try {
      const cases = [
        {},
        { GRILL_USAGE_STATS: "" },
        { GRILL_USAGE_STATS: "${user_config.usage_stats}" },
        { GRILL_USAGE_STATS: "false" },
        { GRILL_USAGE_STATS: "true", GRILL_PING: "off" },
        { GRILL_USAGE_STATS: "true", DO_NOT_TRACK: "1" },
      ];
      for (const extra of cases) {
        const home = mkdtempSync(join(tmpdir(), "grill-privacy-home-"));
        homes.push(home);
        const client = connectServer({
          GRILL_API_KEY: "sk-or-v1-test-key-never-echoed",
          GRILL_CHECK: "false",
          GRILL_NEWS: "off",
          GRILL_PING_URL: ping.url,
          HOME: home,
          ...fake.env,
          ...extra,
        });
        try {
          await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
          const res = await client.request("tools/call", {
            name: "grill",
            arguments: { subject: `Decision: keep the canary ${CANARY} off the wire.` },
          });
          assert.equal(res.result.isError, false, JSON.stringify(extra));
          await new Promise((resolve) => setTimeout(resolve, 150));
          assert.equal(ping.seen.length, 0, JSON.stringify(extra));
          assert.equal(existsSync(join(home, ".grill", "usage-stats.json")), false, JSON.stringify(extra));
        } finally {
          await client.close();
        }
      }
      assert.ok(fake.seen.chat.length >= 1, "the judge still called OpenRouter");
      assert.ok(fake.seen.chat.some((call) => call.raw.includes(CANARY)));
      assert.equal(fake.seen.other.length, 0);
    } finally {
      await fake.close();
      await ping.close();
      for (const home of homes) rmSync(home, { recursive: true, force: true });
    }
  });

  it("when on, the ping body is only the allowed keys and never the write-up", async () => {
    const calls = [];
    const dir = mkdtempSync(join(tmpdir(), "grill-privacy-state-"));
    let sent = false;
    try {
      sent = await sendUsagePing({
        ok: true,
        ms: 150,
        version: "0.1.1",
        env: {
          GRILL_USAGE_STATS: "true",
          GRILL_CLIENT: "mcpb",
          GRILL_ROUTE: "one_click",
          subject: CANARY,
          OPENROUTER_API_KEY: "sk-or-v1-secret-canary",
        },
        now: Date.parse("2026-10-01T12:00:00Z"),
        stateFile: join(dir, "usage-stats.json"),
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), body: init.body });
          return { status: 204, body: { cancel: async () => {} } };
        },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(sent, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PING_URL);
    assert.equal(calls[0].url, "https://grillyour.ai/api/ping");
    const body = JSON.parse(calls[0].body);
    assert.deepEqual(Object.keys(body), PING_KEYS);
    assert.equal(calls[0].body.includes(CANARY), false);
    assert.equal(calls[0].body.includes("sk-or"), false);
    for (const banned of ["subject", "question", "verdict", "challenge", "email", "model"]) {
      assert.equal(Object.hasOwn(body, banned), false, banned);
    }
  });

  it("a real grill opted in pings loopback with no canary, and does not ping again the same week", async () => {
    const fake = await startFakeOpenRouter();
    const ping = await startPingSink();
    const home = mkdtempSync(join(tmpdir(), "grill-privacy-on-"));
    const client = connectServer({
      GRILL_API_KEY: "sk-or-v1-test-key-never-echoed",
      GRILL_CHECK: "false",
      GRILL_NEWS: "off",
      GRILL_USAGE_STATS: "true",
      GRILL_CLIENT: "mcpb",
      GRILL_ROUTE: "one_click",
      GRILL_PING_URL: ping.url,
      HOME: home,
      ...fake.env,
    });
    try {
      await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
      const subject = `Decision: ship ${CANARY} next week if the test holds.`;
      const first = await client.request("tools/call", { name: "grill", arguments: { subject } });
      assert.equal(first.result.isError, false);
      const text = first.result.content.map((part) => part.text).join("\n");
      assert.equal(text.includes("/api/ping"), false);
      assert.equal(await waitForPing(ping.seen), true);
      assert.equal(ping.seen.length, 1);
      assert.equal(ping.seen[0].url, "/api/ping");
      assert.equal(ping.seen[0].host.startsWith("127.0.0.1"), true);
      const body = JSON.parse(ping.seen[0].body);
      assert.deepEqual(Object.keys(body), PING_KEYS);
      assert.equal(body.v, "1");
      assert.equal(body.client, "mcpb");
      assert.equal(body.route, "one_click");
      assert.equal(body.ok, true);
      assert.equal(body.ms % 100, 0);
      assert.equal(ping.seen[0].body.includes(CANARY), false);
      assert.equal(text.includes(body.id), false);
      assert.equal(client.stderr().includes(body.id), false);
      assert.equal(client.stderr().includes("/api/ping"), false);
      const statePath = join(home, ".grill", "usage-stats.json");
      const state = JSON.parse(readFileSync(statePath, "utf8"));
      assert.deepEqual(Object.keys(state).sort(), ["firstSentDay", "id"]);
      assert.equal(state.id, body.id);
      assert.match(state.firstSentDay, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(JSON.stringify(state).includes(CANARY), false);
      assert.equal(statSync(statePath).mode & 0o777, 0o600);
      assert.ok(fake.seen.chat.some((call) => call.raw.includes(CANARY)), "the judge still received the write-up");
      assert.equal(fake.seen.chat.every((call) => call.url.startsWith("/api/v1/chat/completions")), true);

      const second = await client.request("tools/call", { name: "grill", arguments: { subject } });
      assert.equal(second.result.isError, false);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(ping.seen.length, 1, "a later grill does not ping again");
    } finally {
      await client.close();
      await fake.close();
      await ping.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not hold the report for a ping that never answers", async () => {
    const fake = await startFakeOpenRouter();
    const ping = await startPingSink({ hang: true });
    const home = mkdtempSync(join(tmpdir(), "grill-privacy-hang-"));
    const client = connectServer({
      GRILL_API_KEY: "sk-or-v1-test-key-never-echoed",
      GRILL_CHECK: "false",
      GRILL_NEWS: "off",
      GRILL_USAGE_STATS: "true",
      GRILL_PING_URL: ping.url,
      HOME: home,
      ...fake.env,
    });
    try {
      await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
      const started = Date.now();
      const res = await client.request("tools/call", {
        name: "grill",
        arguments: { subject: "Decision: return before the ping does." },
      });
      assert.equal(res.result.isError, false);
      assert.ok(Date.now() - started < 3_000, "the grill waited for the ping");
    } finally {
      await client.close();
      await fake.close();
      await ping.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
