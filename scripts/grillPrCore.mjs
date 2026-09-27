// Builds the subject Grill CI sends to the judge, and the one sticky pull-request
// comment that comes back. Pure: no network, no git, no token. The runner checks
// out the base commit and passes in text it fetched from the API.

import { budgetText, stripSecrets, VERDICT_BADGE } from "./judgeCore.mjs";

export const GRILL_MARKER = "<!-- grill-ci -->";
export const GRILL_QUESTION =
  "Should this PR be merged as is? What could break, what's untested, and what's the cheapest check before merging?";
export const BODY_CHAR_BUDGET = 8000;

const SHA_MARKER = /<!-- grill-ci-sha: ([0-9a-f]{7,64}) -->/;

export function shaMarker(sha) {
  const clean = String(sha ?? "").toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(clean)) throw new Error("head sha is missing or unexpected");
  return `<!-- grill-ci-sha: ${clean} -->`;
}

/** True when this head was already grilled or intentionally skipped for size. */
export function alreadyGrilled(comments, sha, botLogin = "github-actions[bot]") {
  const want = String(sha ?? "").toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(want)) return false;
  for (const comment of comments ?? []) {
    if (!comment || comment.userLogin !== botLogin || typeof comment.body !== "string") continue;
    if (!comment.body.includes(GRILL_MARKER)) continue;
    const found = comment.body.match(SHA_MARKER);
    if (found && found[1] === want) return true;
  }
  return false;
}

/** `--author` args for judge.mjs. An empty family omits the flag (default exclusion). */
export function judgeAuthorArgs(family) {
  const value = String(family ?? "").trim().toLowerCase();
  return value ? ["--author", value] : [];
}

function reasonText(reason) {
  if (typeof reason === "string") return reason;
  return typeof reason?.message === "string" ? reason.message : "";
}

