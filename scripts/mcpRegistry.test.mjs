// The official MCP Registry publish. The workflow has to exist, and server.json has to be a
// concrete version whose remote is the hosted connector (streamable-http).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = join(ROOT, ".github/workflows/publish-mcp.yml");
const HOSTED = "https://grillyour.ai/mcp";
const VERSION = /^\d+\.\d+\.\d+$/;

describe("MCP Registry publish", () => {
  it("publishes server.json with GitHub OIDC when a release is published, or by hand", () => {
    assert.equal(existsSync(WORKFLOW), true, "missing .github/workflows/publish-mcp.yml");
    const yaml = readFileSync(WORKFLOW, "utf8");
    assert.match(yaml, /release:\n {4}types: \[published\]/);
    assert.match(yaml, /^ {2}workflow_dispatch:$/m);
    assert.match(yaml, /id-token: write/);
    assert.match(yaml, /mcp-publisher login github-oidc --registry=https:\/\/registry\.modelcontextprotocol\.io/);
    assert.match(yaml, /mcp-publisher publish/);
    assert.doesNotMatch(yaml, /pull_request/);
    assert.doesNotMatch(yaml, /MCP_GITHUB_TOKEN|secrets\./);
  });

  it("server.json version is a concrete semver and the remote is streamable-http at the hosted connector", () => {
    const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    assert.equal(server.name, "io.github.mtangoz/grill");
    assert.match(server.version, VERSION);
    assert.equal(server.version, pkg.version);
    for (const pkgEntry of server.packages) {
      assert.match(pkgEntry.version, VERSION);
      assert.equal(pkgEntry.version, server.version);
    }
    assert.ok(Array.isArray(server.remotes) && server.remotes.length === 1);
    const remote = server.remotes[0];
    assert.equal(remote.type, "streamable-http");
    assert.equal(remote.url, HOSTED);
    assert.match(remote.url, /^https:\/\/[^\s]+$/);
  });
});
