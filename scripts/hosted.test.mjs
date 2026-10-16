// Hosted Grill, behind GRILL_HOSTED. No network: Clerk, Redis and OpenRouter are faked.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeKeys, activeMember, AUTH_METADATA_CACHE_MS, describeError, handleAccount, handleAuthorizationServer, handleCalendar, handleDecisions, handleMcp, handleProtectedResource, resetHostedCaches } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import {
  CLAUDE_CODE_CLIENT_ID,
  CLAUDE_WEB_REDIRECT,
  CONSENT_TEXT,
  INVITE_ONLY,
  OUT_OF_CREDIT,
  SERVICE_CAP_TEXT,
  USER_CAP_TEXT,
  allowlistAllows,
  authorForJudge,
  capBlock,
  isoMonth,
  judgeFailureText,
  monthlyCapUsd,
  serviceFailureText,
  userMonthlyCapUsd,
  chainIds,
  createMemoryRedis,
  decisionHabits,
  decryptString,
  encryptString,
  footerLine,
  linkChains,
  ONCE_DISCLOSURE,
  parseJobCredential,
  sourceAppFromClient,
  wwwAuthenticate,
} from "./hostedCore.mjs";
import { countWords } from "./judgeCore.mjs";
import { ONCE_DISCLOSURE as LOCAL_DISCLOSURE } from "../server/index.mjs";
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
        management.deletedUser = decodeURIComponent(u.split("/").pop());
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

/** The provider ID's link to a Grill person ID, as the server stores it. */
function identKeyFor(env, sub) {
  const ns = createHash("sha256").update(env.CLERK_ISSUER.replace(/\/$/, "")).digest("hex").slice(0, 16);
  return `grill:hosted:ident:${ns}:${sub}`;
}

