// The sign-in domain check: no network, the site and sign-in server are faked.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSignIn } from "./check-sign-in.mjs";

function fakeFetch({ named = "https://clerk.grillyour.ai", issuer = "https://clerk.grillyour.ai", dcr = true, mcpStatus = 401 } = {}) {
  return async (url) => {
    const u = String(url);
    if (u === "https://grillyour.ai/.well-known/oauth-protected-resource") {
      return Response.json({ resource: "https://grillyour.ai/mcp", authorization_servers: [named] });
    }
    if (u === `${named}/.well-known/oauth-authorization-server`) {
      return Response.json({
        issuer,
        registration_endpoint: dcr ? `${issuer}/oauth/register` : undefined,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (u === "https://grillyour.ai/mcp") {
      return new Response("", { status: mcpStatus, headers: { "www-authenticate": 'Bearer resource_metadata="https://grillyour.ai/.well-known/oauth-protected-resource"' } });
    }
    throw new Error(`unexpected ${u}`);
  };
}

describe("check-sign-in", () => {
  it("passes when sign-in runs on the site's own domain", async () => {
    const rows = await checkSignIn({ fetchImpl: fakeFetch() });
    assert.deepEqual(rows.filter((row) => !row.ok), []);
    assert.equal(rows.length, 6);
  });

  it("fails while the metadata still names Clerk's own domain", async () => {
    const rows = await checkSignIn({ fetchImpl: fakeFetch({ named: "https://cool-frog-1762.clerk.accounts.dev", issuer: "https://cool-frog-1762.clerk.accounts.dev" }) });
    assert.equal(rows.find((row) => row.name.startsWith("metadata")).ok, false);
  });

  it("fails without self-registration, and turns a network error into a FAIL row", async () => {
    const rows = await checkSignIn({ fetchImpl: fakeFetch({ dcr: false }) });
    assert.equal(rows.find((row) => row.name.includes("DCR")).ok, false);
    const down = await checkSignIn({ fetchImpl: async () => { throw new Error("offline"); } });
    assert.ok(down.length > 0 && down.some((row) => !row.ok && /offline/.test(row.detail)));
  });

  it("fails a sign-in server on someone else's domain", async () => {
    const rows = await checkSignIn({ issuer: "https://clerk.example.com", fetchImpl: fakeFetch({ named: "https://clerk.example.com", issuer: "https://clerk.example.com" }) });
    assert.equal(rows.find((row) => row.name.includes("own domain")).ok, false);
  });
});
