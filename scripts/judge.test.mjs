// End-to-end tests for judge.mjs, the outside judge's CLI.
//
// node:test + node:assert only, no dependencies. Every case here either replays a saved
// response through JUDGE_FIXTURE or talks to a loopback HTTP server this file starts
// itself — nothing reaches the real network and no real API key is ever required.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "judge.mjs");
const FIXTURES = join(HERE, "fixtures");

/**
 * Run the CLI as a real child process. `stdinText`, when given, is written and the pipe
 * closed; when omitted, stdin is `"ignore"`-d so a run that never touches stdin (the usual
 * case here) cannot hang waiting for an EOF nobody is going to send.
 */
function runCli(args, env, stdinText) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env,
      stdio: [stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (stdinText !== undefined) {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

/**
 * A clean environment for one run: starts from the real `process.env` (so PATH etc. still
 * work) but clears every variable this CLI reads, then layers the caller's overrides on
 * top. Without this, a variable already set in the *test runner's* environment (or left
 * behind by an earlier test) could silently change what a later test exercises.
 */
function envFor(overrides = {}) {
  const env = { ...process.env };
  for (const k of ["OPENROUTER_API_KEY", "JUDGE_FIXTURE", "JUDGE_MODEL", "JUDGE_TIMEOUT_MS", "JUDGE_OPENROUTER_URL"]) {
    delete env[k];
  }
  return { ...env, ...overrides };
}

function tmpFile(prefix, name, content) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

// ---------------------------------------------------------------------------
describe("a usable tool call", () => {
  it("gives exit 0, a verdict in --json, and the report written with --out", async () => {
    const subjectPath = tmpFile("judge-subject-", "subject.md", "# A plan\n\nShip the smaller change first.\n");
    const outPath = join(dirname(subjectPath), "report.md");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });

    const { code, stdout, stderr } = await runCli(["--file", subjectPath, "--out", outPath, "--json"], env);

    assert.equal(code, 0);
    assert.match(stderr, /report written to/);
    const result = JSON.parse(stdout);
    assert.equal(result.verdict, "weak");
    assert.equal(result.challenges.length, 1);
    assert.equal(result.servedModel, "openai/gpt-5.6-sol");
    assert.equal(result.decorrelated, true);
    assert.equal(result.subjectLabel, subjectPath);

    const report = readFileSync(outPath, "utf8");
    assert.match(report, /^# 🔥 Grill —/);
    assert.match(report, /WEAK/);
  });
});

// ---------------------------------------------------------------------------
describe("a response with no tool call", () => {
  it("walks the whole chain and ends degraded rather than crashing or hanging", async () => {
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "no-tool-call-response.json") });

    const { code, stdout, stderr } = await runCli(["--text", "a claim to judge", "--json"], env);

    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.verdict, null);
    assert.ok(result.degraded.some((d) => /no tool call/.test(d)));
    // The fixture is replayed for every attempt, so the default 3-link chain is walked in
    // full: two advances logged (link1->link2, link2->link3), then the last link is never
    // abandoned, whatever it returns.
    assert.equal((stderr.match(/chain advance:/g) ?? []).length, 2);
  });
});

// ---------------------------------------------------------------------------
describe("a served model from the excluded author family", () => {
  it("is reported as NOT an independent review, not silently accepted", async () => {
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "anthropic-served-response.json") });

    const { code, stdout } = await runCli(["--text", "a claim", "--json"], env);

    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.decorrelated, false);
    assert.ok(result.degraded.some((d) => /NOT AN INDEPENDENT REVIEW/.test(d)));
  });
});

// ---------------------------------------------------------------------------
describe("OPENROUTER_API_KEY", () => {
  it("is required on a real run and its absence exits 1", async () => {
    const { code, stderr } = await runCli(["--text", "a claim"], envFor({}));
    assert.equal(code, 1);
    assert.match(stderr, /OPENROUTER_API_KEY/);
  });

  it("is NOT required with a fixture", async () => {
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });
    const { code } = await runCli(["--text", "a claim"], env);
    assert.equal(code, 0);
  });

  it("is NOT required with --dry-run", async () => {
    const { code } = await runCli(["--text", "a claim", "--dry-run"], envFor({}));
    assert.equal(code, 0);
  });
});

// ---------------------------------------------------------------------------
// THE OVERRIDE IS A TEST SEAM, NOT AN EXFILTRATION PRIMITIVE. Every request carries
// `Authorization: Bearer $OPENROUTER_API_KEY`, so an override that accepted any host would
// send the subject AND a live credential wherever it pointed.
describe("JUDGE_OPENROUTER_URL", () => {
  it("refuses a non-loopback host and does not fall back silently", async () => {
    const env = envFor({ JUDGE_OPENROUTER_URL: "https://attacker.example/collect" });
    const { code, stderr, stdout } = await runCli(["--text", "a claim", "--dry-run"], env);
    assert.notEqual(code, 0);
    assert.match(stderr, /must point at loopback/);
    // The refusal must be the end of it — no payload may be printed for a rejected endpoint.
    assert.ok(!stdout.includes("would POST"));
  });

  it("accepts a loopback host", async () => {
    const env = envFor({ JUDGE_OPENROUTER_URL: "http://127.0.0.1:9/x" });
    const { code, stdout } = await runCli(["--text", "a claim", "--dry-run"], env);
    assert.equal(code, 0);
    assert.match(stdout, /would POST to http:\/\/127\.0\.0\.1:9\/x/);
  });
});