/** The Grill person ID a signed-in provider ID resolved to. */
function personOf(ctx, sub = "user_invitee") {
  return ctx.memory.command(["GET", identKeyFor(ctx.env, sub)]);
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

  it("counts distinct active people per day, week and month without storing who they are", async () => {
    const ctx = world();
    const now = Date.parse("2026-10-11T12:00:00Z");
    const call = (id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "no_such_tool", arguments: {} } });
    const token = signJwt(claims());
    await postMcp(ctx, call(1), { token, deps: { now } });
    await postMcp(ctx, call(2), { token, deps: { now } });
    const keys = activeKeys(now);
    assert.deepEqual(keys, {
      day: "grill:hosted:active:day:2026-10-11",
      week: "grill:hosted:active:week:2026-W41",
      month: "grill:hosted:active:month:2026-10",
    });
    for (const key of Object.values(keys)) assert.equal(ctx.memory.command(["PFCOUNT", key]), 1);
    const member = activeMember("invitee@example.com", ctx.env);
    assert.match(member, /^[0-9a-f]{32}$/);
    const pfadds = ctx.writes.filter((args) => args[0] === "PFADD");
    assert.ok(pfadds.length >= 3);
    for (const args of pfadds) {
      assert.equal(args[2], member);
      assert.ok(!args.join(" ").includes("invitee@example.com"));
      assert.ok(!args.join(" ").includes("user_invitee"));
    }
    assert.notEqual(member, activeMember("invitee@example.com", { GRILL_METRICS_SALT: "another-salt" }));
    assert.equal(activeMember("invitee@example.com", {}), "");
  });

  it("still answers a tool call when the active count can't be written", async () => {
    const ctx = world();
    const redis = ctx.redis;
    ctx.redis = async (args) => {
      if (args[0] === "PFADD") throw new Error("boom");
      return redis(args);
    };
    const out = await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims()) });
    assert.match(textOf(out.json), /no tool called/);
  });

  it("files a new account under a Grill ID, not the sign-in provider's ID", async () => {
    const ctx = world();
    await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims()) });
    const id = personOf(ctx);
    assert.match(id, /^g_[0-9a-f-]{36}$/);
    assert.ok(ctx.memory.command(["GET", `grill:hosted:acct:${id}`]));
    assert.equal(ctx.memory.command(["GET", "grill:hosted:acct:user_invitee"]), null);
  });

  it("keeps an account made before Grill IDs under its old ID, so nothing moves", async () => {
    const ctx = world();
    const legacy = { id: "user_invitee", email: "invitee@example.com", records: "keep", spend: [], createdAt: "2026-10-01T00:00:00Z" };
    ctx.memory.command(["SET", "grill:hosted:acct:user_invitee", JSON.stringify(legacy)]);
    await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims()) });
    assert.equal(personOf(ctx), "user_invitee");
    assert.equal(JSON.parse(ctx.memory.command(["GET", "grill:hosted:acct:user_invitee"])).records, "keep");
  });

  it("after a switch to a new sign-in provider, the same verified email finds the same records", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const deps = judgeDeps(fake);
      const keep = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: keep this one.", keep_records: true, quality_check: false } } };
      await postMcp(ctx, keep, { token: signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT })), deps });
      const decided = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill_decided", arguments: { decided: "do it" } } };
      await postMcp(ctx, decided, { token: signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT })), deps });
      const before = personOf(ctx);
      const records = ctx.memory.command(["ZRANGE", `grill:hosted:records:${before}`, "0", "-1"]);
      assert.equal(records.length, 1);
      // A new provider: another issuer, another user ID, the same verified email.
      resetHostedCaches();
      ctx.env.CLERK_ISSUER = "https://clerk.other.test";
      const moved = signJwt(claims({ iss: "https://clerk.other.test", sub: "user_elsewhere", redirect_uri: CLAUDE_WEB_REDIRECT }));
      await postMcp(ctx, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: moved, deps });
      assert.equal(personOf(ctx, "user_elsewhere"), before);
      assert.deepEqual(ctx.memory.command(["ZRANGE", `grill:hosted:records:${before}`, "0", "-1"]), records);
      assert.equal(ctx.management.creates.length, 1);
      const session = signJwt({ iss: "https://clerk.other.test", sub: "user_elsewhere", exp: Math.floor(Date.now() / 1000) + 3600 });
      await handleAccount(
        new Request("https://grillyour.ai/account", {
          method: "POST",
          headers: { cookie: `__session=${session}`, "content-type": "application/x-www-form-urlencoded" },
          body: "action=delete-account&confirm=delete",
        }),
        ctx,
      );
      assert.equal(personOf(ctx, "user_elsewhere"), null);
      ctx.env.CLERK_ISSUER = "https://clerk.example.test";
      assert.equal(personOf(ctx, "user_invitee"), null, "the earlier provider's link goes too");
    } finally {
      await fake.close();
    }
  });

  it("an account made before Grill IDs is found again after the switch, through its starter-credit claim", async () => {
    const ctx = world();
    const emailHash = createHash("sha256").update("invitee@example.com").digest("hex");
    const legacy = { id: "user_devinstance", email: "invitee@example.com", records: "keep", spend: [], createdAt: "2026-10-01T00:00:00Z" };
    ctx.memory.command(["SET", "grill:hosted:acct:user_devinstance", JSON.stringify(legacy)]);
    ctx.memory.command(["SET", `grill:hosted:email:${emailHash}`, "user_devinstance"]);
    await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims({ sub: "user_production" })) });
    assert.equal(personOf(ctx, "user_production"), "user_devinstance");
    assert.equal(ctx.memory.command(["GET", `grill:hosted:person:${emailHash}`]), "user_devinstance");
    assert.equal(JSON.parse(ctx.memory.command(["GET", "grill:hosted:acct:user_devinstance"])).records, "keep");
    assert.equal(ctx.memory.command(["GET", `grill:hosted:email:${emailHash}`]), "user_devinstance");
  });

  it("a starter-credit claim held by an agent for its owner doesn't link the owner into the agent's account", async () => {
    const ctx = world();
    const emailHash = createHash("sha256").update("invitee@example.com").digest("hex");
    const agent = { id: "user_agent", email: "agent@inbox.example", human: "invitee@example.com", spend: [], createdAt: "2026-10-01T00:00:00Z" };
    ctx.memory.command(["SET", "grill:hosted:acct:user_agent", JSON.stringify(agent)]);
    ctx.memory.command(["SET", `grill:hosted:email:${emailHash}`, "user_agent"]);
    await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims()) });
    assert.notEqual(personOf(ctx), "user_agent");
  });

  it("an unverified email never links to someone else's records", async () => {
    const ctx = world();
    await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims()) });
    const fetchVerified = ctx.fetch;
    ctx.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/users/user_unverified")) {
        return Response.json({
          id: "user_unverified",
          primary_email_address_id: "idn_1",
          email_addresses: [{ id: "idn_1", email_address: "invitee@example.com", verification: { status: "unverified" } }],
        });
      }
      return fetchVerified(url, init);
    };
    const out = await postMcp(ctx, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "no_such_tool", arguments: {} } }, { token: signJwt(claims({ sub: "user_unverified" })) });
    assert.match(textOf(out.json), /verified email/);
    assert.equal(personOf(ctx, "user_unverified"), null);
  });

  it("a changed email moves the link, so the old address can't reach this account", async () => {
    const ctx = world();
    const call = (id) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "no_such_tool", arguments: {} } });
    await postMcp(ctx, call(1), { token: signJwt(claims()) });
    const me = personOf(ctx);
    const hash = (email) => createHash("sha256").update(email).digest("hex");
    assert.equal(ctx.memory.command(["GET", `grill:hosted:person:${hash("invitee@example.com")}`]), me);
    resetHostedCaches();
    ctx.env.GRILL_HOSTED_ALLOWLIST = "invitee@example.com,renamed@example.com";
    const fetchOld = ctx.fetch;
    ctx.fetch = async (url, init = {}) => {
      if (String(url).endsWith("/v1/users/user_invitee") && !init.method) {
        return Response.json({
          id: "user_invitee",
          primary_email_address_id: "idn_1",
          email_addresses: [{ id: "idn_1", email_address: "renamed@example.com", verification: { status: "verified" } }],
        });
      }
      return fetchOld(url, init);
    };
    await postMcp(ctx, call(2), { token: signJwt(claims()) });
    assert.equal(personOf(ctx), me);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:person:${hash("invitee@example.com")}`]), null);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:person:${hash("renamed@example.com")}`]), me);
  });

  it("stays dark until GRILL_HOSTED=on", async () => {
    const env = { ...baseEnv(), GRILL_HOSTED: "" };
    const deps = { env, fetch: async () => { throw new Error("should not fetch"); }, redis: async () => { throw new Error("should not store"); } };
    for (const call of [
      handleMcp(new Request(RESOURCE, { method: "POST", body: "{}" }), deps),
      handleProtectedResource(new Request("https://mcp.example/.well-known/oauth-protected-resource"), deps),
      handleAuthorizationServer(new Request("https://mcp.example/.well-known/oauth-authorization-server"), deps),
      handleAuthorizationServer(new Request("https://mcp.example/.well-known/openid-configuration/mcp"), deps),
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
    assert.match(grill.description, /Send the decision as the user stated it/);
    assert.match(grill.description, /Do not wait for an OK/);
    assert.match(grill.description, /Do not add a disclosure of your own/);
    assert.match(grill.description, /openrouter\/auto/);
    assert.match(grill.description, /never falls back to this chat's own model/);
    assert.equal(typeof grill.inputSchema.properties.keep_records, "object");
  });

  it("tells the assistant to call grill_result again right now, before any reply", async () => {
    const ctx = world();
    const token = signJwt(claims());
    const init = await postMcp(
      ctx,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { token },
    );
    const instructions = init.json.result.instructions;
    assert.match(
      instructions,
      /If grill returns a job id, call grill_result right now with that job id, before you reply to the person, and keep calling until the note arrives\. Do not ask the person to check, and do not ask them for a job id\./,
    );
    assert.match(instructions, /no code changes, no PRs, no product questions/);
    assert.match(instructions, /Grill's job ends at the verdict and the record/);
    assert.doesNotMatch(instructions, /call grill_result until the report arrives/);
    assert.equal(instructions.includes("—"), false);
    const listed = await postMcp(ctx, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { token });
    const tools = listed.json.result.tools;
    const grill = tools.find((tool) => tool.name === "grill");
    assert.match(grill.description, /Do not tell them the balance or how long it takes/);
    assert.match(
      grill.description,
      /If the result is a job id, call grill_result with that job id right now, before you reply to the person, and keep calling until the verdict arrives\./,
    );
    assert.doesNotMatch(grill.description, /call grill_result until the verdict arrives/);
    assert.equal(
      tools.find((tool) => tool.name === "grill_result").description,
      "Collect a grill that returned a job id, or a later layer of one. This call waits up to 45 seconds. If it is still running, call grill_result again right now with the same job id, before you reply to the person. detail is brief, more, options, or full. Do not write a layer yourself.",
    );
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
      assert.match(textOf(kept.json), /This goes to an outside judge from a different company/);
      assert.match(textOf(kept.json), /Say 'more', 'options', or your call\./);
      assert.doesNotMatch(textOf(kept.json), /grill-record|about \d+ grills of credit left|Quality check/);
      const savedNow = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill_decided", arguments: { decided: "Ship it.", confidence: "70%" } } },
        { token, deps: { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-03T15:00:00Z") } },
      );
      assert.match(textOf(savedNow.json), /Saved\./);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
      const exported = await handleDecisions(
        new Request("https://grillyour.ai/decisions?export=text&__route=decisions", { headers: { cookie: `__session=${session}` } }),
        ctx,
      );
      const parsed = parseRecords(await exported.text());
      assert.equal(parsed[0].source_app, "claude");
      assert.equal(parsed[0].title, CANARY);
      assert.equal(parsed[0].decided, "Ship it.");
      assert.equal(parsed[0].confidence, "70%");
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
      assert.match(textOf(off.json), /Say 'more', 'options', or your call\./);
      assert.doesNotMatch(textOf(off.json), /credit left|grill-record/);
      assert.equal(offCtx.writes.some((row) => row[0] === "SET" && row[1].includes(":record:")), false);
    } finally {
      await fake.close();
    }
  });

  it("saves a quick take when the choice has no confidence", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-11T15:00:00Z") };
      const grilled = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "grill", arguments: { subject: "drop the free tier?", keep_records: true, quality_check: false } },
        },
        { token, deps },
      );
      const shown = textOf(grilled.json);
      assert.equal(grilled.json.result.isError, false, shown);
      assert.equal(LOCAL_DISCLOSURE, ONCE_DISCLOSURE);
      assert.equal(ONCE_DISCLOSURE.includes("\n"), false);
      assert.ok(countWords(ONCE_DISCLOSURE) <= 25, countWords(ONCE_DISCLOSURE));
      assert.ok(countWords(ONCE_DISCLOSURE) >= 12, countWords(ONCE_DISCLOSURE));
      assert.doesNotMatch(ONCE_DISCLOSURE, /Jev|TypeSafe|credit/i);
      assert.equal(shown.split("\n")[0], ONCE_DISCLOSURE);
      assert.match(shown, /^Quick take, on thin input:/m);
      assert.doesNotMatch(shown, /Needs facts|Jev|TypeSafe/);
      const more = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill_result", arguments: { detail: "more" } } },
        { token, deps },
      );
      assert.equal(more.json.result.isError, false, textOf(more.json));
      assert.ok(countWords(textOf(more.json)) <= 80, countWords(textOf(more.json)));
      const options = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill_result", arguments: { detail: "options" } } },
        { token, deps },
      );
      assert.equal(options.json.result.isError, false, textOf(options.json));
      assert.ok(countWords(textOf(options.json)) <= 80, countWords(textOf(options.json)));
      const saved = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "grill_decided", arguments: { decided: "do it" } } },
        { token, deps },
      );
      const confirm = textOf(saved.json).trim();
      assert.equal(saved.json.result.isError, false, confirm);
      assert.equal(confirm, "Saved. Look-back 25 Oct.");
      assert.ok(countWords(confirm) <= 6, countWords(confirm));
      assert.doesNotMatch(confirm, /confidence|%|grill-record|how sure/i);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
      const exported = await handleDecisions(
        new Request("https://grillyour.ai/decisions?export=text&__route=decisions", { headers: { cookie: `__session=${session}` } }),
        ctx,
      );
      const parsed = parseRecords(await exported.text());
      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].decided, "do it");
      assert.equal(parsed[0].confidence, "");
      assert.equal(parsed[0].verdict, "quick take");
    } finally {
      await fake.close();
    }
  });

  it("at the running cap, waits, then tells the assistant to retry without asking for a job id", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      ctx.memory.command(["SET", identKeyFor(ctx.env, "user_invitee"), "g_running"]);
      for (const id of ["a", "b", "c"]) ctx.memory.command(["SADD", "grill:hosted:running:g_running", id]);
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const res = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "grill", arguments: { subject: "Decision: drop the free tier? Paid users cover support.", keep_records: false, quality_check: false } },
        },
        { token, deps: { ...judgeDeps(fake), waitMs: 300 } },
      );
      assert.equal(res.json.result.isError, true);
      assert.match(textOf(res.json), /Wait about 2 minutes, then call grill again yourself/);
      assert.match(textOf(res.json), /Do not ask the person for a job id/);
      assert.doesNotMatch(textOf(res.json), /grill_result/);
      assert.equal(fake.seen.chat.length, 0);
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
      const jobId = textOf(started.json).match(/job (g1\.[0-9a-f]{32}\.[A-Za-z0-9_-]+)/)[1];
      const still = `Still grilling (job ${jobId}). Before you reply to the person, call grill_result again right now with job_id "${jobId}". Do not ask the person to check. That call waits up to 45 seconds, then returns the report or this same line.`;
      assert.equal(textOf(started.json), still);
      assert.equal(still.includes("1–3"), false);
      assert.equal(still.includes("minute"), false);
      const stillRunning = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId } } },
        { token, deps: { waitMs: 20 } },
      );
      assert.equal(textOf(stillRunning.json), still);
      const credential = parseJobCredential(jobId);
      release();
      await Promise.all(backgrounds);
      const stored = ctx.writes.filter((row) => row[0] === "SET" && row[1].includes(":job:"));
      assert.ok(stored.length >= 1);
      assert.equal(stored.some((row) => row.join(" ").includes(CANARY) || row.join(" ").includes("headline number")), false);
      const cipher = stored.at(-1)[2];
      const opened = JSON.parse(decryptString(cipher, credential.key));
      assert.match(opened.text, /headline number|Shaky|Needs facts/);
      const collected = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId } } },
        { token, deps: { waitMs: 500 } },
      );
      assert.match(textOf(collected.json), /Say 'more', 'options', or your call\./);
      assert.doesNotMatch(textOf(collected.json), /credit left|grill-record/);
      const again = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill_result", arguments: { job_id: jobId, detail: "more" } } },
        { token, deps: { waitMs: 50 } },
      );
      assert.equal(again.json.result.isError, false, textOf(again.json));
      assert.match(textOf(again.json), /challenge|Cheap test|flip/i);
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
      const choseFirst = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "grill_decided", arguments: { decided: "Hire the contractor.", confidence: "60%" } } },
        { token, deps },
      );
      assert.match(textOf(choseFirst.json), /Saved\./);
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
      assert.doesNotMatch(textOf(second.json), /supersedes:|grill-record|superseded-by:/);
      const choseSecond = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "grill_decided", arguments: { decided: "We hired in house.", confidence: "55%" } },
        },
        { token, deps: { ...deps, now: Date.parse("2026-02-01T15:00:00Z") } },
      );
      assert.match(textOf(choseSecond.json), /Saved\./);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
      const page = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: `__session=${session}` } }), ctx);
      const html = await page.text();
      assert.match(html, /Hire contractor/);
      assert.match(html, /Hire in house/);
      assert.match(html, /Replaces 2026-01-10 Hire contractor/);
      assert.doesNotMatch(html, /flip-flop|consistency score/i);
      assert.match(html, /Your habits/);
      assert.match(html, /Grills you answered with a choice: 2\./);
      assert.match(html, /Changed course on an earlier call: 1\./);
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
      assert.match(textOf(decided.json), /Saved\./);
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

  it("records who proposed a call and the challenge that changed it, and shows where calls changed", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000, now: Date.parse("2026-10-03T15:00:00Z") };
      const grilled = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: Switch vendor now", keep_records: true, quality_check: false } } },
        { token, deps },
      );
      assert.equal(grilled.json.result.isError, false, textOf(grilled.json));
      const chose = await postMcp(
        ctx,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "grill_decided", arguments: { decided: "Trial two weeks first.", proposed_by: "ai", after: "1" } },
        },
        { token, deps },
      );
      assert.match(textOf(chose.json), /Saved\./);
      const changes = await postMcp(
        ctx,
        { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grill_look_back", arguments: { view: "changes" } } },
        { token, deps },
      );
      const text = textOf(changes.json);
      assert.match(text, /## What changed/);
      assert.match(text, /Read from the records you chose to keep/);
      assert.match(text, /\*\*Switch vendor now\*\* \(AI suggestion\)\. Before: "Switch vendor now", as brought to the grill\. After: "Trial two weeks first\.", after challenge 1\./);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
      const exported = await handleDecisions(
        new Request("https://grillyour.ai/decisions?export=text&__route=decisions", { headers: { cookie: `__session=${session}` } }),
        ctx,
      );
      const [parsed] = parseRecords(await exported.text());
      assert.equal(parsed.proposed_by, "ai");
      assert.equal(parsed.decided, "Trial two weeks first. | after challenge 1");
      const html = await (await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: `__session=${session}` } }), ctx)).text();
      assert.match(html, /Where your calls changed/);
      assert.match(html, /<strong>Switch vendor now<\/strong> \(AI suggestion\)/);
      assert.doesNotMatch(html, /saved you|streak/i);
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
      // Same verified email, another sign-in ID: the same person, still one starter key.
      assert.doesNotMatch(textOf(shared.json), /already has Grill.s free starter credit/);
      assert.equal(personOf(ctx, "user_second"), personOf(ctx));
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
      assert.equal(ctx.management.deletedUser, "user_invitee");
      assert.equal(personOf(ctx), null);
      const emailHash = createHash("sha256").update("invitee@example.com").digest("hex");
      assert.equal(ctx.memory.command(["GET", `grill:hosted:person:${emailHash}`]), null);
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
});

