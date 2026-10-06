// Hosted Grill, behind GRILL_HOSTED. No network: Clerk, Redis and OpenRouter are faked.
import { createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAccount, handleDecisions, handleMcp, handleProtectedResource, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_CODE_CLIENT_ID,
  CLAUDE_WEB_REDIRECT,
  CONSENT_TEXT,
  INVITE_ONLY,
  OUT_OF_CREDIT,
  authorForJudge,
  chainIds,
  createMemoryRedis,
  decryptString,
  encryptString,
  footerLine,
  HOSTED_INSTRUCTIONS,
  hostedInstructions,
  hostedWaitMode,
  linkChains,
  parseJobCredential,
  sourceAppFromClient,
  wwwAuthenticate,
} from "./hostedCore.mjs";
import { parseRecords, sourceAppLabel } from "./reflection.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ANTHROPIC = readFileSync(join(ROOT, "scripts/fixtures/anthropic-served-response.json"), "utf8");
const USER_KEY = "sk-or-v1-hosted-user-key-never-shown-0001";
const MGMT_KEY = "sk-or-v1-management-do-not-leak-9999";
const CANARY = "CANARY-HOSTED-WRITEUP-9f3a";
const RESOURCE = "https://mcp.example/mcp";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key";
jwk.alg = "RS256";
jwk.use = "sig";

function signJwt(payload, { tamper = false } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  let sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  if (tamper) sig = `${sig.slice(0, -4)}${sig.endsWith("aaaa") ? "bbbb" : "aaaa"}`;
  return `${data}.${sig}`;
}

function claims(extra = {}) {
  return {
    iss: "https://clerk.example.test",
    sub: "user_invitee",
    aud: RESOURCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  };
}

function baseEnv() {
  return {
    GRILL_HOSTED: "on",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: MGMT_KEY,
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: "invitee@example.com",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
  };
}

