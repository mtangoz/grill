// POST /api/ping: strict body, counters, peppered ids, no address.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PING_ID_TTL_SECONDS, handlePing, parsePing, pepperedId } from "../api/_ping.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = Date.parse("2026-10-01T13:22:00Z");
const ID = "11111111-1111-4111-8111-111111111111";
const ENV = {
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
  GRILL_PING_PEPPER: "pepper-for-tests",
};

function body(extra = {}) {
  return {
    v: "1",
    id: ID,
    ver: "0.1.1",
    client: "mcpb",
    route: "one_click",
    ok: true,
    ms: 200,
    ts: "2026-10-01",
    ...extra,
  };
}

function redisEval(store, args) {
  const [op, key, ...rest] = args;
  if (op === "INCR") {
    const n = (Number(store.get(key)) || 0) + 1;
    store.set(key, String(n));
    return n;
  }
  if (op === "GET") return store.has(key) ? store.get(key) : null;
  if (op === "EXPIRE") {
    store.set(`${key}:ttl`, rest[0]);
    return 1;
  }
  if (op === "SET") {
    if (rest.includes("NX") && store.has(key)) return null;
    store.set(key, rest[0]);
    const ex = rest.indexOf("EX");
    if (ex !== -1) store.set(`${key}:ttl`, rest[ex + 1]);
    return "OK";
  }
  throw new Error(`unexpected redis ${op}`);
}

function world() {
  const store = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body: parsed, headers: init.headers });
    if (String(url) !== ENV.UPSTASH_REDIS_REST_URL) {
      return new Response("no", { status: 599 });
    }
    return Response.json({ result: redisEval(store, parsed) });
  };
  return { store, calls, fetchImpl };
}

function post(raw, { env = ENV, fetchImpl, headers = {}, now = NOW, method = "POST" } = {}) {
  return handlePing(
    new Request("https://grillyour.ai/api/ping", {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: method === "POST" ? raw : undefined,
    }),
    { env, fetch: fetchImpl, now },
  );
}

describe("the body is strict", () => {
  it("accepts the eight keys and rejects anything else", () => {
    assert.ok(parsePing(JSON.stringify(body())));
    assert.equal(parsePing(JSON.stringify(body({ note: "the decision" }))), null);
    assert.equal(parsePing(JSON.stringify(body({ email: "a@b.c" }))), null);
    const missing = body();
    delete missing.route;
    assert.equal(parsePing(JSON.stringify(missing)), null);
    assert.equal(parsePing(JSON.stringify(body({ v: 1 }))), null);
    assert.equal(parsePing(JSON.stringify(body({ ok: "true" }))), null);
    assert.equal(parsePing(JSON.stringify(body({ ms: 1.5 }))), null);
    assert.equal(parsePing(JSON.stringify(body({ ms: -100 }))), null);
    assert.equal(parsePing(JSON.stringify(body({ client: "desktop" }))), null);
    assert.equal(parsePing(JSON.stringify(body({ route: "paste" }))), null);
    assert.equal(parsePing(JSON.stringify(body({ id: "not-a-uuid" }))), null);
    assert.equal(parsePing(JSON.stringify(body({ ts: "2026-02-31" }))), null);
    assert.equal(parsePing(JSON.stringify(body({ ts: "2026-10-01T13:22:00Z" }))), null);
    assert.equal(parsePing("x".repeat(513)), null);
    assert.equal(parsePing(""), null);
    assert.equal(parsePing("[]"), null);
  });

  it("answers 400 for a bad body and does not call the store", async () => {
    let called = 0;
    const res = await post(JSON.stringify(body({ verdict: "shaky" })), {
      fetchImpl: async () => {
        called += 1;
        throw new Error("should not be called");
      },
    });
    assert.equal(res.status, 400);
    assert.equal(await res.text(), "");
    assert.equal(called, 0);
  });

  it("answers 405 for anything but POST", async () => {
    const res = await post("", {
      method: "GET",
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    });
    assert.equal(res.status, 405);
  });

  it("rejects an oversized content-length before trusting the body", async () => {
    let called = 0;
    let read = 0;
    const res = await handlePing(
      {
        method: "POST",
        headers: { get: (name) => (name === "content-length" ? "900" : null) },
        text: async () => {
          read += 1;
          return JSON.stringify(body());
        },
      },
      {
        env: ENV,
        fetch: async () => {
          called += 1;
          throw new Error("should not be called");
        },
        now: NOW,
      },
    );
    assert.equal(res.status, 400);
    assert.equal(called, 0);
    assert.equal(read, 0);
  });
});