const AGENT_TOKEN = "tok_agent_owner_lookup_do_not_log";
const OWNER_EMAIL = "owner.person@example.com";
const AGENTID_USERINFO = "https://auth.agentid.com/v0/userinfo";

function clerkPerson({ id, email, agent = false, verified = true }) {
  return {
    id,
    primary_email_address_id: "idn_1",
    email_addresses: [{ id: "idn_1", email_address: email, verification: { status: verified ? "verified" : "unverified" } }],
    external_accounts: agent ? [{ provider: "oauth_agentid", verification: { strategy: "oauth_agentid", status: "verified" } }] : [],
  };
}

function tokenPayload(token = AGENT_TOKEN, scopes = ["openid", "email", "profile", "owner_email"]) {
  return { data: [{ object: "oauth_access_token", provider: "oauth_agentid", token, scopes }], total_count: 1 };
}

function agentCtx(users, { tokens = {}, userinfo = Response.json({}) } = {}) {
  const ctx = world();
  ctx.env.GRILL_HOSTED_ALLOWLIST = OWNER_EMAIL;
  const calls = [];
  const inner = ctx.fetch;
  ctx.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    calls.push(u);
    if (u.includes("/oauth_access_tokens/oauth_agentid")) {
      const id = decodeURIComponent(new URL(u).pathname.split("/")[3]);
      const spec = tokens[id];
      if (spec instanceof Response) return spec;
      if (spec) return Response.json(spec);
      return Response.json({ data: [], total_count: 0 });
    }
    if (u === AGENTID_USERINFO) {
      if (typeof userinfo === "function") return userinfo(init);
      return userinfo;
    }
    if (u.startsWith("https://api.clerk.com/v1/users/") && method === "GET") {
      const id = decodeURIComponent(new URL(u).pathname.split("/")[3]);
      if (users[id]) return Response.json(users[id]);
    }
    return inner(url, init);
  };
  ctx.calls = calls;
  return ctx;
}

