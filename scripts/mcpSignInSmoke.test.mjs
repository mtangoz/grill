// Hosted sign-in for two MCP clients. Clerk, the network, and a signed-in person are faked.
// The opt-in read of production is scripts/mcpSignInLive.mjs. This file does not run it.
import { createSign } from "node:crypto";
import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleAuthorizationServer, handleMcp, handleProtectedResource, resetHostedCaches } from "../api/_hosted.mjs";
import { wwwAuthenticate } from "./hostedCore.mjs";
import { allowedProtectedResourceUrl, assessDiscovery, checkMcpSignIn, resourceMetadataUrl } from "./mcpSignInLive.mjs";
import { testSigningKey } from "./testSigningKey.mjs";

const SITE = "https://mcp.example.test";
const ISSUER = "https://clerk.mcp.example.test";
const RESOURCE = `${SITE}/mcp`;
// Claude's hosted apps: web, desktop, mobile, and Cowork.
const CLAUDE_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
// ChatGPT's stable callback, used when the authorization server advertises issuer identification.
const CHATGPT_REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";

const CLIENTS = [
  { name: "Claude", redirectUri: CLAUDE_REDIRECT },
  { name: "ChatGPT", redirectUri: CHATGPT_REDIRECT },
];

let privateKey;
let jwk;
before(async () => {
  ({ privateKey, jwk } = await testSigningKey());
});

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${sig}`;
}

function tokenFor(clientId, redirectUri, { aud = RESOURCE, sub = "user_two_apps" } = {}) {
  return signJwt({
    iss: ISSUER,
    sub,
    aud,
    azp: clientId,
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
}

function clerkDocuments() {
  const oauth = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    revocation_endpoint: `${ISSUER}/oauth/token/revoke`,
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    authorization_response_iss_parameter_supported: true,
  };
  // Clerk's OpenID document advertises refresh and leaves dynamic registration off this URL.
  const openid = {
    issuer: ISSUER,
    authorization_endpoint: oauth.authorization_endpoint,
    token_endpoint: oauth.token_endpoint,
    jwks_uri: `${ISSUER}/.well-known/jwks.json`,
    grant_types_supported: oauth.grant_types_supported,
    scopes_supported: oauth.scopes_supported,
  };
  return { oauth, openid };
}

function boot() {
  const { oauth, openid } = clerkDocuments();
  const registrations = [];
  const serverFetches = [];
  const env = {
    GRILL_HOSTED: "on",
    CLERK_ISSUER: ISSUER,
    CLERK_JWKS_URL: `${ISSUER}/jwks.json`,
    CLERK_SECRET_KEY: "sk_test_unused",
  };
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u === `${ISSUER}/.well-known/oauth-authorization-server`) return Response.json(oauth);
    if (u === `${ISSUER}/.well-known/openid-configuration`) return Response.json(openid);
    if (u === oauth.registration_endpoint && method === "POST") {
      const body = JSON.parse(init.body);
      const created = {
        client_id: `client_${body.client_name}`,
        client_id_issued_at: 1_700_000_000,
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
        grant_types: body.grant_types,
        response_types: body.response_types,
        token_endpoint_auth_method: body.token_endpoint_auth_method,
      };
      registrations.push(created);
      return Response.json(created, { status: 201 });
    }
    throw new Error(`unexpected ${method} ${u}`);
  };
  const deps = {
    env,
    fetch: async (url, init) => {
      serverFetches.push(String(url));
      return fetch(url, init);
    },
  };
  return { deps, oauth, openid, registrations, serverFetches, fetch };
}

async function post(deps, { token, method, params }) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await handleMcp(
    new Request(RESOURCE, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
    deps,
  );
  const json = await res.json().catch(() => null);
  return { res, json };
}

async function discoveryFromHandlers(deps, clerkFetch) {
  const denied = await post(deps, { method: "ping" });
  const www = denied.res.headers.get("www-authenticate") || "";
  const challengedUrl = resourceMetadataUrl(www);
  const protectedResource = allowedProtectedResourceUrl(challengedUrl, SITE)
    ? await handleProtectedResource(new Request(challengedUrl), deps)
    : new Response("no", { status: 404 });
  const protectedResourcePath = await handleProtectedResource(new Request(`${SITE}/.well-known/oauth-protected-resource/mcp`), deps);
  const authorizationServerOnHost = await handleAuthorizationServer(new Request(`${SITE}/.well-known/oauth-authorization-server`), deps);
  const authorizationServerOnHostPath = await handleAuthorizationServer(new Request(`${SITE}/.well-known/oauth-authorization-server/mcp`), deps);
  // Clerk's own document, not the copy Grill serves. A rewrite on the connector host then shows up.
  const issuerRes = await clerkFetch(`${ISSUER}/.well-known/oauth-authorization-server`);
  const openid = await handleAuthorizationServer(new Request(`${SITE}/.well-known/openid-configuration`), deps);
  const asJson = async (res) => ({ status: res.status, body: res.status === 200 ? await res.json() : null });
  return assessDiscovery({
    site: SITE,
    mcp: { status: denied.res.status, wwwAuthenticate: www },
    challengedUrl,
    protectedResource: await asJson(protectedResource),
    protectedResourcePath: await asJson(protectedResourcePath),
    authorizationServer: await asJson(issuerRes),
    authorizationServerOnHost: await asJson(authorizationServerOnHost),
    authorizationServerOnHostPath: await asJson(authorizationServerOnHostPath),
    openid: await asJson(openid),
  });
}

function passed(result) {
  const failed = result.rows.filter((row) => !row.ok);
  assert.deepEqual(failed, [], failed.map((row) => `${row.name}: ${row.detail}`).join("\n"));
}

describe("hosted sign-in discovery", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  it("answers 401 with metadata both clients can follow, including refresh", async () => {
    const { deps, fetch } = boot();
    const denied = await post(deps, { method: "ping" });
    assert.equal(denied.res.status, 401);
    assert.equal(denied.res.headers.get("www-authenticate"), wwwAuthenticate(SITE));
    const result = await discoveryFromHandlers(deps, fetch);
    assert.equal(result.rows.length, 10);
    passed(result);
    assert.ok(result.notes.some((note) => note.includes("registration_endpoint")));
    assert.ok(result.notes.some((note) => note.includes("dynamic client registration")));
  });

  it("registers Claude and ChatGPT, requires an /mcp audience, and does not lock one client out", async () => {
    const { deps, oauth, registrations, serverFetches, fetch } = boot();
    const result = await discoveryFromHandlers(deps, fetch);
    passed(result);
    const endpoint = oauth.registration_endpoint;
    assert.equal(result.rows.find((row) => row.name.startsWith("dynamic registration")).ok, true);

    for (const client of CLIENTS) {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: client.name,
          redirect_uris: [client.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          scope: "openid profile email offline_access",
        }),
      });
      assert.equal(res.status, 201, client.name);
    }
    assert.deepEqual(registrations.map((row) => row.redirect_uris), [[CLAUDE_REDIRECT], [CHATGPT_REDIRECT]]);
    assert.deepEqual(new Set(registrations.map((row) => row.client_id)).size, 2);
    assert.ok(registrations.every((row) => row.grant_types.includes("refresh_token") && row.token_endpoint_auth_method === "none"));
    assert.equal(serverFetches.some((url) => url.includes("/oauth/register")), false);

    const claude = tokenFor(registrations[0].client_id, CLAUDE_REDIRECT);
    const chatgpt = tokenFor(registrations[1].client_id, CHATGPT_REDIRECT);
    const handshake = async (token, name) => {
      const res = await post(deps, { token, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name } } });
      assert.equal(res.res.status, 200, name);
      assert.equal(res.json.result.protocolVersion, "2025-11-25", name);
    };
    const ping = async (token, label) => {
      const res = await post(deps, { token, method: "ping" });
      assert.equal(res.res.status, 200, label);
      assert.deepEqual(res.json.result, {}, label);
    };

    await handshake(claude, "Claude");
    await handshake(chatgpt, "ChatGPT");
    await ping(claude, "claude after chatgpt connected");
    await ping(chatgpt, "chatgpt after claude connected");
    await ping(claude, "claude still works");

    const alsoAudience = tokenFor(registrations[1].client_id, CHATGPT_REDIRECT, { aud: [RESOURCE, "https://other.example/mcp"] });
    await ping(alsoAudience, "audience list containing /mcp");
    const unregistered = tokenFor("client_never_registered", CLAUDE_REDIRECT);
    await ping(unregistered, "token whose client was not registered with Grill");

    const rejected = [
      ["origin without /mcp", `${SITE}`],
      ["trailing slash", `${RESOURCE}/`],
      ["issuer as audience", ISSUER],
      ["other resource", "https://evil.example/mcp"],
    ];
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      warnings.push(args.map((part) => String(part)).join(" "));
    };
    try {
      for (const [label, aud] of rejected) {
        const res = await post(deps, { token: tokenFor(registrations[0].client_id, CLAUDE_REDIRECT, { aud }), method: "ping" });
        assert.equal(res.res.status, 401, label);
        assert.equal(res.res.headers.get("www-authenticate"), wwwAuthenticate(SITE), label);
      }
      const noAud = signJwt({ iss: ISSUER, sub: "user_two_apps", exp: Math.floor(Date.now() / 1000) + 3600, client_id: registrations[0].client_id });
      const missing = await post(deps, { token: noAud, method: "ping" });
      assert.equal(missing.res.status, 401);
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.length, rejected.length + 1);
    assert.ok(warnings.every((line) => line.includes('"reason":"audience"')));

    await ping(chatgpt, "chatgpt after a rejected token");
    await ping(claude, "claude after a rejected token");
  });
});

function shape({ refresh = true, hostGrants } = {}) {
  const site = "https://grillyour.ai";
  const issuer = "https://clerk.grillyour.ai";
  const grants = refresh ? ["authorization_code", "refresh_token"] : ["authorization_code"];
  const prm = {
    resource: `${site}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    bearer_methods_supported: ["header"],
  };
  const as = {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    grant_types_supported: grants,
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
  };
  const host = hostGrants ? { ...as, grant_types_supported: hostGrants } : as;
  const oidc = { issuer, token_endpoint: as.token_endpoint, grant_types_supported: grants, scopes_supported: as.scopes_supported };
  return { site, issuer, prm, as, host, oidc };
}

