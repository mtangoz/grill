// Unit tests for upstreamCore.mjs, against SAVED, TRIMMED, REAL-SHAPE fixtures of OpenRouter's
// two public catalog endpoints (scripts/fixtures/upstream/*.json — see those files' own
// `_comment` for provenance). No network; no dependencies; node:test + node:assert only.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { JEV_MODEL } from "./checkCore.mjs";
import { AUTO_ROUTER_PLUGIN_IDS, DEFAULT_CHAIN } from "./judgeCore.mjs";
import { checkChain, checkZdrListed } from "./upstreamCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "upstream");

const models = JSON.parse(readFileSync(join(FIXTURES, "models-sample.json"), "utf8"));
const zdr = JSON.parse(readFileSync(join(FIXTURES, "zdr-sample.json"), "utf8"));

// ---------------------------------------------------------------------------
describe("checkChain against the real-shape fixtures", () => {
  it("finds no problems in judgeCore's actual DEFAULT_CHAIN — the fixtures were captured to cover it", () => {
    assert.deepEqual(checkChain(DEFAULT_CHAIN, models, zdr), []);
  });

  it("skips every router slug (openrouter/auto, openrouter/auto-beta) rather than reporting them as missing", () => {
    for (const routerSlug of Object.keys(AUTO_ROUTER_PLUGIN_IDS)) {
      assert.deepEqual(checkChain(routerSlug, models, zdr), []);
    }
  });

  it("reports a concrete model that IS in the catalog but has NO real ZDR coverage", () => {
    // z-ai/glm-5.3-prime is a real model id, present in models-sample.json, and genuinely
    // absent from zdr-sample.json — both taken from the live API, not fabricated.
    const problems = checkChain("z-ai/glm-5.3-prime", models, zdr);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no zero-data-retention endpoint/);
    assert.match(problems[0], /z-ai\/glm-5\.3-prime/);
  });

  it("reports BOTH problems for a slug in neither catalog nor ZDR list", () => {
    const problems = checkChain("openai/gpt-9999-does-not-exist", models, zdr);
    assert.equal(problems.length, 2);
    assert.ok(problems.some((p) => /not found in OpenRouter's model catalog/.test(p)));
    assert.ok(problems.some((p) => /no zero-data-retention endpoint/.test(p)));
  });

  it("checks every concrete link in a mixed chain independently", () => {
    const problems = checkChain("openrouter/auto,openai/gpt-5.6-sol,z-ai/glm-5.3-prime", models, zdr);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /z-ai\/glm-5\.3-prime/);
  });

  it("passes a concrete model with multiple ZDR provider rows (openai/gpt-5.6-sol has two in the fixture)", () => {
    assert.deepEqual(checkChain("openai/gpt-5.6-sol", models, zdr), []);
  });
});

// ---------------------------------------------------------------------------
describe("checkChain input handling", () => {
  it("treats a malformed or empty modelsJson/zdrJson as 'nothing known' rather than throwing", () => {
    assert.deepEqual(checkChain("openai/gpt-5.6-sol", {}, {}), [
      "openai/gpt-5.6-sol: not found in OpenRouter's model catalog (GET /api/v1/models, data[].id)",
      "openai/gpt-5.6-sol: no zero-data-retention endpoint (GET /api/v1/endpoints/zdr, data[].model_id) — every judge request sets provider.zdr:true, so this model would fail every real request",
    ]);
    assert.doesNotThrow(() => checkChain("openai/gpt-5.6-sol", null, undefined));
    assert.doesNotThrow(() => checkChain("openai/gpt-5.6-sol", { data: null }, { data: "not-an-array" }));
  });

  it("parses an empty chain to no problems at all", () => {
    assert.deepEqual(checkChain("", models, zdr), []);
    assert.deepEqual(checkChain(",, ,", models, zdr), []);
  });

  it("trims whitespace around each link the same way judgeCore's own chain parsing does", () => {
    assert.deepEqual(checkChain(" openai/gpt-5.6-sol , openai/gpt-5.3-codex ", models, zdr), []);
  });

  it("ignores an entry in modelsJson.data or zdrJson.data with a non-string id instead of crashing", () => {
    const dirtyModels = { data: [{ id: 42 }, { id: "openai/gpt-5.6-sol" }, {}, null] };
    const dirtyZdr = { data: [{ model_id: null }, { model_id: "openai/gpt-5.6-sol" }] };
    assert.deepEqual(checkChain("openai/gpt-5.6-sol", dirtyModels, dirtyZdr), []);
  });
});