function askGrill(id = 1) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name: "grill", arguments: { subject: "Decision: ask." } } };
}

function userinfoCalls(ctx) {
  return ctx.calls.filter((url) => url === AGENTID_USERINFO).length;
}

async function storedAccount(ctx, sub) {
  const id = ctx.memory.command(["GET", identKeyFor(ctx.env, sub)]);
  if (!id) return null;
  const raw = await ctx.redis(["GET", `grill:hosted:acct:${id}`]);
  return raw ? JSON.parse(raw) : null;
}

describe("AgentID owner email", () => {
  beforeEach(() => resetHostedCaches());

  it("allows an agent whose own verified email is on the list, without asking AgentID", async () => {
    const ctx = agentCtx(
      { user_invitee: clerkPerson({ id: "user_invitee", email: "invitee@example.com", agent: true }) },
      { tokens: { user_invitee: tokenPayload() }, userinfo: Response.json({ owner_email: "nope@example.com", owner_email_verified: true }) },
    );
    ctx.env.GRILL_HOSTED_ALLOWLIST = "invitee@example.com";
    const { json } = await postMcp(ctx, askGrill(), { token: signJwt(claims({ sub: "user_invitee" })) });
    assert.equal(textOf(json), CONSENT_TEXT);
    assert.equal(userinfoCalls(ctx), 0);
    assert.equal(ctx.calls.some((url) => url.includes("/oauth_access_tokens/")), false);
    assert.equal(ctx.management.creates.length, 1);
  });

  it("allows an agent when the verified owner email is on the list", async () => {
    const errors = [];
    const orig = console.error;
    console.error = (...args) => {
      errors.push(args.map((part) => String(part)).join(" "));
    };
    try {
      const ctx = agentCtx(
        { user_agent: clerkPerson({ id: "user_agent", email: "agent.one@inbox.example", agent: true }) },
        {
          tokens: { user_agent: tokenPayload() },
          userinfo: Response.json({ owner_email: `  ${OWNER_EMAIL.toUpperCase()}  `, owner_email_verified: true }),
        },
      );
      const { json } = await postMcp(ctx, askGrill(), { token: signJwt(claims({ sub: "user_agent" })) });
      assert.equal(textOf(json), CONSENT_TEXT);
      assert.equal(json.result.isError, false);
      assert.equal(userinfoCalls(ctx), 1);
      assert.equal(ctx.management.creates.length, 1);
      const session = signJwt({ iss: "https://clerk.example.test", sub: "user_agent", exp: Math.floor(Date.now() / 1000) + 3600 });
      const page = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: `__session=${session}` } }), ctx);
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, /agent\.one@inbox\.example/);
      assert.equal(html.includes(OWNER_EMAIL), false);
      assert.equal(html.includes(AGENT_TOKEN), false);
      assert.equal(JSON.stringify(ctx.writes).includes(AGENT_TOKEN), false);
      assert.equal(errors.some((line) => line.includes(OWNER_EMAIL) || line.includes(AGENT_TOKEN)), false);
      const row = await storedAccount(ctx, "user_agent");
      assert.equal(row.human, OWNER_EMAIL);
      assert.equal(row.email, "agent.one@inbox.example");
    } finally {
      console.error = orig;
    }
  });

  it("denies an unverified, missing, or unlisted owner email, and a missing token or scope", async () => {
    const cases = [
      ["unverified", Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: false }), tokenPayload(), 1],
      ["verified flag is not boolean true", Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: "true" }), tokenPayload(), 1],
      ["missing email", Response.json({ owner_email_verified: true }), tokenPayload(), 1],
      ["not listed", Response.json({ owner_email: "stranger@example.com", owner_email_verified: true }), tokenPayload(), 1],
      ["missing token", Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: true }), { data: [], total_count: 0 }, 0],
      ["missing scope", Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: true }), tokenPayload(AGENT_TOKEN, ["openid", "email", "profile"]), 0],
    ];
    for (const [label, userinfo, tokens, infoCalls] of cases) {
      resetHostedCaches();
      const ctx = agentCtx(
        { user_agent: clerkPerson({ id: "user_agent", email: "agent.one@inbox.example", agent: true }) },
        { tokens: { user_agent: tokens }, userinfo },
      );
      const { json } = await postMcp(ctx, askGrill(), { token: signJwt(claims({ sub: "user_agent" })) });
      assert.equal(textOf(json), INVITE_ONLY, label);
      assert.equal(json.result.isError, true, label);
      assert.equal(userinfoCalls(ctx), infoCalls, label);
      assert.equal(ctx.management.creates.length, 0, label);
      assert.equal(JSON.stringify(json).includes(AGENT_TOKEN), false, label);
      assert.equal(JSON.stringify(json).includes(OWNER_EMAIL), false, label);
    }
  });

  it("denies when the owner lookup fails, and remembers the miss", async () => {
    const down = agentCtx(
      { user_agent: clerkPerson({ id: "user_agent", email: "agent.one@inbox.example", agent: true }) },
      { tokens: { user_agent: tokenPayload() }, userinfo: () => { throw new Error("agentid down"); } },
    );
    const first = await postMcp(down, askGrill(1), { token: signJwt(claims({ sub: "user_agent" })) });
    const second = await postMcp(down, askGrill(2), { token: signJwt(claims({ sub: "user_agent" })) });
    assert.equal(textOf(first.json), INVITE_ONLY);
    assert.equal(textOf(second.json), INVITE_ONLY);
    assert.equal(userinfoCalls(down), 1);
    assert.equal(down.management.creates.length, 0);
    assert.equal(first.res.status, 200);

    resetHostedCaches();
    const clerkDown = agentCtx(
      { user_agent: clerkPerson({ id: "user_agent", email: "agent.one@inbox.example", agent: true }) },
      { tokens: { user_agent: new Response("no", { status: 502 }) }, userinfo: Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: true }) },
    );
    const denied = await postMcp(clerkDown, askGrill(), { token: signJwt(claims({ sub: "user_agent" })) });
    assert.equal(textOf(denied.json), INVITE_ONLY);
    assert.equal(userinfoCalls(clerkDown), 0);
    assert.equal(clerkDown.management.creates.length, 0);
  });

  it("remembers a verified owner so the next request does not call Clerk or AgentID again", async () => {
    const ctx = agentCtx(
      { user_agent: clerkPerson({ id: "user_agent", email: "agent.one@inbox.example", agent: true }) },
      { tokens: { user_agent: [{ token: AGENT_TOKEN, provider: "oauth_agentid", scopes: "openid email profile owner_email" }] }, userinfo: Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: true }) },
    );
    const token = signJwt(claims({ sub: "user_agent" }));
    const first = await postMcp(ctx, askGrill(1), { token });
    const tokenCalls = ctx.calls.filter((url) => url.includes("/oauth_access_tokens/")).length;
    const infoCalls = userinfoCalls(ctx);
    const second = await postMcp(ctx, askGrill(2), { token });
    assert.equal(textOf(first.json), CONSENT_TEXT);
    assert.equal(textOf(second.json), CONSENT_TEXT);
    assert.equal(tokenCalls, 1);
    assert.equal(infoCalls, 1);
    assert.equal(ctx.calls.filter((url) => url.includes("/oauth_access_tokens/")).length, 1);
    assert.equal(userinfoCalls(ctx), 1);
    const sets = ctx.writes.filter((row) => row[0] === "SET" && row[1] === "grill:hosted:owner:user_agent");
    assert.equal(sets.length, 1);
    assert.equal(sets[0][2], OWNER_EMAIL);
    assert.equal(sets[0][3], "EX");
    assert.equal(sets[0][4], "600");
    assert.equal(ctx.management.creates.length, 1);
  });

  it("lets two agents of one owner share one starter key, and a borrowing delete leaves that key", async () => {
    const users = {
      user_agent_a: clerkPerson({ id: "user_agent_a", email: "agent.a@inbox.example", agent: true }),
      user_agent_b: clerkPerson({ id: "user_agent_b", email: "agent.b@inbox.example", agent: true }),
    };
    const ctx = agentCtx(users, {
      tokens: { user_agent_a: tokenPayload(), user_agent_b: tokenPayload() },
      userinfo: () => Response.json({ owner_email: OWNER_EMAIL, owner_email_verified: true }),
    });
    const first = await postMcp(ctx, askGrill(1), { token: signJwt(claims({ sub: "user_agent_a" })) });
    const second = await postMcp(ctx, askGrill(2), { token: signJwt(claims({ sub: "user_agent_b" })) });
    assert.equal(textOf(first.json), CONSENT_TEXT);
    assert.equal(textOf(second.json), CONSENT_TEXT);
    assert.equal(ctx.management.creates.length, 1);
    const holder = await storedAccount(ctx, "user_agent_a");
    const borrower = await storedAccount(ctx, "user_agent_b");
    assert.equal(holder.human, OWNER_EMAIL);
    assert.equal(borrower.human, OWNER_EMAIL);
    assert.equal(borrower.capFrom, personOf(ctx, "user_agent_a"));
    assert.equal(borrower.keyHash, holder.keyHash);
    assert.ok(borrower.keyHash);
    const session = signJwt({ iss: "https://clerk.example.test", sub: "user_agent_b", exp: Math.floor(Date.now() / 1000) + 3600 });
    const gone = await handleAccount(
      new Request("https://grillyour.ai/account", {
        method: "POST",
        headers: { cookie: `__session=${session}`, "content-type": "application/x-www-form-urlencoded" },
        body: "action=delete-account&confirm=delete",
      }),
      ctx,
    );
    assert.match(await gone.text(), /account is deleted/);
    assert.equal(ctx.management.removed.length, 0);
    const still = await storedAccount(ctx, "user_agent_a");
    assert.equal(still.keyHash, holder.keyHash);
    assert.equal(await storedAccount(ctx, "user_agent_b"), null);
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
    const saved = { hosted: process.env.GRILL_HOSTED, issuer: process.env.CLERK_ISSUER, fetch: globalThis.fetch };
    process.env.GRILL_HOSTED = "on";
    process.env.CLERK_ISSUER = "https://clerk.example.test";
    const metadataFetches = [];
    globalThis.fetch = async (url, init) => {
      metadataFetches.push({ url: String(url), init });
      const kind = String(url).endsWith("/openid-configuration") ? "openid-configuration" : "oauth-authorization-server";
      return Response.json({ issuer: "https://clerk.example.test", kind });
    };
    try {
      const { GET, POST, DELETE, OPTIONS } = await import("../api/hosted.js");
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

      const oauth = await GET(new Request("https://grillyour.ai/api/hosted?__route=oauth"));
      assert.equal(oauth.status, 200);
      assert.equal(oauth.headers.get("access-control-allow-origin"), "*");
      assert.deepEqual(await oauth.json(), { issuer: "https://clerk.example.test", kind: "oauth-authorization-server" });
      assert.deepEqual(metadataFetches.map((call) => call.url), ["https://clerk.example.test/.well-known/oauth-authorization-server"]);

      const oidc = await GET(new Request("https://grillyour.ai/.well-known/openid-configuration/mcp"));
      assert.equal(oidc.status, 200);
      assert.deepEqual(await oidc.json(), { issuer: "https://clerk.example.test", kind: "openid-configuration" });
      assert.equal(metadataFetches.at(-1).url, "https://clerk.example.test/.well-known/openid-configuration");

      const preflight = await OPTIONS(new Request("https://grillyour.ai/.well-known/oauth-authorization-server/mcp", { method: "OPTIONS" }));
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
      const otherPreflight = await OPTIONS(new Request("https://grillyour.ai/account", { method: "OPTIONS" }));
      assert.equal(otherPreflight.status, 405);

      process.env.GRILL_HOSTED = "";
      const off = await GET(new Request("https://grillyour.ai/account"));
      assert.equal(off.status, 404);
      const metadataOff = await GET(new Request("https://grillyour.ai/.well-known/oauth-authorization-server"));
      assert.equal(metadataOff.status, 404);
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.hosted === undefined) delete process.env.GRILL_HOSTED;
      else process.env.GRILL_HOSTED = saved.hosted;
      if (saved.issuer === undefined) delete process.env.CLERK_ISSUER;
      else process.env.CLERK_ISSUER = saved.issuer;
    }
  });
});

