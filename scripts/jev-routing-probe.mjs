#!/usr/bin/env node
/**
 * jev-routing-probe.mjs — maintainer tool: does OpenRouter's decisions endpoint honour the quality
 * check's `provider.only: ["typesafe/zdr"]`?
 *
 * Sends three requests with a FICTIONAL write-up (jevProbeCore.PROBE_SUBJECT), never anyone's
 * decision: two pinned to endpoints that do not exist (must be refused) and one pinned to Jev's
 * zero-retention endpoint (must be answered by TypeSafe). See jevProbeCore.mjs for the reasoning.
 * The result is what unblocks the weekly upstream check: it stays red while
 * checkCore.JEV_ONLY_VERIFIED_ON is empty. This script never edits that constant. A person sets it,
 * after also checking OpenRouter's activity log.
 *
 * Never shipped, never run on a user's behalf. Costs one Jev call (two or three if a decoy leaks).
 *
 * USAGE
 *   OPENROUTER_API_KEY=... node scripts/jev-routing-probe.mjs
 *
 * ENVIRONMENT
 *   OPENROUTER_API_KEY    required. Use a capped key.
 *   JUDGE_DECISIONS_URL   test-only override of the decisions endpoint, same as judge.mjs.
 *
 * EXIT CODES
 *   0   consistent: decoys refused, zdr answered by TypeSafe. Check the activity log next.
 *   1   not honoured: a decoy was served, or the zdr request was answered by someone else.
 *   2   inconclusive (auth, credit, rate limit, timeout, 5xx), or no key.
 */

import { judgeProbe, probeRequests } from "./jevProbeCore.mjs";

const DECISIONS_URL = process.env.JUDGE_DECISIONS_URL || "https://openrouter.ai/api/alpha/decisions";
const KEY = process.env.OPENROUTER_API_KEY;
const TIMEOUT_MS = 60000;

if (!KEY) {
  console.error("[jev-routing-probe] OPENROUTER_API_KEY is not set. Use a capped key.");
  process.exit(2);
}

async function post(body) {
  let response;
  try {
    response = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://grillyour.ai",
        "X-Title": "Grill",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { outcome: "no-response", status: null, detail: String(e?.message ?? e) };
  }
  let text = "";
  try {
    text = await response.text();
  } catch (e) {
    return { outcome: "stalled", status: response.status, detail: String(e?.message ?? e) };
  }
  if (!response.ok) return { outcome: "http", status: response.status, detail: text.slice(0, 300) };
  try {
    return { outcome: "ok", status: response.status, data: JSON.parse(text) };
  } catch {
    return { outcome: "unparseable", status: response.status, detail: text.slice(0, 300) };
  }
}

const responses = {};
// One at a time, decoys first, so a leak shows before the paid zdr call.
for (const { arm, request } of probeRequests()) {
  responses[arm] = await post(request);
  const r = responses[arm];
  const note = r.outcome === "ok" ? `provider=${r.data?.provider ?? "?"} id=${r.data?.id ?? "?"}` : (r.detail ?? "");
  console.error(`[jev-routing-probe] ${arm}: ${r.outcome} ${r.status ?? ""} ${note}`.trim());
}

const { lines, exitCode } = judgeProbe(responses);
for (const line of lines) console.log(line);
process.exit(exitCode);
