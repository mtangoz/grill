#!/usr/bin/env node
// Checks that hosted Grill's sign-in runs on Grill's own domain. No judgement needed:
// it prints PASS or FAIL per check and exits 0 only when every check passes.
//
//   node scripts/check-sign-in.mjs [--site https://grillyour.ai] [--issuer https://clerk.grillyour.ai]
//
// Exit 0: all pass. Exit 1: a check failed. Exit 2: bad arguments.
import { fileURLToPath } from "node:url";

const DEFAULTS = { site: "https://grillyour.ai", issuer: "https://clerk.grillyour.ai" };

function trim(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url, { redirect: "manual" });
  if (!res.ok) return { status: res.status, body: null };
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Runs every check. Each row is { name, ok, detail }. Never throws. */
export async function checkSignIn({ site = DEFAULTS.site, issuer = DEFAULTS.issuer, fetchImpl = fetch } = {}) {
  site = trim(site);
  issuer = trim(issuer);
  const rows = [];
  const add = (name, ok, detail) => rows.push({ name, ok: Boolean(ok), detail });
  const siteHost = new URL(site).hostname;
  const step = async (name, run) => {
    try {
      await run();
    } catch (error) {
      add(name, false, `request failed: ${error?.message || error}`);
    }
  };

  await step("metadata names the expected sign-in server", async () => {
    const { status, body } = await getJson(fetchImpl, `${site}/.well-known/oauth-protected-resource`);
    const named = Array.isArray(body?.authorization_servers) ? trim(body.authorization_servers[0]) : "";
    add("metadata names the expected sign-in server", named === issuer, `status ${status}, names ${named || "nothing"}, want ${issuer}`);
  });

  await step("sign-in server is on the site's own domain", async () => {
    const host = new URL(issuer).hostname;
    add("sign-in server is on the site's own domain", host === siteHost || host.endsWith(`.${siteHost}`), `${host} vs ${siteHost}`);
  });

  await step("sign-in server publishes its settings", async () => {
    const { status, body } = await getJson(fetchImpl, `${issuer}/.well-known/oauth-authorization-server`);
    add("sign-in server publishes its settings", status === 200 && trim(body?.issuer) === issuer, `status ${status}, issuer ${body?.issuer || "missing"}`);
    const reg = String(body?.registration_endpoint || "");
    add("assistants can register themselves (DCR)", reg.startsWith(`${issuer}/`), reg || "no registration_endpoint");
    const pkce = Array.isArray(body?.code_challenge_methods_supported) && body.code_challenge_methods_supported.includes("S256");
    add("PKCE S256 is supported", pkce, JSON.stringify(body?.code_challenge_methods_supported || null));
  });

  await step("/mcp asks for sign-in", async () => {
    const res = await fetchImpl(`${site}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      redirect: "manual",
    });
    const auth = res.headers.get("www-authenticate") || "";
    add("/mcp asks for sign-in", res.status === 401 && auth.includes("resource_metadata"), `status ${res.status}`);
  });

  return rows;
}

async function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== "--site" && flag !== "--issuer") || !value || !/^https:\/\//.test(value)) {
      console.error("usage: node scripts/check-sign-in.mjs [--site https://…] [--issuer https://…]");
      return 2;
    }
    opts[flag.slice(2)] = value;
  }
  const rows = await checkSignIn(opts);
  for (const row of rows) console.log(`${row.ok ? "PASS" : "FAIL"}  ${row.name}  (${row.detail})`);
  const failed = rows.filter((row) => !row.ok).length;
  console.log(failed ? `RESULT: FAIL (${failed} of ${rows.length} checks failed)` : `RESULT: PASS (${rows.length} checks)`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