describe("authorization server metadata on the connector host", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  const oauthDoc = {
    issuer: "https://clerk.example.test",
    authorization_endpoint: "https://clerk.example.test/oauth/authorize",
    token_endpoint: "https://clerk.example.test/oauth/token",
    registration_endpoint: "https://clerk.example.test/oauth/register",
    code_challenge_methods_supported: ["S256"],
  };
  const oidcDoc = {
    issuer: "https://clerk.example.test",
    authorization_endpoint: "https://clerk.example.test/oauth/authorize",
    userinfo_endpoint: "https://clerk.example.test/oauth/userinfo",
    jwks_uri: "https://clerk.example.test/.well-known/jwks.json",
  };
  const paths = [
    ["https://grillyour.ai/.well-known/oauth-authorization-server", "https://clerk.example.test/.well-known/oauth-authorization-server", oauthDoc],
    ["https://grillyour.ai/.well-known/oauth-authorization-server/mcp", "https://clerk.example.test/.well-known/oauth-authorization-server", oauthDoc],
    ["https://grillyour.ai/.well-known/openid-configuration", "https://clerk.example.test/.well-known/openid-configuration", oidcDoc],
    ["https://grillyour.ai/.well-known/openid-configuration/mcp", "https://clerk.example.test/.well-known/openid-configuration", oidcDoc],
  ];

  function scripted(env = baseEnv()) {
    const calls = [];
    const deps = {
      env,
      now: 1_700_000_000_000,
      calls,
      fetch: async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (url === "https://clerk.example.test/.well-known/oauth-authorization-server") return Response.json(oauthDoc);
        if (url === "https://clerk.example.test/.well-known/openid-configuration") return Response.json(oidcDoc);
        throw new Error(`unexpected fetch ${url}`);
      },
    };
    return deps;
  }

  it("serves Clerk's documents as JSON with CORS, and does not rewrite them", async () => {
    const deps = scripted();
    for (const [path, upstream, doc] of paths) {
      resetHostedCaches();
      deps.calls.length = 0;
      const res = await handleAuthorizationServer(new Request(path, { headers: { authorization: "Bearer secret-token", cookie: "sid=secret" } }), deps);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get("content-type"), "application/json", path);
      assert.equal(res.headers.get("access-control-allow-origin"), "*", path);
      assert.equal(res.headers.get("cache-control"), "public, max-age=60", path);
      assert.deepEqual(await res.json(), doc, path);
      assert.equal(deps.calls.length, 1, path);
      assert.equal(deps.calls[0].url, upstream, path);
      assert.equal(deps.calls[0].init.redirect, "follow", path);
      assert.deepEqual(deps.calls[0].init.headers, { accept: "application/json" }, path);
      assert.equal(JSON.stringify(deps.calls[0].init).includes("secret"), false, path);
    }

    const prm = await handleProtectedResource(new Request("https://grillyour.ai/.well-known/oauth-protected-resource/mcp"), deps);
    assert.equal(prm.status, 200);
    assert.equal(prm.headers.get("access-control-allow-origin"), null);
    assert.equal(prm.headers.get("cache-control"), "no-store");
    assert.deepEqual(await prm.json(), {
      resource: "https://grillyour.ai/mcp",
      authorization_servers: ["https://clerk.example.test"],
      scopes_supported: ["openid", "profile", "email"],
      bearer_methods_supported: ["header"],
    });
    assert.equal(deps.calls.length, 1);
  });

  it("caches a good read briefly, shares the /mcp form with the root, and refetches after the window", async () => {
    const deps = scripted();
    const root = "https://grillyour.ai/.well-known/oauth-authorization-server";
    const inserted = "https://grillyour.ai/.well-known/oauth-authorization-server/mcp";
    const first = await handleAuthorizationServer(new Request(root), deps);
    assert.equal(first.status, 200);
    assert.equal(deps.calls.length, 1);
    const again = await handleAuthorizationServer(new Request(inserted), deps);
    assert.deepEqual(await again.json(), oauthDoc);
    assert.equal(deps.calls.length, 1);

    const head = await handleAuthorizationServer(new Request(root, { method: "HEAD" }), deps);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("access-control-allow-origin"), "*");
    assert.equal(head.headers.get("content-type"), "application/json");
    assert.equal(deps.calls.length, 1);

    deps.now += AUTH_METADATA_CACHE_MS - 1;
    await handleAuthorizationServer(new Request(root), deps);
    assert.equal(deps.calls.length, 1);
    deps.now += 1;
    const expired = await handleAuthorizationServer(new Request(root), deps);
    assert.equal(expired.status, 200);
    assert.equal(deps.calls.length, 2);

    const oidc = await handleAuthorizationServer(new Request("https://grillyour.ai/.well-known/openid-configuration/mcp"), deps);
    assert.deepEqual(await oidc.json(), oidcDoc);
    assert.equal(deps.calls.at(-1).url, "https://clerk.example.test/.well-known/openid-configuration");
    assert.equal(deps.calls.length, 3);

    deps.env = { ...deps.env, CLERK_ISSUER: "https://clerk.example.test/" };
    resetHostedCaches();
    deps.calls.length = 0;
    const slash = await handleAuthorizationServer(new Request(inserted), deps);
    assert.equal(slash.status, 200);
    assert.equal(deps.calls[0].url, "https://clerk.example.test/.well-known/oauth-authorization-server");
  });

  it("redirects when Clerk cannot be read, and does not cache the miss", async () => {
    const cases = [
      ["status", async () => new Response("missing", { status: 404 })],
      ["throw", async () => { throw new Error("network"); }],
      ["text", async () => new Response("nope", { status: 200, headers: { "content-type": "text/plain" } })],
      ["array", async () => Response.json(["not", "a document"])],
    ];
    for (const [label, fetchImpl] of cases) {
      resetHostedCaches();
      const calls = [];
      const deps = {
        env: baseEnv(),
        now: 1_700_000_000_000,
        fetch: async (url, init) => {
          calls.push(String(url));
          return fetchImpl(url, init);
        },
      };
      const path = "https://grillyour.ai/.well-known/oauth-authorization-server/mcp";
      const res = await handleAuthorizationServer(new Request(path), deps);
      assert.equal(res.status, 302, label);
      assert.equal(res.headers.get("location"), "https://clerk.example.test/.well-known/oauth-authorization-server", label);
      assert.equal(res.headers.get("access-control-allow-origin"), "*", label);
      assert.equal(res.headers.get("cache-control"), "no-store", label);
      deps.fetch = async () => Response.json(oauthDoc);
      const next = await handleAuthorizationServer(new Request(path), deps);
      assert.equal(next.status, 200, label);
      assert.deepEqual(await next.json(), oauthDoc, label);
      assert.equal(calls.length, 1, label);
    }
  });

  it("answers a preflight, refuses other methods, and does not fetch without an issuer", async () => {
    const deps = scripted();
    const path = "https://grillyour.ai/.well-known/openid-configuration";
    const preflight = await handleAuthorizationServer(new Request(path, { method: "OPTIONS" }), deps);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
    assert.equal(deps.calls.length, 0);

    for (const method of ["POST", "DELETE"]) {
      const res = await handleAuthorizationServer(new Request(path, { method }), deps);
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.get("allow"), "GET, HEAD, OPTIONS", method);
      assert.equal(res.headers.get("access-control-allow-origin"), "*", method);
    }
    assert.equal(deps.calls.length, 0);

    const missing = scripted({ ...baseEnv(), CLERK_ISSUER: "  " });
    const broken = await handleAuthorizationServer(new Request(path), missing);
    assert.equal(broken.status, 500);
    assert.match(await broken.text(), /sign-in/);
    assert.equal(missing.calls.length, 0);

    const off = scripted({ ...baseEnv(), GRILL_HOSTED: "" });
    const dark = await handleAuthorizationServer(new Request(path, { method: "OPTIONS" }), off);
    assert.equal(dark.status, 404);
    assert.equal(off.calls.length, 0);
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

  it("counts decision habits from the person's own records only", () => {
    const block = (confidence) => `version: 1\ndate: 2026-01-10\ntitle: T\nverdict: shaky\nconfidence: ${confidence}\nreview: 2026-01-20`;
    const now = Date.parse("2026-02-01T00:00:00Z");
    const habits = decisionHabits({
      records: [
        { block: block("70%"), review: "2026-01-20", supersedes: "", lookback: { happened: "it held" } },
        { block: block(""), review: "2026-03-01", supersedes: "2026-01-10 T" },
      ],
      waiting: 1,
      now,
    });
    assert.deepEqual(
      { ...habits, prompt: undefined },
      { decided: 2, waiting: 1, withConfidence: 1, changedCourse: 1, due: 1, lookedBack: 1, prompt: undefined },
    );
    assert.equal(habits.prompt, "");
    assert.match(decisionHabits({ records: [], waiting: 3, now }).prompt, /end without a choice/);
    assert.match(decisionHabits({ records: [{ block: block("") }, { block: block("") }], now }).prompt, /how sure you are/);
    assert.match(decisionHabits({ records: [{ block: block("60%"), review: "2026-01-20" }], now }).prompt, /1 look-back is due/);
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
    const apiFns = readdirSync(join(ROOT, "api")).filter((name) => name.endsWith(".js") && !name.startsWith("_"));
    assert.ok(apiFns.length <= 12, apiFns.join(", "));
    const hosted = readFileSync(join(ROOT, "api/_hosted.mjs"), "utf8");
    const urls = [...hosted.matchAll(/https?:\/\/[^\s"'`]+/g)].map((match) => match[0]);
    // The Google Calendar address is a subscribe link on the page for the person to click. The server never fetches it.
    assert.deepEqual(urls, ["https://api.clerk.com", "https://auth.agentid.com/v0/userinfo", "https://calendar.google.com/calendar/r"]);
    assert.doesNotMatch(hosted, /fetch\([^)]*GOOGLE_CALENDAR_SUBSCRIBE/);
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
    assert.match(ledger, /Calendar link/);
    const principles = readFileSync(join(ROOT, "docs/PRINCIPLES.md"), "utf8");
    assert.match(principles, /passes through Grill's server in memory/);
  });
});

describe("hosted Grill: spending caps, open sign-up, races and plain errors", () => {
  beforeEach(() => resetHostedCaches());

  const grillCall = (id, subject) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "grill", arguments: { subject, keep_records: false, quality_check: false } },
  });

  it("reads the caps from env with safe defaults", () => {
    assert.equal(monthlyCapUsd({}), 20);
    assert.equal(userMonthlyCapUsd({}), 1);
    assert.equal(monthlyCapUsd({ GRILL_MONTHLY_CAP_USD: "35" }), 35);
    assert.equal(monthlyCapUsd({ GRILL_MONTHLY_CAP_USD: "nonsense" }), 20);
    assert.equal(monthlyCapUsd({ GRILL_MONTHLY_CAP_USD: "-4" }), 20);
    assert.equal(monthlyCapUsd({ GRILL_MONTHLY_CAP_USD: "0" }), 0);
    assert.equal(capBlock({ serviceMicros: 19_999_999, userMicros: 0 }), null);
    assert.equal(capBlock({ serviceMicros: 20_000_000, userMicros: 0 }).text, SERVICE_CAP_TEXT);
    assert.equal(capBlock({ serviceMicros: 0, userMicros: 1_000_000 }).text, USER_CAP_TEXT);
    for (const text of [SERVICE_CAP_TEXT, USER_CAP_TEXT]) {
      assert.doesNotMatch(text, /\b[45]\d\d\b|error|code/i);
      assert.match(text, /Nothing was charged to you/);
    }
  });

  it("stops a grill with a plain message once the service cap is reached, before any judge call", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      ctx.env.GRILL_MONTHLY_CAP_USD = "5";
      await ctx.memory.command(["SET", `grill:hosted:capspend:all:${isoMonth()}`, "5000000"]);
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const before = fake.seen.chat.length;
      const { json } = await postMcp(ctx, grillCall(1, "Decision: capped."), { token, deps: { ...judgeDeps(fake), waitMs: 20_000 } });
      assert.equal(textOf(json), SERVICE_CAP_TEXT);
      assert.equal(json.result.isError, false);
      assert.equal(fake.seen.chat.length, before);
    } finally {
      await fake.close();
    }
  });

  it("counts each finished grill against the service and the person, and stops the person at their cap", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      ctx.env.GRILL_USER_MONTHLY_CAP_USD = "0.01";
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000 };
      const first = await postMcp(ctx, grillCall(1, "Decision: first of the month."), { token, deps });
      assert.equal(first.json.result.isError, false, textOf(first.json));
      const month = isoMonth();
      const all = Number(await ctx.memory.command(["GET", `grill:hosted:capspend:all:${month}`]));
      assert.ok(all > 0, "service counter moved");
      const personKeys = ctx.writes.filter((row) => row[0] === "INCRBY" && row[1].includes(":capspend:person:"));
      assert.equal(personKeys.length, 1);
      assert.equal(personKeys[0][1].includes("invitee"), false, "the person key is a hash, not the email");
      const second = await postMcp(ctx, grillCall(2, "Decision: second."), { token, deps });
      assert.equal(textOf(second.json), USER_CAP_TEXT);
    } finally {
      await fake.close();
    }
  });

  it("keeps the invite list unless GRILL_OPEN_SIGNUP is on, and an empty list lets nobody in", () => {
    assert.equal(allowlistAllows("a@example.com", { GRILL_HOSTED_ALLOWLIST: "a@example.com" }), true);
    assert.equal(allowlistAllows("b@example.com", { GRILL_HOSTED_ALLOWLIST: "a@example.com" }), false);
    assert.equal(allowlistAllows("b@example.com", {}), false);
    assert.equal(allowlistAllows("b@example.com", { GRILL_HOSTED_ALLOWLIST: " " }), false);
    assert.equal(allowlistAllows("b@example.com", { GRILL_OPEN_SIGNUP: "1" }), false);
    assert.equal(allowlistAllows("b@example.com", { GRILL_OPEN_SIGNUP: "on" }), true);
    assert.equal(allowlistAllows("", { GRILL_OPEN_SIGNUP: "on" }), false);
  });

  it("lets any verified email grill when open sign-up is on", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world({ email: "stranger@example.com" });
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000 };
      const shut = await postMcp(ctx, grillCall(1, "Decision: closed door."), { token, deps });
      assert.equal(textOf(shut.json), INVITE_ONLY);
      ctx.env.GRILL_OPEN_SIGNUP = "on";
      resetHostedCaches();
      const open = await postMcp(ctx, grillCall(2, "Decision: open door."), { token, deps });
      assert.equal(open.json.result.isError, false, textOf(open.json));
    } finally {
      await fake.close();
    }
  });

  it("two grills finishing together keep both spend rows, show the disclosure once, and never rewrite the account", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000 };
      // Create the account and starter key first, so both grills below start from the same stored record.
      await postMcp(ctx, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "grill", arguments: { subject: "" , keep_records: false } } }, { token, deps });
      const setupWrites = ctx.writes.length;
      const [a, b] = await Promise.all([
        postMcp(ctx, grillCall(2, "Decision: race A."), { token, deps }),
        postMcp(ctx, grillCall(3, "Decision: race B."), { token, deps }),
      ]);
      const texts = [textOf(a.json), textOf(b.json)];
      assert.equal(texts.filter((text) => text.includes(ONCE_DISCLOSURE)).length, 1, texts.join("\n---\n"));
      const me = personOf(ctx);
      const log = await ctx.memory.command(["LRANGE", `grill:hosted:spendlog:${me}`, "0", "-1"]);
      assert.equal(log.length, 2);
      const acctWritesAfterSetup = ctx.writes.slice(setupWrites).filter((row) => row[0] === "SET" && row[1] === `grill:hosted:acct:${me}`);
      const raw = await ctx.memory.command(["GET", `grill:hosted:acct:${me}`]);
      assert.equal(JSON.parse(raw).records, "off");
      assert.equal(acctWritesAfterSetup.length, 0, `account rewritten ${acctWritesAfterSetup.length} times`);
    } finally {
      await fake.close();
    }
  });

  it("two first record writes at once agree on one data key", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const deps = { ...judgeDeps(fake), waitMs: 20_000 };
      const keep = (id, subject) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "grill", arguments: { subject, keep_records: true, quality_check: false } },
      });
      await Promise.all([postMcp(ctx, keep(1, "Decision: keep A."), { token, deps }), postMcp(ctx, keep(2, "Decision: keep B."), { token, deps })]);
      const rkeySets = ctx.writes.filter((row) => row[0] === "SET" && row[1] === `grill:hosted:rkey:${personOf(ctx)}`);
      assert.ok(rkeySets.every((row) => row.includes("NX")));
      for (const id of [3, 4]) {
        const decided = await postMcp(
          ctx,
          { jsonrpc: "2.0", id, method: "tools/call", params: { name: "grill_decided", arguments: { decided: `go ${id}` } } },
          { token, deps },
        );
        assert.equal(decided.json.result.isError, false, textOf(decided.json));
      }
    } finally {
      await fake.close();
    }
  });

  it("explains failures in plain words, with no codes or traces", () => {
    const cases = [
      ["[judge] ERROR: refusing a correlated verdict — x", /same company/],
      ["[judge] ERROR: OpenRouter 402 insufficient credits", /out of grill credit/],
      ["[judge] ERROR: the subject contains what looks like an API key. Nothing was sent.", /password, key or token/],
      ["[judge] router retry: openrouter/auto · http_429", /busy/],
      ["[judge] abandoned the walk after the deadline", /took too long/],
      ["[judge] chain advance: transport", /couldn't reach the judge/],
      ["", /didn't send back a verdict/],
    ];
    for (const [stderr, want] of cases) {
      const text = judgeFailureText(stderr, "ab12cd34");
      assert.match(text, want, stderr);
      assert.doesNotMatch(text, /\[judge\]|ERROR|http_|stack/);
    }
    for (const code of ["store", "clerk", "starter-key", "key-encryption", "clerk-delete", ""]) {
      const text = serviceFailureText(code, "ab12cd34");
      assert.match(text, /Try again|write to support/);
      assert.match(text, /reference ab12cd34/);
    }
  });

  it("answers a broken tool call with a plain tool result, not a failed request", async () => {
    const ctx = world();
    const broken = { ...ctx, redis: async () => { throw new Error("boom"); } };
    resetHostedCaches();
    const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
    const { res, json } = await postMcp(broken, grillCall(1, "Decision: storage down."), { token });
    assert.equal(res.status, 200);
    assert.equal(json.result.isError, true);
    assert.match(textOf(json), /Try again in a minute/);
  });

  it("redacts key-shaped strings from logged error messages", () => {
    const line = describeError(new TypeError(`bad sk-or-v1-abcdefgh${"x".repeat(40)} and ${"Q".repeat(48)} end`));
    assert.match(line, /^TypeError\/TypeError: /);
    assert.doesNotMatch(line, /x{20}|Q{20}/);
    assert.ok(line.length < 220);
  });
});

