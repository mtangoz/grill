// Tests for server/index.mjs, spoken to exactly as a chat client would: JSON-RPC over stdio.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  AUTHOR_VENDORS,
  GUESSED_AUTHOR_LINE,
  INDEPENDENCE_NOT_VERIFIED,
  INDEPENDENCE_RELAY,
  NEWS_MONTH_START_DAYS,
  NEWS_RELEASE_WINDOW_DAYS,
  NEWS_UNTIL,
  NEWS_URL,
  ONCE_DISCLOSURE,
  ONCE_DISCLOSURE_UNVERIFIED,
  RELEASE_DATE,
  buildGrillTools,
  groundedAuthor,
  newsLine,
  normalizeAuthor,
  withNews,
} from "../server/index.mjs";
import { RUN_PRIVACY_LINE, countWords } from "./judgeCore.mjs";
import { JUDGE_COMPANY_IDS } from "./resultsCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server", "index.mjs");
const USABLE = join(HERE, "fixtures", "usable-response.json");
const DEEPEN = join(HERE, "fixtures", "deepen-response.json");
const KEY = "sk-or-v1-test-key-never-echoed";

/** A minimal MCP client: send lines, collect replies by id and notifications in order. */
function connect(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, GRILL_KEY_FILE: join(tmpdir(), "grill-tests-no-key-file", "key"), ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  const notifications = [];
  let buffer = "";
  let transcript = "";
  child.stderr.on("data", () => {});
  child.stdout.on("data", (chunk) => {
    transcript += chunk;
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
      } else if (msg.method) notifications.push(msg);
      else waiting.get(null)?.(msg);
    }
  });
  let nextId = 1;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, 4_000);
      waiting.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const raw = (line) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for a raw line")), 4_000);
      waiting.set(null, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      child.stdin.write(`${line}\n`);
    });
  const close = () =>
    new Promise((resolve) => {
      let settled = false;
      let killTimer;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        child.unref();
        resolve();
      };
      killTimer = setTimeout(finish, 500);
      child.once("close", finish);
      if (child.exitCode !== null || child.signalCode !== null) finish();
      else child.stdin.end();
    });
  return { request, raw, close, notifications, transcript: () => transcript };
}

// The default client is one the server recognises, so a default run knows who wrote the
// subject. A client it cannot place gets one more line after the run note. Those cases pass
// their own client name.
async function initialized(env, clientInfo = { name: "claude-ai", version: "0" }) {
  const client = connect(env);
  await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, ...(clientInfo ? { clientInfo } : {}) });
  client.raw.bind(null); // keep the helper shape obvious
  return client;
}

const textOf = (res) => res.result.content.map((c) => c.text).join("\n");

describe("the MCP handshake", () => {
  it("negotiates a supported protocol, and falls back to its newest for an unknown one", async () => {
    const a = connect({});
    const known = await a.request("initialize", { protocolVersion: "2025-03-26", capabilities: {} });
    assert.equal(known.result.protocolVersion, "2025-03-26");
    assert.equal(known.result.serverInfo.name, "grill");
    assert.ok(known.result.capabilities.tools);
    assert.match(known.result.instructions, /do not wait for an OK/);
    await a.close();
    const b = connect({});
    const unknown = await b.request("initialize", { protocolVersion: "1999-01-01", capabilities: {} });
    assert.equal(unknown.result.protocolVersion, "2025-06-18");
    await b.close();
  });

  it("lists exactly grill and grill_result, with a required subject", async () => {
    const c = await initialized({});
    const res = await c.request("tools/list", {});
    const names = res.result.tools.map((t) => t.name);
    assert.deepEqual(names, ["grill", "grill_result", "grill_look_back", "grill_feedback"]);
    const annotations = {
      grill: { title: "Grill a decision", readOnlyHint: true, destructiveHint: false },
      grill_result: { title: "Collect a grill", readOnlyHint: true, destructiveHint: false },
      grill_look_back: { title: "Look back", readOnlyHint: true, destructiveHint: false },
      grill_feedback: { title: "Tell Grill how this grill was", readOnlyHint: false, destructiveHint: false },
    };
    for (const tool of res.result.tools) {
      const want = annotations[tool.name];
      assert.equal(typeof tool.title, "string");
      assert.ok(tool.title.length > 0, tool.name);
      assert.equal(tool.annotations.title, want.title, tool.name);
      assert.equal(tool.annotations.readOnlyHint, want.readOnlyHint, tool.name);
      assert.equal(tool.annotations.destructiveHint, want.destructiveHint, tool.name);
    }
    const grill = res.result.tools[0];
    assert.deepEqual(grill.inputSchema.required, ["subject"]);
    assert.match(grill.description, /different company than the assistant that wrote it \(Claude, unless set otherwise\)/);
    await c.close();
  });

  it("tells Claude to send the decision as stated, and not to wait for an OK", async () => {
    const c = await initialized({});
    const res = await c.request("tools/list", {});
    const grill = res.result.tools.find((t) => t.name === "grill");
    assert.match(grill.description, /Send the decision as the user stated it/);
    assert.match(grill.description, /Do not wait for an OK/);
    assert.match(grill.description, /at most one short question/);
    assert.match(grill.description, /do not add your own case against/i);
    assert.match(grill.description, /quick or bulk/);
    assert.deepEqual(Object.keys(grill.inputSchema.properties).sort(), ["author", "big", "quality_check", "question", "subject"]);
    assert.match(grill.inputSchema.properties.question.description, /Leave it empty/);
    assert.match(grill.description, /no code changes, no PRs, no product questions/);
    assert.match(grill.description, /https:\/\/grillyour\.ai\/#privacy/);
    assert.match(grill.description, /do not show a write-up full of blanks/i);
    assert.doesNotMatch(grill.description, /\[[a-z][^\]\n]{1,40}\]/);
    await c.close();
  });

  it("answers ping, refuses unknown methods, and reports parse errors", async () => {
    const c = await initialized({});
    assert.deepEqual((await c.request("ping", {})).result, {});
    assert.equal((await c.request("resources/list", {})).error.code, -32601);
    assert.equal((await c.raw("{not json")).error.code, -32700);
    await c.close();
  });
});

