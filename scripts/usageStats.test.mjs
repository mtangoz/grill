// The opt-in ping: explicit on, a kill switch that wins, one first success, then one per ISO week.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PING_TIMEOUT_MS,
  PING_URL,
  bucketMs,
  isoWeek,
  scheduleUsagePing,
  sendUsagePing,
  usageStatsEnabled,
  usageStatsKilled,
} from "./usageStats.mjs";

const CANARY = "CANARY-writeup-9f3a2c-do-not-send";
const KEY = "sk-or-v1-this-must-not-leave";

function tempFile() {
  const dir = mkdtempSync(join(tmpdir(), "grill-usage-"));
  return { dir, file: join(dir, ".grill", "usage-stats.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function accept() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: init.body, timeout: init.signal });
    return { status: 204, body: { cancel: async () => {} } };
  };
  return { calls, fetchImpl };
}

function env(extra = {}) {
  return { GRILL_USAGE_STATS: "true", GRILL_CLIENT: "mcpb", GRILL_ROUTE: "one_click", ...extra };
}

describe("the setting is off unless it is exactly on", () => {
  for (const value of [undefined, "", "   ", "false", "FALSE", "0", "off", "no", "maybe", "2", "${user_config.usage_stats}"]) {
    it(`treats ${JSON.stringify(value)} as off`, () => {
      const src = value === undefined ? {} : { GRILL_USAGE_STATS: value };
      assert.equal(usageStatsEnabled(src), false);
    });
  }

  for (const value of ["true", "TRUE", " true ", "1", "on", "ON", "yes", "Yes"]) {
    it(`treats ${JSON.stringify(value)} as on`, () => {
      assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: value }), true);
    });
  }
});

describe("the kill switch wins", () => {
  for (const ping of ["off", "OFF", " false ", "0", "no"]) {
    it(`GRILL_PING=${JSON.stringify(ping)} beats GRILL_USAGE_STATS=true`, () => {
      assert.equal(usageStatsKilled({ GRILL_PING: ping }), true);
      assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: "true", GRILL_PING: ping }), false);
    });
  }

  it("DO_NOT_TRACK=1 beats an explicit opt-in, and other values do not", () => {
    assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: "true", DO_NOT_TRACK: "1" }), false);
    assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: "true", DO_NOT_TRACK: " 1 " }), false);
    assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: "yes", DO_NOT_TRACK: "true" }), true);
    assert.equal(usageStatsEnabled({ GRILL_USAGE_STATS: "true", GRILL_PING: "on" }), true);
  });
});

