// Privacy invariants. Each test pins a promise docs/PRIVACY.md makes, so the promise can't
// quietly stop being true.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeMasked, redactSensitive } from "./judgeCore.mjs";

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

describe("the code users install can talk to one place: OpenRouter", () => {
  const build = readFileSync(join(ROOT, "scripts/build-extension.mjs"), "utf8");
  const shipped = JSON.parse(build.match(/const FILES = (\[[^\]]+\])/)[1]).filter((f) => f.endsWith(".mjs"));

  it("ships the server and the judge, and nothing else runnable", () => {
    assert.deepEqual(shipped.sort(), ["scripts/judge.mjs", "scripts/judgeCore.mjs", "server/index.mjs"]);
  });

  it("imports only Node built-ins and its own files: no third-party code at all", () => {
    for (const f of shipped) {
      const src = readFileSync(join(ROOT, f), "utf8");
      for (const [, spec] of src.matchAll(/^\s*import[^"']*["']([^"']+)["']/gm)) {
        assert.ok(spec.startsWith("node:") || spec.startsWith("./") || spec.startsWith("../"), `${f} imports ${spec}`);
      }
    }
  });

  it("has no raw network modules, and exactly one fetch, in the judge", () => {
    let fetches = 0;
    for (const f of shipped) {
      const src = readFileSync(join(ROOT, f), "utf8");
      assert.doesNotMatch(src, /["']node:(?:http|https|http2|net|tls|dgram|dns)["']/, `${f} imports a network module`);
      assert.doesNotMatch(src, /\b(?:XMLHttpRequest|WebSocket)\b/, `${f} opens another channel`);
      const n = (src.match(/\bfetch\(/g) ?? []).length;
      if (n > 0) assert.equal(f, "scripts/judge.mjs", `${f} calls fetch`);
      fetches += n;
    }
    assert.equal(fetches, 1);
  });

  it("that one fetch targets OpenRouter, or loopback in tests, and nothing else", () => {
    const judge = readFileSync(join(ROOT, "scripts/judge.mjs"), "utf8");
    assert.match(judge, /const OPENROUTER_DEFAULT_URL = "https:\/\/openrouter\.ai\/api\/v1\/chat\/completions";/);
    assert.match(judge, /fetch\(OPENROUTER_URL,/);
    assert.match(judge, /LOOPBACK_HOSTS/);
  });
});