describe("grill without a key", () => {
  it("returns the setup steps as an error, and starts no judge", async () => {
    const c = await initialized({});
    const res = await c.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices." } });
    assert.equal(res.result.isError, true);
    assert.match(textOf(res), /openrouter\.ai\/keys/);
    assert.match(textOf(res), /Settings → Extensions → Grill/);
    await c.close();
  });

  it("does not point a person with no key at a paid plan", async () => {
    const c = await initialized({});
    let reply = "";
    try {
      reply = textOf(await c.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices." } }));
    } finally {
      await c.close();
    }
    // Paid plans are off. The reply gives the steps that work today and nothing else.
    assert.doesNotMatch(reply, /Grill Pro|\bPro\b|managed key/);
    assert.doesNotMatch(reply, /grillyour\.ai\/(?:pro|pricing|checkout|notify)\b/);
    assert.deepEqual(
      reply.trim().split("\n").map((line) => line.replace(/https:\/\/\S+/g, "<link>")),
      [
        "Grill isn't set up yet: it needs a key for its model router, OpenRouter.",
        "1. Create one at <link> Sign in, and add credit.",
        "2. Paste it into Grill's settings where you installed it (Claude Desktop: Settings → Extensions → Grill).",
        "   Or save it once for every app on this computer: run `npx -y grillyour --set-key` in a terminal, paste the key, press Enter, then Ctrl-D.",
        "Step-by-step: <link>",
        "Until then, the grill skill can write the subject as a prompt for you to paste into ChatGPT or Gemini instead.",
      ],
    );
  });

  it("treats an unfilled install-dialog placeholder as no key", async () => {
    const c = await initialized({ GRILL_API_KEY: "${user_config.openrouter_api_key}" });
    const res = await c.request("tools/call", { name: "grill", arguments: { subject: "x" } });
    assert.equal(res.result.isError, true);
    assert.match(textOf(res), /isn't set up yet/);
    await c.close();
  });
});

describe("grill input checks", () => {
  it("refuses an empty subject, an over-long question and a malformed author", async () => {
    const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE });
    for (const args of [{ subject: "  " }, { subject: "s", question: "q".repeat(601) }, { subject: "s", author: "Open AI!" }]) {
      const res = await c.request("tools/call", { name: "grill", arguments: args });
      assert.equal(res.result.isError, true, JSON.stringify(args));
    }
    await c.close();
  });
});

describe("a grill end to end (fixture, no network)", () => {
  it("returns the report, and the key appears nowhere in anything the server wrote", async () => {
    const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE });
    const res = await c.request("tools/call", {
      name: "grill",
      arguments: { subject: "We will raise prices 20% in Q4.", question: "Which way, and on what grounds?" },
    });
    try {
      assert.equal(res.result.isError, false);
      const report = textOf(res);
      assert.match(report, /\*\*Shaky\.\*\*/);
      assert.doesNotMatch(report, /\*\*Shaky\. \*\*/);
      assert.match(report, /Pull the signup curve from the last comparable launch/);
      assert.match(report, /Say 'more', 'options', or your call\./);
      // The run note names the model that answered and the time, then the privacy line.
      // It follows the closing line. The model appears there and nowhere else in the note.
      assert.match(report, /^\*\*Shaky\.\*\*/);
      assert.match(report, /Say 'more', 'options', or your call\.\n\nModels: openai\/gpt-5\.6-sol \(judge\) · (took \d+(m \d{2})?s|time not recorded)\nPrivate: sent only to zero-data-retention endpoints/);
      const body = report.replace(/\n\nModels: [^\n]* · (took \d+(m \d{2})?s|time not recorded)\nPrivate: sent only to zero-data-retention endpoints[^\n]*\s*$/, "");
      assert.doesNotMatch(body, /grill-record|## Steelman|## Quality check|gpt-/);
      assert.ok(report.indexOf("**Shaky.**") < report.indexOf("Say 'more'"));
      assert.ok(report.indexOf("Say 'more'") < report.indexOf("Private:"));
    } finally {
      await c.close();
    }
    assert.ok(!c.transcript().includes(KEY), "the key must never be echoed");
  });

  it("hands back a job id when the judge outlasts the wait, and grill_result collects it", { timeout: 5_000 }, async () => {
    // The clock jumps past the wait on the second read, so the fixture cannot finish first.
    const c = await initialized({
      GRILL_API_KEY: KEY,
      JUDGE_FIXTURE: USABLE,
      GRILL_WAIT_MS: "1000",
      GRILL_CLOCK_MS: "0",
      GRILL_CLOCK_STEP_MS: "10000",
    });
    try {
      const first = await c.request("tools/call", { name: "grill", arguments: { subject: "s" } });
      const match = textOf(first).match(/job_id "([0-9a-f]{8})"/);
      assert.ok(match, textOf(first));
      let report = "";
      for (let i = 0; i < 5 && !/Quick take|\*\*Shaky\.\*\*/.test(report); i++) {
        report = textOf(await c.request("tools/call", { name: "grill_result", arguments: { job_id: match[1] } }));
      }
      assert.match(report, /Quick take|Shaky/);
      const again = await c.request("tools/call", { name: "grill_result", arguments: { job_id: match[1], detail: "more" } });
      assert.equal(again.result.isError, false, textOf(again));
    } finally {
      await c.close();
    }
  });

  it("runs deepen only after the verdict, only for a big decision, and only when the test is on", { timeout: 15_000 }, async () => {
    const subject = "We will raise prices 20% in Q4 because paid users cover the support cost.";
    const listed = await initialized({});
    const tools = (await listed.request("tools/list", {})).result.tools;
    const grill = tools.find((t) => t.name === "grill");
    const resultTool = tools.find((t) => t.name === "grill_result");
    assert.match(grill.description, /only when the person asks to deepen or go bigger/);
    assert.match(grill.description, /Never ask whether it is big/);
    assert.match(grill.description, /Never add a required question before the verdict/);
    assert.match(resultTool.description, /Call detail deepen only when the person asks to deepen or go bigger/);
    assert.ok(resultTool.inputSchema.properties.detail.enum.includes("deepen"));
    assert.match((await listed.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} })).result.instructions, /only when the person asks to deepen or go bigger/);
    await listed.close();

    const off = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE, GRILL_CHECK: "false", GRILL_NEWS: "off" });
    const offRes = await off.request("tools/call", { name: "grill", arguments: { subject, big: true } });
    assert.match(textOf(offRes), /Say 'more', 'options', or your call\./);
    assert.doesNotMatch(textOf(offRes), /deepen/);
    const offDeep = await off.request("tools/call", { name: "grill_result", arguments: { detail: "deepen" } });
    assert.match(textOf(offDeep), /Deepen is a test and is off/);
    await off.close();

    const small = await initialized({
      GRILL_API_KEY: KEY,
      JUDGE_FIXTURE: USABLE,
      JUDGE_DEEPEN_FIXTURE: DEEPEN,
      GRILL_DEEPEN_TEST: "1",
      GRILL_CHECK: "false",
      GRILL_NEWS: "off",
    });
    const smallRes = await small.request("tools/call", { name: "grill", arguments: { subject } });
    assert.match(textOf(smallRes), /Say 'more', 'options', or your call\./);
    assert.doesNotMatch(textOf(smallRes), /deepen|Rewritten plan/);
    const smallDeep = await small.request("tools/call", { name: "grill_result", arguments: { detail: "deepen" } });
    assert.match(textOf(smallDeep), /only for a decision marked as big/);
    await small.close();

    const big = await initialized({
      GRILL_API_KEY: KEY,
      JUDGE_FIXTURE: USABLE,
      JUDGE_DEEPEN_FIXTURE: DEEPEN,
      GRILL_DEEPEN_TEST: "1",
      GRILL_CHECK: "false",
      GRILL_NEWS: "off",
    });
    const bigRes = await big.request("tools/call", { name: "grill", arguments: { subject, big: true } });
    const brief = textOf(bigRes).replace(/\n\nModels: [^\n]* · (took \d+(m \d{2})?s|time not recorded)\nPrivate: sent only to zero-data-retention endpoints[^\n]*\s*$/, "");
    assert.match(brief, /^\*\*Shaky\.\*\*/);
    assert.match(brief, /Say 'more', 'options', 'deepen', or your call\./);
    assert.doesNotMatch(brief, /Rewritten plan|top professional/);
    const words = brief.trim().split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 75, `${words}: ${brief}`);
    assert.ok(brief.indexOf("**Shaky.**") < brief.indexOf("The question that would change this:"), brief);
    const deep = await big.request("tools/call", { name: "grill_result", arguments: { detail: "deepen" } });
    const note = textOf(deep);
    assert.equal(deep.result.isError, false, note);
    assert.match(note, /Deeper, not bigger\./);
    assert.match(note, /1\. A top professional would:/);
    assert.match(note, /Rewritten plan:/);
    assert.match(note, /The rewrite is not the decision\./);
    assert.doesNotMatch(note, /gpt-|openrouter\/auto/);
    await big.close();
  });
});

