// Grill CI: tier write-up, author exclusion args, and the one sticky comment.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMENT_MARKER, commentPlan } from "./automergeCore.mjs";
import { redactSensitive } from "./judgeCore.mjs";
import {
  GRILL_MARKER,
  GRILL_QUESTION,
  alreadyGrilled,
  buildWriteUp,
  formatGrillComment,
  grillLabels,
  judgeAuthorArgs,
} from "./grillPrCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET = "sk-or-v1-0123456789abcdef0123456789abcdef";
const SHA = "0123456789abcdef0123456789abcdef01234567";

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

describe("author exclusion args", () => {
  it("omits --author for the default, and passes a family when one is set", () => {
    assert.deepEqual(judgeAuthorArgs(""), []);
    assert.deepEqual(judgeAuthorArgs("   "), []);
    assert.deepEqual(judgeAuthorArgs("openai"), ["--author", "openai"]);
    assert.deepEqual(judgeAuthorArgs("Anthropic"), ["--author", "anthropic"]);
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
      authorFamily: "openai",
    });
    assert.ok(body.startsWith(GRILL_MARKER));
    assert.match(body, /grill-ci-sha: 0123456789abcdef/);
    assert.match(body, /\*\*Grill CI · high risk · shaky\*\*/);
    assert.match(body, /api\/_pro\.mjs/);
    assert.match(body, /The migration has no rollback/);
    assert.match(body, /Cheapest check: Run the charge test with the provider returning 500/);
    assert.match(body, /google\/gemini-2\.5-pro/);
    assert.match(body, /\$0\.03/);
    assert.match(body, /--author openai/);
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
      authorFamily: "",
    });
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes("sk-or-v1"), false);
    assert.match(body, /\[redacted\]/);
    assert.match(body, /doesn't hold up/);
    assert.match(body, /\$0/);
    assert.match(body, /--author` omitted/);
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
    assert.match(runner, /judgeAuthorArgs/);
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