function fence(text) {
  const body = typeof text === "string" ? text : "";
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}diff\n${body}\n${ticks}`;
}

function describeFile(file) {
  if (typeof file === "string") return file;
  const path = typeof file?.path === "string" ? file.path : "(unnamed)";
  const status = typeof file?.status === "string" && file.status ? file.status : "changed";
  const prev = typeof file?.previousPath === "string" && file.previousPath ? ` (from ${file.previousPath})` : "";
  const additions = Number(file?.additions);
  const deletions = Number(file?.deletions);
  const lines = Number.isInteger(additions) && Number.isInteger(deletions) ? `, +${additions} -${deletions}` : "";
  return `${path}${prev} (${status}${lines})`;
}

/**
 * The subject the judge reads. The diff is capped by `diffCharBudget` characters
 * and the cap is named in the text. Secret-shaped strings are replaced before return.
 */
export function buildWriteUp({
  title = "",
  body = "",
  tier = "medium",
  reasons = [],
  files = [],
  diff = "",
  diffCharBudget = 24000,
} = {}) {
  const description = budgetText(stripSecrets(typeof body === "string" ? body : "").text, BODY_CHAR_BUDGET);
  const clippedDiff = budgetText(stripSecrets(typeof diff === "string" ? diff : "").text, diffCharBudget);
  const reasonLines = (Array.isArray(reasons) ? reasons : []).map(reasonText).filter(Boolean);
  const fileLines = (Array.isArray(files) ? files : []).map(describeFile);
  const parts = [
    "# Pull request",
    "",
    "## What it claims to do",
    `Title: ${typeof title === "string" && title.trim() ? title.trim() : "(no title)"}`,
    "",
    description.text.trim() ? description.text : "(no description)",
  ];
  if (description.clipped) parts.push("", "The pull request description is truncated.");
  parts.push(
    "",
    "## Risk tier",
    String(tier),
    "",
    reasonLines.length ? reasonLines.map((line) => `- ${line}`).join("\n") : "- (no extra reasons)",
    "",
    "## Changed files",
    fileLines.length ? fileLines.map((line) => `- ${line}`).join("\n") : "- (none)",
    "",
    "## Diff",
    clippedDiff.text.trim() ? fence(clippedDiff.text) : "(no diff)",
  );
  if (clippedDiff.clipped) parts.push("", "The diff is truncated.");
  const stripped = stripSecrets(parts.join("\n"));
  return {
    text: stripped.text,
    truncated: clippedDiff.clipped || description.clipped,
    secrets: stripped.secrets,
    stripped: stripped.stripped,
  };
}

function flatten(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function formatCost(costUsd) {
  if (typeof costUsd !== "number" || !Number.isFinite(costUsd)) return "unknown";
  if (costUsd === 0) return "$0";
  const digits = Math.abs(costUsd) >= 0.01 ? 2 : 4;
  return `$${costUsd.toFixed(digits)}`;
}

export function verdictBadge(verdict) {
  return Object.prototype.hasOwnProperty.call(VERDICT_BADGE, verdict) ? VERDICT_BADGE[verdict] : null;
}

/**
 * Labels for a finished verdict. Shaky results add needs-review (which blocks
 * auto-merge). Solid results add grill-solid and clear needs-review. Anything
 * else changes no labels.
 */
export function grillLabels(badge, { needsReviewLabel = "needs-review", grillSolidLabel = "grill-solid" } = {}) {
  if (badge === "shaky" || badge === "doesn't hold up") {
    return { add: [needsReviewLabel], remove: [grillSolidLabel] };
  }
  if (badge === "solid" || badge === "solid if") {
    return { add: [grillSolidLabel], remove: [needsReviewLabel] };
  }
  return { add: [], remove: [] };
}

function reasonBlock(reasons) {
  const lines = (Array.isArray(reasons) ? reasons : []).map(reasonText).filter(Boolean).slice(0, 12);
  if (lines.length === 0) return "";
  return lines.map((line) => `- ${line}`).join("\n");
}

function challengeBlock(challenges) {
  const list = Array.isArray(challenges) ? challenges.slice(0, 10) : [];
  if (list.length === 0) return "_None. The judge tried to break it and could not._";
  return list.map((challenge, index) => {
    const severity = flatten(challenge?.severity) || "note";
    const text = flatten(challenge?.challenge) || "(no challenge text)";
    const check = flatten(challenge?.falsifier) || "(none named)";
    return `${index + 1}. **${severity}.** ${text}\n   Cheapest check: ${check}`;
  }).join("\n\n");
}

function finish(parts) {
  return stripSecrets(parts.filter((part) => part !== "").join("\n\n")).text;
}

/** One sticky comment. `kind` is unconfigured, low, enormous, degraded, error, or result. */
export function formatGrillComment(state = {}) {
  const tier = state.tier || "medium";
  if (state.kind === "unconfigured") {
    return finish([
      GRILL_MARKER,
      "**Grill CI is not configured.**",
      "This repository has no `GRILL_CI_OPENROUTER_KEY` secret, so the judge did not run. Add that secret and the next push will grill this pull request.",
    ]);
  }
  if (state.kind === "error") {
    return finish([
      GRILL_MARKER,
      "**Grill CI could not finish.**",
      "The judge run failed, so this job fails. Nothing was labeled from this attempt. The log has the error. A later push runs it again.",
    ]);
  }

  const stamp = shaMarker(state.sha);
  if (state.kind === "low") {
    return finish([
      GRILL_MARKER,
      stamp,
      "**Grill CI skipped this push.** It is low risk, so auto-merge handles it and the judge was not called.",
    ]);
  }
  if (state.kind === "enormous") {
    const why = state.diffTooLarge
      ? "The diff is too large to send to the judge."
      : `The diff is ${state.changedLines} changed lines, above the ${state.limit} line budget for a judge run.`;
    return finish([
      GRILL_MARKER,
      stamp,
      `**Grill CI skipped this push.** ${why} Risk tier: **${tier}**. Nothing was sent to the judge.`,
      reasonBlock(state.reasons),
    ]);
  }
  if (state.kind === "degraded") {
    const notes = (Array.isArray(state.degraded) ? state.degraded : []).map(flatten).filter(Boolean).slice(0, 6);
    return finish([
      GRILL_MARKER,
      stamp,
      `**Grill CI · ${tier} risk · no review**`,
      "The judge run was degraded, so this is not a review and no label was changed.",
      notes.length ? notes.map((line) => `- ${line}`).join("\n") : "",
      `Judge model: ${flatten(state.servedModel) || "unavailable"}. Cost: ${formatCost(state.costUsd)}.`,
    ]);
  }

  const badge = state.badge || verdictBadge(state.verdict) || "unknown";
  const family = String(state.authorFamily ?? "").trim();
  const exclusion = family ? `\`--author ${family}\`` : "the default (Anthropic excluded, `--author` omitted)";
  return finish([
    GRILL_MARKER,
    stamp,
    `**Grill CI · ${tier} risk · ${badge}**`,
    reasonBlock(state.reasons),
    state.verdictReason ? flatten(state.verdictReason) : "",
    "**What could break, and the cheapest check**",
    challengeBlock(state.challenges),
    `Judge model: ${flatten(state.servedModel) || "unavailable"}. Cost: ${formatCost(state.costUsd)}. Exclusion: ${exclusion}.`,
    "This is advisory. The job passes either way, so it does not block merging unless branch protection requires it. `needs-review` blocks auto-merge. `grill-solid` does not make a pull request low risk. A solid verdict clears `needs-review`. Use `do-not-merge` when a later solid grill should still not merge.",
  ]);
}