// ---------------------------------------------------------------------------
describe("--dry-run", () => {
  it("shows the privacy fields on the payload it would send", async () => {
    const { code, stdout } = await runCli(["--text", "a claim", "--dry-run"], envFor({}));
    assert.equal(code, 0);
    assert.match(stdout, /"zdr":\s*true/);
    assert.match(stdout, /"data_collection":\s*"deny"/);
  });

  it("reads the subject from stdin when neither --file nor --text is given", async () => {
    const { code, stdout } = await runCli(["--dry-run"], envFor({}), "a claim piped on stdin\n");
    assert.equal(code, 0);
    assert.match(stdout, /\(stdin\)/);
  });

  it("includes --context material without treating it as the subject", async () => {
    const ctxPath = tmpFile("judge-context-", "ctx.md", "Background: a cost model the subject should be consistent with.");
    const { code, stdout } = await runCli(["--text", "the plan", "--context", ctxPath, "--dry-run"], envFor({}));
    assert.equal(code, 0);
    assert.ok(stdout.includes(ctxPath));
  });
});

// ---------------------------------------------------------------------------
describe("argument handling", () => {
  it("prints usage and exits 0 on --help", async () => {
    const { code, stdout } = await runCli(["--help"], envFor({}));
    assert.equal(code, 0);
    assert.match(stdout, /USAGE/);
    assert.match(stdout, /OPENROUTER_API_KEY/);
    assert.match(stdout, /JUDGE_FIXTURE/);
  });

  it("rejects an unknown flag", async () => {
    const { code, stderr } = await runCli(["--bogus"], envFor({}));
    assert.equal(code, 1);
    assert.match(stderr, /unknown argument/);
  });

  it("rejects a non-integer --max", async () => {
    const { code, stderr } = await runCli(["--text", "x", "--max", "1.5"], envFor({}));
    assert.equal(code, 1);
    assert.match(stderr, /--max must be a positive integer/);
  });

  it("exits 1 with no subject and nothing piped", async () => {
    const { code, stderr } = await runCli([], envFor({}));
    assert.equal(code, 1);
    assert.match(stderr, /no subject/);
  });

  it("no longer recognises the removed --kindo, --diff or --lines flags", async () => {
    for (const flag of ["--kindo", "--diff", "--lines"]) {
      const { code, stderr } = await runCli([flag], envFor({}));
      assert.equal(code, 1, `${flag} should be rejected`);
      assert.match(stderr, /unknown argument/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("every request", () => {
  it("carries zero-data-retention privacy fields and the X-Title header, and never an HTTP-Referer", async () => {
    let capturedBody = null;
    let capturedHeaders = null;
    const usableFixture = JSON.parse(readFileSync(join(FIXTURES, "usable-response.json"), "utf8"));

    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        capturedBody = JSON.parse(raw);
        capturedHeaders = req.headers;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(usableFixture));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    const env = envFor({
      OPENROUTER_API_KEY: "test-key-never-leaves-loopback",
      JUDGE_OPENROUTER_URL: `http://127.0.0.1:${port}`,
    });
    const { code } = await runCli(["--text", "a claim to inspect", "--json"], env);

    await new Promise((resolve) => server.close(resolve));

    assert.equal(code, 0);
    assert.ok(capturedBody, "the server never received a request");
    assert.equal(capturedBody.provider.zdr, true);
    assert.equal(capturedBody.provider.data_collection, "deny");
    assert.equal(capturedHeaders["x-title"], "Grill");
    assert.equal(capturedHeaders["http-referer"], undefined);
  });
});

// ---------------------------------------------------------------------------
describe("a judge that sends headers and never finishes the body", () => {
  it(
    "degrades, reports and exits clean instead of crashing the process",
    async () => {
      let server;
      await new Promise((resolve) => {
        server = createServer((_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.write('{"choices":[');
          // deliberately no res.end() — the "generation" never finishes
        });
        server.listen(0, "127.0.0.1", resolve);
      });
      const port = server.address().port;

      const env = envFor({
        OPENROUTER_API_KEY: "test-key-never-leaves-loopback",
        JUDGE_OPENROUTER_URL: `http://127.0.0.1:${port}`,
        JUDGE_TIMEOUT_MS: "1200", // -> a 1800ms walk deadline, so the 3rd link is never attempted
      });
      const { code, stdout, stderr } = await runCli(["--text", "a claim that wants judging", "--json"], env);

      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));

      // THE CRASH ITSELF: before the guarded-read fix, the abort rejected an unhandled
      // promise and killed the process.
      assert.doesNotMatch(stderr, /DOMException|ERR_UNHANDLED_REJECTION|Timeout\._onTimeout/);
      assert.equal(code, 0);
      assert.notEqual(stdout.trim(), "");

      const result = JSON.parse(stdout);
      // THE STALL IS NAMED AS ITS OWN FAILURE MODE, apart from an ordinary HTTP failure.
      assert.ok(result.degraded.some((d) => /never finished sending its answer/.test(d)));
      // IT IS A TRANSPORT OUTCOME, so the walk advances instead of treating it as the answer.
      assert.match(stderr, /chain advance: .*· transport/);
      // THE WALK IS BOUNDED: two 1200ms aborts exceed the 1800ms deadline, so the third
      // link is never attempted.
      assert.ok(result.degraded.some((d) => /walk deadline passed with 1 link\(s\) unattempted/.test(d)));
      // THE POINT OF THE WHOLE INSTRUMENT: an unjudged subject must never render as judged.
      assert.equal(result.verdict, null);
    },
    { timeout: 20000 },
  );
});
