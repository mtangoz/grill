// OpenAI verifies the domain by fetching this public token. The body is the token
// and nothing else. The route has to answer before the page routes.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "qUFqSGmOG8CWwJUnLKQuZ-6pUmSzTgCZRDsib-tA2j0";
const PATHNAME = "/.well-known/openai-apps-challenge";

function header(route, name) {
  const found = Object.entries(route.headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return found ? found[1] : undefined;
}

describe("OpenAI apps domain challenge", () => {
  it("routes the challenge path to its file as text/plain, before the page routes", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const routes = config.routes;
    assert.ok(Array.isArray(routes));
    const errorAt = routes.findIndex((route) => route.handle === "error");
    assert.ok(errorAt > 0, "error handle");

    const matches = routes.filter((route) => {
      const src = route.src ?? route.source;
      return typeof src === "string" && new RegExp(src).test(PATHNAME);
    });
    assert.equal(matches.length, 1, "exactly one route matches the challenge path");
    const route = matches[0];
    assert.ok(routes.indexOf(route) < errorAt, "the challenge route is not an error route");
    assert.equal(route.dest ?? route.destination, PATHNAME);
    assert.equal(route.status ?? 200, 200);
    assert.equal(route.has, undefined, "the token is not conditional on Accept");
    assert.equal(header(route, "content-type"), "text/plain");
    assert.equal(route.check, true, "the route serves the built file");
  });

  it("the site build writes the token and no trailing whitespace", () => {
    execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: ROOT, stdio: "pipe" });
    const body = readFileSync(join(ROOT, "_site/.well-known/openai-apps-challenge"));
    assert.equal(body.toString("utf8"), TOKEN);
    assert.equal(body.length, Buffer.byteLength(TOKEN));
    assert.equal(/\s/u.test(body.toString("utf8")), false);
  });
});