describe("storage", () => {
  it("returns 204 and does nothing when Upstash is missing", async () => {
    let called = 0;
    const env = { ...ENV };
    delete env.UPSTASH_REDIS_REST_URL;
    const res = await post(JSON.stringify(body()), {
      env,
      fetchImpl: async () => {
        called += 1;
        throw new Error("should not be called");
      },
    });
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.equal(called, 0);
  });

  it("counts the day and stores a peppered id, never the id or an address", async () => {
    const w = world();
    const headers = { "x-forwarded-for": "203.0.113.8", "user-agent": "CanaryAgent/9" };
    const first = await post(JSON.stringify(body()), { fetchImpl: w.fetchImpl, headers });
    assert.equal(first.status, 204);
    const again = await post(JSON.stringify(body({ ok: false, ms: 0 })), { fetchImpl: w.fetchImpl, headers });
    assert.equal(again.status, 204);
    const hash = pepperedId(ID, ENV.GRILL_PING_PEPPER);
    assert.notEqual(hash.includes(ID), true);
    assert.equal(w.store.get(`grill:ping:n:2026-10-01:1:mcpb:one_click:0.1.1`), "1");
    assert.equal(w.store.get(`grill:ping:n:2026-10-01:0:mcpb:one_click:0.1.1`), "1");
    assert.equal(w.store.get("grill:ping:unique"), "1");
    assert.equal(w.store.get(`grill:ping:id:${hash}`), "1");
    assert.equal(w.store.get(`grill:ping:id:${hash}:ttl`), String(PING_ID_TTL_SECONDS));
    assert.equal(PING_ID_TTL_SECONDS, 90 * 24 * 60 * 60);
    const flat = JSON.stringify(w.calls);
    assert.equal(flat.includes(ID), false);
    assert.equal(flat.includes("203.0.113.8"), false);
    assert.equal(flat.includes("CanaryAgent/9"), false);
    assert.equal(w.calls.every((call) => call.url === ENV.UPSTASH_REDIS_REST_URL), true);
  });

  it("still counts when the pepper is missing, and skips the id set", async () => {
    const w = world();
    const env = { ...ENV };
    delete env.GRILL_PING_PEPPER;
    const res = await post(JSON.stringify(body()), { env, fetchImpl: w.fetchImpl });
    assert.equal(res.status, 204);
    assert.equal(w.store.get(`grill:ping:n:2026-10-01:1:mcpb:one_click:0.1.1`), "1");
    assert.equal([...w.store.keys()].some((key) => String(key).includes("grill:ping:id:")), false);
    assert.equal(w.store.has("grill:ping:unique"), false);
  });

  it("stops at the global per-minute cap without storing the event", async () => {
    const w = world();
    const env = { ...ENV, GRILL_PING_RATE_PER_MINUTE: "1" };
    const ok = await post(JSON.stringify(body()), { env, fetchImpl: w.fetchImpl });
    assert.equal(ok.status, 204);
    const limited = await post(JSON.stringify(body({ id: "22222222-2222-4222-8222-222222222222" })), {
      env,
      fetchImpl: w.fetchImpl,
    });
    assert.equal(limited.status, 429);
    assert.equal(w.store.get(`grill:ping:n:2026-10-01:1:mcpb:one_click:0.1.1`), "1");
    assert.equal(w.store.get("grill:ping:rate:2026-10-01T13:22"), "2");
  });

  it("returns 204 when the store errors, and logs nothing about the body", async () => {
    const errors = [];
    const orig = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      const res = await post(JSON.stringify(body()), {
        fetchImpl: async () => {
          throw new Error("redis down");
        },
      });
      assert.equal(res.status, 204);
      assert.equal(errors.length, 0);
    } finally {
      console.error = orig;
    }
  });
});

describe("the handler source", () => {
  it("does not mention an address header or a user-agent", () => {
    const src = readFileSync(join(ROOT, "api/_ping.mjs"), "utf8") + readFileSync(join(ROOT, "api/ping.js"), "utf8");
    assert.doesNotMatch(src, /x-forwarded-for|x-real-ip|cf-connecting-ip|user-agent|remoteAddress/i);
    assert.match(src, /content-length/);
  });
});
