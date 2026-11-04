// Miss cards: contribute the miss, never the decision. node --test scripts/miss.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MISS_CHOICES, MISS_LABELS, MISS_QUESTIONS, checkMissCard, normaliseMissCard } from "./missCore.mjs";
import { MISS_QUEUE_KEY, handleMiss } from "../api/_miss.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const GOOD = Object.freeze({
  failure: "count-without-rate",
  stage: "draft",
  caught_by: "me",
  stakes: "founder-or-board",
  category: "operations",
  cost: "rework",
  grill_ran: "said-so-but-no",
  check: "Show the per-contact rate next to every count compared across periods.",
  repro: "A firm compared 28 replies in one month with 13 in the two before, but contacted twice as many people, so the rate was flat.",
});
const ORIGINAL = "Charlie asked why we changed the copy. 13 of 1,112 replied in July. Tina Durocher-Murphy said yes on getnatter.net.";

describe("the miss card check", () => {
  it("passes a card in made-up words, with or without the real text", () => {
    assert.deepEqual(checkMissCard(GOOD), { ok: true, problems: [] });
    assert.deepEqual(checkMissCard(GOOD, { original: ORIGINAL }), { ok: true, problems: [] });
  });

  it("blocks real names, real numbers and real phrases when the real text is given", () => {
    const leaky = { ...GOOD, repro: "Tina said yes and 13 of 1,112 replied in July, so interest looked up when it was flat." };
    const reasons = checkMissCard(leaky, { original: ORIGINAL }).problems.map((p) => p.reason).join(" | ");
    assert.match(reasons, /names come from your real text: Tina/);
    assert.match(reasons, /numbers come from your real text: 1112/);
    assert.match(reasons, /words come from your real text/);
  });

  it("always blocks emails, links, domains, phone numbers, handles and keys", () => {
    for (const bad of ["mail a@b.com", "see https://x.test/a", "on getnatter.net", "call +1 415 555 0100", "ask @someone", "key sk-abcdefghijklmnop"]) {
      const { ok } = checkMissCard({ ...GOOD, check: `${GOOD.check} ${bad}` });
      assert.equal(ok, false, bad);
    }
  });

  it("needs every choice from its list, and both texts within limits", () => {
    assert.equal(checkMissCard({ ...GOOD, failure: "made-up" }).ok, false);
    assert.equal(checkMissCard({ ...GOOD, repro: "short" }).ok, false);
    assert.equal(checkMissCard({ ...GOOD, repro: "x ".repeat(800) }).ok, false);
  });

  it("keeps only the card's fields", () => {
    const card = normaliseMissCard({ ...GOOD, original: ORIGINAL, email: "a@b.com", ip: "1.2.3.4" });
    assert.deepEqual(Object.keys(card).sort(), [...Object.keys(MISS_CHOICES), "check", "repro"].sort());
  });

  it("labels and questions cover every choice", () => {
    for (const [key, values] of Object.entries(MISS_CHOICES)) {
      assert.ok(MISS_QUESTIONS[key], key);
      for (const v of values) assert.ok(MISS_LABELS[key][v], `${key}.${v}`);
    }
  });
});

function world({ env = {}, count = 0 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(url, "https://redis.test");
    const args = JSON.parse(init.body);
    calls.push(args);
    if (args[0] === "INCR") return Response.json({ result: (count += 1) });
    return Response.json({ result: "OK" });
  };
  return {
    calls,
    deps: { env: { GRILL_MISS: "1", UPSTASH_REDIS_REST_URL: "https://redis.test", UPSTASH_REDIS_REST_TOKEN: "t", ...env }, fetch, now: Date.UTC(2026, 9, 15, 13, 7) },
  };
}

const post = (fields) => new Request("https://grillyour.ai/miss/send", { method: "POST", body: new URLSearchParams(fields).toString() });

describe("grillyour.ai/miss/send", () => {
  it("is off, and stores nothing, unless GRILL_MISS=1", async () => {
    const { calls, deps } = world({ env: { GRILL_MISS: "" } });
    const res = await handleMiss(post(GOOD), deps);
    assert.equal(res.status, 503);
    assert.equal(calls.length, 0);
  });

  it("stores only the card's fields and the UTC day: no IP, no account, no time of day", async () => {
    const { calls, deps } = world();
    const req = new Request("https://grillyour.ai/miss/send", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9", "user-agent": "Test" },
      body: new URLSearchParams({ ...GOOD, original: ORIGINAL, email: "a@b.com" }).toString(),
    });
    const res = await handleMiss(req, deps);
    assert.equal(res.status, 200);
    const push = calls.find((c) => c[0] === "LPUSH");
    assert.equal(push[1], MISS_QUEUE_KEY);
    const stored = JSON.parse(push[2]);
    assert.deepEqual(Object.keys(stored).sort(), ["v", "day", ...Object.keys(MISS_CHOICES), "check", "repro"].sort());
    assert.equal(stored.day, "2026-10-15");
    assert.doesNotMatch(push[2], /203\.0\.113|Test|a@b\.com|Charlie|Tina/);
    assert.ok(calls.some((c) => c[0] === "LTRIM"));
  });

  it("refuses a card that fails the check, and stores nothing", async () => {
    const { calls, deps } = world();
    const res = await handleMiss(post({ ...GOOD, repro: `${GOOD.repro} Write to a@b.com.` }), deps);
    assert.equal(res.status, 422);
    assert.equal(calls.length, 0);
  });

  it("drops a filled honeypot, and stops at the daily cap", async () => {
    const bot = world();
    assert.equal((await handleMiss(post({ ...GOOD, leave_blank: "x" }), bot.deps)).status, 200);
    assert.equal(bot.calls.length, 0);
    const full = world({ env: { GRILL_MISS_DAILY_CAP: "2" }, count: 2 });
    assert.equal((await handleMiss(post(GOOD), full.deps)).status, 429);
    assert.equal(full.calls.some((c) => c[0] === "LPUSH"), false);
  });
});

describe("the miss page", () => {
  it("is built only with GRILL_MISS=1, from the same module, and the real-text box is never sent", () => {
    const out = join(ROOT, "_site/miss/index.html");
    rmSync(join(ROOT, "_site/miss"), { recursive: true, force: true });
    execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: ROOT, env: { ...process.env, GRILL_MISS: "" } });
    assert.equal(existsSync(out), false);
    execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: ROOT, env: { ...process.env, GRILL_MISS: "1" } });
    const html = readFileSync(out, "utf8");
    assert.match(html, /action="\/miss\/send"/);
    for (const key of Object.keys(MISS_CHOICES)) assert.match(html, new RegExp(`<select id="miss-${key}" name="${key}" required>`));
    assert.match(html, /function checkMissCard\(/);
    assert.doesNotMatch(html, /^export /m);
    const box = html.match(/<textarea id="miss-original"[^>]*>/)[0];
    assert.doesNotMatch(box, /\bname=/, "the real-text box must have no name, so the browser never submits it");
    rmSync(join(ROOT, "_site/miss"), { recursive: true, force: true });
  });
});
