// Grill CI: tier write-up, author exclusion args, and the one sticky comment.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMENT_MARKER, commentPlan, loadConfig } from "./automergeCore.mjs";
import { redactSensitive } from "./judgeCore.mjs";
import {
  GRILL_MARKER,
  GRILL_QUESTION,
  actionableDegraded,
  alreadyGrilled,
  buildWriteUp,
  companyCheck,
  formatGrillComment,
  grillLabels,
  judgePlan,
  reviewOutcome,
  writtenByModel,
} from "./grillPrCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "sk-or-v1-0123456789abcdef0123456789abcdef";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const config = loadConfig(JSON.parse(readFileSync(join(ROOT, ".github/automerge.json"), "utf8")));

describe("the write-up", () => {
  it("asks the merge question through the judge, and caps a long diff", () => {
    assert.equal(
      GRILL_QUESTION,
      "Should this PR be merged as is? What could break, what's untested, and what's the cheapest check before merging?",
    );
    const tail = "UNIQUE_TAIL_SHOULD_BE_GONE";
    const writeUp = buildWriteUp({
      title: "Add a refund path",
      body: "Refunds go through the existing charge helper.",
      tier: "high",
      reasons: [{ message: "api/_pro.mjs is high risk because it matches api/**." }],
      files: [{ path: "api/_pro.mjs", status: "modified", additions: 12, deletions: 2 }],
      diff: `${"changed line\n".repeat(200)}${tail}`,
      diffCharBudget: 400,
    });
    assert.match(writeUp.text, /Add a refund path/);
    assert.match(writeUp.text, /## Risk tier\nhigh/);
    assert.match(writeUp.text, /api\/_pro\.mjs/);
    assert.match(writeUp.text, /The diff is truncated/);
    assert.equal(writeUp.truncated, true);
    assert.equal(writeUp.text.includes(tail), false);
  });

  it("strips secrets and contact details before the text can be sent", () => {
    const writeUp = buildWriteUp({
      title: "Rotate credentials",
      body: `Send mail to sam@example.com and the key ${SECRET}.`,
      tier: "medium",
      reasons: ["package.json is not on the safe path list."],
      files: ["package.json"],
      diff: `+const token = "${SECRET}";\n+ghp_${"a".repeat(36)}\n`,
      diffCharBudget: 8000,
    });
    assert.equal(writeUp.text.includes(SECRET), false);
    assert.equal(writeUp.text.includes("0123456789abcdef"), false);
    assert.equal(writeUp.text.includes("ghp_"), false);
    assert.equal(writeUp.text.includes("sam@example.com"), false);
    assert.match(writeUp.text, /\[redacted\]/);
    assert.match(writeUp.text, /\[email\]/);
    assert.deepEqual(redactSensitive(writeUp.text).secrets, []);
  });
});

describe("who the judge is allowed to be", () => {
  function plan(author, body = "") {
    return judgePlan({ author, body, config });
  }

  it("excludes Anthropic for Claude Code and pins a Google judge", () => {
    const claude = plan("claude[bot]", "Written-by-model: openai/gpt-5.6-sol");
    assert.equal(claude.ok, true);
    assert.equal(claude.authorVendor, "anthropic");
    assert.equal(claude.judgeModel, "google/gemini-2.5-pro");
    assert.equal(claude.judgeVendor, "google");
    assert.deepEqual(claude.authorArgs, ["--author", "anthropic"]);
    assert.ok(claude.excludedVendors.includes("anthropic"));
    assert.ok(claude.excludedVendors.includes("x-ai"));
    assert.equal(claude.excludedVendors.includes("openai"), false);
    assert.equal(plan("Claude[bot]").authorVendor, "anthropic");
  });

  it("excludes OpenAI for Codex and pins a Google judge", () => {
    const codex = plan("chatgpt-codex-connector[bot]");
    assert.equal(codex.authorVendor, "openai");
    assert.equal(codex.judgeModel, "google/gemini-2.5-pro");
    assert.deepEqual(codex.authorArgs, ["--author", "openai"]);
    assert.ok(codex.excludedVendors.includes("openai"));
    assert.ok(codex.excludedVendors.includes("x-ai"));
    assert.equal(codex.excludedVendors.includes("google"), false);
  });

  it("pins Gemini for Cursor, mtangoz, and an unknown login when the body names no model", () => {
    for (const author of ["mtangoz", "cursor[bot]", "cursoragent", "Cursor[bot]", "octocat", ""]) {
      const row = plan(author, "No model line here.");
      assert.equal(row.authorVendor, "unknown", author);
      assert.equal(row.judgeModel, "google/gemini-2.5-pro", author);
      assert.equal(row.judgeVendor, "google", author);
      assert.deepEqual(row.authorArgs, [], author);
      assert.equal(row.requireJudgeVendor, "google", author);
      assert.ok(row.excludedVendors.includes("x-ai"), author);
      assert.equal(row.excludedVendors.includes("anthropic"), false, author);
      assert.equal(row.excludedVendors.includes("openai"), false, author);
    }
  });

  it("reads Written-by-model from the body and excludes that vendor", () => {
    const anthropic = plan("mtangoz", "Summary\n\nWritten-by-model: anthropic/claude-opus-4\n");
    assert.equal(anthropic.authorVendor, "anthropic");
    assert.equal(anthropic.declared, "anthropic/claude-opus-4");
    assert.equal(anthropic.judgeVendor, "google");
    assert.ok(anthropic.excludedVendors.includes("anthropic"));
    assert.ok(anthropic.excludedVendors.includes("x-ai"));

    const openai = plan("cursoragent", "Written-by-model: OpenAI/gpt-5.6-sol");
    assert.equal(openai.authorVendor, "openai");
    assert.equal(openai.judgeModel, "google/gemini-2.5-pro");
    assert.ok(openai.excludedVendors.includes("openai"));

    const google = plan("cursor[bot]", "> Written-by-model: google/gemini-2.5-pro");
    assert.equal(google.authorVendor, "google");
    assert.equal(google.judgeModel, "openai/gpt-5.6-sol");
    assert.equal(google.judgeVendor, "openai");
    assert.ok(google.excludedVendors.includes("google"));
    assert.ok(google.excludedVendors.includes("x-ai"));

    const grok = plan("mtangoz", "Written-by-model: x-ai/grok-4");
    assert.equal(grok.authorVendor, "x-ai");
    assert.equal(grok.judgeModel, "google/gemini-2.5-pro");
    assert.ok(grok.excludedVendors.includes("x-ai"));

    assert.equal(writtenByModel("see Written-by-model: openai/gpt-5.6-sol inline"), null);
    assert.equal(plan("octocat", "Written-by-model: not a slug").authorVendor, "unknown");
  });
});

describe("the post-run company check", () => {
  it("accepts a judge from a different company and rejects the excluded one", () => {
    const claude = judgePlan({ author: "claude[bot]", body: "", config });
    const ok = companyCheck({
      servedModel: "google/gemini-2.5-pro",
      authorVendor: claude.authorVendor,
      excludedVendors: claude.excludedVendors,
      requireJudgeVendor: claude.requireJudgeVendor,
    });
    assert.equal(ok.decorrelated, true);
    assert.equal(ok.line, "Author model vendor: anthropic, judge: google (different company ✓)");
    const outcome = reviewOutcome({ check: ok, badge: "solid", degradedNotes: [] });
    assert.equal(outcome.failJob, false);
    assert.equal(outcome.kind, "result");
    assert.deepEqual(outcome.labels, { add: ["grill-solid"], remove: ["needs-review"] });

    const same = companyCheck({
      servedModel: "anthropic/claude-opus-4",
      authorVendor: claude.authorVendor,
      excludedVendors: claude.excludedVendors,
    });
    assert.equal(same.decorrelated, false);
    assert.equal(same.verifiable, true);
    assert.equal(same.line, "Author model vendor: anthropic, judge: anthropic (NOT decorrelated)");
    const failed = reviewOutcome({ check: same, badge: "solid" });
    assert.equal(failed.failJob, true);
    assert.equal(failed.kind, "not-decorrelated");
    assert.deepEqual(failed.labels, { add: ["needs-review"], remove: ["grill-solid"] });
  });

  it("rejects x-ai for every mapping, and requires Gemini when the author vendor is unknown", () => {
    const unknown = judgePlan({ author: "mtangoz", body: "", config });
    const gemini = companyCheck({
      servedModel: "google/gemini-2.5-pro",
      authorVendor: unknown.authorVendor,
      excludedVendors: unknown.excludedVendors,
      requireJudgeVendor: unknown.requireJudgeVendor,
    });
    assert.equal(gemini.line, "Author model vendor: unknown, judge: google (different company ✓)");
    const openai = companyCheck({
      servedModel: "openai/gpt-5.6-sol",
      authorVendor: unknown.authorVendor,
      excludedVendors: unknown.excludedVendors,
      requireJudgeVendor: unknown.requireJudgeVendor,
    });
    assert.equal(openai.decorrelated, false);
    assert.equal(reviewOutcome({ check: openai, badge: "shaky" }).failJob, true);
    const grok = companyCheck({
      servedModel: "x-ai/grok-4",
      authorVendor: unknown.authorVendor,
      excludedVendors: unknown.excludedVendors,
      requireJudgeVendor: unknown.requireJudgeVendor,
    });
    assert.equal(grok.decorrelated, false);
    assert.match(grok.line, /judge: x-ai \(NOT decorrelated\)/);

    const codex = judgePlan({ author: "chatgpt-codex-connector[bot]", body: "", config });
    const codexGrok = companyCheck({
      servedModel: "x-ai/grok-4",
      authorVendor: codex.authorVendor,
      excludedVendors: codex.excludedVendors,
      requireJudgeVendor: codex.requireJudgeVendor,
    });
    assert.equal(codexGrok.decorrelated, false);
    assert.equal(reviewOutcome({ check: codexGrok, badge: "solid" }).labels.add[0], "needs-review");

    const writtenGoogle = judgePlan({ author: "cursor[bot]", body: "Written-by-model: google/gemini-2.5-pro", config });
    const otherCompany = companyCheck({
      servedModel: "openai/gpt-5.6-sol",
      authorVendor: writtenGoogle.authorVendor,
      excludedVendors: writtenGoogle.excludedVendors,
      requireJudgeVendor: writtenGoogle.requireJudgeVendor,
    });
    assert.equal(otherCompany.line, "Author model vendor: google, judge: openai (different company ✓)");
    const stillGoogle = companyCheck({
      servedModel: "google/gemini-2.5-pro",
      authorVendor: writtenGoogle.authorVendor,
      excludedVendors: writtenGoogle.excludedVendors,
    });
    assert.equal(stillGoogle.decorrelated, false);
    assert.equal(reviewOutcome({ check: stillGoogle, badge: "solid if" }).failJob, true);
  });

  it("does not treat a missing model as a failed company check, and ignores the intentional pin note", () => {
    const missing = companyCheck({ servedModel: "", authorVendor: "anthropic", excludedVendors: ["anthropic", "x-ai"] });
    assert.equal(missing.verifiable, false);
    assert.equal(missing.decorrelated, false);
    assert.equal(reviewOutcome({ check: missing, badge: "shaky" }).failJob, false);
    assert.equal(reviewOutcome({ check: missing, badge: "shaky" }).kind, "degraded");
    const shadow = "JUDGE_MODEL pins `google/gemini-2.5-pro`, which SHADOWS the default's Auto Router — the per-request model choice is off and this judge is pinned to one vendor";
    assert.deepEqual(actionableDegraded([shadow]), []);
    assert.equal(actionableDegraded([shadow, "the judge returned no tool call"]).length, 1);
    const check = companyCheck({
      servedModel: "google/gemini-2.5-pro",
      authorVendor: "anthropic",
      excludedVendors: ["anthropic", "x-ai"],
    });
    assert.equal(reviewOutcome({ check, badge: "shaky", degradedNotes: actionableDegraded([shadow]) }).kind, "result");
  });
});

describe("the sticky comment", () => {
  it("formats a verdict with the tier, the cheapest checks, the model, and the cost", () => {
    const body = formatGrillComment({
      kind: "result",
      sha: SHA,
      tier: "high",
      reasons: [{ message: "api/_pro.mjs is high risk because it matches api/**." }],
      badge: "shaky",
      verdictReason: "The migration has no rollback.",
      challenges: [{
        severity: "serious",
        challenge: "A failed charge leaves the row half-written.",
        falsifier: "Run the charge test with the provider returning 500.",
      }],
      servedModel: "google/gemini-2.5-pro",
      costUsd: 0.031,
      companyLine: "Author model vendor: openai, judge: google (different company ✓)",
    });
    assert.ok(body.startsWith(GRILL_MARKER));
    assert.match(body, /grill-ci-sha: 0123456789abcdef/);
    assert.match(body, /\*\*Grill CI · high risk · shaky\*\*/);
    assert.match(body, /api\/_pro\.mjs/);
    assert.match(body, /The migration has no rollback/);
    assert.match(body, /Cheapest check: Run the charge test with the provider returning 500/);
    assert.match(body, /google\/gemini-2\.5-pro/);
    assert.match(body, /\$0\.03/);
    assert.match(body, /Author model vendor: openai, judge: google \(different company ✓\)/);
    assert.match(body, /needs-review/);
    assert.equal(body.includes(SECRET), false);
  });

  it("redacts a secret the judge copied into a challenge", () => {
    const body = formatGrillComment({
      kind: "result",
      sha: SHA,
      tier: "medium",
      badge: "doesn't hold up",
      challenges: [{ severity: "fatal", challenge: `The diff contains ${SECRET}.`, falsifier: "Search the diff for a key." }],
      servedModel: "google/gemini-2.5-pro",
      costUsd: 0,
      companyLine: "Author model vendor: unknown, judge: google (different company ✓)",
    });
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes("sk-or-v1"), false);
    assert.match(body, /\[redacted\]/);
    assert.match(body, /doesn't hold up/);
    assert.match(body, /\$0/);
    assert.match(body, /Author model vendor: unknown, judge: google \(different company ✓\)/);
  });

  it("leaves the sha off the unconfigured and error comments", () => {
    const missing = formatGrillComment({ kind: "unconfigured" });
    assert.match(missing, /Grill CI is not configured/);
    assert.match(missing, /GRILL_CI_OPENROUTER_KEY/);
    assert.doesNotMatch(missing, /grill-ci-sha/);
    const failed = formatGrillComment({ kind: "error" });
    assert.match(failed, /could not finish/);
    assert.doesNotMatch(failed, /grill-ci-sha/);
  });

  it("stamps a size skip so the same head is not grilled again", () => {
    const body = formatGrillComment({
      kind: "enormous",
      sha: SHA,
      tier: "high",
      changedLines: 4500,
      limit: 4000,
      reasons: [{ message: "It changes 4500 lines, above the 800 line high-risk mark." }],
    });
    assert.match(body, /skipped this push/);
    assert.match(body, /4500 changed lines/);
    assert.match(body, /4000 line budget/);
    assert.match(body, new RegExp(`grill-ci-sha: ${SHA}`));
    const comments = [{ id: 4, body, userLogin: "github-actions[bot]" }];
    assert.equal(alreadyGrilled(comments, SHA), true);
    const failed = formatGrillComment({
      kind: "not-decorrelated",
      sha: SHA,
      tier: "high",
      companyLine: "Author model vendor: anthropic, judge: anthropic (NOT decorrelated)",
      servedModel: "anthropic/claude-opus-4",
    });
    assert.match(failed, /NOT decorrelated/);
    assert.equal(alreadyGrilled([{ id: 9, body: failed, userLogin: "github-actions[bot]" }], SHA), false);
    assert.equal(alreadyGrilled(comments, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
    assert.equal(alreadyGrilled([{ id: 1, body: formatGrillComment({ kind: "unconfigured" }), userLogin: "github-actions[bot]" }], SHA), false);
    assert.equal(alreadyGrilled([{ id: 2, body, userLogin: "mtangoz" }], SHA), false);
  });

  it("updates the grill comment without touching the auto-merge comment", () => {
    const grill = formatGrillComment({ kind: "low", sha: SHA });
    const automerge = `${COMMENT_MARKER}\n\nAuto-merge is on.`;
    const plan = commentPlan([
      { id: 1, body: automerge, userLogin: "github-actions[bot]" },
      { id: 2, body: `${GRILL_MARKER}\n\nold`, userLogin: "github-actions[bot]" },
    ], grill, "github-actions[bot]", GRILL_MARKER);
    assert.equal(plan.create, null);
    assert.equal(plan.updateId, 2);
    assert.deepEqual(plan.deleteIds, []);
    const automergePlan = commentPlan([
      { id: 1, body: automerge, userLogin: "github-actions[bot]" },
      { id: 2, body: grill, userLogin: "github-actions[bot]" },
    ], automerge);
    assert.equal(automergePlan.updateId, null);
  });
});

describe("verdict labels", () => {
  it("adds needs-review when the verdict is shaky, and grill-solid when it holds", () => {
    assert.deepEqual(grillLabels("shaky"), { add: ["needs-review"], remove: ["grill-solid"] });
    assert.deepEqual(grillLabels("doesn't hold up"), { add: ["needs-review"], remove: ["grill-solid"] });
    assert.deepEqual(grillLabels("solid"), { add: ["grill-solid"], remove: ["needs-review"] });
    assert.deepEqual(grillLabels("solid if"), { add: ["grill-solid"], remove: ["needs-review"] });
    assert.deepEqual(grillLabels(null), { add: [], remove: [] });
  });
});

describe("the grill workflow contract", () => {
  const yaml = readFileSync(join(ROOT, ".github/workflows/grill-pr.yml"), "utf8");
  const runner = readFileSync(join(ROOT, "scripts/grillPr.mjs"), "utf8");

  it("listens to same-repo ready pull requests and checks out the base commit only", () => {
    assert.match(yaml, /on:\n {2}pull_request:\n/);
    assert.doesNotMatch(yaml, /pull_request_target/);
    for (const type of ["opened", "synchronize", "ready_for_review", "reopened"]) {
      assert.match(yaml, new RegExp(type));
    }
    assert.doesNotMatch(yaml, /labeled/);
    assert.match(yaml, /branches: \[main\]/);
    assert.match(yaml, /contents: read/);
    assert.match(yaml, /pull-requests: write/);
    assert.doesNotMatch(yaml, /contents: write/);
    assert.doesNotMatch(yaml, /issues: write/);
    assert.match(yaml, /github\.event\.pull_request\.draft == false/);
    assert.match(yaml, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
    assert.match(yaml, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
    assert.doesNotMatch(yaml, /ref: \$\{\{ github\.event\.pull_request\.head/);
    assert.match(yaml, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    assert.match(yaml, /secrets\.GRILL_CI_OPENROUTER_KEY/);
    assert.match(yaml, /node scripts\/grillPr\.mjs/);
    assert.match(yaml, /persist-credentials: false/);
  });

  it("runs the judge from the base checkout and never executes the pull request", () => {
    assert.match(runner, /application\/vnd\.github\.diff/);
    assert.match(runner, /--question/);
    assert.match(runner, /GRILL_QUESTION/);
    assert.match(runner, /"--json"/);
    assert.match(runner, /judgePlan/);
    assert.match(runner, /companyCheck/);
    assert.match(runner, /reviewOutcome/);
    assert.match(runner, /env\.JUDGE_MODEL = plan\.judgeModel/);
    assert.match(runner, /OPENROUTER_API_KEY = process\.env\.GRILL_CI_OPENROUTER_KEY/);
    assert.match(runner, /scripts\/judge\.mjs/);
    assert.doesNotMatch(runner, /--check/);
    assert.doesNotMatch(runner, /--text/);
    assert.doesNotMatch(runner, /\bfetch\(/);
    assert.doesNotMatch(runner, /node:https?/);
    assert.doesNotMatch(runner, /\bgit\b/);
    assert.doesNotMatch(runner, /pull_request_target/);
    assert.match(runner, /Grill CI is not configured/);
  });
});