function world({ email = "invitee@example.com", sub = "user_invitee" } = {}) {
  const memory = createMemoryRedis();
  const writes = [];
  const management = { creates: [], removed: [], deleted: false, usage: 0 };
  const env = baseEnv();
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      if (init.method === "DELETE") {
        management.deleted = true;
        management.removedUsers = (management.removedUsers || 0) + 1;
        return new Response("{}", { status: 200 });
      }
      if (management.deleted) return new Response("{}", { status: 404 });
      const id = decodeURIComponent(u.split("/").pop());
      const address = id === "user_other" ? "other@example.com" : id === "user_second" ? email : email;
      return Response.json({
        id,
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: address, verification: { status: "verified" } }],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && init.method === "POST") {
      management.creates.push(JSON.parse(init.body));
      return Response.json({ key: USER_KEY, data: { hash: "hash_hosted_1", limit: 1, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      if (init.method === "DELETE") {
        management.removed.push(u);
        return new Response("{}", { status: 200 });
      }
      return Response.json({
        data: { hash: "hash_hosted_1", limit: 1, usage: management.usage, usage_monthly: management.usage, disabled: false },
      });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  const redis = async (args) => {
    writes.push(args.map((part) => String(part)));
    return memory.command(args);
  };
  return { env, fetch: fetchImpl, redis, writes, management, memory, sub };
}

function textOf(json) {
  return json?.result?.content?.[0]?.text || "";
}

function judgeDeps(fake, extra = {}) {
  return { judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL, ...extra };
}

async function postMcp(ctx, body, { token, url = RESOURCE, accept, deps = {} } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (accept) headers.accept = accept;
  const res = await handleMcp(new Request(url, { method: "POST", headers, body: JSON.stringify(body) }), { ...ctx, ...deps });
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) return { res, json: await res.json(), raw: "" };
  const raw = await res.text();
  return { res, json: null, raw };
}

describe("hosted Grill", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  it("stays dark until GRILL_HOSTED=on", async () => {
    const env = { ...baseEnv(), GRILL_HOSTED: "" };
    const deps = { env, fetch: async () => { throw new Error("should not fetch"); }, redis: async () => { throw new Error("should not store"); } };
    for (const call of [
      handleMcp(new Request(RESOURCE, { method: "POST", body: "{}" }), deps),
      handleProtectedResource(new Request("https://mcp.example/.well-known/oauth-protected-resource"), deps),
      handleDecisions(new Request("https://grillyour.ai/decisions"), deps),
      handleAccount(new Request("https://grillyour.ai/account"), deps),
    ]) {
      const res = await call;
      assert.equal(res.status, 404);
    }
  });

  it("answers 401 with the protected-resource header, and publishes the metadata", async () => {
    const ctx = world();
    const res = await handleMcp(new Request(RESOURCE, { method: "POST", body: "{}" }), ctx);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("www-authenticate"), wwwAuthenticate("https://mcp.example"));
    const meta = await handleProtectedResource(new Request("https://mcp.example/.well-known/oauth-protected-resource/mcp"), ctx);
    assert.equal(meta.status, 200);
    const body = await meta.json();
    assert.equal(body.resource, RESOURCE);
    assert.deepEqual(body.authorization_servers, ["https://clerk.example.test"]);
    assert.deepEqual(body.bearer_methods_supported, ["header"]);
    assert.deepEqual(body.scopes_supported, ["openid", "profile", "email"]);
  });

  it("rejects a bad signature, the wrong issuer, an expired token, a missing token, and a query-string token", async () => {
    const ctx = world();
    const good = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
    const cases = [
      ["bad signature", signJwt(claims(), { tamper: true }), RESOURCE],
      ["wrong issuer", signJwt(claims({ iss: "https://evil.example" })), RESOURCE],
      ["expired", signJwt(claims({ exp: Math.floor(Date.now() / 1000) - 120 })), RESOURCE],
      ["missing", "", RESOURCE],
      ["query string", good, `${RESOURCE}?access_token=${good}`],
    ];
    for (const [label, token, url] of cases) {
      const headers = { "content-type": "application/json" };
      if (token && label !== "query string") headers.authorization = `Bearer ${token}`;
      if (label === "query string") headers.authorization = `Bearer ${token}`;
      const res = await handleMcp(
        new Request(url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }),
        ctx,
      );
      assert.equal(res.status, 401, label);
      assert.equal(res.headers.get("www-authenticate"), wwwAuthenticate("https://mcp.example"), label);
    }
  });

  it("negotiates the hosted protocol versions and lists tools with annotations", async () => {
    const ctx = world();
    const token = signJwt(claims());
    for (const version of ["2025-11-25", "2025-06-18", "2025-03-26"]) {
      const { json } = await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version } }, { token });
      assert.equal(json.result.protocolVersion, version);
    }
    const unknown = await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }, { token });
    assert.equal(unknown.json.result.protocolVersion, "2025-11-25");
    const listed = await postMcp(ctx, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { token });
    const tools = listed.json.result.tools;
    assert.deepEqual(tools.map((tool) => tool.name), ["grill", "grill_result", "grill_look_back", "grill_decided"]);
    for (const tool of tools) {
      assert.equal(typeof tool.title, "string");
      assert.equal(typeof tool.annotations.title, "string");
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    }
    const grill = tools[0];
    assert.match(grill.description, /clerk, not an advocate/);
    assert.match(grill.description, /Show it to the user, and call only after they approve/);
    assert.match(grill.description, /openrouter\/auto/);
    assert.match(grill.description, /never falls back to this chat's own model/);
    assert.equal(typeof grill.inputSchema.properties.keep_records, "object");
  });

  it("returns plain JSON unless the client asks only for event streams", async () => {
    const ctx = world();
    const token = signJwt(claims());
    const json = await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "ping" }, { token, accept: "application/json, text/event-stream" });
    assert.match(json.res.headers.get("content-type"), /application\/json/);
    const sse = await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "ping" }, { token, accept: "text/event-stream" });
    assert.match(sse.res.headers.get("content-type"), /text\/event-stream/);
    assert.match(sse.raw, /^event: message\ndata: /);
  });

  describe("the judge stays on openrouter/auto", () => {
    const clients = [
      ["claude", { redirect_uri: CLAUDE_WEB_REDIRECT }, ["anthropic/*", "*/claude-*"]],
      ["claude code", { client_id: CLAUDE_CODE_CLIENT_ID, redirect_uri: "http://127.0.0.1:53111/callback" }, ["anthropic/*", "*/claude-*"]],
      ["chatgpt", { redirect_uri: "https://chatgpt.com/backend-api/aip/connectors/mcp/oauth_callback" }, ["openai/*"]],
      ["grok", { redirect_uri: "https://grok.com/connectors/oauth/callback" }, ["x-ai/*"]],
      ["gemini", { redirect_uri: "https://gemini.google.com/app/oauth" }, ["google/*"]],
    ];
    for (const [label, claim, excluded] of clients) {
      it(`excludes only ${label}, and pins nothing`, async () => {
        const previous = process.env.JUDGE_MODEL;
        process.env.JUDGE_MODEL = "anthropic/claude-sonnet-4";
        const fake = await startFakeOpenRouter({
          chat: (body) => {
            const excluded = body?.plugins?.[0]?.excluded_models || [];
            const model = excluded.some((item) => String(item).startsWith("openai")) ? "google/gemini-2.5-pro" : "openai/gpt-5.6-sol";
            const payload = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/usable-response.json"), "utf8"));
            payload.model = model;
            return { text: JSON.stringify(payload) };
          },
        });
        try {
          const ctx = world();
          const token = signJwt(claims(claim));
          const { json } = await postMcp(
            ctx,
            {
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: "grill", arguments: { subject: `Decision: ship the ${label} plan.\nI'm 70% sure.`, keep_records: false, quality_check: false } },
            },
            { token, deps: { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-03T15:00:00Z") } },
          );
          assert.equal(json.result.isError, false, textOf(json));
          const body = fake.seen.chat[0].body;
          assert.equal(body.model, "openrouter/auto");
          assert.equal(body.models, undefined);
          assert.deepEqual(body.provider, { zdr: true, data_collection: "deny" });
          assert.equal(body.plugins.length, 1);
          assert.equal(body.plugins[0].id, "auto-router");
          assert.deepEqual(body.plugins[0].excluded_models, excluded);
          assert.equal(fake.seen.chat[0].headers.authorization, `Bearer ${USER_KEY}`);
          assert.notEqual(fake.seen.chat[0].headers.authorization, `Bearer ${MGMT_KEY}`);
        } finally {
          if (previous === undefined) delete process.env.JUDGE_MODEL;
          else process.env.JUDGE_MODEL = previous;
          await fake.close();
        }
      });
    }

    it("lets an explicit author win, and uses a clientInfo hint only when the OAuth client is unknown", async () => {
      const fake = await startFakeOpenRouter({
        chat: (body) => {
          const excluded = body?.plugins?.[0]?.excluded_models || [];
          const model = excluded.some((item) => String(item).startsWith("openai"))
            ? "google/gemini-2.5-pro"
            : excluded.some((item) => String(item).startsWith("google"))
              ? "deepseek/deepseek-v4"
              : "openai/gpt-5.6-sol";
          const payload = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/usable-response.json"), "utf8"));
          payload.model = model;
          return { text: JSON.stringify(payload) };
        },
      });
      try {
        const ctx = world();
        const claude = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
        const explicit = await postMcp(
          ctx,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "grill", arguments: { subject: "Decision: switch vendors.", keep_records: false, quality_check: false, author: "openai" } },
          },
          { token: claude, deps: { ...judgeDeps(fake), waitMs: 20_000 } },
        );
        assert.equal(explicit.json.result.isError, false, textOf(explicit.json));
        assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, ["openai/*"]);
        const hinted = signJwt(claims({ sub: "user_invitee" }));
        const hint = await postMcp(
          ctx,
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "grill",
              arguments: { subject: "Decision: wait a week.", keep_records: false, quality_check: false },
              _meta: { clientInfo: { name: "Gemini" } },
            },
          },
          { token: hinted, deps: { ...judgeDeps(fake), waitMs: 20_000 } },
        );
        assert.equal(hint.json.result.isError, false, textOf(hint.json));
        assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, ["google/*"]);
        const blank = signJwt(claims());
        const none = await postMcp(
          ctx,
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "grill", arguments: { subject: "Decision: none named.", keep_records: false, quality_check: false } },
          },
          { token: blank, deps: { ...judgeDeps(fake), waitMs: 20_000 } },
        );
        assert.equal(none.json.result.isError, false, textOf(none.json));
        assert.deepEqual(fake.seen.chat.at(-1).body.plugins[0].excluded_models, []);
      } finally {
        await fake.close();
      }
    });

    it("refuses a verdict served by the excluded company", async () => {
      const fake = await startFakeOpenRouter({ chat: () => ({ text: ANTHROPIC }) });
      try {
        const ctx = world();
        const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
        const { json } = await postMcp(
          ctx,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "grill", arguments: { subject: "Decision: keep the price.", keep_records: false, quality_check: false } },
          },
          { token, deps: { ...judgeDeps(fake), waitMs: 20_000 } },
        );
        assert.equal(json.result.isError, true);
        assert.match(textOf(json), /same company/);
        assert.doesNotMatch(textOf(json), /\*\*Verdict: solid\*\*/);
        assert.equal(fake.seen.chat[0].body.model, "openrouter/auto");
        assert.equal(fake.seen.chat[0].body.models, undefined);
      } finally {
        await fake.close();
      }
    });
  });

  it("asks before the first send, then keeps or skips the record", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const subject = `Decision: ${CANARY}\nI'm 70% sure.`;
      const ask = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject, quality_check: false } } },
        { token, deps: { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-03T15:00:00Z") } },
      );
      assert.equal(ask.json.result.isError, false);
      assert.match(textOf(ask.json), /Keep a record of your decisions on your Grill account\? Yes \/ No/);
      assert.ok(textOf(ask.json).includes(CONSENT_TEXT.split("\n")[0]));
      assert.equal(fake.seen.chat.length, 0);
      assert.equal(ctx.writes.some((row) => row.join(" ").includes(CANARY)), false);

      const kept = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill", arguments: { subject, keep_records: true, quality_check: false } } },
        { token, deps: { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-03T15:00:00Z") } },
      );
      assert.equal(kept.json.result.isError, false, textOf(kept.json));
      assert.match(textOf(kept.json), /Saved to your decisions · look-back on 17 Oct · about \d+ grills of credit left/);
      const parsed = parseRecords(textOf(kept.json));
      assert.equal(parsed[0].source_app, "claude");
      assert.equal(parsed[0].title, CANARY);
      assert.equal(ctx.writes.some((row) => row.join(" ").includes(CANARY)), false);
      assert.equal(ctx.writes.some((row) => row.join(" ").includes(USER_KEY)), false);
      assert.equal(ctx.writes.some((row) => row.join(" ").includes("headline number")), false);

      const offCtx = world({ sub: "user_invitee" });
      const offToken = signJwt(claims());
      const off = await postMcp(
        offCtx,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "grill", arguments: { subject: "Decision: skip the notes.", keep_records: false, quality_check: false } },
        },
        { token: offToken, deps: { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-03T15:00:00Z") } },
      );
      assert.match(textOf(off.json), /^Not saved · about \d+ grills of credit left/m);
      assert.equal(offCtx.writes.some((row) => row[0] === "SET" && row[1].includes(":record:")), false);
    } finally {
      await fake.close();
    }
  });

  it("returns a job id, stores ciphertext, and deletes it on grill_result", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fake = await startFakeOpenRouter({
      chat: () => gate.then(() => ({ text: readFileSync(join(ROOT, "scripts/fixtures/usable-response.json"), "utf8") })),
    });
    const backgrounds = [];
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const pending = postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "grill", arguments: { subject: `Decision: ${CANARY}`, keep_records: true, quality_check: false } },
        },
        { token, deps: { ...judgeDeps(fake), waitMs: 40, backgrounds, now: Date.parse("2026-10-03T15:00:00Z") } },
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      const started = await pending;
      assert.match(textOf(started.json), /Still grilling/);
      const jobId = textOf(started.json).match(/job (g1\.[0-9a-f]{32}\.[A-Za-z0-9_-]+)/)[1];
      const credential = parseJobCredential(jobId);
      release();
      await Promise.all(backgrounds);
      const stored = ctx.writes.filter((row) => row[0] === "SET" && row[1].includes(":job:"));
      assert.ok(stored.length >= 1);
      assert.equal(stored.some((row) => row.join(" ").includes(CANARY) || row.join(" ").includes("headline number")), false);
      const cipher = stored.at(-1)[2];
      const opened = JSON.parse(decryptString(cipher, credential.key));
      assert.match(opened.text, /headline number/);
      const collected = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId } } },
        { token, deps: { waitMs: 500 } },
      );
      assert.match(textOf(collected.json), /Saved to your decisions/);
      const again = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId } } },
        { token, deps: { waitMs: 50 } },
      );
      assert.equal(again.json.result.isError, true);
    } finally {
      release();
      await fake.close();
    }
  });

  it("links a supersedes chain, exports, deletes, and records look-back and decided in the person's words", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-01-10T15:00:00Z") };
      const first = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "grill", arguments: { subject: "Decision: Hire contractor\nI'm 60% sure.", keep_records: true, quality_check: false } },
        },
        { token, deps },
      );
      assert.equal(first.json.result.isError, false, textOf(first.json));
      const second = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "grill",
            arguments: {
              subject: "Decision: Hire in house\nI'm 55% sure.",
              keep_records: true,
              quality_check: false,
              supersedes: "2026-01-10 Hire contractor",
              changed: "evidence — the pilot failed",
            },
          },
        },
        { token, deps: { ...deps, now: Date.parse("2026-02-01T15:00:00Z") } },
      );
      assert.match(textOf(second.json), /supersedes: 2026-01-10 Hire contractor/);
      assert.match(textOf(second.json), /changed: evidence — the pilot failed/);
      assert.doesNotMatch(textOf(second.json), /^superseded-by:/m);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
      const page = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: `__session=${session}` } }), ctx);
      const html = await page.text();
      assert.match(html, /Hire contractor/);
      assert.match(html, /Hire in house/);
      assert.match(html, /Replaces 2026-01-10 Hire contractor/);
      assert.doesNotMatch(html, /flip-flop|consistency score/i);
      assert.doesNotMatch(html, new RegExp(USER_KEY));
      const exported = await handleDecisions(
        new Request("https://grillyour.ai/decisions?export=text&__route=decisions", { headers: { cookie: `__session=${session}` } }),
        ctx,
      );
      const blocks = await exported.text();
      assert.equal(parseRecords(blocks).length, 2);
      assert.match(blocks, /source_app: claude/);
      const asJson = await handleDecisions(
        new Request("https://grillyour.ai/decisions?__route=decisions&export=json", { headers: { cookie: `__session=${session}` } }),
        ctx,
      );
      const rows = JSON.parse(await asJson.text());
      assert.equal(rows.length, 2);
      const decided = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill_decided", arguments: { record_ref: "2026-02-01 Hire in house", decided: "We hired in house." } } },
        { token },
      );
      assert.match(textOf(decided.json), /Added your words/);
      const empty = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "grill_decided", arguments: { record_ref: "2026-02-01 Hire in house", decided: "   " } } },
        { token },
      );
      assert.equal(empty.json.result.isError, true);
      const look = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "grill_look_back", arguments: { happened: "came_true: yes\nhappened: The in-house hire started." } },
        },
        { token, deps: { now: Date.parse("2026-03-01T15:00:00Z") } },
      );
      assert.match(textOf(look.json), /Look back/);
      const after = JSON.parse(await (await handleDecisions(new Request("https://grillyour.ai/decisions?export=json", { headers: { cookie: `__session=${session}` } }), ctx)).text());
      assert.ok(after.some((row) => /in-house hire started/.test(row.lookback?.happened || "")));
      const id = after.find((row) => row.block.includes("Hire in house")).id;
      const removed = await handleDecisions(
        new Request("https://grillyour.ai/decisions", {
          method: "POST",
          headers: { cookie: `__session=${session}`, "content-type": "application/x-www-form-urlencoded" },
          body: `action=delete-chain&id=${id}`,
        }),
        ctx,
      );
      assert.equal(removed.status, 200);
      const left = JSON.parse(await (await handleDecisions(new Request("https://grillyour.ai/decisions?export=json", { headers: { cookie: `__session=${session}` } }), ctx)).text());
      assert.equal(left.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("creates one starter key, hides it, and says so when credit is gone", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000 };
      await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: first.", keep_records: false, quality_check: false } } },
        { token, deps },
      );
      await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: second.", keep_records: false, quality_check: false } } },
        { token, deps },
      );
      assert.equal(ctx.management.creates.length, 1);
      assert.equal(ctx.management.creates[0].name.includes("@"), false);
      assert.equal(ctx.management.creates[0].name.includes("invitee"), false);
      assert.equal(ctx.management.creates[0].limit, 1);
      const secondUser = signJwt(claims({ sub: "user_second", redirect_uri: CLAUDE_WEB_REDIRECT }));
      const shared = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: same email.", keep_records: false, quality_check: false } } },
        { token: secondUser, deps },
      );
      assert.match(textOf(shared.json), /already has a Grill starter credit/);
      assert.equal(ctx.management.creates.length, 1);
      resetHostedCaches();
      ctx.management.usage = 1;
      const before = fake.seen.chat.length;
      const empty = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: no credit.", keep_records: false, quality_check: false } } },
        { token, deps },
      );
      assert.equal(textOf(empty.json), OUT_OF_CREDIT);
      assert.equal(fake.seen.chat.length, before);
      assert.equal(JSON.stringify(empty.json).includes(USER_KEY), false);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
      const account = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: `__session=${session}` } }), ctx);
      const html = await account.text();
      assert.equal(html.includes(USER_KEY), false);
      assert.match(html, /out of grill credit/i);
      const gone = await handleAccount(
        new Request("https://grillyour.ai/account", {
          method: "POST",
          headers: { cookie: `__session=${session}`, "content-type": "application/x-www-form-urlencoded" },
          body: "action=delete-account&confirm=delete",
        }),
        ctx,
      );
      assert.match(await gone.text(), /account is deleted/);
      assert.equal(ctx.management.removed.length, 1);
      assert.equal(ctx.management.removedUsers, 1);
    } finally {
      await fake.close();
    }
  });

  it("stops people who are not on the allowlist before a grill", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world({ email: "other@example.com" });
      const token = signJwt(claims({ sub: "user_other", redirect_uri: CLAUDE_WEB_REDIRECT }));
      const { json } = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: not invited.", keep_records: true, quality_check: false } } },
        { token, deps: { ...judgeDeps(fake), waitMs: 20_000 } },
      );
      assert.equal(textOf(json), INVITE_ONLY);
      assert.equal(fake.seen.chat.length, 0);
      assert.equal(ctx.management.creates.length, 0);
    } finally {
      await fake.close();
    }
  });

  it("reads GRILL_HOSTED_WAIT as auto unless the value is check", () => {
    assert.equal(hostedWaitMode({}), "auto");
    assert.equal(hostedWaitMode({ GRILL_HOSTED_WAIT: "" }), "auto");
    assert.equal(hostedWaitMode({ GRILL_HOSTED_WAIT: "auto" }), "auto");
    assert.equal(hostedWaitMode({ GRILL_HOSTED_WAIT: "later" }), "auto");
    assert.equal(hostedWaitMode({ GRILL_HOSTED_WAIT: " check " }), "check");
    assert.equal(hostedInstructions("auto"), HOSTED_INSTRUCTIONS);
    assert.equal(hostedInstructions("later"), HOSTED_INSTRUCTIONS);
    assert.equal(hostedInstructions(undefined), HOSTED_INSTRUCTIONS);
    assert.notEqual(hostedInstructions("check"), HOSTED_INSTRUCTIONS);
    assert.doesNotMatch(hostedInstructions("check"), /say "check"/);
  });

  it("keeps today's still-running line in auto, including an unknown value, and returns the report when the job finishes", async () => {
    for (const value of [undefined, "auto", "later"]) {
      const row = await waitModeRun(value);
      const expected = `Still grilling (job ${row.jobId}). Call grill_result with job_id "${row.jobId}" to collect the report. A grill usually takes 1–3 minutes.`;
      assert.equal(row.startedText, expected, String(value));
      assert.equal(row.againText, expected, String(value));
      assert.equal(row.doneError, false, String(value));
      assert.match(row.doneText, /Saved to your decisions/, String(value));
      assert.doesNotMatch(row.doneText, /say "check"/, String(value));
      assert.equal(row.instructions, HOSTED_INSTRUCTIONS, String(value));
      assert.match(row.grillDescription, /call grill_result until the verdict arrives/, String(value));
      assert.equal(
        row.resultDescription,
        "Collect the report of a grill that returned a job id. Waits up to 45 seconds; call again if it is still running.",
        String(value),
      );
    }
  });

  it("in check mode, a running job tells the assistant to ask for one word, and a finished job is the report", async () => {
    const row = await waitModeRun("check");
    const expected = `Still grilling (job ${row.jobId}). Tell the user, in one short plain sentence, that the grill is still running and to say "check" in about a minute. When they say check, call grill_result with job_id "${row.jobId}".`;
    assert.equal(row.startedText, expected);
    assert.equal(row.againText, expected);
    assert.equal(row.doneError, false);
    assert.match(row.doneText, /Saved to your decisions/);
    assert.doesNotMatch(row.doneText, /say "check"/);
    assert.match(row.instructions, /follow that result/);
    assert.doesNotMatch(row.instructions, /Do not ask the person to check/);
    assert.doesNotMatch(row.instructions, /say "check"/);
    assert.match(row.grillDescription, /do not call grill_result again on your own/);
    assert.doesNotMatch(row.grillDescription, /until the verdict arrives/);
    assert.match(row.resultDescription, /do not call again on your own/);
    assert.doesNotMatch(row.resultDescription, /say "check"/);
  });
});