describe("against a loopback OpenRouter", () => {
  it("sends the install-dialog key as the bearer token, and sends progress while it waits", async () => {
    const usable = readFileSync(USABLE, "utf8");
    let seenAuth = null;
    const fake = createServer((req, res) => {
      seenAuth = req.headers.authorization;
      req.resume();
      req.on("end", () =>
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(usable);
        }, 400),
      );
    });
    await new Promise((r) => fake.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    // The Jev check is on by default. With no decisions override the judge POSTs to
    // the real OpenRouter host and will wait out a stalled DNS or connect for up to
    // a minute, which is longer than this client's 4s wait.
    const c = await initialized({
      GRILL_API_KEY: KEY,
      OPENROUTER_API_KEY: "ignored-env-key",
      JUDGE_OPENROUTER_URL: `${base}/api/v1/chat/completions`,
      JUDGE_DECISIONS_URL: `${base}/api/alpha/decisions`,
      GRILL_PROGRESS_MS: "100",
    });
    const res = await c.request("tools/call", { name: "grill", arguments: { subject: "s" }, _meta: { progressToken: "tok-1" } });
    assert.equal(res.result.isError, false, textOf(res));
    assert.equal(seenAuth, `Bearer ${KEY}`);
    const progress = c.notifications.filter((n) => n.method === "notifications/progress");
    assert.ok(progress.length >= 1, "at least one progress notification while waiting");
    assert.equal(progress[0].params.progressToken, "tok-1");
    await c.close();
    fake.close();
  });
});

describe("the Jev quality check setting", () => {
  const grill = async (env) => {
    const fake = await startFakeOpenRouter();
    const c = await initialized({ GRILL_API_KEY: KEY, ...fake.env, ...env });
    const res = await c.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices 20% in Q4." } });
    await c.close();
    await fake.close();
    return { res, fake };
  };

  it("the check is ON by default: unset, empty, an unfilled placeholder or true all run it", async () => {
    for (const on of ["true", "1", "", "${user_config.jev_quality_check}", "TRUE", "yes", undefined]) {
      const { res, fake } = await grill(on === undefined ? {} : { GRILL_CHECK: on });
      assert.equal(res.result.isError, false, textOf(res));
      assert.equal(fake.seen.decisions.length, 1, `GRILL_CHECK=${JSON.stringify(on)}`);
      assert.equal(fake.seen.decisions[0].body.model, "typesafe/jev-1.13");
      assert.doesNotMatch(textOf(res), /Quality check|Jev score/);
    }
  });

  it("is off only when switched off: false, 0, off or no, in any case", async () => {
    for (const off of ["false", "0", "off", "no", "FALSE", " Off "]) {
      const { res, fake } = await grill({ GRILL_CHECK: off });
      assert.equal(res.result.isError, false, textOf(res));
      assert.equal(fake.seen.chat.length, 1, "the grill itself still ran");
      assert.equal(fake.seen.decisions.length, 0, `GRILL_CHECK=${JSON.stringify(off)} must not start the check`);
      assert.doesNotMatch(textOf(res), /Quality check/);
    }
  });

  it("one grill can skip the check, and no grill can switch on a check the settings turned off", async () => {
    const run = async (env, args) => {
      const fake = await startFakeOpenRouter();
      const c = await initialized({ GRILL_API_KEY: KEY, ...fake.env, ...env });
      const res = await c.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices 20% in Q4.", ...args } });
      await c.close();
      await fake.close();
      return { res, fake };
    };
    const skipped = await run({}, { quality_check: false });
    assert.equal(skipped.res.result.isError, false, textOf(skipped.res));
    assert.equal(skipped.fake.seen.chat.length, 1, "the grill itself still ran");
    assert.equal(skipped.fake.seen.decisions.length, 0, "quality_check: false skips Jev for this grill");
    const next = await run({}, {});
    assert.equal(next.fake.seen.decisions.length, 1, "the next grill follows the setting again");
    const cannotEnable = await run({ GRILL_CHECK: "false" }, { quality_check: true });
    assert.equal(cannotEnable.fake.seen.decisions.length, 0, "a switched-off check stays off");
  });

  it("tells Claude, before every call, whether Jev will see the write-up and how to skip it", async () => {
    for (const [env, want] of [
      [{}, /quality check \(Jev, from TypeSafe\)[\s\S]*once-only[\s\S]*quality_check: false/],
      [{ GRILL_CHECK: "false" }, /quality check is off/],
    ]) {
      const c = await initialized({ GRILL_API_KEY: KEY, ...env });
      const res = await c.request("tools/list", {});
      const grillTool = res.result.tools.find((t) => t.name === "grill");
      assert.match(grillTool.description, want);
      assert.equal(grillTool.inputSchema.properties.quality_check.type, "boolean");
      await c.close();
    }
  });

  it("the setting is the only switch: JUDGE_CHECK in the host's environment changes nothing", async () => {
    const { res, fake } = await grill({ JUDGE_CHECK: "1", GRILL_CHECK: "false" });
    assert.equal(res.result.isError, false, textOf(res));
    assert.equal(fake.seen.decisions.length, 0, "switched off stays off");
    const onByDefault = await grill({ JUDGE_CHECK: "0" });
    assert.equal(onByDefault.fake.seen.decisions.length, 1, "on by default stays on");
  });
});

