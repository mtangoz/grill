// upstreamCore.mjs — the pure half of the upstream drift check.
//
// No fs, no network — checkChain takes the model catalog and the ZDR endpoint list as plain
// data (already fetched and parsed by upstream-check.mjs) and returns a plain list of problem
// strings. That split is what makes it testable against a saved fixture of the real API shapes
// rather than a live network call.
//
// WHAT THIS GUARDS AGAINST. judge.mjs's whole privacy guarantee rests on every request in the
// chain landing on a model that (a) still exists in OpenRouter's catalog and (b) still has a
// zero-data-retention endpoint — both can change upstream, silently, with no error from
// judge.mjs itself: a model dropped from the catalog just 404s on the rare occasion the chain
// walk actually reaches it, and a model that lost ZDR coverage fails its `provider: {zdr:
// true}` request and the chain quietly walks past it. This is a maintainer tool that checks
// both conditions up front, on a schedule, so that drift is caught as a GitHub issue instead of
// as a degraded grill run nobody was watching for.
//
// Zero dependencies. Node >= 20. ESM throughout.

import { AUTO_ROUTER_PLUGIN_IDS } from "./judgeCore.mjs";

/** "a, ,b" -> ["a", "b"]. Same splitting rule judgeCore's own parseChain uses. */
function parseChain(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function idsOf(list, field) {
  return new Set(
    (Array.isArray(list) ? list : [])
      .map((item) => item?.[field])
      .filter((id) => typeof id === "string" && id.length > 0),
  );
}

/**
 * Check every CONCRETE model slug in `chainString` against OpenRouter's model catalog and its
 * zero-data-retention endpoint list.
 *
 * A router slug — anything that is a key of `AUTO_ROUTER_PLUGIN_IDS` (`openrouter/auto`,
 * `openrouter/auto-beta`) — is skipped: it is a meta-model with no catalog entry and no ZDR
 * endpoint of its own (confirmed against the real API: `openrouter/auto` has zero entries in
 * `/api/v1/endpoints/zdr`), so checking it here would always find a false problem, on a model
 * this repo is never routed to directly.
 *
 * For every other slug, two independent checks, each reported on its own if it fails:
 *   - it must appear in `modelsJson.data[].id` (GET /api/v1/models);
 *   - it must have at least one entry in `zdrJson.data` whose `model_id` matches
 *     (GET /api/v1/endpoints/zdr — note the field is `model_id` there, not `id`).
 * A slug missing from the catalog entirely is ALSO reported as missing ZDR coverage, rather
 * than short-circuited: the two facts are independently true and a caller scanning the problem
 * list for "does this slug have ZDR coverage" should not have to first rule out "is it even a
 * real model" to get a reliable answer.
 *
 * @param {string} chainString comma-separated model chain, e.g. judgeCore's DEFAULT_CHAIN.
 * @param {{data?: Array<{id?: string}>}} modelsJson parsed body of GET /api/v1/models.
 * @param {{data?: Array<{model_id?: string}>}} zdrJson parsed body of GET /api/v1/endpoints/zdr.
 * @returns {string[]} human-readable problems; empty when the chain is clean.
 */
export function checkChain(chainString, modelsJson, zdrJson) {
  const problems = [];
  const chain = parseChain(chainString);
  const modelIds = idsOf(modelsJson?.data, "id");
  const zdrIds = idsOf(zdrJson?.data, "model_id");

  for (const slug of chain) {
    if (Object.hasOwn(AUTO_ROUTER_PLUGIN_IDS, slug)) continue;

    if (!modelIds.has(slug)) {
      problems.push(`${slug}: not found in OpenRouter's model catalog (GET /api/v1/models, data[].id)`);
    }
    if (!zdrIds.has(slug)) {
      problems.push(
        `${slug}: no zero-data-retention endpoint (GET /api/v1/endpoints/zdr, data[].model_id) — every judge request sets provider.zdr:true, so this model would fail every real request`,
      );
    }
  }

  return problems;
}