// ---------------------------------------------------------------------------
describe("checkZdrListed — the quality check's pinned model", () => {
  const WHY = "every check would send masked write-ups to an endpoint that no longer promises zero retention";

  it("finds typesafe/jev-1.13 on the real-shape ZDR fixture", () => {
    assert.equal(JEV_MODEL, "typesafe/jev-1.13");
    assert.deepEqual(checkZdrListed(JEV_MODEL, zdr, WHY), []);
  });

  it("reports it, with the consequence, once it is off the list", () => {
    const without = { data: zdr.data.filter((row) => row.model_id !== JEV_MODEL) };
    const problems = checkZdrListed(JEV_MODEL, without, WHY);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^typesafe\/jev-1\.13: no zero-data-retention endpoint \(GET \/api\/v1\/endpoints\/zdr, data\[\]\.model_id\)/);
    assert.ok(problems[0].endsWith(WHY));
  });

  it("reads only model_id, the ZDR list's own key, never a lookalike field", () => {
    assert.equal(checkZdrListed(JEV_MODEL, { data: [{ id: JEV_MODEL }, { model_name: JEV_MODEL }] }, WHY).length, 1);
  });

  it("treats a missing or malformed list as 'not listed' rather than throwing", () => {
    for (const bad of [null, undefined, {}, { data: null }, { data: "x" }, { data: [null, 42] }]) {
      assert.equal(checkZdrListed(JEV_MODEL, bad, WHY).length, 1);
    }
  });

  it("is a separate check because the model is not in the chat catalog: checkChain would call it missing every week", () => {
    assert.ok(!models.data.some((m) => m.id === JEV_MODEL), "the real /api/v1/models has no entry for it");
    assert.ok(checkChain(JEV_MODEL, models, zdr).some((p) => /not found in OpenRouter's model catalog/.test(p)));
  });
});

describe("checkAllEndpointsZdr: every endpoint, not just one", async () => {
  const { checkAllEndpointsZdr } = await import("./upstreamCore.mjs");
  const { readFileSync } = await import("node:fs");
  const here = new URL(".", import.meta.url).pathname;
  const endpoints = JSON.parse(readFileSync(`${here}fixtures/upstream/jev-endpoints-sample.json`, "utf8"));
  const zdrRow = { model_id: "typesafe/jev-1.13", provider_name: "TypeSafe", tag: "typesafe" };

  it("passes when the model's only endpoint is on the ZDR list (the live shape, 2026-09-26)", () => {
    assert.deepEqual(checkAllEndpointsZdr("typesafe/jev-1.13", endpoints, { data: [zdrRow] }, "x"), []);
  });

  it("flags a second endpoint from the same provider that is not zero-retention", () => {
    const two = { data: { ...endpoints.data, endpoints: [...endpoints.data.endpoints, { provider_name: "TypeSafe", tag: "typesafe/retaining" }] } };
    const problems = checkAllEndpointsZdr("typesafe/jev-1.13", two, { data: [zdrRow] }, "x");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /typesafe\/retaining/);
  });

  it("flags an unreadable endpoint list instead of passing silently", () => {
    assert.equal(checkAllEndpointsZdr("typesafe/jev-1.13", {}, { data: [zdrRow] }, "x").length, 1);
  });
});
