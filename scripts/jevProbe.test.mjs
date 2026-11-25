// Tests for the Jev routing probe (jevProbeCore.mjs, jev-routing-probe.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { JEV_PROVIDER, JEV_ZDR_ENDPOINT, checkRoutingIsZdrOnly } from "./checkCore.mjs";
import { DECOY_PROVIDER, DECOY_TAG, PROBE_SUBJECT, classifyArm, judgeProbe, probeRequests } from "./jevProbeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ok = (provider = JEV_PROVIDER, id = "gen-1") => ({ outcome: "ok", status: 200, data: { provider, id, answers: {} } });
const http = (status) => ({ outcome: "http", status, detail: "x" });

test("probe requests: three arms, each the real check request with only provider.only changed", () => {
  const arms = probeRequests();
  assert.deepEqual(arms.map((a) => a.arm), ["wrong-tag", "wrong-provider", "zdr"]);
  assert.deepEqual(arms.map((a) => a.request.provider), [{ only: [DECOY_TAG] }, { only: [DECOY_PROVIDER] }, { only: [JEV_ZDR_ENDPOINT] }]);
  // The zdr arm passes the same fail-closed gate judge.mjs applies; the decoys do not.
  assert.equal(checkRoutingIsZdrOnly(arms[2].request), true);
  assert.equal(checkRoutingIsZdrOnly(arms[0].request), false);
  for (const a of arms) assert.equal(a.request.state.write_up, PROBE_SUBJECT);
  assert.match(PROBE_SUBJECT, /^Fictional/);
});

test("classifyArm: routing refusals vs answers vs responses that say nothing about routing", () => {
  assert.equal(classifyArm(ok()), "answered");
  assert.equal(classifyArm(ok("SomeoneElse")), "answered-by-other");
  assert.equal(classifyArm(http(400)), "refused");
  assert.equal(classifyArm(http(404)), "refused");
  for (const s of [401, 402, 403, 408, 429, 500, 503]) assert.equal(classifyArm(http(s)), "inconclusive", String(s));
  assert.equal(classifyArm({ outcome: "no-response", status: null }), "inconclusive");
  assert.equal(classifyArm({ outcome: "unparseable", status: 200 }), "inconclusive");
  assert.equal(classifyArm(undefined), "inconclusive");
});

test("judgeProbe: decoys refused and zdr answered by TypeSafe is consistent, and names the request id", () => {
  const out = judgeProbe({ "wrong-tag": http(400), "wrong-provider": http(404), zdr: ok(JEV_PROVIDER, "gen-abc") });
  assert.equal(out.finding, "consistent");
  assert.equal(out.exitCode, 0);
  assert.match(out.lines.at(-1), /gen-abc/);
  assert.match(out.lines.at(-1), /activity log/);
});

test("judgeProbe: a served decoy is not-honoured, even when the zdr arm also failed", () => {
  for (const decoy of ["wrong-tag", "wrong-provider"]) {
    const responses = { "wrong-tag": http(400), "wrong-provider": http(400), zdr: http(500) };
    responses[decoy] = ok();
    const out = judgeProbe(responses);
    assert.equal(out.finding, "not-honoured", decoy);
    assert.equal(out.exitCode, 1);
    assert.match(out.lines.at(-1), /turn the quality check off/);
  }
});

test("judgeProbe: zdr answered by another provider is not-honoured", () => {
  const out = judgeProbe({ "wrong-tag": http(400), "wrong-provider": http(400), zdr: ok("Other") });
  assert.equal(out.finding, "not-honoured");
});

test("judgeProbe: auth or credit failures are inconclusive, never consistent", () => {
  assert.equal(judgeProbe({ "wrong-tag": http(401), "wrong-provider": http(401), zdr: http(401) }).exitCode, 2);
  // A 400 on the decoys means nothing if the same key could not get the zdr request answered.
  assert.equal(judgeProbe({ "wrong-tag": http(400), "wrong-provider": http(400), zdr: http(402) }).finding, "inconclusive");
  assert.equal(judgeProbe({}).finding, "inconclusive");
});

// The CLI against a local fake of the decisions endpoint.
function runProbe(handler, env = {}) {
  return new Promise((resolve, reject) => {
    const bodies = [];
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        bodies.push({ body, auth: req.headers.authorization });
        const [status, json] = handler(body.provider?.only?.[0]);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(json));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}/decisions`;
      const child = spawn(process.execPath, [join(ROOT, "scripts/jev-routing-probe.mjs")], {
        env: { PATH: process.env.PATH, JUDGE_DECISIONS_URL: url, OPENROUTER_API_KEY: "sk-test-probe", ...env },
      });
      let stdout = "";
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", () => {});
      child.on("error", reject);
      child.on("close", (code) => server.close(() => resolve({ code, stdout, bodies })));
    });
  });
}

test("CLI: a router that honours the tag gives exit 0, decoys sent first", async () => {
  const { code, stdout, bodies } = await runProbe((tag) =>
    tag === JEV_ZDR_ENDPOINT ? [200, { provider: JEV_PROVIDER, id: "gen-local", answers: {} }] : [400, { error: { message: "no such endpoint" } }],
  );
  assert.equal(code, 0, stdout);
  assert.match(stdout, /CONSISTENT/);
  assert.deepEqual(bodies.map((b) => b.body.provider.only[0]), [DECOY_TAG, DECOY_PROVIDER, JEV_ZDR_ENDPOINT]);
  for (const b of bodies) {
    assert.equal(b.auth, "Bearer sk-test-probe");
    assert.equal(b.body.state.write_up, PROBE_SUBJECT);
  }
});

test("CLI: a router that matches on the provider name only gives exit 1", async () => {
  const { code, stdout } = await runProbe((tag) =>
    tag.startsWith("typesafe/") ? [200, { provider: JEV_PROVIDER, id: "g", answers: {} }] : [400, {}],
  );
  assert.equal(code, 1);
  assert.match(stdout, /NOT HONOURED: OpenRouter served wrong-tag/);
});

test("CLI: no key sends nothing and exits 2", async () => {
  const { code, bodies } = await runProbe(() => [200, {}], { OPENROUTER_API_KEY: "" });
  assert.equal(code, 2);
  assert.equal(bodies.length, 0);
});
