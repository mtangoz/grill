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

import { startFakeOpenRouter, typesafeAnswer } from "./fixtures/fake-openrouter.mjs";

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
  for (const k of [
    "OPENROUTER_API_KEY",
    "JUDGE_FIXTURE",
    "JUDGE_MODEL",
    "JUDGE_TIMEOUT_MS",
    "JUDGE_OPENROUTER_URL",
    "JUDGE_CHECK",
    "JUDGE_DECISIONS_URL",
  ]) {
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
    assert.match(report, /\*\*Verdict: shaky\*\*/);
  });
});

// ---------------------------------------------------------------------------
describe("a verdict kinder than its own challenges", () => {
  it("keeps the judge's 'holds' but warns, in the report, that a serious challenge stands under it", async () => {
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "holds-over-serious-response.json") });

    const { code, stdout } = await runCli(["--text", "Move every customer to the new database in one weekend.", "--json"], env);

    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.verdict, "holds", "reported, never overwritten");
    assert.equal(result.verdictCoherent, false);
    assert.match(result.verdictNote, /1 SERIOUS challenge/);
    assert.deepEqual(result.degraded, [], "a kind verdict is a warning, not a blind run");

    const { stdout: report } = await runCli(["--text", "Move every customer to the new database in one weekend."], env);
    assert.match(report, /\*\*Verdict: solid\*\*/);
    assert.match(report, /Verdict does not match the surviving challenges\.\*\* the judge returned "holds" while filing 1 SERIOUS/);
    assert.doesNotMatch(report, /DEGRADED RUN/);
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

// ---------------------------------------------------------------------------
// THE LOCAL QUOTE CHECK. Always on and sends nothing, so a fixture exercises it end to end.
// usable-response.json's one challenge quotes "this will double signups within a month".
describe("the local quote check", () => {
  it("counts a quote that is in the write-up, in the footer", async () => {
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });
    const { code, stdout } = await runCli(["--text", "Ship it: this will double   signups within a month.", "--json"], env);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.grounding, { checked: 1, found: 1, missing: [] });
  });

  it("warns in the footer, and only there, when the quote is not in the write-up", async () => {
    const subjectPath = tmpFile("judge-ground-", "subject.md", "A claim that says something else entirely.");
    const outPath = join(dirname(subjectPath), "report.md");
    const env = envFor({ JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") });
    const { code, stdout, stderr } = await runCli(["--file", subjectPath, "--json", "--out", outPath], env);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.grounding, { checked: 1, found: 0, missing: [0] });
    assert.deepEqual(result.degraded, [], "a drifted quote is not a degraded run");
    const report = readFileSync(outPath, "utf8");
    assert.match(report, /⚠ 1 of 1 challenge quotes words that aren't in the write-up \(#1\); weigh it with care/);
    assert.doesNotMatch(report, /DEGRADED RUN/);
    assert.doesNotMatch(stderr, /DEGRADED/);
  });
});

