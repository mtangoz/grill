// Grill in chat needs no OpenRouter key. The README leads setup with it, and
// server.json names the hosted connector (streamable-http in the schema at $schema).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const server = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));

const HOSTED = "https://grillyour.ai/mcp";

describe("Grill in chat leads setup", () => {
  it("the first subsection under Set up is Grill in chat", () => {
    const start = readme.indexOf("## Set up\n");
    assert.ok(start >= 0, "README has a Set up section");
    const rest = readme.slice(start);
    const next = rest.indexOf("\n## ", 1);
    const body = next === -1 ? rest : rest.slice(0, next);
    const heading = body.split("\n").find((line) => line.startsWith("### "));
    assert.equal(heading, "### Grill in chat");
  });

  it("names the hosted connector before the OpenRouter key page", () => {
    const mcp = readme.indexOf(HOSTED);
    const keys = readme.indexOf("openrouter.ai/keys");
    assert.ok(mcp >= 0, "README names the hosted connector");
    assert.ok(keys > mcp, "https://grillyour.ai/mcp comes before openrouter.ai/keys");
  });

  it("server.json lists one streamable-http remote for the hosted connector", () => {
    assert.equal(server.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    assert.deepEqual(server.remotes, [{ type: "streamable-http", url: HOSTED }]);
  });
});