describe("look-back reminders", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  const JAN = Date.parse("2026-01-01T15:00:00Z");
  const FEB = Date.parse("2026-02-01T15:00:00Z");
  const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const session = () => signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
  const page = async (ctx, handler, path, { now, body } = {}) => {
    const headers = { cookie: `__session=${session()}` };
    if (body) headers["content-type"] = "application/x-www-form-urlencoded";
    const res = await handler(new Request(`https://grillyour.ai${path}`, body ? { method: "POST", headers, body } : { headers }), { ...ctx, now });
    return res.text();
  };
  const feed = (ctx, url, now = FEB) => handleCalendar(new Request(url), { ...ctx, now });
  const linkIn = (html) => html.match(/https:\/\/grillyour\.ai\/decisions\/calendar\/([A-Za-z0-9_-]{43})\.ics/)?.[1] || "";

  async function decide(ctx, fake, token, title, now) {
    const deps = { ...judgeDeps(fake), now };
    const grilled = await postMcp(ctx, call(1, "grill", { subject: `Decision: ${title}\nI'm 60% sure.`, keep_records: true, quality_check: false }), { token, deps });
    assert.equal(grilled.json.result.isError, false, textOf(grilled.json));
    return textOf((await postMcp(ctx, call(2, "grill_decided", { decided: `Go with ${title}.` }), { token, deps })).json);
  }

  it("reminds once a day in chat, lists what is due, and serves a private calendar link", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      const first = await decide(ctx, fake, token, "Hire contractor", JAN);
      assert.equal(first, "Saved. Look-back 15 Jan.");

      // A month later the first call is overdue. The next choice says so once, as a count with no title.
      const second = await decide(ctx, fake, token, "Move office", FEB);
      assert.equal(second, 'Saved. Look-back 15 Feb.\n1 earlier call is due for a look-back. Say "look back" when you\'re ready.');
      const third = await decide(ctx, fake, token, "Cut prices", FEB);
      assert.equal(third, "Saved. Look-back 15 Feb.");

      // The due list names only what waits for a look-back.
      let html = await page(ctx, handleDecisions, "/decisions", { now: FEB });
      assert.match(html, /Due for a look-back/);
      assert.match(html, /Hire contractor · review 2026-01-15 · 17 days overdue/);
      assert.doesNotMatch(html, /<li>Move office/);
      assert.match(html, /Get a calendar link/);

      // Off by default: there is no link to fetch.
      assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar/${"a".repeat(43)}.ics`)).status, 404);

      html = await page(ctx, handleDecisions, "/decisions", { now: FEB, body: "action=calendar&value=on" });
      const link = linkIn(html);
      assert.ok(link, "the new link is shown once");
      assert.match(html, /shown only once/);
      assert.match(html, /webcal:\/\/grillyour\.ai\/decisions\/calendar\//);
      // Stored only as a hash.
      assert.ok(!ctx.writes.some((args) => args.join(" ").includes(link)));
      assert.equal(linkIn(await page(ctx, handleDecisions, "/decisions", { now: FEB })), "");

      let res = await feed(ctx, `https://grillyour.ai/decisions/calendar/${link}.ics`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type"), /^text\/calendar/);
      assert.match(res.headers.get("cache-control"), /no-store/);
      let ics = await res.text();
      assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
      assert.equal(ics.match(/BEGIN:VEVENT/g).length, 3);
      assert.match(ics, /DTSTART;VALUE=DATE:20260115/);
      assert.match(ics, /SUMMARY:Grill look-back due\r\n/);
      for (const word of ["Hire contractor", "Move office", "Cut prices", "Go with", "60%"]) assert.ok(!ics.includes(word), word);
      // The rewrite form: the link arrives as a query parameter.
      assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar?t=${link}.ics`)).status, 200);

      // Titles only when switched on, and the link stays the same.
      await page(ctx, handleAccount, "/account", { body: "action=calendar&value=titles-on" });
      ics = await (await feed(ctx, `https://grillyour.ai/decisions/calendar/${link}.ics`)).text();
      assert.match(ics, /SUMMARY:Grill look-back due: Hire contractor/);

      // A look-back takes the call out of the feed, and out of the next "look back".
      const look = await postMcp(ctx, call(3, "grill_look_back", { happened: "came_true: yes\nhappened: The contractor shipped." }), { token, deps: { now: FEB } });
      assert.match(textOf(look.json), /Saved with your decision record/);
      ics = await (await feed(ctx, `https://grillyour.ai/decisions/calendar/${link}.ics`)).text();
      assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2);
      assert.ok(!ics.includes("Hire contractor"));
      const again = await postMcp(ctx, call(4, "grill_look_back", {}), { token, deps: { now: FEB } });
      assert.match(textOf(again.json), /No saved decision is due/);
      assert.doesNotMatch(await page(ctx, handleDecisions, "/decisions", { now: FEB }), /Due for a look-back/);

      // Reset: the old link stops working, the new one keeps the titles choice.
      html = await page(ctx, handleAccount, "/account", { body: "action=calendar&value=reset" });
      const next = linkIn(html);
      assert.ok(next && next !== link);
      assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar/${link}.ics`)).status, 404);
      assert.match(await (await feed(ctx, `https://grillyour.ai/decisions/calendar/${next}.ics`)).text(), /Move office/);

      // Off.
      await page(ctx, handleDecisions, "/decisions", { body: "action=calendar&value=off" });
      assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar/${next}.ics`)).status, 404);
    } finally {
      await fake.close();
    }
  });

  it("deleting the account revokes the calendar link", async () => {
    const fake = await startFakeOpenRouter();
    try {
      const ctx = world();
      const token = signJwt(claims({ redirect_uri: CLAUDE_WEB_REDIRECT }));
      await decide(ctx, fake, token, "Hire contractor", JAN);
      const link = linkIn(await page(ctx, handleAccount, "/account", { body: "action=calendar&value=on" }));
      assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar/${link}.ics`)).status, 200);
      await page(ctx, handleAccount, "/account", { body: "action=delete-account&confirm=delete" });
      assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar/${link}.ics`)).status, 404);
      assert.ok(!ctx.memory.command(["GET", `grill:hosted:calfeed:${createHash("sha256").update(link).digest("hex")}`]));
    } finally {
      await fake.close();
    }
  });

  it("answers 404 for a malformed link, and for every link while hosted is off", async () => {
    const ctx = world();
    assert.equal((await feed(ctx, "https://grillyour.ai/decisions/calendar/short.ics")).status, 404);
    ctx.env.GRILL_HOSTED = "off";
    assert.equal((await feed(ctx, `https://grillyour.ai/decisions/calendar/${"a".repeat(43)}.ics`)).status, 404);
    assert.equal((await handleCalendar(new Request(`https://grillyour.ai/decisions/calendar/${"a".repeat(43)}.ics`, { method: "POST" }), ctx)).status, 404);
  });
});