describe("a managed key and a chosen judge", () => {
  it("sends the key and the judge model, treats an unfilled box as unset, and refuses the author's own company", async () => {
    const usable = readFileSync(USABLE, "utf8");
    const listen = () =>
      new Promise((resolve) => {
        const seen = [];
        const fake = createServer((req, res) => {
          let raw = "";
          req.on("data", (d) => (raw += d));
          req.on("end", () => {
            seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
            res.writeHead(200, { "content-type": "application/json" });
            res.end(usable);
          });
        });
        fake.listen(0, "127.0.0.1", () => resolve({ fake, seen, url: `http://127.0.0.1:${fake.address().port}/api/v1/chat/completions` }));
      });

    const pinned = await listen();
    const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_MODEL: "google/gemini-2.5-pro", JUDGE_OPENROUTER_URL: pinned.url, GRILL_CHECK: "false" });
    const res = await c.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices 20% in Q4." } });
    assert.equal(res.result.isError, false, textOf(res));
    assert.equal(pinned.seen[0].auth, `Bearer ${KEY}`);
    assert.equal(pinned.seen[0].body.model, "google/gemini-2.5-pro");
    await c.close();
    pinned.fake.close();

    const blank = await listen();
    const unset = await initialized({
      GRILL_API_KEY: KEY,
      JUDGE_MODEL: "${user_config.judge_model}",
      JUDGE_OPENROUTER_URL: blank.url,
      GRILL_CHECK: "false",
    });
    const def = await unset.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices 20% in Q4." } });
    assert.equal(def.result.isError, false, textOf(def));
    assert.equal(blank.seen[0].body.model, "openrouter/auto", "an unfilled judge box keeps the default chain");
    await unset.close();
    blank.fake.close();

    const blocked = await initialized({ GRILL_API_KEY: KEY, JUDGE_MODEL: "anthropic/claude-sonnet-4.5", JUDGE_FIXTURE: USABLE });
    const no = await blocked.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices 20% in Q4." } });
    assert.equal(no.result.isError, true);
    assert.match(textOf(no), /different company/);
    await blocked.close();

    const other = await initialized({ GRILL_API_KEY: KEY, JUDGE_MODEL: "openai/gpt-5.6-sol", JUDGE_FIXTURE: USABLE });
    const still = await other.request("tools/call", {
      name: "grill",
      arguments: { subject: "We will raise prices 20% in Q4.", author: "openai" },
    });
    assert.equal(still.result.isError, true);
    assert.match(textOf(still), /openai/);
    await other.close();
  });
});

