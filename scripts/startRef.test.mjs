// ?ref= on /start is recorded as a count and a cookie, then the static page loads. No script.
// Made-up source labels only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleStart, normalizeRef, refFromCookie, startRefKey } from "../api/_start.mjs";
import { createMemoryRedis } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function world() {
  const memory = createMemoryRedis();
  return {
    env: {},
    redis: async (args) => memory.command(args),
    memory,
  };
}

describe("start attribution", () => {
  it("accepts a short source and drops anything else", () => {
    assert.equal(normalizeRef(" askgrill "), "askgrill");
    assert.equal(normalizeRef("AskGrill"), "askgrill");
    for (const bad of ["", "  ", "a b", "a@b.com", "https://evil.example", "x".repeat(41), "lead\naskgrill", null]) {
      assert.equal(normalizeRef(bad), "", JSON.stringify(bad));
    }
  });

  it("records ref=askgrill and redirects to the static page without the query", async () => {
    const ctx = world();
    const res = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill"), ctx);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "https://grillyour.ai/start/");
    assert.match(res.headers.get("set-cookie"), /grill_ref=askgrill/);
    assert.match(res.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(res.headers.get("set-cookie").includes("askgrill@"), false);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "1");
    const again = await handleStart(new Request("https://preview.example/start/?ref=AskGrill"), ctx);
    assert.equal(again.headers.get("location"), "https://preview.example/start/");
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "2");
    assert.equal(refFromCookie(again.headers.get("set-cookie")), "askgrill");
  });

  it("does not record a bad ref, and still sends the person to the page when the store is missing", async () => {
    const ctx = world();
    const bad = await handleStart(new Request("https://grillyour.ai/start?ref=not%20a%20ref"), ctx);
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get("location"), "https://grillyour.ai/start/");
    assert.equal(bad.headers.get("set-cookie"), null);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), null);

    let called = false;
    const bare = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill"), {
      env: {},
      fetch: async () => {
        called = true;
        throw new Error("no store");
      },
    });
    assert.equal(bare.status, 303);
    assert.equal(bare.headers.get("location"), "https://grillyour.ai/start/");
    assert.equal(called, false);

    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const rewrites = config.rewrites.filter((row) => row.destination === "/api/start");
    assert.deepEqual(rewrites.map((row) => row.source), ["/start", "/start/"]);
    for (const row of rewrites) assert.equal(row.has[0].key, "ref");
    const start = readFileSync(join(ROOT, "site/start.html"), "utf8");
    assert.equal(start.includes("<script"), false);
  });
});
