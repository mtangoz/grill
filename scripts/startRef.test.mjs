// ?ref= on /start is recorded as a count and a cookie. The page itself is the answer. No script.
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

  it("records ref=askgrill and shows the page, without sending the query back", async () => {
    const ctx = world();
    const res = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill"), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("location"), null);
    const html = await res.text();
    assert.match(html, /First 100 users get Grill free for life, 100 spots left\./);
    assert.equal(html.includes("<script"), false);
    assert.equal(html.includes("askgrill"), false);
    assert.match(res.headers.get("set-cookie"), /grill_ref=askgrill/);
    assert.match(res.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(res.headers.get("set-cookie").includes("askgrill@"), false);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "1");
    const again = await handleStart(new Request("https://preview.example/start/?ref=AskGrill"), ctx);
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("location"), null);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "2");
    assert.equal(refFromCookie(again.headers.get("set-cookie")), "askgrill");
  });

  it("does not record a bad ref, and still shows the page when the store is missing", async () => {
    const ctx = world();
    const bad = await handleStart(new Request("https://grillyour.ai/start?ref=not%20a%20ref"), ctx);
    assert.equal(bad.status, 200);
    assert.equal(bad.headers.get("location"), null);
    assert.match(await bad.text(), /First 100 users get Grill free for life, 100 spots left\./);
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
    assert.equal(bare.status, 200);
    assert.equal(bare.headers.get("location"), null);
    assert.match(await bare.text(), /Connect Grill to your AI/);
    assert.equal(called, false);

    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const rewrites = config.rewrites.filter((row) => row.destination === "/api/hosted?__route=start");
    assert.deepEqual(rewrites.map((row) => row.source), ["/start", "/start/"]);
    for (const row of rewrites) assert.equal(row.has, undefined);
    const route = config.routes.find((row) => row.dest === "/api/hosted?__route=start" && row.src === "^/start/?$");
    assert.ok(route, "a route serves /start before the HTML file");
    const start = readFileSync(join(ROOT, "site/start.html"), "utf8");
    assert.equal(start.includes("<script"), false);
    assert.match(start, /First 100 users get Grill free for life, 100 spots left\./);
  });
});