describe("grill_look_back", () => {
  const records = [
    "```grill-record",
    "version: 1",
    "date: 2026-09-01",
    "title: Move the launch to March",
    "verdict: shaky",
    "falsifier: show the new price to one in ten",
    "confidence: 70%",
    "review: 2026-09-15",
    "```",
  ].join("\n");

  it("asks, then scores, with no key and no judge", async () => {
    const c = await initialized({});
    const asked = await c.request("tools/call", { name: "grill_look_back", arguments: { records } });
    assert.equal(asked.result.isError, false);
    assert.match(textOf(asked), /You were 70% sure\. What happened\?/);
    assert.doesNotMatch(textOf(asked), /## Pattern/);
    const scored = await c.request("tools/call", {
      name: "grill_look_back",
      arguments: {
        records,
        happened: "title: Move the launch to March\ncame_true: no\nfalsifier_fired: yes\nhappened: Signups stayed flat.",
      },
    });
    assert.match(textOf(scored), /The doubt matched what happened/);
    assert.match(textOf(scored), /Nothing is stored/);
    const empty = await c.request("tools/call", { name: "grill_look_back", arguments: { records: "  " } });
    assert.equal(empty.result.isError, true);
    assert.doesNotMatch(textOf(asked) + textOf(scored) + textOf(empty), /Grill news/);
    await c.close();
  });
});

describe("the Grill news line", () => {
  const subject = "We will raise prices 20% in Q4.";
  const DAY = 24 * 60 * 60 * 1000;
  const releaseMs = Date.parse(`${RELEASE_DATE}T00:00:00.000Z`);
  const IN_WINDOW = `${RELEASE_DATE}T12:00:00.000Z`;

  function at(iso, extra = {}) {
    return withNews("# report\n", { now: Date.parse(iso), state: { shown: false }, ...extra });
  }

  it("is one statement, once per process, last, and the URL is the fixed constant", async () => {
    assert.equal(NEWS_UNTIL, "2026-11-13");
    assert.equal(RELEASE_DATE, "2026-09-29");
    assert.equal(NEWS_RELEASE_WINDOW_DAYS, 7);
    assert.equal(NEWS_MONTH_START_DAYS, 3);
    assert.equal(Date.parse(`${NEWS_UNTIL}T00:00:00.000Z`) - releaseMs, 45 * DAY);
    const privacy = readFileSync(join(HERE, "..", "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /within 7 days of the release date/);
    assert.match(privacy, /first 3 days of a month/);
    assert.match(privacy, /at most once a session/);
    assert.match(privacy, /stops after 2026-11-13/);
    const skill = readFileSync(join(HERE, "..", "skills/grill/SKILL.md"), "utf8");
    assert.match(skill, /within 7 days of the release date/);
    assert.match(skill, /first 3 days of a month/);
    assert.match(skill, /at most once a session/);
    assert.equal(NEWS_URL, "https://grillyour.ai/notify?via=tool");
    assert.deepEqual(newsLine().match(/\?/g), ["?"], "the only question mark is the one in the fixed URL");
    assert.match(newsLine(), new RegExp(NEWS_URL.replace(/[?]/g, "\\?")));
    assert.doesNotMatch(newsLine(), /would you like|want to hear\?/i);
    assert.doesNotMatch(readFileSync(SERVER, "utf8"), /\b(writeFile|appendFile|createWriteStream|fetch)\s*\(/);

    const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE, GRILL_CHECK: "false", GRILL_NOW: IN_WINDOW });
    const early = await c.request("tools/call", { name: "grill", arguments: { subject: "  " } });
    assert.equal(early.result.isError, true);
    assert.doesNotMatch(textOf(early), /Grill news/);
    const first = await c.request("tools/call", { name: "grill", arguments: { subject } });
    const report = textOf(first);
    assert.equal(first.result.isError, false);
    assert.match(report, /Grill news:/);
    assert.ok(report.indexOf("**Shaky.**") < report.indexOf("Grill news:"));
    assert.ok(report.indexOf("Grill news:") < report.indexOf("Say 'more'"));
    assert.doesNotMatch(report, /version: 1/);
    assert.equal((report.match(/Grill news:/g) ?? []).length, 1);
    const second = await c.request("tools/call", { name: "grill", arguments: { subject } });
    assert.doesNotMatch(textOf(second), /Grill news/);
    const looked = await c.request("tools/call", {
      name: "grill_look_back",
      arguments: { records: "version: 1\ndate: 2026-09-01\ntitle: Raise prices\nverdict: shaky\nfalsifier: a\nconfidence: 70%\nreview: 2026-10-01\n" },
    });
    assert.doesNotMatch(textOf(looked), /Grill news/);
    await c.close();
  });

  it("is absent on setup and while a job is still running", async () => {
    const setup = await initialized({});
    const missing = await setup.request("tools/call", { name: "grill", arguments: { subject } });
    assert.match(textOf(missing), /isn't set up yet/);
    assert.doesNotMatch(textOf(missing), /Grill news/);
    await setup.close();

    const slow = await initialized({
      GRILL_API_KEY: KEY,
      JUDGE_FIXTURE: USABLE,
      GRILL_CHECK: "false",
      GRILL_WAIT_MS: "1000",
      GRILL_CLOCK_MS: "0",
      GRILL_CLOCK_STEP_MS: "10000",
    });
    try {
      const pending = await slow.request("tools/call", { name: "grill", arguments: { subject } });
      assert.match(textOf(pending), /Still grilling/);
      assert.doesNotMatch(textOf(pending), /Grill news/);
    } finally {
      await slow.close();
    }
  });

  it("stays on for an unset value or an unfilled placeholder, and off only when switched off", async () => {
    for (const on of ["true", "1", "", "${user_config.show_news}", "TRUE", "yes", undefined]) {
      const c = await initialized({
        GRILL_API_KEY: KEY,
        JUDGE_FIXTURE: USABLE,
        GRILL_CHECK: "false",
        GRILL_NOW: IN_WINDOW,
        ...(on === undefined ? {} : { GRILL_NEWS: on }),
      });
      const res = await c.request("tools/call", { name: "grill", arguments: { subject } });
      assert.match(textOf(res), /Grill news:/, `GRILL_NEWS=${JSON.stringify(on)}`);
      await c.close();
    }
    for (const off of ["false", "0", "off", "no", "FALSE", " Off "]) {
      const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE, GRILL_CHECK: "false", GRILL_NEWS: off, GRILL_NOW: IN_WINDOW });
      const res = await c.request("tools/call", { name: "grill", arguments: { subject } });
      assert.equal(res.result.isError, false);
      assert.doesNotMatch(textOf(res), /Grill news/, `GRILL_NEWS=${JSON.stringify(off)}`);
      await c.close();
    }
  });

  it("shows only inside the release window or the first days of a month, and the clock is injectable", () => {
    const show = (iso, extra) => assert.match(at(iso, extra), /Grill news:/, iso);
    const hide = (iso, extra) => assert.equal(at(iso, extra), "# report\n", iso);

    show(`${RELEASE_DATE}T00:00:00.000Z`);
    show(`${RELEASE_DATE}T23:59:59.999Z`);
    show(new Date(releaseMs + NEWS_RELEASE_WINDOW_DAYS * DAY).toISOString());
    show(new Date(releaseMs - NEWS_RELEASE_WINDOW_DAYS * DAY).toISOString());
    hide(new Date(releaseMs + (NEWS_RELEASE_WINDOW_DAYS + 1) * DAY).toISOString());
    hide(new Date(releaseMs - (NEWS_RELEASE_WINDOW_DAYS + 1) * DAY).toISOString());

    // November is outside the 2026-09-29 release window, so these pin the month rule on its own.
    show("2026-11-01T00:00:00.000Z");
    show("2026-11-03T23:59:59.999Z");
    hide("2026-11-04T00:00:00.000Z");
    hide("2026-11-13T23:59:59.999Z");

    // The end date still wins when the day would otherwise qualify.
    hide("2026-12-01T00:00:00.000Z");
    hide("2026-12-03T12:00:00.000Z");
    show("2026-11-13T12:00:00.000Z", { releaseDate: "2026-11-10" });
    hide("2026-11-14T00:00:00.000Z", { releaseDate: "2026-11-10" });

    hide("2026-11-04T12:00:00.000Z", { releaseDate: "not-a-date" });
    show("2026-11-02T12:00:00.000Z", { releaseDate: "not-a-date" });
    hide(IN_WINDOW, { env: { GRILL_NEWS: "off" } });

    const state = { shown: false };
    assert.equal(withNews("# report\n", { now: Date.parse("2026-11-04T00:00:00.000Z"), state }), "# report\n");
    assert.equal(state.shown, false, "a skipped window does not use up the one line");
    assert.match(withNews("# report\n", { now: Date.parse("2026-11-02T00:00:00.000Z"), state }), /Grill news:/);
    assert.equal(withNews("# report\n", { now: Date.parse("2026-11-02T00:00:00.000Z"), state }), "# report\n");
  });

  it("the running server follows GRILL_NOW for the window and the end date", async () => {
    const run = async (now) => {
      const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE, GRILL_CHECK: "false", GRILL_NOW: now });
      const res = await c.request("tools/call", { name: "grill", arguments: { subject } });
      const text = textOf(res);
      assert.equal(res.result.isError, false, text);
      await c.close();
      return text;
    };
    assert.match(await run("2026-11-02T12:00:00.000Z"), /Grill news:/);
    assert.doesNotMatch(await run("2026-10-07T12:00:00.000Z"), /Grill news/);
    assert.doesNotMatch(await run("2026-12-01T12:00:00.000Z"), /Grill news/);
  });

  it("tells Claude to show a Grill news line once, word for word, at the end", async () => {
    const c = await initialized({});
    const known = await c.request("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    assert.match(known.result.instructions, /Grill news/);
    assert.match(known.result.instructions, /word for word/);
    assert.match(known.result.instructions, /within 7 days of a release or on the first 3 days of a month/);
    assert.match(known.result.instructions, /Don't ask about it or repeat it/);
    await c.close();
  });
});

describe("GRILL_AUTHOR: a host that is not Claude", () => {
  const subject = { subject: "We will raise prices 20% in Q4." };

  it("excludes the host's company when the call leaves author empty, and a call's own author still wins", async () => {
    const fake = await startFakeOpenRouter();
    // The stand-in answers as OpenAI, so the host here is Gemini CLI.
    const gemini = await initialized({ GRILL_API_KEY: KEY, GRILL_AUTHOR: "Google", GRILL_CHECK: "false", ...fake.env });
    const res = await gemini.request("tools/call", { name: "grill", arguments: subject });
    assert.equal(res.result.isError, false, textOf(res));
    const excluded = fake.seen.chat[0].body.plugins[0].excluded_models;
    assert.ok(excluded.includes("google/*"), "the host's company is excluded");
    assert.ok(!excluded.includes("anthropic/*"), "Claude can judge work Claude did not write");
    await gemini.close();

    const told = await initialized({ GRILL_API_KEY: KEY, GRILL_AUTHOR: "google", GRILL_CHECK: "false", ...fake.env });
    await told.request("tools/call", { name: "grill", arguments: { ...subject, author: "xai" } });
    const last = fake.seen.chat.at(-1).body.plugins[0].excluded_models;
    assert.deepEqual(last, ["x-ai/*"], "xai is mapped to the router's own prefix");
    assert.ok(!last.includes("google/*"), "the call's own author replaces GRILL_AUTHOR");
    await told.close();
    // And a host that declares the company that answers gets no verdict at all.
    const codex = await initialized({ GRILL_API_KEY: KEY, GRILL_AUTHOR: "openai", GRILL_CHECK: "false", ...fake.env });
    const refused = await codex.request("tools/call", { name: "grill", arguments: subject });
    assert.equal(refused.result.isError, true);
    assert.match(textOf(refused), /correlated verdict/);
    await codex.close();
    await fake.close();
  });

  it("refuses a pinned judge from the host's own company", async () => {
    const c = await initialized({ GRILL_API_KEY: KEY, GRILL_AUTHOR: "openai", JUDGE_MODEL: "openai/gpt-5.6-sol", JUDGE_FIXTURE: USABLE });
    const res = await c.request("tools/call", { name: "grill", arguments: subject });
    assert.equal(res.result.isError, true);
    assert.match(textOf(res), /same company/);
    await c.close();
  });

  it("ignores a value that is not a family name, or an unfilled placeholder", async () => {
    const fake = await startFakeOpenRouter();
    for (const value of ["${user_config.author}", "open ai!", ""]) {
      const c = await initialized({ GRILL_API_KEY: KEY, GRILL_AUTHOR: value, GRILL_CHECK: "false", ...fake.env });
      await c.request("tools/call", { name: "grill", arguments: subject });
      assert.ok(fake.seen.chat.at(-1).body.plugins[0].excluded_models.includes("anthropic/*"), `"${value}" falls back to Anthropic`);
      await c.close();
    }
    await fake.close();
  });
});

describe("MCP initialize: the company behind the client", () => {
  const subject = { subject: "We will raise prices 20% in Q4." };
  const outside = () => {
    const payload = JSON.parse(readFileSync(USABLE, "utf8"));
    return (body) => {
      const excluded = body?.plugins?.[0]?.excluded_models || [];
      payload.model = excluded.some((item) => String(item).startsWith("openai"))
        ? "google/gemini-2.5-pro"
        : excluded.some((item) => String(item).startsWith("google"))
          ? "deepseek/deepseek-chat"
          : "openai/gpt-5.6-sol";
      return { text: JSON.stringify(payload) };
    };
  };

  it("excludes google/* for a Gemini client and keeps the non-Google default router", async () => {
    const fake = await startFakeOpenRouter({ chat: outside() });
    try {
      for (const name of ["gemini", "GEMINI-CLI", "Antigravity", "Google-Discovery-Engine"]) {
        const client = await initialized({ GRILL_API_KEY: KEY, GRILL_CHECK: "false", ...fake.env }, { name, version: "0" });
        const res = await client.request("tools/call", { name: "grill", arguments: subject });
        assert.equal(res.result.isError, false, `${name}: ${textOf(res)}`);
        const body = fake.seen.chat.at(-1).body;
        assert.equal(body.model, "openrouter/auto", name);
        assert.deepEqual(body.plugins[0].excluded_models, ["google/*"], name);
        await client.close();
      }
    } finally {
      await fake.close();
    }
  });

  it("uses the same client list as Claude and ChatGPT, and an explicit author or GRILL_AUTHOR still wins", async () => {
    const fake = await startFakeOpenRouter({ chat: outside() });
    try {
      const claude = await initialized({ GRILL_API_KEY: KEY, GRILL_CHECK: "false", ...fake.env }, { name: "Claude", version: "0" });
      const claudeRes = await claude.request("tools/call", { name: "grill", arguments: subject });
      assert.equal(claudeRes.result.isError, false, textOf(claudeRes));
      assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, ["anthropic/*", "*/claude-*"]);
      await claude.close();

      const chatgpt = await initialized({ GRILL_API_KEY: KEY, GRILL_CHECK: "false", ...fake.env }, { name: "ChatGPT", version: "0" });
      const chatRes = await chatgpt.request("tools/call", { name: "grill", arguments: subject });
      assert.equal(chatRes.result.isError, false, textOf(chatRes));
      assert.equal(fake.seen.chat.at(-1).body.model, "openrouter/auto");
      assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, ["openai/*"]);
      await chatgpt.close();

      const told = await initialized({ GRILL_API_KEY: KEY, GRILL_CHECK: "false", ...fake.env }, { name: "gemini-cli", version: "0" });
      const toldRes = await told.request("tools/call", { name: "grill", arguments: { ...subject, author: "xai" } });
      assert.equal(toldRes.result.isError, false, textOf(toldRes));
      const toldExcluded = fake.seen.chat.at(-1).body.plugins[0].excluded_models;
      assert.deepEqual(toldExcluded, ["x-ai/*"], "xai is mapped to the router's own prefix");
      assert.ok(!toldExcluded.includes("google/*"));
      await told.close();

      const configured = await initialized(
        { GRILL_API_KEY: KEY, GRILL_AUTHOR: "openai", GRILL_CHECK: "false", ...fake.env },
        { name: "gemini-cli", version: "0" },
      );
      const configuredRes = await configured.request("tools/call", { name: "grill", arguments: subject });
      assert.equal(configuredRes.result.isError, false, textOf(configuredRes));
      assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, ["openai/*"]);
      await configured.close();

      const cursor = await initialized({ GRILL_API_KEY: KEY, GRILL_CHECK: "false", ...fake.env }, { name: "Cursor", version: "0" });
      const cursorRes = await cursor.request("tools/call", { name: "grill", arguments: subject });
      assert.equal(cursorRes.result.isError, false, textOf(cursorRes));
      assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, ["anthropic/*", "*/claude-*"]);
      await cursor.close();
    } finally {
      await fake.close();
    }
  });

  it("says independence is not verified when the author was a guess, for each client, setting and author", { timeout: 60_000 }, async () => {
    const ANTHROPIC = ["anthropic/*", "*/claude-*"];
    // [client name, GRILL_AUTHOR, the call's author, what the judge is told to leave out,
    //  was the author a guess, does the session know the author before any call]
    const table = [
      // A client the server recognises: its company is excluded and nothing is guessed.
      ["claude-ai", "", "", ANTHROPIC, false, true],
      ["claude-code", "", "", ANTHROPIC, false, true],
      ["ChatGPT", "", "", ["openai/*"], false, true],
      ["gemini-cli", "", "", ["google/*"], false, true],
      // none, or a name the router does not use, cannot remove that company.
      ["gemini-cli", "", "none", ["google/*"], false, true],
      ["gemini-cli", "", "assistant", ["google/*"], false, true],
      ["ChatGPT", "", "unknown", ["openai/*"], false, true],
      // A real company named on the call still replaces it.
      ["gemini-cli", "", "openai", ["openai/*"], false, true],
      ["gemini-cli", "", "claude", ANTHROPIC, false, true],
      // Cursor, a client with no known company, and no client name at all: Anthropic is a guess.
      ["Cursor", "", "", ANTHROPIC, true, false],
      ["test", "", "", ANTHROPIC, true, false],
      [null, "", "", ANTHROPIC, true, false],
      ["Cursor", "", "none", ANTHROPIC, true, false],
      ["Cursor", "", "cursor", ANTHROPIC, true, false],
      ["test", "", "unknown", ANTHROPIC, true, false],
      // The same clients once the call names a company the router uses.
      ["Cursor", "", "openai", ["openai/*"], false, false],
      ["Cursor", "", "gpt", ["openai/*"], false, false],
      ["Cursor", "", "xai", ["x-ai/*"], false, false],
      ["test", "", "meta", ["meta-llama/*"], false, false],
      ["test", "", "anthropic", ANTHROPIC, false, false],
      // GRILL_AUTHOR names the company for the whole session, when it is one the router uses.
      ["Cursor", "xai", "", ["x-ai/*"], false, true],
      ["test", "OpenAI", "", ["openai/*"], false, true],
      ["test", "openai", "none", ["openai/*"], false, true],
      ["test", "openai", "google", ["google/*"], false, true],
      ["Cursor", "none", "", ANTHROPIC, true, false],
      ["Cursor", "copilot", "", ANTHROPIC, true, false],
    ];
    const fake = await startFakeOpenRouter({ chat: outside() });
    try {
      for (const [name, configured, called, excluded, guessed, sessionKnows] of table) {
        const label = JSON.stringify({ name, configured, called });
        const env = { GRILL_API_KEY: KEY, GRILL_CHECK: "false", GRILL_NEWS: "off", ...fake.env, ...(configured ? { GRILL_AUTHOR: configured } : {}) };
        const client = connect(env);
        try {
          const init = await client.request("initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            ...(name ? { clientInfo: { name, version: "0" } } : {}),
          });
          const instructions = init.result.instructions;
          const description = (await client.request("tools/list", {})).result.tools.find((tool) => tool.name === "grill").description;
          // The once-only line and the instructions claim a different company only when the session knows the author.
          assert.equal(description.includes(ONCE_DISCLOSURE), sessionKnows, label);
          assert.equal(description.includes(ONCE_DISCLOSURE_UNVERIFIED), !sessionKnows, label);
          assert.equal(instructions.startsWith("Grill sends the decision as the user stated it to an outside judge from a different company. "), sessionKnows, label);
          assert.equal(instructions.startsWith("Grill sends the decision as the user stated it to an outside judge. "), !sessionKnows, label);
          assert.ok(description.includes(INDEPENDENCE_RELAY), label);
          assert.ok(instructions.includes(INDEPENDENCE_RELAY), label);

          const res = await client.request("tools/call", { name: "grill", arguments: { ...subject, ...(called ? { author: called } : {}) } });
          const report = textOf(res);
          assert.equal(res.result.isError, false, `${label}: ${report}`);
          assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, excluded, label);
          assert.equal(fake.seen.chat.at(-1).body.model, "openrouter/auto", label);
          if (guessed) {
            // One line, after the privacy sentence, and nothing after it.
            assert.ok(report.endsWith(`${RUN_PRIVACY_LINE}\n${GUESSED_AUTHOR_LINE}\n`), `${label}: ${report}`);
            assert.equal(report.split(INDEPENDENCE_NOT_VERIFIED).length, 2, label);
          } else {
            assert.ok(report.endsWith(`${RUN_PRIVACY_LINE}\n`), `${label}: ${report}`);
            assert.equal(report.includes(INDEPENDENCE_NOT_VERIFIED), false, `${label}: ${report}`);
          }
          // A later layer is not the verdict, and carries no line.
          const more = await client.request("tools/call", { name: "grill_result", arguments: { detail: "more" } });
          assert.equal(textOf(more).includes(INDEPENDENCE_NOT_VERIFIED), false, label);
        } finally {
          await client.close();
        }
      }
    } finally {
      await fake.close();
    }
  });

  it("keeps the guess line when the verdict is collected later with grill_result", { timeout: 10_000 }, async () => {
    const guessed = await initialized(
      { GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE, GRILL_CHECK: "false", GRILL_NEWS: "off", GRILL_WAIT_MS: "1000", GRILL_CLOCK_MS: "0", GRILL_CLOCK_STEP_MS: "10000" },
      { name: "Cursor", version: "0" },
    );
    try {
      const first = await guessed.request("tools/call", { name: "grill", arguments: subject });
      const match = textOf(first).match(/job_id "([0-9a-f]{8})"/);
      assert.ok(match, textOf(first));
      assert.equal(textOf(first).includes(INDEPENDENCE_NOT_VERIFIED), false, "a job id is not a verdict");
      let report = "";
      for (let i = 0; i < 5 && !/\*\*Shaky\.\*\*/.test(report); i++) {
        report = textOf(await guessed.request("tools/call", { name: "grill_result", arguments: { job_id: match[1] } }));
      }
      assert.ok(report.endsWith(`${RUN_PRIVACY_LINE}\n${GUESSED_AUTHOR_LINE}\n`), report);
    } finally {
      await guessed.close();
    }
  });
});