describe("one hosted function", () => {
  it("answers DELETE with 405 on the pages, and 404 while hosted is off", async () => {
    const ctx = world();
    for (const call of [
      handleAccount(new Request("https://grillyour.ai/account?__route=account", { method: "DELETE" }), ctx),
      handleDecisions(new Request("https://grillyour.ai/decisions?__route=decisions", { method: "DELETE" }), ctx),
      handleProtectedResource(new Request("https://mcp.example/.well-known/oauth-protected-resource?__route=prm", { method: "DELETE" }), ctx),
    ]) {
      const res = await call;
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "GET, POST");
    }
    const off = { ...ctx, env: { ...ctx.env, GRILL_HOSTED: "" } };
    const dark = await handleAccount(new Request("https://grillyour.ai/account", { method: "DELETE" }), off);
    assert.equal(dark.status, 404);
  });

  it("ignores __route on the sign-in return and on a query token", async () => {
    const ctx = world();
    const back = await handleAccount(new Request("https://grillyour.ai/account?__route=account"), ctx);
    assert.equal(back.status, 302);
    const loc = new URL(back.headers.get("location"));
    assert.equal(loc.origin, "https://accounts.example.test");
    assert.equal(loc.pathname, "/sign-in");
    assert.equal(loc.searchParams.get("redirect_url"), "https://grillyour.ai/account?from=signin");
    const token = signJwt(claims());
    const poisoned = await handleMcp(
      new Request(`${RESOURCE}?__route=mcp&access_token=${token}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      ctx,
    );
    assert.equal(poisoned.status, 401);
    const routed = await handleMcp(
      new Request(`${RESOURCE}?__route=mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      }),
      ctx,
    );
    assert.equal(routed.status, 200);
  });

  it("sends signed-out account pages to the Account Portal, and does not loop", async () => {
    const cases = [
      ["https://named-animal-12.clerk.accounts.dev", "https://named-animal-12.accounts.dev"],
      ["https://clerk.grillyour.ai/", "https://accounts.grillyour.ai"],
      ["https://foo.clerk.accountsstage.dev", "https://foo.accountsstage.dev"],
    ];
    for (const [issuer, portal] of cases) {
      const ctx = world();
      ctx.env.CLERK_ISSUER = issuer;
      const res = await handleAccount(new Request("https://grillyour.ai/account"), ctx);
      assert.equal(res.status, 302);
      const loc = new URL(res.headers.get("location"));
      assert.equal(loc.origin, portal);
      assert.equal(loc.pathname, "/sign-in");
      assert.equal(loc.searchParams.get("redirect_url"), "https://grillyour.ai/account?from=signin");
      assert.equal(loc.hostname.includes("clerk."), false);
    }

    const decisions = world();
    decisions.env.CLERK_ISSUER = "https://clerk.grillyour.ai";
    const listed = await handleDecisions(new Request("https://preview.example/decisions"), decisions);
    const listedLoc = new URL(listed.headers.get("location"));
    assert.equal(listedLoc.origin, "https://accounts.grillyour.ai");
    assert.equal(listedLoc.searchParams.get("redirect_url"), "https://preview.example/decisions?from=signin");

    const custom = world();
    custom.env.CLERK_ISSUER = "https://named-animal-12.clerk.accounts.dev";
    custom.env.CLERK_SIGN_IN_URL = "https://accounts.custom.test/enter";
    const overridden = await handleAccount(new Request("https://grillyour.ai/account"), custom);
    const overLoc = new URL(overridden.headers.get("location"));
    assert.equal(overLoc.origin, "https://accounts.custom.test");
    assert.equal(overLoc.pathname, "/enter");
    assert.equal(overLoc.searchParams.get("redirect_url"), "https://grillyour.ai/account?from=signin");

    const unknown = world();
    unknown.env.CLERK_ISSUER = "https://fapi.example.test";
    const unset = await handleAccount(new Request("https://grillyour.ai/account"), unknown);
    assert.equal(unset.status, 200);
    assert.match(await unset.text(), /CLERK_SIGN_IN_URL/);
    assert.equal(unset.headers.get("location"), null);

    const returned = world();
    const stuck = await handleDecisions(new Request("https://grillyour.ai/decisions?from=signin"), returned);
    assert.equal(stuck.status, 200);
    const body = await stuck.text();
    assert.match(body, /no session for this site/);
    assert.match(body, /https:\/\/accounts\.example\.test\/sign-in/);
    assert.equal(body.includes("clerk.example.test/sign-in"), false);
    assert.equal(stuck.headers.get("location"), null);

    const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
    const home = await handleAccount(
      new Request("https://grillyour.ai/account?from=signin", { headers: { cookie: `__session=${session}` } }),
      world(),
    );
    assert.equal(home.status, 200);
    const signedIn = await home.text();
    assert.match(signedIn, /Your account/);
    assert.equal(signedIn.includes("no session for this site"), false);

    const mcp = await handleMcp(new Request("https://mcp.example/mcp", { method: "POST", body: "{}" }), world());
    assert.equal(mcp.status, 401);
    assert.equal(mcp.headers.get("location"), null);
  });

  it("dispatches /api/hosted by __route, and by the public path", async () => {
    const saved = { hosted: process.env.GRILL_HOSTED, issuer: process.env.CLERK_ISSUER };
    process.env.GRILL_HOSTED = "on";
    process.env.CLERK_ISSUER = "https://clerk.example.test";
    try {
      const { GET, POST, DELETE } = await import("../api/hosted.js");
      const meta = await GET(new Request("https://mcp.example/api/hosted?__route=prm"));
      assert.equal(meta.status, 200);
      assert.equal((await meta.json()).resource, "https://mcp.example/mcp");

      const account = await GET(new Request("https://grillyour.ai/api/hosted?__route=account"));
      assert.equal(account.status, 302);
      assert.equal(new URL(account.headers.get("location")).origin, "https://accounts.example.test");
      assert.equal(new URL(account.headers.get("location")).searchParams.get("redirect_url"), "https://grillyour.ai/account?from=signin");

      const byPath = await GET(new Request("https://grillyour.ai/decisions"));
      assert.equal(byPath.status, 302);
      assert.equal(new URL(byPath.headers.get("location")).origin, "https://accounts.example.test");
      assert.equal(new URL(byPath.headers.get("location")).searchParams.get("redirect_url"), "https://grillyour.ai/decisions?from=signin");

      const removed = await DELETE(new Request("https://grillyour.ai/api/hosted?__route=decisions", { method: "DELETE" }));
      assert.equal(removed.status, 405);

      const mcp = await POST(new Request("https://mcp.example/api/hosted?__route=mcp", { method: "POST", body: "{}" }));
      assert.equal(mcp.status, 401);
      assert.match(mcp.headers.get("www-authenticate"), /oauth-protected-resource/);

      const unknown = await GET(new Request("https://mcp.example/api/hosted"));
      assert.equal(unknown.status, 401);

      process.env.GRILL_HOSTED = "";
      const off = await GET(new Request("https://grillyour.ai/account"));
      assert.equal(off.status, 404);
    } finally {
      if (saved.hosted === undefined) delete process.env.GRILL_HOSTED;
      else process.env.GRILL_HOSTED = saved.hosted;
      if (saved.issuer === undefined) delete process.env.CLERK_ISSUER;
      else process.env.CLERK_ISSUER = saved.issuer;
    }
  });
});