function liveFetch(doc, calls) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", authorization: init.headers?.authorization });
    if (u.includes("/oauth/register")) throw new Error("registration must not be called");
    const header = 'Bearer resource_metadata="https://grillyour.ai/.well-known/oauth-protected-resource"';
    if (u === "https://grillyour.ai/mcp") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "www-authenticate": header } });
    if (u === "https://grillyour.ai/.well-known/oauth-protected-resource" || u === "https://grillyour.ai/.well-known/oauth-protected-resource/mcp") {
      return Response.json(doc.prm);
    }
    if (u === "https://grillyour.ai/.well-known/oauth-authorization-server" || u === "https://grillyour.ai/.well-known/oauth-authorization-server/mcp") {
      return Response.json(doc.host);
    }
    if (u === "https://clerk.grillyour.ai/.well-known/oauth-authorization-server") return Response.json(doc.as);
    if (u === "https://grillyour.ai/.well-known/openid-configuration") return Response.json(doc.oidc);
    throw new Error(`unexpected ${u}`);
  };
}

describe("opt-in production sign-in check", () => {
  it("passes a consistent read and does not register a client", async () => {
    const doc = shape();
    const calls = [];
    const { rows, notes } = await checkMcpSignIn({ fetchImpl: liveFetch(doc, calls) });
    passed({ rows });
    assert.equal(rows.length, 10);
    assert.ok(notes.some((note) => note.includes("registration_endpoint")));
    assert.equal(calls.some((call) => call.url.includes("/oauth/register")), false);
    const mcp = calls.find((call) => call.url === "https://grillyour.ai/mcp");
    assert.equal(mcp.method, "POST");
    assert.equal(mcp.authorization, undefined);
    assert.ok(calls.some((call) => call.url === "https://clerk.grillyour.ai/.well-known/oauth-authorization-server"));
  });

  it("fails when the connector host drops refresh, or the issuer does not match", async () => {
    const drifted = shape({ hostGrants: ["authorization_code"] });
    const badHost = await checkMcpSignIn({ fetchImpl: liveFetch(drifted, []) });
    assert.equal(badHost.rows.find((row) => row.name.startsWith("connector host")).ok, false);
    assert.equal(badHost.rows.find((row) => row.name.startsWith("refresh")).ok, false);

    const off = shape();
    off.as = { ...off.as, issuer: "https://clerk.example.com", registration_endpoint: "https://clerk.example.com/oauth/register" };
    const mismatch = await checkMcpSignIn({ fetchImpl: liveFetch(off, []) });
    assert.equal(mismatch.rows.find((row) => row.name.includes("same issuer")).ok, false);

    const noRefresh = shape({ refresh: false });
    const stripped = await checkMcpSignIn({ fetchImpl: liveFetch(noRefresh, []) });
    assert.equal(stripped.rows.find((row) => row.name.startsWith("refresh")).ok, false);
    assert.equal(stripped.rows.find((row) => row.name.startsWith("/mcp")).ok, true);
  });

  it("does not fetch a challenge that points off the site", async () => {
    assert.equal(allowedProtectedResourceUrl("https://evil.example/.well-known/oauth-protected-resource", "https://grillyour.ai"), false);
    assert.equal(allowedProtectedResourceUrl("https://grillyour.ai/.well-known/oauth-protected-resource/mcp", "https://grillyour.ai"), true);
    const calls = [];
    const { rows } = await checkMcpSignIn({
      site: "https://grillyour.ai",
      fetchImpl: async (url, init = {}) => {
        const u = String(url);
        calls.push(u);
        if (u.includes("evil.example")) throw new Error("fetched off site");
        if (u === "https://grillyour.ai/mcp" && init.method === "POST") {
          return new Response("", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://evil.example/meta"' } });
        }
        return new Response("no", { status: 404 });
      },
    });
    assert.equal(calls.some((url) => url.includes("evil.example")), false);
    assert.equal(rows.find((row) => row.name.startsWith("challenge")).ok, false);
  });
});
