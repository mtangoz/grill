#!/usr/bin/env node
/**
 * upstream-check.mjs — maintainer tool: is every model in the judge's chain still real?
 *
 * Fetches OpenRouter's live model catalog and its zero-data-retention endpoint list, and
 * checks the judge's model chain (judgeCore.DEFAULT_CHAIN, or JUDGE_MODEL when set — same
 * override judge.mjs itself honours) against both. See upstreamCore.mjs for exactly what
 * "checked" means and why a router slug like `openrouter/auto` is skipped.
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
 *   0   every concrete model in the chain is cataloged and has ZDR coverage.
 *   1   at least one problem was found, or either endpoint could not be fetched or parsed.
 */

import { DEFAULT_CHAIN } from "./judgeCore.mjs";
import { checkChain } from "./upstreamCore.mjs";

const MODELS_URL = "https://openrouter.ai/api/v1/models";
const ZDR_URL = "https://openrouter.ai/api/v1/endpoints/zdr";

function fail(message) {
  console.error(`[upstream-check] ERROR: ${message}`);
  process.exit(1);
}

async function fetchJson(url, what) {
  let response;
  try {
    response = await fetch(url);
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

const [models, zdr] = await Promise.all([
  fetchJson(MODELS_URL, "the model catalog"),
  fetchJson(ZDR_URL, "the zero-data-retention endpoint list"),
]);

const problems = checkChain(chain, models, zdr);

console.log(`[upstream-check] chain: ${chain}`);
if (problems.length === 0) {
  console.log("[upstream-check] OK — every concrete model in the chain is cataloged and has ZDR coverage.");
  process.exit(0);
}

console.log(`[upstream-check] ${problems.length} problem(s):`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);