describe("hosted mappings and ledger pins", () => {
  it("maps each OAuth client, and does not let clientInfo override that", () => {
    const table = [
      [{ redirectUri: CLAUDE_WEB_REDIRECT, clientInfo: { name: "ChatGPT" } }, "anthropic", "claude"],
      [{ clientId: CLAUDE_CODE_CLIENT_ID, redirectUri: "http://localhost:8080/callback", clientInfo: { name: "ChatGPT" } }, "anthropic", "claude-code"],
      [{ redirectUri: "https://chatgpt.com/connector/oauth", clientInfo: { name: "Claude" } }, "openai", "chatgpt"],
      [{ redirectUri: "https://grok.com/oauth/callback" }, "x-ai", "grok"],
      [{ redirectUri: "https://gemini.google.com/oauth" }, "google", "gemini"],
      [{ redirectUri: "https://unknown.example/cb" }, "", "unknown"],
      [{ redirectUri: "https://unknown.example/cb", clientInfo: { name: "Gemini" } }, "google", "gemini"],
    ];
    for (const [input, company, sourceApp] of table) {
      assert.deepEqual(sourceAppFromClient(input), { company, sourceApp });
    }
    assert.equal(authorForJudge({ explicit: "openai", company: "anthropic" }).author, "openai");
    assert.equal(authorForJudge({ company: "" }).author, "none");
    assert.equal(sourceAppLabel("claude-code"), "claude-code");
    assert.equal(sourceAppLabel("Claude by Anthropic"), "claude");
  });

  it("links chains without a superseded-by line", () => {
    const rows = [
      { id: "a", date: "2026-01-10", title: "Hire contractor", supersedes: "" },
      { id: "b", date: "2026-02-01", title: "Hire in house", supersedes: "2026-01-10 Hire contractor" },
    ];
    const linked = linkChains(rows);
    assert.equal(linked[1].replacesId, "a");
    assert.deepEqual(linked[0].replacedByIds, ["b"]);
    assert.deepEqual(chainIds(rows, "b").sort(), ["a", "b"]);
    assert.match(footerLine({ saved: true, review: "2026-10-17", remainingUsd: 1 }), /Saved to your decisions · look-back on 17 Oct · about 33 grills of credit left/);
    assert.match(footerLine({ saved: false, remainingUsd: 0 }), /Not saved · about 0 grills of credit left/);
    const key = randomBytes(32);
    const cipher = encryptString("plain decision text", key);
    assert.equal(cipher.includes("plain decision text"), false);
    assert.equal(decryptString(cipher, key), "plain decision text");
  });

  it("does not log decision text, and pins hosted network destinations", () => {
    const files = ["api/_hosted.mjs", "api/hosted.js", "scripts/hostedCore.mjs"];
    for (const file of files) {
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const match of src.matchAll(/console\.(?:log|error|warn|info|debug)\(([^)]*)\)/g)) {
        assert.doesNotMatch(match[1], /subject|report|record|args|body|token|key|email|stderr|stdout/, file);
      }
    }
    const hosted = readFileSync(join(ROOT, "api/_hosted.mjs"), "utf8");
    const urls = [...hosted.matchAll(/https?:\/\/[^\s"'`]+/g)].map((match) => match[0]);
    assert.deepEqual(urls, ["https://api.clerk.com"]);
    const childEnv = hosted.slice(hosted.indexOf("function judgeChildEnv"), hosted.indexOf("function startJudge"));
    assert.doesNotMatch(childEnv, /JUDGE_MODEL/);
    assert.match(hosted, /OPENROUTER_API_KEY: apiKey/);
    const server = readFileSync(join(ROOT, "server/index.mjs"), "utf8");
    assert.doesNotMatch(server, /api\.clerk\.com|upstash|GRILL_HOSTED/);
    const judge = readFileSync(join(ROOT, "scripts/judge.mjs"), "utf8");
    assert.match(judge, /https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.match(judge, /https:\/\/openrouter\.ai\/api\/alpha\/decisions/);
    const ledger = readFileSync(join(ROOT, "docs/DATA-LEDGER.md"), "utf8");
    assert.match(ledger, /15 minutes/);
    assert.match(ledger, /never logged or stored/);
    const principles = readFileSync(join(ROOT, "docs/PRINCIPLES.md"), "utf8");
    assert.match(principles, /passes through Grill's server in memory/);
  });
});

async function waitModeRun(waitValue) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fake = await startFakeOpenRouter({
    chat: () => gate.then(() => ({ text: readFileSync(join(ROOT, "scripts/fixtures/usable-response.json"), "utf8") })),
  });
  const backgrounds = [];
  const ctx = world();
  const env = { ...ctx.env };
  if (waitValue !== undefined) env.GRILL_HOSTED_WAIT = waitValue;
  const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
  const deps = { ...judgeDeps(fake), waitMs: 40, backgrounds, now: Date.parse("2026-10-03T15:00:00Z"), env };
  try {
    const init = await postMcp(
      ctx,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { token, deps },
    );
    const listed = await postMcp(ctx, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { token, deps });
    const pendingCall = postMcp(
      ctx,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "grill", arguments: { subject: `Decision: ${CANARY}`, keep_records: true, quality_check: false } },
      },
      { token, deps },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    const started = await pendingCall;
    const startedText = textOf(started.json);
    const jobId = startedText.match(/job (g1\.[0-9a-f]{32}\.[A-Za-z0-9_-]+)/)[1];
    const again = await postMcp(
      ctx,
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId } } },
      { token, deps: { ...deps, waitMs: 20 } },
    );
    release();
    await Promise.all(backgrounds);
    const done = await postMcp(
      ctx,
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId } } },
      { token, deps: { ...deps, waitMs: 500 } },
    );
    const tools = listed.json.result.tools;
    return {
      startedText,
      againText: textOf(again.json),
      doneText: textOf(done.json),
      doneError: done.json.result.isError,
      jobId,
      instructions: init.json.result.instructions,
      grillDescription: tools.find((tool) => tool.name === "grill").description,
      resultDescription: tools.find((tool) => tool.name === "grill_result").description,
    };
  } finally {
    release();
    await fake.close();
  }
}
