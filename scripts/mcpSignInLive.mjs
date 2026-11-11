#!/usr/bin/env node
// Read-only check of the hosted connector's sign-in discovery. Not part of CI.
// It does not register a client, exchange a code, or send a bearer token.
//
//   node scripts/mcpSignInLive.mjs
//   node scripts/mcpSignInLive.mjs --site https://grillyour.ai
//
// Exit 0: every check passed. Exit 1: a check failed. Exit 2: bad arguments.
import { fileURLToPath } from "node:url";

const DEFAULT_SITE = "https://grillyour.ai";

function trimSlash(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

export function resourceMetadataUrl(header) {
  const text = String(header || "");
  const quoted = /(?:^|[,\s])resource_metadata="([^"]*)"/.exec(text);
  if (quoted) return quoted[1];
  const bare = /(?:^|[,\s])resource_metadata=([^,\s]+)/.exec(text);
  return bare ? bare[1] : "";
}

function hostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function onSite(url, site) {
  try {
    const target = new URL(url);
    const home = new URL(site);
    return target.protocol === "https:" && target.origin === home.origin;
  } catch {
    return false;
  }
}

/** The challenged metadata URL has to be this site's protected-resource document. */
export function allowedProtectedResourceUrl(url, site) {
  if (!onSite(url, site)) return false;
  const path = new URL(url).pathname;
  return path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp";
}

function issuerOnSite(issuer, site) {
  try {
    const url = new URL(issuer);
    const host = url.hostname.toLowerCase();
    const siteHost = hostname(site);
    return url.protocol === "https:" && (host === siteHost || host.endsWith(`.${siteHost}`));
  } catch {
    return false;
  }
}

function includes(list, value) {
  return Array.isArray(list) && list.includes(value);
}

function differingKeys(left, right) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  const changed = [];
  for (const key of keys) {
    if (JSON.stringify(left?.[key]) !== JSON.stringify(right?.[key])) changed.push(key);
  }
  return changed;
}

/**
 * The documents a client would have read, with no network.
 * `rows` are the checks. `notes` are gaps that do not fail the run.
 */
export function assessDiscovery({
  site,
  mcp,
  challengedUrl,
  protectedResource,
  protectedResourcePath,
  authorizationServer,
  authorizationServerOnHost,
  authorizationServerOnHostPath,
  openid,
} = {}) {
  const home = trimSlash(site);
  const resource = `${home}/mcp`;
  const rows = [];
  const notes = [];
  const add = (name, ok, detail) => rows.push({ name, ok: Boolean(ok), detail: String(detail || "") });
  const statusOf = (doc) => {
    if (!doc) return "missing";
    if (doc.error) return `status ${doc.status}, ${doc.error}`;
    return `status ${doc.status}`;
  };

  const challenge = resourceMetadataUrl(mcp?.wwwAuthenticate);
  const bearer = /^Bearer\b/i.test(String(mcp?.wwwAuthenticate || ""));
  add(
    "/mcp asks for sign-in",
    mcp?.status === 401 && bearer && challenge.length > 0,
    `${statusOf(mcp)}; ${mcp?.wwwAuthenticate || "no WWW-Authenticate"}`,
  );
  add(
    "challenge points at protected-resource metadata",
    challenge === challengedUrl && allowedProtectedResourceUrl(challenge, home),
    challenge || "no resource_metadata",
  );

  const prm = protectedResource?.body;
  const prmOk = protectedResource?.status === 200 && prm && !Array.isArray(prm);
  const servers = Array.isArray(prm?.authorization_servers) ? prm.authorization_servers : [];
  add(
    "protected-resource metadata names /mcp",
    prmOk && prm.resource === resource && servers.length > 0 && servers.every((item) => typeof item === "string" && item.startsWith("https://")) && includes(prm.bearer_methods_supported, "header"),
    prmOk ? `resource ${prm.resource || "missing"}` : statusOf(protectedResource),
  );

  const pathBody = protectedResourcePath?.body;
  const pathOk = protectedResourcePath?.status === 200 && pathBody && !Array.isArray(pathBody);
  add(
    "path-inserted protected-resource metadata matches",
    pathOk && prmOk && JSON.stringify(pathBody) === JSON.stringify(prm) && pathBody.resource === resource,
    pathOk ? `resource ${pathBody.resource || "missing"}` : statusOf(protectedResourcePath),
  );

  const named = trimSlash(servers[0] || "");
  add(
    "authorization server is on the site's domain",
    Boolean(named) && issuerOnSite(named, home),
    named || "no authorization server",
  );

  const issuerBody = authorizationServer?.body;
  const issuerOk = authorizationServer?.status === 200 && issuerBody && !Array.isArray(issuerBody);
  const issuer = trimSlash(issuerBody?.issuer || "");
  add(
    "protected-resource and authorization server name the same issuer",
    issuerOk && named.length > 0 && issuer === named,
    issuerOk ? `metadata ${named || "nothing"}, document ${issuer || "nothing"}` : statusOf(authorizationServer),
  );

  const hostBody = authorizationServerOnHost?.body;
  const hostPathBody = authorizationServerOnHostPath?.body;
  const hostOk = authorizationServerOnHost?.status === 200 && hostBody && !Array.isArray(hostBody);
  const hostPathOk = authorizationServerOnHostPath?.status === 200 && hostPathBody && !Array.isArray(hostPathBody);
  const hostDiff = differingKeys(hostBody, issuerBody);
  const pathDiff = differingKeys(hostPathBody, issuerBody);
  add(
    "connector host serves that authorization-server document",
    issuerOk && hostOk && hostPathOk && hostDiff.length === 0 && pathDiff.length === 0,
    !hostOk || !hostPathOk ? `host ${statusOf(authorizationServerOnHost)}; /mcp ${statusOf(authorizationServerOnHostPath)}` : hostDiff.concat(pathDiff).join(", ") || "matches",
  );

  const registration = typeof issuerBody?.registration_endpoint === "string" ? issuerBody.registration_endpoint : "";
  const hostRegistration = typeof hostBody?.registration_endpoint === "string" ? hostBody.registration_endpoint : "";
  let registrationOnIssuer = false;
  try {
    registrationOnIssuer = registration.startsWith(`${named}/`) && new URL(registration).protocol === "https:" && hostRegistration === registration;
  } catch {
    registrationOnIssuer = false;
  }
  add("dynamic registration is advertised on the issuer", issuerOk && registrationOnIssuer, registration || "no registration_endpoint");

  const refresh = includes(issuerBody?.grant_types_supported, "refresh_token") && includes(hostBody?.grant_types_supported, "refresh_token") && includes(prm?.scopes_supported, "offline_access");
  const tokenEndpoint = typeof issuerBody?.token_endpoint === "string" ? issuerBody.token_endpoint : "";
  let tokenOnIssuer = false;
  try {
    tokenOnIssuer = tokenEndpoint.startsWith(`${named}/`) && new URL(tokenEndpoint).protocol === "https:";
  } catch {
    tokenOnIssuer = false;
  }
  add(
    "refresh tokens are advertised",
    Boolean(refresh && tokenOnIssuer),
    `grants ${JSON.stringify(issuerBody?.grant_types_supported || null)}; scopes ${JSON.stringify(prm?.scopes_supported || null)}; token ${tokenEndpoint || "missing"}`,
  );
  add(
    "PKCE S256 is advertised",
    includes(issuerBody?.code_challenge_methods_supported, "S256") && includes(hostBody?.code_challenge_methods_supported, "S256"),
    JSON.stringify(issuerBody?.code_challenge_methods_supported || null),
  );

  if (openid && openid.status === 200 && openid.body && !Array.isArray(openid.body) && !openid.body.registration_endpoint) {
    notes.push("OpenID configuration has no registration_endpoint. Dynamic registration is on the OAuth authorization-server document.");
  } else if (openid && openid.status !== 200) {
    notes.push(`OpenID configuration was not read (${statusOf(openid)}).`);
  }
  if (issuerOk && issuerBody.client_id_metadata_document_supported !== true) {
    notes.push("Client ID metadata documents are not advertised. ChatGPT and Claude will use dynamic client registration.");
  }
  return { rows, notes };
}