describe("naming the author", () => {
  it("maps common names to the router's vendor prefix, and treats anything else as no company", () => {
    const mapped = [
      ["xai", "x-ai"],
      ["XAI", "x-ai"],
      [" grok ", "x-ai"],
      ["x-ai", "x-ai"],
      ["claude", "anthropic"],
      ["Anthropic", "anthropic"],
      ["gemini", "google"],
      ["google", "google"],
      ["chatgpt", "openai"],
      ["gpt", "openai"],
      ["codex", "openai"],
      ["openai", "openai"],
      ["meta", "meta-llama"],
      ["muse", "meta-llama"],
      ["llama", "meta-llama"],
      ["meta-llama", "meta-llama"],
      ["mistral", "mistralai"],
      ["mistralai", "mistralai"],
      ["deepseek", "deepseek"],
      ["moonshot", "moonshotai"],
      ["alibaba", "qwen"],
      ["zai", "z-ai"],
    ];
    for (const [given, vendor] of mapped) {
      assert.equal(normalizeAuthor(given), vendor, given);
      assert.equal(groundedAuthor(given), vendor, given);
    }
    // Not a company the router uses: the name passes through unchanged, and grounds nothing.
    for (const given of ["none", "unknown", "cursor", "copilot", "assistant", "open ai!", "${user_config.author}", "toString", "constructor", ""]) {
      assert.equal(groundedAuthor(given), "", given);
    }
    assert.equal(normalizeAuthor("None"), "none");
    assert.equal(normalizeAuthor("Cursor"), "cursor");
    assert.equal(normalizeAuthor("toString"), "tostring");
    for (const given of [undefined, null, 7, {}, ["openai"]]) {
      assert.equal(normalizeAuthor(given), "");
      assert.equal(groundedAuthor(given), "");
    }
  });

  it("knows the same vendor prefixes as the published results, so a named author always matches real models", () => {
    assert.deepEqual([...AUTHOR_VENDORS], JUDGE_COMPANY_IDS.filter((id) => id !== "other"));
    for (const vendor of AUTHOR_VENDORS) assert.equal(groundedAuthor(vendor), vendor);
    assert.equal(AUTHOR_VENDORS.includes("none"), false);
    assert.equal(AUTHOR_VENDORS.includes("xai"), false, "the router's prefix is x-ai");
  });

  it("gives the router's own spelling as the example in the tool schema", () => {
    for (const tools of [buildGrillTools({ checkOn: true }), buildGrillTools({ checkOn: false, authorGuessed: true })]) {
      const author = tools.find((tool) => tool.name === "grill").inputSchema.properties.author.description;
      assert.match(author, /for example openai, google or x-ai\./);
      assert.doesNotMatch(author, /\bxai\b/);
      for (const example of author.match(/for example ([^.]+)\./)[1].split(/, | or /)) {
        assert.equal(groundedAuthor(example), example, `${example} must be a name that excludes a company`);
      }
    }
  });

  it("words the guess line and the once-only line without a company claim", () => {
    assert.equal(INDEPENDENCE_NOT_VERIFIED, "Independence not verified:");
    assert.equal(
      GUESSED_AUTHOR_LINE,
      "Independence not verified: Grill couldn't tell which AI you're using, so it ruled out Anthropic only. Set GRILL_AUTHOR, or name your assistant's company next time.",
    );
    assert.equal(GUESSED_AUTHOR_LINE.includes("\n"), false);
    assert.equal(GUESSED_AUTHOR_LINE.includes("?"), false);
    assert.ok(countWords(GUESSED_AUTHOR_LINE) <= 25, countWords(GUESSED_AUTHOR_LINE));
    // The existing sentence, minus the company claim, and nothing else changed. The link is
    // whatever the full line carries, so a change to it lands in both lines at once.
    assert.match(ONCE_DISCLOSURE_UNVERIFIED, /^This goes to an outside judge, and the router does not keep it\. https:\/\/grillyour\.ai\/\S+$/);
    assert.match(ONCE_DISCLOSURE, /^This goes to an outside judge from a different company, and the router does not keep it\. https:\/\/grillyour\.ai\/\S+$/);
    assert.equal(ONCE_DISCLOSURE.replace(" from a different company", ""), ONCE_DISCLOSURE_UNVERIFIED);
    assert.notEqual(ONCE_DISCLOSURE_UNVERIFIED, ONCE_DISCLOSURE);
    assert.equal(ONCE_DISCLOSURE_UNVERIFIED.includes("different company"), false);
    assert.equal(ONCE_DISCLOSURE_UNVERIFIED.includes("\n"), false);
    assert.ok(countWords(ONCE_DISCLOSURE_UNVERIFIED) >= 12 && countWords(ONCE_DISCLOSURE_UNVERIFIED) <= 25, countWords(ONCE_DISCLOSURE_UNVERIFIED));
    assert.equal(INDEPENDENCE_RELAY, "If a line that starts with Independence not verified follows the run note, show that line as written.");
    for (const text of [GUESSED_AUTHOR_LINE, ONCE_DISCLOSURE_UNVERIFIED, INDEPENDENCE_RELAY]) assert.doesNotMatch(text, /[\u2013\u2014]/);
  });
});

