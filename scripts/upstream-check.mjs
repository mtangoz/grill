#!/usr/bin/env node
/**
 * upstream-check.mjs — maintainer tool: is every model in the judge's chain still real?
 *
 * Fetches OpenRouter's live model catalog and its zero-data-retention endpoint list, and
 * checks the judge's model chain (judgeCore.DEFAULT_CHAIN, or JUDGE_MODEL when set — same
 * override judge.mjs itself honours) against both. See upstreamCore.mjs for exactly what
 * "checked" means and why a router slug like `openrouter/auto` is skipped.
 *
 * It also checks the quality check's pinned endpoint (checkCore.JEV_ZDR_ENDPOINT for
 * checkCore.JEV_MODEL). That request asks OpenRouter for that endpoint only and fails closed, so
 * the check fails if the endpoint is no longer served or leaves the zero-data-retention list.
 * Other endpoints for the model that retain data are printed, not failed.
 *
 * NETWORK IS FINE HERE. Unlike judge.mjs and eval.mjs, this script is never shipped to users
 * and never runs on their behalf — it is a maintainer/CI tool that talks to OpenRouter's own
 * public catalog endpoints directly, no API key required.
 *
 * USAGE
 *   node scripts/upstream-check.mjs
 *
 * ENVIRONMENT
 *   JUDGE_MODEL   optional chain override, in the same comma-separated syntax judge.mjs
 *                 itself reads. Defaults to judgeCore.mjs's DEFAULT_CHAIN.
 *
 * EXIT CODES
 *   0   every concrete model in the chain is cataloged and has ZDR coverage, and so does the
 *       quality check's model.
 *   1   at least one problem was found, or either endpoint could not be fetched or parsed.
 */

import { JEV_MODEL, JEV_ZDR_ENDPOINT } from "./checkCore.mjs";
import { DEFAULT_CHAIN } from "./judgeCore.mjs";
import { checkChain, checkPinnedEndpointZdr, otherEndpointsNotZdr } from "./upstreamCore.mjs";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const ZDR_URL = "https://openrouter.ai/api/v1/endpoints/zdr";

function fail(message) {
  console.error(`[upstream-check] ERROR: ${message}`);
  process.exit(1);
}

async function fetchJson(url, what) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "HTTP-Referer": "https://grillyour.ai",
        "X-Title": "Grill",
      },
    });
  } catch (e) {
    return fail(`could not reach ${what} (${url}): ${e?.message ?? e}`);
  }
  if (!response.ok) {
    return fail(`${what} (${url}) returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (e) {
    return fail(`${what} (${url}) returned unparseable JSON: ${e?.message ?? e}`);
  }
}

const chain = process.env.JUDGE_MODEL || DEFAULT_CHAIN;

const [models, zdr, jevEndpoints] = await Promise.all([
  fetchJson(MODELS_URL, "the model catalog"),
  fetchJson(ZDR_URL, "the zero-data-retention endpoint list"),
  fetchJson(`https://openrouter.ai/api/v1/models/${JEV_MODEL}/endpoints`, "the quality check model's endpoint list"),
]);

const problems = [
  ...checkChain(chain, models, zdr),
  ...checkPinnedEndpointZdr(
    JEV_MODEL,
    JEV_ZDR_ENDPOINT,
    jevEndpoints,
    zdr,
    "the opt-in quality check asks for that endpoint only, so every check would now say unavailable. Re-pin it to a zero-retention endpoint or turn the check off",
  ),
];
const retaining = otherEndpointsNotZdr(JEV_MODEL, JEV_ZDR_ENDPOINT, jevEndpoints, zdr);

console.log(`[upstream-check] chain: ${chain}`);
console.log(`[upstream-check] quality check model: ${JEV_MODEL}, pinned to ${JEV_ZDR_ENDPOINT}`);
if (retaining.length) console.log(`[upstream-check] note: not zero-retention, and not used by the check: ${retaining.join(", ")}`);
if (problems.length === 0) {
  console.log(
    `[upstream-check] OK — every concrete model in the chain is cataloged and has ZDR coverage, and ${JEV_MODEL}'s pinned endpoint ${JEV_ZDR_ENDPOINT} is on the ZDR list.`,
  );
  process.exit(0);
}

console.log(`[upstream-check] ${problems.length} problem(s):`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