async function read(fetchImpl, url, init) {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(10_000),
      ...init,
      redirect: "manual",
    });
    let body = null;
    if (res.status === 200) body = await res.json().catch(() => null);
    return { status: res.status, body, wwwAuthenticate: res.headers.get("www-authenticate") || "" };
  } catch (error) {
    return { status: 0, body: null, wwwAuthenticate: "", error: error?.message || String(error) };
  }
}

/** GETs the public metadata and one unauthenticated POST /mcp. Never calls the registration endpoint. */
export async function checkMcpSignIn({ site = DEFAULT_SITE, fetchImpl = globalThis.fetch } = {}) {
  const home = trimSlash(site);
  const mcp = await read(fetchImpl, `${home}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  const challengedUrl = resourceMetadataUrl(mcp.wwwAuthenticate);
  const protectedResource = allowedProtectedResourceUrl(challengedUrl, home)
    ? await read(fetchImpl, challengedUrl)
    : { status: 0, body: null, error: "challenge URL was not fetched" };
  const protectedResourcePath = await read(fetchImpl, `${home}/.well-known/oauth-protected-resource/mcp`);
  const authorizationServerOnHost = await read(fetchImpl, `${home}/.well-known/oauth-authorization-server`);
  const authorizationServerOnHostPath = await read(fetchImpl, `${home}/.well-known/oauth-authorization-server/mcp`);
  const named = trimSlash(protectedResource.body?.authorization_servers?.[0] || "");
  const authorizationServer = named && issuerOnSite(named, home)
    ? await read(fetchImpl, `${named}/.well-known/oauth-authorization-server`)
    : { status: 0, body: null, error: named ? "issuer is off the site's domain" : "no issuer" };
  const openid = await read(fetchImpl, `${home}/.well-known/openid-configuration`);
  return assessDiscovery({
    site: home,
    mcp,
    challengedUrl,
    protectedResource,
    protectedResourcePath,
    authorizationServer,
    authorizationServerOnHost,
    authorizationServerOnHostPath,
    openid,
  });
}

async function main(argv) {
  let site = DEFAULT_SITE;
  if (argv.length !== 0) {
    if (argv.length !== 2 || argv[0] !== "--site" || !/^https:\/\//.test(argv[1] || "")) {
      console.error("usage: node scripts/mcpSignInLive.mjs [--site https://…]");
      return 2;
    }
    site = argv[1];
  }
  const { rows, notes } = await checkMcpSignIn({ site });
  for (const row of rows) console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}  (${row.detail})`);
  for (const note of notes) console.log(`NOTE  ${note}`);
  const failed = rows.filter((row) => !row.ok).length;
  console.log(failed ? `RESULT: FAIL (${failed} of ${rows.length} checks failed)` : `RESULT: PASS (${rows.length} checks)`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