describe("the server as a command (npx -y grillyour …)", () => {
  const run = (args, env = {}, stdin) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [SERVER, ...args], {
        env: { PATH: process.env.PATH, GRILL_KEY_FILE: join(tmpdir(), "grill-tests-no-key-file", "key"), ...env },
        stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (code) => resolve({ code, out, err }));
      if (stdin !== undefined) child.stdin.end(stdin);
    });

  it("--set-key saves stdin to the key file, --key-status finds it, and neither prints the key", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "grill-srv-key-")), "key");
    const set = await run(["--set-key"], { GRILL_KEY_FILE: file }, `${KEY}\n`);
    assert.equal(set.code, 0, set.err);
    assert.equal(readFileSync(file, "utf8"), `${KEY}\n`);
    const status = await run(["--key-status"], { GRILL_KEY_FILE: file });
    assert.match(status.out, /Key found: .*\(…hoed\)/);
    assert.ok(!(set.out + status.out).includes(KEY));
  });

  it("then serves grills off that file with no key in the MCP config", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "grill-srv-key-")), "key");
    await run(["--set-key"], { GRILL_KEY_FILE: file }, `${KEY}\n`);
    const fake = await startFakeOpenRouter();
    const c = await initialized({ GRILL_KEY_FILE: file, GRILL_CHECK: "false", ...fake.env });
    const res = await c.request("tools/call", { name: "grill", arguments: { subject: "We will raise prices 20% in Q4." } });
    assert.equal(res.result.isError, false, textOf(res));
    assert.equal(fake.seen.chat[0].headers.authorization, `Bearer ${KEY}`);
    await c.close();
    await fake.close();
  });

  it("posts a reaction without the subject unless share_grill is true, and a grill alone posts nothing", async () => {
    const seen = [];
    const sink = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        seen.push(raw);
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
    const fake = await startFakeOpenRouter();
    const subject = "Decision: ship CANARY-FEEDBACK-SUBJECT-9f3a next week because paid users cover support.";
    const c = await initialized({
      GRILL_API_KEY: KEY,
      GRILL_CHECK: "false",
      GRILL_NEWS: "off",
      GRILL_FEEDBACK_URL: `http://127.0.0.1:${sink.address().port}/api/feedback`,
      ...fake.env,
    });
    try {
      const grilled = await c.request("tools/call", { name: "grill", arguments: { subject } });
      assert.equal(grilled.result.isError, false, textOf(grilled));
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(seen.length, 0);
      const quiet = await c.request("tools/call", { name: "grill_feedback", arguments: { rating: "meh", reason: "too vague" } });
      assert.equal(quiet.result.isError, false, textOf(quiet));
      // A reaction goes to Grill's server, so the reply says so and says what went.
      assert.equal(
        textOf(quiet).trim(),
        "Noted. That was sent to Grill: the rating, your one-line reason, the verdict label and the judge model, kept 180 days. Not the decision.",
      );
      assert.equal(seen.length, 1);
      // What went is what the reply lists, plus a random id for this install and the yes or no on sending the grill.
      assert.deepEqual(Object.keys(JSON.parse(seen[0])).sort(), ["account_id", "model", "rating", "reason", "share_grill", "verdict"]);
      assert.equal(seen[0].includes("CANARY-FEEDBACK-SUBJECT-9f3a"), false);
      assert.equal(seen[0].includes("headline number"), false);
      const body = JSON.parse(seen[0]);
      assert.equal(body.rating, "meh");
      assert.equal(body.share_grill, false);
      assert.equal(Object.hasOwn(body, "subject"), false);
      assert.equal(Object.hasOwn(body, "layer1"), false);
      const sent = await c.request("tools/call", { name: "grill_feedback", arguments: { rating: "helped", share_grill: true } });
      assert.match(textOf(sent), /This grill was sent so Grill can learn from it/);
      const shared = JSON.parse(seen[1]);
      assert.equal(shared.subject, subject);
      assert.match(shared.layer1, /\*\*Shaky\.\*\*/);
    } finally {
      await c.close();
      await fake.close();
      await new Promise((resolve) => sink.close(resolve));
    }
  });

  it("--set-key with nothing piped exits 1; an unknown flag exits 1 with the help", async () => {
    assert.equal((await run(["--set-key"], {}, "")).code, 1);
    const bad = await run(["--nope"]);
    assert.equal(bad.code, 1);
    assert.match(bad.err, /--set-key/);
    assert.match((await run(["--version"])).out, /^\d+\.\d+\.\d+/);
  });
});
