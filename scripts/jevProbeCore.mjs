// jevProbeCore.mjs — the pure half of scripts/jev-routing-probe.mjs.
//
// WHY THIS EXISTS. The quality check asks OpenRouter's decisions endpoint for Jev's
// zero-retention endpoint only (`provider: { only: ["typesafe/zdr"] }`, checkCore.JEV_ZDR_ENDPOINT).
// OpenRouter's reference lists `provider.only` but does not say it takes an endpoint tag, and a
// reply names only the provider ("TypeSafe"), which both of Jev's endpoints answer as. So the
// routing is unproven, checkCore.JEV_ONLY_VERIFIED_ON is empty, and the weekly upstream check is red
// until someone confirms it live. This module turns that confirmation into one command with three
// requests, all carrying a FICTIONAL write-up (PROBE_SUBJECT), never anyone's decision:
//
//   wrong-tag       only: ["typesafe/<no such tag>"]       must be refused
//   wrong-provider  only: ["<no such provider>/zdr"]       must be refused
//   zdr             only: [JEV_ZDR_ENDPOINT]                must be answered, by TypeSafe
//
// If OpenRouter matched `only` on the provider name alone, it would serve wrong-tag from TypeSafe,
// possibly from the retaining endpoint, and the probe says so. If both decoys are refused and the
// zdr request is answered, the routing reads the tag. The last step stays human: the owner opens
// OpenRouter's activity log for the zdr request and checks it shows the zero-retention endpoint.
// Only then does anyone set JEV_ONLY_VERIFIED_ON. The probe never edits code.
//
// Zero dependencies. Node >= 20. ESM throughout. No network here: the CLI does the fetches.

import { JEV_PROVIDER, JEV_ZDR_ENDPOINT, buildCheckRequest } from "./checkCore.mjs";

/** A made-up decision. It is the only write-up the probe ever sends. */
export const PROBE_SUBJECT = [
  "Fictional test write-up for a routing probe. No real person or company.",
  "Decision: a small bakery will move its Saturday opening from 8:00 to 7:00 for four weeks.",
  "Why: three regulars asked for it. Cost: one extra staff hour per Saturday.",
  "Check: if fewer than ten sales happen before 8:00 on the first two Saturdays, go back to 8:00.",
].join("\n");

const PROBE_RESULT = {
  verdict: "holds-with-conditions",
  verdictReason: "Cheap, reversible, with a stated stop rule.",
  challenges: [
    {
      severity: "moderate",
      kind: "hidden-assumption",
      target: "three regulars asked for it",
      challenge: "Three requests may not mean ten early sales.",
      falsifier: "Count sales before 8:00 on the first two Saturdays.",
    },
  ],
};

/** Tags no provider uses. Fixed strings, so a run is repeatable and greppable in the activity log. */
export const DECOY_TAG = "typesafe/grill-probe-no-such-endpoint";
export const DECOY_PROVIDER = "grill-probe-no-such-provider/zdr";

/** One request per arm. Each is the check's real request with only `provider.only` changed. */
export function probeRequests() {
  const base = buildCheckRequest({ subject: PROBE_SUBJECT, question: "Should we open earlier?", result: PROBE_RESULT });
  const pinned = (tag) => ({ ...base, provider: { only: [tag] } });
  return [
    { arm: "wrong-tag", expect: "refused", request: pinned(DECOY_TAG) },
    { arm: "wrong-provider", expect: "refused", request: pinned(DECOY_PROVIDER) },
    { arm: "zdr", expect: "answered", request: pinned(JEV_ZDR_ENDPOINT) },
  ];
}

/** Auth, credit or rate limits: the request never reached routing, so it proves nothing. */
const NOT_ROUTING = new Set([401, 402, 403, 408, 429]);

/**
 * What one arm's response shows. `r` is `{outcome, status, data?, detail?}`, the shape judge.mjs's
 * postJson returns: outcome is "ok", "http", "no-response", "stalled" or "unparseable".
 * @returns {"refused"|"answered"|"answered-by-other"|"inconclusive"}
 */
export function classifyArm(r) {
  if (!r || typeof r !== "object") return "inconclusive";
  if (r.outcome === "ok") return r.data?.provider === JEV_PROVIDER ? "answered" : "answered-by-other";
  if (r.outcome === "http" && Number.isInteger(r.status) && r.status >= 400 && r.status < 500 && !NOT_ROUTING.has(r.status)) {
    return "refused";
  }
  return "inconclusive";
}

/**
 * The probe's finding from all three arms, `{arm: response}`.
 * @returns {{finding: "not-honoured"|"inconclusive"|"consistent", exitCode: 0|1|2, lines: string[]}}
 *   exitCode 0: consistent, pending the activity-log check. 1: the routing is not honoured. 2: inconclusive.
 */
export function judgeProbe(responses) {
  const seen = {};
  for (const { arm } of probeRequests()) seen[arm] = classifyArm(responses?.[arm]);
  const lines = Object.entries(seen).map(([arm, got]) => {
    const r = responses?.[arm];
    const status = r?.status ?? r?.outcome ?? "none";
    return `${arm}: ${got} (${status})`;
  });

  // A decoy that was served at all means `only` did not hold, whoever served it. Checked first:
  // this is the finding that matters even if the zdr arm also failed.
  const leaked = ["wrong-tag", "wrong-provider"].filter((a) => seen[a] === "answered" || seen[a] === "answered-by-other");
  if (leaked.length > 0) {
    lines.push(
      `NOT HONOURED: OpenRouter served ${leaked.join(" and ")}, pinned to an endpoint that does not exist. ` +
        "provider.only does not hold on the decisions endpoint, so a check pinned to typesafe/zdr could reach the retaining endpoint. " +
        "Leave JEV_ONLY_VERIFIED_ON empty and turn the quality check off until this is fixed.",
    );
    return { finding: "not-honoured", exitCode: 1, lines };
  }
  if (seen.zdr === "answered-by-other") {
    lines.push(`NOT HONOURED: the zdr request was answered by "${responses.zdr.data?.provider}", not ${JEV_PROVIDER}.`);
    return { finding: "not-honoured", exitCode: 1, lines };
  }
  if (seen.zdr !== "answered" || seen["wrong-tag"] !== "refused" || seen["wrong-provider"] !== "refused") {
    lines.push(
      "INCONCLUSIVE: the zdr request must be answered and both decoys refused with a routing error (400/404). " +
        "Auth, credit, rate-limit, timeout or 5xx answers say nothing about routing. Fix the cause and run again.",
    );
    return { finding: "inconclusive", exitCode: 2, lines };
  }
  const id = responses.zdr.data?.id;
  lines.push(
    "CONSISTENT: both decoys were refused and the zdr request was answered by TypeSafe, so provider.only reads the endpoint tag. " +
      `Last step, by hand: open OpenRouter's activity log for this key${id ? `, request ${id},` : ""} and check it shows TypeSafe's zero-retention endpoint. ` +
      "Only then set checkCore.JEV_ONLY_VERIFIED_ON to today's date.",
  );
  return { finding: "consistent", exitCode: 0, lines };
}
