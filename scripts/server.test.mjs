// Tests for server/index.mjs, spoken to exactly as a chat client would: JSON-RPC over stdio.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server", "index.mjs");
const USABLE = join(HERE, "fixtures", "usable-response.json");
const KEY = "sk-or-v1-test-key-never-echoed";

/** A minimal MCP client: send lines, collect replies by id and notifications in order. */
function connect(env) {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  const notifications = [];
  let buffer = "";
  let transcript = "";
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
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  const raw = (line) =>
    new Promise((resolve) => {
      waiting.set(null, resolve);
      child.stdin.write(`${line}\n`);
    });
  const close = () =>
    new Promise((resolve) => {
      child.on("close", resolve);
      child.stdin.end();
    });
  return { request, raw, close, notifications, transcript: () => transcript };
}

async function initialized(env) {
  const client = connect(env);
  await client.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
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
    assert.match(known.result.instructions, /OK before calling grill/);
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
    assert.deepEqual(names, ["grill", "grill_result", "grill_look_back"]);
    const grill = res.result.tools[0];
    assert.deepEqual(grill.inputSchema.required, ["subject"]);
    assert.match(grill.description, /different company than Claude/);
    await c.close();
  });

  it("tells Claude, before every call, to write the subject as a clerk and keep the question from leaning", async () => {
    // With the extension alone there is no skill: this text is all Claude reads about framing.
    const c = await initialized({});
    const res = await c.request("tools/list", {});
    const grill = res.result.tools.find((t) => t.name === "grill");
    assert.match(grill.description, /clerk, not an advocate/);
    assert.match(grill.description, /kinder verdict than it should/);
    assert.match(grill.description, /don't answer it/);
    assert.match(grill.inputSchema.properties.question.description, /names every option/);
    assert.match(grill.inputSchema.properties.question.description, /easy answer is the choice already made/);
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
    assert.equal(res.result.isError, false);
    const report = textOf(res);
    assert.match(report, /^# 🔥 Grill — \(stdin\)/);
    assert.match(report, /Verdict:/);
    assert.match(report, /Which way, and on what grounds\?/);
    assert.match(report, /## Before you decide/);
    assert.match(report, /^verdict: shaky$/m);
    assert.match(report, /Pull the signup curve from the last comparable launch/);
    assert.match(report, /^confidence: $/m);
    assert.ok(report.indexOf("**Verdict:") < report.indexOf("## Before you decide"));
    await c.close();
    assert.ok(!c.transcript().includes(KEY), "the key must never be echoed");
  });

  it("hands back a job id when the judge outlasts the wait, and grill_result collects it", async () => {
    const c = await initialized({ GRILL_API_KEY: KEY, JUDGE_FIXTURE: USABLE, GRILL_WAIT_MS: "1" });
    const first = await c.request("tools/call", { name: "grill", arguments: { subject: "s" } });
    const match = textOf(first).match(/job_id "([0-9a-f]{8})"/);
    assert.ok(match, textOf(first));
    let report = "";
    for (let i = 0; i < 200 && !report.startsWith("# "); i++) {
      report = textOf(await c.request("tools/call", { name: "grill_result", arguments: { job_id: match[1] } }));
    }
    assert.match(report, /^# 🔥 Grill/);
    const again = await c.request("tools/call", { name: "grill_result", arguments: { job_id: match[1] } });
    assert.equal(again.result.isError, true, "a collected job is gone");
    await c.close();
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
    const url = `http://127.0.0.1:${fake.address().port}/api/v1/chat/completions`;
    const c = await initialized({ GRILL_API_KEY: KEY, OPENROUTER_API_KEY: "ignored-env-key", JUDGE_OPENROUTER_URL: url, GRILL_PROGRESS_MS: "100" });
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
      assert.match(textOf(res), /## Quality check \(Jev\)/);
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
      [{}, /quality check is ON[\s\S]*sees the masked write-up[\s\S]*quality_check: false/],
      [{ GRILL_CHECK: "false" }, /quality check is switched OFF/],
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
    assert.match(textOf(asked), /Did it come true/);
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
    await c.close();
  });
});