// ---------------------------------------------------------------------------
// THE JEV QUALITY CHECK, against one loopback server answering both OpenRouter paths.
describe("--check: the Jev quality check", () => {
  const KEY = "test-key-never-leaves-loopback";
  const SUBJECT = "Decision: hire the candidate at sam@example.com (phone 415-555-0123), because this will double signups within a month.";

  async function grill(args, { fake, env = {}, stdin } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "judge-check-"));
    const outPath = join(dir, "report.md");
    const run = await runCli(
      [...args, "--json", "--out", outPath],
      envFor({ OPENROUTER_API_KEY: KEY, ...(fake ? fake.env : {}), ...env }),
      stdin,
    );
    let report = "";
    try {
      report = readFileSync(outPath, "utf8");
    } catch {
      // no report: the run was refused
    }
    let result = null;
    try {
      result = JSON.parse(run.stdout);
    } catch {
      // not JSON: the run was refused
    }
    return { ...run, report, result };
  }

  it("sends the MASKED subject to the decisions path, pinned to Jev, and the report shows the section", async () => {
    const fake = await startFakeOpenRouter();
    const r = await grill(["--text", SUBJECT, "--question", "Should we hire her?", "--check"], { fake });
    await fake.close();

    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.seen.chat.length, 1);
    assert.equal(fake.seen.decisions.length, 1, "exactly one check request");
    const [d] = fake.seen.decisions;
    assert.equal(d.body.model, "typesafe/jev-1.13");
    // MASKED, both ways round: the placeholders are there, and the raw details are nowhere.
    assert.ok(d.body.state.write_up.includes("[email]"));
    assert.ok(d.body.state.write_up.includes("[phone]"));
    assert.ok(!d.raw.includes("sam@example.com"), "the address never reached the decisions path");
    assert.ok(!d.raw.includes("415-555-0123"), "the phone never reached the decisions path");
    // The second reader is sent the very text the judge was sent, and nothing more of it.
    assert.ok(fake.seen.chat[0].body.messages[1].content.includes(d.body.state.write_up));
    assert.equal(d.body.state.question, "Should we hire her?");
    assert.equal(d.body.state.verdict, "weak");
    assert.equal(d.body.state.challenges.length, 1);
    assert.ok(d.body.questions.answers_question, "asked because there was a question");
    // The same headers as the judge's request, and no Referer.
    assert.equal(d.headers.authorization, `Bearer ${KEY}`);
    assert.equal(d.headers["x-title"], "Grill");
    assert.equal(d.headers["http-referer"], undefined);

    assert.equal(r.result.quality.provider, "TypeSafe");
    assert.deepEqual(r.result.quality.concrete, { n: 1, good: 1 });
    assert.deepEqual(r.result.degraded, []);
    assert.match(r.report, /## Quality check \(Jev\)/);
    assert.match(r.report, /Falsifiers that name a concrete, cheap test: 1 of 1/);
    assert.match(r.report, /quotes checked: 1 of 1 found in the write-up/);
  });

  it("a decisions-path 500 leaves the grill intact and says 'quality check unavailable'", async () => {
    const fake = await startFakeOpenRouter({ decisions: () => ({ status: 500, text: "upstream exploded" }) });
    const r = await grill(["--text", SUBJECT, "--check"], { fake });
    await fake.close();

    assert.equal(r.code, 0);
    assert.equal(fake.seen.decisions.length, 1);
    // The grill itself is untouched: same verdict, same challenge, no banner.
    assert.equal(r.result.verdict, "weak");
    assert.equal(r.result.challenges.length, 1);
    assert.deepEqual(r.result.degraded, []);
    assert.match(r.result.quality.unavailable, /returned 500: upstream exploded/);
    assert.match(r.report, /Verdict: shaky/);
    assert.match(r.report, /quality check unavailable: OpenRouter's decisions endpoint returned 500: upstream exploded/);
    assert.doesNotMatch(r.report, /DEGRADED RUN/);
    assert.match(r.stderr, /quality check unavailable/);
    assert.doesNotMatch(r.stderr, /DEGRADED/);
  });

  it("without --check, the decisions path is never hit and there is no Jev section", async () => {
    const fake = await startFakeOpenRouter();
    const r = await grill(["--text", SUBJECT], { fake });
    await fake.close();

    assert.equal(r.code, 0);
    assert.equal(fake.seen.chat.length, 1);
    assert.equal(fake.seen.decisions.length, 0);
    assert.equal(r.result.quality, null);
    assert.doesNotMatch(r.report, /Quality check/);
  });

  it("JUDGE_CHECK=1 turns it on without the flag; any other value is announced and ignored", async () => {
    const on = await startFakeOpenRouter();
    const a = await grill(["--text", SUBJECT], { fake: on, env: { JUDGE_CHECK: "1" } });
    await on.close();
    assert.equal(a.code, 0);
    assert.equal(on.seen.decisions.length, 1);

    for (const value of ["true", "yes", "2"]) {
      const off = await startFakeOpenRouter();
      const b = await grill(["--text", SUBJECT], { fake: off, env: { JUDGE_CHECK: value } });
      await off.close();
      assert.equal(b.code, 0);
      assert.equal(off.seen.decisions.length, 0, `JUDGE_CHECK=${value} must not turn the check on`);
      assert.match(b.stderr, new RegExp(`JUDGE_CHECK=${value} is not "1" — IGNORED`));
    }
  });

  it("drops the answers when they were served by anyone but TypeSafe", async () => {
    const fake = await startFakeOpenRouter({ decisions: (body) => ({ json: typesafeAnswer(body, { provider: "SomeoneElse" }) }) });
    const r = await grill(["--text", SUBJECT, "--check"], { fake });
    await fake.close();

    assert.equal(r.code, 0);
    assert.equal(r.result.quality.unavailable, "served by an endpoint outside the zero-retention allowlist");
    assert.equal(r.result.quality.concrete, undefined, "no answer from an unvetted endpoint is used");
    assert.match(r.report, /quality check unavailable: served by an endpoint outside the zero-retention allowlist/);
    assert.equal(r.result.verdict, "weak");
  });

  it("sends nothing when the grill came back with no usable verdict", async () => {
    const noToolCall = readFileSync(join(FIXTURES, "no-tool-call-response.json"), "utf8");
    const fake = await startFakeOpenRouter({ chat: () => ({ text: noToolCall }) });
    const r = await grill(["--text", SUBJECT, "--check"], { fake });
    await fake.close();

    assert.equal(r.code, 0);
    assert.equal(r.result.verdict, null);
    assert.equal(fake.seen.decisions.length, 0);
    assert.match(r.result.quality.unavailable, /no usable verdict/);
  });

  it("sends nothing in fixture mode, even with --check", async () => {
    const fake = await startFakeOpenRouter();
    const r = await grill(["--text", SUBJECT, "--check"], {
      fake,
      env: { OPENROUTER_API_KEY: undefined, JUDGE_FIXTURE: join(FIXTURES, "usable-response.json") },
    });
    await fake.close();

    assert.equal(r.code, 0);
    assert.equal(fake.seen.chat.length + fake.seen.decisions.length, 0);
    assert.match(r.result.quality.unavailable, /JUDGE_FIXTURE/);
  });

  it(
    "a check whose body stalls cannot hold the report back: it times out as unavailable",
    async () => {
      const fake = await startFakeOpenRouter({ decisions: () => ({ stall: true }) });
      const r = await grill(["--text", SUBJECT, "--check"], { fake, env: { JUDGE_TIMEOUT_MS: "1200" } });
      await fake.close();

      assert.doesNotMatch(r.stderr, /ERR_UNHANDLED_REJECTION|DOMException \[/);
      assert.equal(r.code, 0);
      assert.equal(r.result.verdict, "weak");
      assert.match(r.result.quality.unavailable, /stalled after a 200 and hit the 1200ms ceiling/);
      assert.deepEqual(r.result.degraded, []);
    },
    { timeout: 20000 },
  );

  it("--check-flaw asks catches_planted_flaw, with the flaw masked like the subject", async () => {
    const fake = await startFakeOpenRouter();
    const r = await grill(["--text", SUBJECT, "--check", "--check-flaw", "Assumes ops@example.com will sign off."], { fake });
    await fake.close();

    assert.equal(r.code, 0);
    const q = fake.seen.decisions[0].body.questions.catches_planted_flaw;
    assert.equal(q.type, "noul");
    assert.equal(q.instructions, "Does any challenge identify this specific flaw: Assumes [email] will sign off?");
    assert.ok(!fake.seen.decisions[0].raw.includes("ops@example.com"));
    assert.equal(r.result.quality.extra.catches_planted_flaw, 0.9);
  });

  it("--check-flaw without the check is refused before anything is sent", async () => {
    const fake = await startFakeOpenRouter();
    const r = await grill(["--text", SUBJECT, "--check-flaw", "a flaw"], { fake });
    await fake.close();

    assert.equal(r.code, 1);
    assert.match(r.stderr, /--check-flaw adds a question to the quality check, so it needs --check/);
    assert.equal(fake.seen.chat.length + fake.seen.decisions.length, 0);
  });

  it("an empty --check-flaw is refused before anything is sent", async () => {
    const fake = await startFakeOpenRouter();
    const r = await grill(["--text", SUBJECT, "--check", "--check-flaw", " . "], { fake });
    await fake.close();

    assert.equal(r.code, 1);
    assert.match(r.stderr, /--check-flaw needs the flaw, in words/);
    assert.equal(fake.seen.chat.length + fake.seen.decisions.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("JUDGE_DECISIONS_URL", () => {
  it("refuses a non-loopback host, by the same guard as the judge's endpoint", async () => {
    const env = envFor({ JUDGE_DECISIONS_URL: "https://attacker.example/decisions" });
    const { code, stderr, stdout } = await runCli(["--text", "a claim", "--check", "--dry-run"], env);
    assert.notEqual(code, 0);
    assert.match(stderr, /JUDGE_DECISIONS_URL must point at loopback — got host "attacker\.example"/);
    assert.ok(!stdout.includes("would POST"));
  });

  it("refuses something that is not a URL at all", async () => {
    const { code, stderr } = await runCli(["--text", "a claim", "--dry-run"], envFor({ JUDGE_DECISIONS_URL: "not a url" }));
    assert.equal(code, 1);
    assert.match(stderr, /JUDGE_DECISIONS_URL is not a URL/);
  });

  it("--dry-run says whether the check is on, and where it would go", async () => {
    const on = await runCli(["--text", "a claim", "--check", "--dry-run"], envFor({ JUDGE_DECISIONS_URL: "http://127.0.0.1:9/d" }));
    assert.equal(on.code, 0);
    assert.match(on.stdout, /quality check: ON — after a usable verdict, one POST to http:\/\/127\.0\.0\.1:9\/d \(typesafe\/jev-1\.13; answers used only if served by TypeSafe\)/);

    const off = await runCli(["--text", "a claim", "--dry-run"], envFor({}));
    assert.match(off.stdout, /quality check: off/);
    assert.match(off.stdout, /would POST to https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
  });
});