describe("what is sent", () => {
  it("posts exactly the allowed keys to the ping URL, with no decision text", async () => {
    const { calls, fetchImpl } = accept();
    const place = tempFile();
    try {
      const sent = await sendUsagePing({
        ok: true,
        ms: 150,
        version: "0.1.1",
        env: env({
          OPENROUTER_API_KEY: KEY,
          JUDGE_MODEL: CANARY,
          subject: CANARY,
          question: CANARY,
        }),
        fetchImpl,
        stateFile: place.file,
        now: Date.parse("2026-10-01T15:00:00Z"),
      });
      assert.equal(sent, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, PING_URL);
      assert.equal(calls[0].url, "https://grillyour.ai/api/ping");
      assert.ok(Buffer.byteLength(calls[0].body) <= 512);
      const body = JSON.parse(calls[0].body);
      assert.deepEqual(Object.keys(body), ["v", "id", "ver", "client", "route", "ok", "ms", "ts"]);
      assert.equal(body.v, "1");
      assert.match(body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.equal(body.ver, "0.1.1");
      assert.equal(body.client, "mcpb");
      assert.equal(body.route, "one_click");
      assert.equal(body.ok, true);
      assert.equal(body.ms, 200);
      assert.equal(body.ts, "2026-10-01");
      const wire = JSON.stringify(body);
      assert.equal(wire.includes(CANARY), false);
      assert.equal(wire.includes(KEY), false);
      assert.equal(wire.includes("subject"), false);
      const state = JSON.parse(readFileSync(place.file, "utf8"));
      assert.equal(state.id, body.id);
      assert.equal(state.firstSentDay, "2026-10-01");
      assert.equal(JSON.stringify(state).includes(CANARY), false);
      assert.equal(statSync(place.file).mode & 0o777, 0o600);
      assert.equal(statSync(join(place.dir, ".grill")).mode & 0o777, 0o700);
    } finally {
      place.cleanup();
    }
  });

  it("rounds latency to the nearest 100 and caps it", () => {
    assert.equal(bucketMs(0), 0);
    assert.equal(bucketMs(49), 0);
    assert.equal(bucketMs(50), 100);
    assert.equal(bucketMs(149), 100);
    assert.equal(bucketMs(150), 200);
    assert.equal(bucketMs(9_999_999), 3_600_000);
    assert.equal(PING_TIMEOUT_MS <= 2000, true);
  });

  it("uses stdio and one_click when the packaging env is unset, and keeps a loopback override", async () => {
    const { calls, fetchImpl } = accept();
    const place = tempFile();
    const loop = "http://127.0.0.1:9/api/ping";
    try {
      await sendUsagePing({
        ok: true,
        ms: 100,
        version: "0.1.1",
        env: { GRILL_USAGE_STATS: "true", GRILL_PING_URL: "https://evil.example/collect" },
        fetchImpl,
        stateFile: place.file,
        now: Date.parse("2026-10-01T00:00:00Z"),
      });
      assert.equal(calls[0].url, PING_URL);
      const body = JSON.parse(calls[0].body);
      assert.equal(body.client, "stdio");
      assert.equal(body.route, "one_click");
      calls.length = 0;
      const again = tempFile();
      try {
        await sendUsagePing({
          ok: true,
          ms: 100,
          version: "0.1.1",
          env: { GRILL_USAGE_STATS: "on", GRILL_PING_URL: loop, GRILL_CLIENT: "nope", GRILL_ROUTE: "plugin" },
          fetchImpl,
          stateFile: again.file,
          now: Date.parse("2026-10-01T00:00:00Z"),
        });
        assert.equal(calls[0].url, loop);
        const routed = JSON.parse(calls[0].body);
        assert.equal(routed.client, "other");
        assert.equal(routed.route, "plugin");
      } finally {
        again.cleanup();
      }
    } finally {
      place.cleanup();
    }
  });
});

describe("when it fires", () => {
  it("sends on the first success, skips the rest of that ISO week, and sends again the next week", async () => {
    const { calls, fetchImpl } = accept();
    const place = tempFile();
    const base = { ok: true, ms: 100, version: "0.1.1", env: env(), fetchImpl, stateFile: place.file };
    try {
      assert.equal(isoWeek(Date.parse("2026-10-01T00:00:00Z")), isoWeek(Date.parse("2026-10-04T23:00:00Z")));
      assert.notEqual(isoWeek(Date.parse("2026-10-01T00:00:00Z")), isoWeek(Date.parse("2026-10-05T00:00:00Z")));
      assert.equal(isoWeek(Date.parse("2025-12-29T00:00:00Z")), isoWeek(Date.parse("2026-01-01T00:00:00Z")));
      assert.notEqual(isoWeek(Date.parse("2025-12-28T00:00:00Z")), isoWeek(Date.parse("2026-01-01T00:00:00Z")));
      assert.equal(await sendUsagePing({ ...base, now: Date.parse("2026-10-01T12:00:00Z") }), true);
      assert.equal(await sendUsagePing({ ...base, now: Date.parse("2026-10-04T18:00:00Z") }), false);
      assert.equal(calls.length, 1);
      const id = JSON.parse(calls[0].body).id;
      assert.equal(await sendUsagePing({ ...base, now: Date.parse("2026-10-05T00:00:00Z") }), true);
      assert.equal(calls.length, 2);
      assert.equal(JSON.parse(calls[1].body).id, id);
      assert.equal(JSON.parse(calls[1].body).ts, "2026-10-05");
    } finally {
      place.cleanup();
    }
  });

  it("does not ping a failed grill, and does not create the state file", async () => {
    const { calls, fetchImpl } = accept();
    const place = tempFile();
    try {
      assert.equal(
        await sendUsagePing({ ok: false, ms: 100, version: "0.1.1", env: env(), fetchImpl, stateFile: place.file }),
        false,
      );
      assert.equal(calls.length, 0);
      assert.equal(statSync(place.dir).isDirectory(), true);
      assert.throws(() => statSync(place.file));
    } finally {
      place.cleanup();
    }
  });

  it("retries a dropped post once, and does not retry a 400", async () => {
    const place = tempFile();
    try {
      let n = 0;
      const sent = await sendUsagePing({
        ok: true,
        ms: 100,
        version: "0.1.1",
        env: env(),
        stateFile: place.file,
        now: Date.parse("2026-10-01T00:00:00Z"),
        fetchImpl: async () => {
          n += 1;
          if (n === 1) throw new Error("reset");
          return { status: 204, body: { cancel: async () => {} } };
        },
      });
      assert.equal(sent, true);
      assert.equal(n, 2);
      let calls = 0;
      const refused = await sendUsagePing({
        ok: true,
        ms: 100,
        version: "0.1.1",
        env: env(),
        stateFile: place.file,
        now: Date.parse("2026-10-08T00:00:00Z"),
        fetchImpl: async () => {
          calls += 1;
          return { status: 400, body: { cancel: async () => {} } };
        },
      });
      assert.equal(refused, false);
      assert.equal(calls, 1);
    } finally {
      place.cleanup();
    }
  });

  it("gives up after one retry when the endpoint never answers", async () => {
    const place = tempFile();
    try {
      let calls = 0;
      const started = Date.now();
      const sent = await sendUsagePing({
        ok: true,
        ms: 100,
        version: "0.1.1",
        env: env(),
        stateFile: place.file,
        timeoutMs: 40,
        fetchImpl: (url, init) =>
          new Promise((resolve, reject) => {
            calls += 1;
            const timer = setTimeout(() => resolve({ status: 204, body: { cancel: async () => {} } }), 10_000);
            init.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(init.signal.reason ?? new Error("aborted"));
            });
          }),
      });
      assert.equal(sent, false);
      assert.equal(calls, 2);
      assert.ok(Date.now() - started < 1000, "two short timeouts, not a hung request");
    } finally {
      place.cleanup();
    }
  });
});

describe("off means no file and no request", () => {
  for (const extra of [
    {},
    { GRILL_USAGE_STATS: "" },
    { GRILL_USAGE_STATS: "${user_config.usage_stats}" },
    { GRILL_USAGE_STATS: "false" },
    { GRILL_USAGE_STATS: "true", GRILL_PING: "off" },
    { GRILL_USAGE_STATS: "true", DO_NOT_TRACK: "1" },
  ]) {
    it(`does not touch the state file for ${JSON.stringify(extra)}`, async () => {
      const place = tempFile();
      let called = 0;
      try {
        const sent = await sendUsagePing({
          ok: true,
          ms: 100,
          version: "0.1.1",
          env: extra,
          stateFile: place.file,
          fetchImpl: async () => {
            called += 1;
            throw new Error("should not be called");
          },
        });
        assert.equal(sent, false);
        assert.equal(called, 0);
        assert.throws(() => statSync(place.file));
        scheduleUsagePing({ ok: true, ms: 1, version: "0.1.1", env: extra, stateFile: place.file });
        assert.throws(() => statSync(place.file));
      } finally {
        place.cleanup();
      }
    });
  }
});
