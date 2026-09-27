// The low-risk auto-merge decision. No network, no token, no git.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMENT_MARKER,
  actionsFor,
  classify,
  commentBody,
  commentPlan,
  loadConfig,
  matchGlob,
} from "./automergeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawConfig = JSON.parse(readFileSync(join(ROOT, ".github/automerge.json"), "utf8"));
const config = loadConfig(rawConfig);

function file(path, over = {}) {
  return { path, previousPath: null, status: "modified", additions: 2, deletions: 1, ...over };
}

function pull(over = {}) {
  return {
    draft: false,
    author: "mtangoz",
    labels: [],
    files: [file("site/page.html")],
    ...over,
  };
}

function rules(result) {
  return result.failures.map((failure) => failure.rule);
}

describe("the shipped policy", () => {
  it("allowlists mtangoz, the Cursor agent accounts, and the Claude Code app bot", () => {
    assert.deepEqual(config.authors, ["mtangoz", "cursor[bot]", "cursoragent", "claude[bot]"]);
    assert.equal(config.maxChangedLines, 300);
    assert.equal(config.maxFiles, 15);
    assert.deepEqual(config.blockingLabels, ["do-not-merge", "needs-review"]);
    assert.equal(config.automergeLabel, "automerge");
  });

  it("keeps site copy to site/page.html and blocks the terms page, the site build, and account routes", () => {
    assert.equal(classify(pull(), config).lowRisk, true);
    for (const path of ["site/terms.html", "scripts/build-site.mjs", "vercel.json", "api/_pro.mjs", "api/_account.mjs"]) {
      const result = classify(pull({ files: [file(path)] }), config);
      assert.equal(result.lowRisk, false, path);
      assert.ok(rules(result).includes("path"), path);
    }
  });
});

describe("a safe copy change passes", () => {
  it("passes a small site/page.html edit from an allowlisted author", () => {
    const result = classify(pull(), config);
    assert.equal(result.lowRisk, true);
    assert.deepEqual(result.failures, []);
    assert.match(commentBody(result), /site\/page\.html/);
    assert.match(commentBody(result), /Auto-merge is on/);
    assert.ok(commentBody(result).startsWith(COMMENT_MARKER));
  });

  it("passes README, LEARNING, docs, a new eval case, and an issue template together", () => {
    const result = classify(pull({
      files: [
        file("README.md"),
        file("LEARNING.md"),
        file("docs/PRO.md"),
        file("docs/CONNECTIONS.md"),
        file("evals/cases/new-sound-example.json", { status: "added", additions: 20, deletions: 0 }),
        file(".github/ISSUE_TEMPLATE/grill-signal.yml"),
        file("site/page.html"),
      ],
    }), config);
    assert.equal(result.lowRisk, true);
  });

  it("passes cursor[bot] and cursoragent, including a differently cased app login", () => {
    assert.equal(classify(pull({ author: "cursor[bot]" }), config).lowRisk, true);
    assert.equal(classify(pull({ author: "cursoragent" }), config).lowRisk, true);
    assert.equal(classify(pull({ author: "Cursor[bot]" }), config).lowRisk, true);
  });

  it("passes a pull request opened by claude[bot]", () => {
    const result = classify(pull({ author: "claude[bot]" }), config);
    assert.equal(result.lowRisk, true);
    assert.deepEqual(result.failures, []);
    assert.equal(classify(pull({ author: "Claude[bot]" }), config).lowRisk, true);
  });

  it("passes exactly 300 lines and exactly 15 files", () => {
    assert.equal(classify(pull({ files: [file("README.md", { additions: 200, deletions: 100 })] }), config).lowRisk, true);
    const files = Array.from({ length: 15 }, (_, i) => file(`docs/note-${i}.md`, { additions: 1, deletions: 0 }));
    assert.equal(classify(pull({ files }), config).lowRisk, true);
  });

  it("ignores the automerge label itself", () => {
    assert.equal(classify(pull({ labels: ["automerge"] }), config).lowRisk, true);
  });

  it("treats an empty diff from an allowlisted author as low risk", () => {
    assert.equal(classify(pull({ files: [] }), config).lowRisk, true);
  });
});

describe("blocked paths fail", () => {
  it("fails an api/ change", () => {
    const result = classify(pull({ files: [file("api/_pro.mjs")] }), config);
    assert.equal(result.lowRisk, false);
    assert.match(result.failures.find((failure) => failure.rule === "path").message, /api\/_pro\.mjs/);
    assert.match(result.failures[0].message, /api\/\*\*/);
  });

  it("fails a workflow change", () => {
    const result = classify(pull({ files: [file(".github/workflows/ci.yml")] }), config);
    assert.equal(result.lowRisk, false);
    assert.match(result.failures.map((failure) => failure.message).join("\n"), /\.github\/workflows\/\*\*/);
  });

  it("fails a prompt change", () => {
    const result = classify(pull({ files: [file("prompts/grill.md")] }), config);
    assert.equal(result.lowRisk, false);
    assert.match(result.failures.map((failure) => failure.message).join("\n"), /prompts\/\*\*/);
  });

  it("fails judge, check, manifest, plugin, lockfile, security, and policy files", () => {
    const blocked = [
      "scripts/judge.mjs",
      "scripts/judgeCore.mjs",
      "scripts/judgeCore.test.mjs",
      "scripts/checkCore.mjs",
      "scripts/checkCore.test.mjs",
      "manifest.json",
      "server.json",
      ".claude-plugin/plugin.json",
      ".mcp.json",
      "package.json",
      "package-lock.json",
      "nested/yarn.lock",
      "SECURITY.md",
      ".github/automerge.json",
      "scripts/automergeCore.mjs",
      "scripts/automerge.mjs",
    ];
    for (const path of blocked) {
      const result = classify(pull({ files: [file(path)] }), config);
      assert.equal(result.lowRisk, false, path);
      assert.ok(rules(result).includes("path"), path);
    }
  });

  it("fails docs/PRIVACY.md even though docs/** is safe, and fails terms and privacy pages", () => {
    for (const path of ["docs/PRIVACY.md", "docs/privacy.md", "site/terms.html", "legal/terms/index.html", "site/privacy.html"]) {
      const result = classify(pull({ files: [file(path)] }), config);
      assert.equal(result.lowRisk, false, path);
    }
    const privacy = classify(pull({ files: [file("docs/PRIVACY.md")] }), config);
    assert.match(privacy.failures.map((failure) => failure.message).join("\n"), /docs\/PRIVACY\.md/i);
  });

  it("fails a path that contains stripe, auth, key, or secret, including inside an otherwise safe directory", () => {
    for (const path of ["docs/stripe.md", "docs/auth-notes.md", "docs/api-key.md", "docs/secret.md", "evals/cases/new-secret-case.json"]) {
      const result = classify(pull({ files: [file(path, { status: "added", additions: 4, deletions: 0 })] }), config);
      assert.equal(result.lowRisk, false, path);
      assert.match(result.failures.map((failure) => failure.message).join("\n"), /path contains/i, path);
    }
  });

  it("fails when one safe file is joined by one blocked file", () => {
    const result = classify(pull({ files: [file("README.md"), file("api/_account.mjs", { additions: 1, deletions: 0 })] }), config);
    assert.equal(result.lowRisk, false);
    assert.match(commentBody(result), /api\/_account\.mjs/);
  });

  it("matches the denylist case-insensitively", () => {
    assert.equal(classify(pull({ files: [file("API/_pro.mjs")] }), config).lowRisk, false);
    assert.equal(classify(pull({ files: [file("Docs/PRIVACY.md")] }), config).lowRisk, false);
  });
});

describe("evals/cases only allow additions", () => {
  it("passes a new case", () => {
    const result = classify(pull({
      files: [file("evals/cases/fresh-case.json", { status: "added", additions: 30, deletions: 0 })],
    }), config);
    assert.equal(result.lowRisk, true);
  });

  it("fails an edit and a deletion of a case", () => {
    const edited = classify(pull({ files: [file("evals/cases/unfalsifiable-launch-buzz.json", { status: "modified" })] }), config);
    const removed = classify(pull({ files: [file("evals/cases/unfalsifiable-launch-buzz.json", { status: "removed", additions: 0, deletions: 10 })] }), config);
    assert.equal(edited.lowRisk, false);
    assert.equal(removed.lowRisk, false);
    assert.match(edited.failures[0].message, /only additions/);
    assert.match(removed.failures[0].message, /only additions/);
  });
});

describe("renames count both paths", () => {
  it("fails a rename from a blocked path onto a safe path", () => {
    const result = classify(pull({
      files: [file("README.md", { status: "renamed", previousPath: "api/_pro.mjs" })],
    }), config);
    assert.equal(result.lowRisk, false);
    assert.match(result.failures.map((failure) => failure.message).join("\n"), /api\/_pro\.mjs/);
  });

  it("fails a rename from a safe path onto a blocked path", () => {
    const result = classify(pull({
      files: [file("api/_pro.mjs", { status: "renamed", previousPath: "README.md" })],
    }), config);
    assert.equal(result.lowRisk, false);
    assert.match(result.failures.map((failure) => failure.message).join("\n"), /api\/_pro\.mjs/);
  });

  it("passes a rename between two safe docs", () => {
    const result = classify(pull({
      files: [file("docs/notes.md", { status: "renamed", previousPath: "docs/PRO.md" })],
    }), config);
    assert.equal(result.lowRisk, true);
  });
});

describe("oversized diffs fail", () => {
  it("fails 301 changed lines", () => {
    const result = classify(pull({ files: [file("README.md", { additions: 200, deletions: 101 })] }), config);
    assert.equal(result.lowRisk, false);
    assert.deepEqual(rules(result), ["size-lines"]);
    assert.match(result.failures[0].message, /301 lines/);
    assert.match(result.failures[0].message, /300 line cap/);
  });

  it("fails 16 files", () => {
    const files = Array.from({ length: 16 }, (_, i) => file(`docs/note-${i}.md`, { additions: 1, deletions: 0 }));
    const result = classify(pull({ files }), config);
    assert.equal(result.lowRisk, false);
    assert.ok(rules(result).includes("size-files"));
    assert.match(result.failures.map((failure) => failure.message).join("\n"), /16 files/);
  });

  it("counts additions and deletions, and reports a size failure next to a path failure", () => {
    const result = classify(pull({ files: [file("prompts/grill.md", { additions: 301, deletions: 0 })] }), config);
    assert.equal(result.lowRisk, false);
    assert.ok(rules(result).includes("path"));
    assert.ok(rules(result).includes("size-lines"));
  });

  it("fails closed when a line count is missing", () => {
    const result = classify(pull({ files: [file("README.md", { additions: 1, deletions: undefined })] }), config);
    assert.equal(result.lowRisk, false);
    assert.ok(rules(result).includes("size-lines"));
  });
});

describe("draft, author, and labels each fail", () => {
  it("fails a draft", () => {
    const result = classify(pull({ draft: true }), config);
    assert.equal(result.lowRisk, false);
    assert.deepEqual(rules(result), ["draft"]);
    assert.match(commentBody(result), /It is a draft/);
  });

  it("fails when draft is missing", () => {
    const result = classify(pull({ draft: undefined }), config);
    assert.equal(result.lowRisk, false);
    assert.ok(rules(result).includes("draft"));
  });

  it("fails an unknown author", () => {
    const result = classify(pull({ author: "someone" }), config);
    assert.equal(result.lowRisk, false);
    assert.deepEqual(rules(result), ["author"]);
    assert.match(result.failures[0].message, /someone is not allowlisted/);
  });

  it("fails dependabot and a missing author", () => {
    assert.equal(classify(pull({ author: "dependabot[bot]" }), config).lowRisk, false);
    const missing = classify(pull({ author: "" }), config);
    assert.equal(missing.lowRisk, false);
    assert.match(missing.failures[0].message, /Author is missing/);
  });

  it("fails the do-not-merge label", () => {
    const result = classify(pull({ labels: ["do-not-merge"] }), config);
    assert.equal(result.lowRisk, false);
    assert.deepEqual(rules(result), ["label"]);
    assert.match(result.failures[0].message, /do-not-merge/);
  });

  it("fails the needs-review label", () => {
    const result = classify(pull({ labels: ["needs-review"] }), config);
    assert.equal(result.lowRisk, false);
    assert.deepEqual(rules(result), ["label"]);
    assert.match(result.failures[0].message, /needs-review/);
  });

  it("fails each blocking label even when the name's case differs, and names both when both are present", () => {
    assert.equal(classify(pull({ labels: ["Do-Not-Merge"] }), config).lowRisk, false);
    assert.equal(classify(pull({ labels: ["Needs-Review"] }), config).lowRisk, false);
    const both = classify(pull({ labels: ["needs-review", "do-not-merge"] }), config);
    assert.equal(both.lowRisk, false);
    const messages = both.failures.map((failure) => failure.message).join("\n");
    assert.match(messages, /do-not-merge/);
    assert.match(messages, /needs-review/);
  });

  it("fails closed when the file list is missing", () => {
    const result = classify(pull({ files: undefined }), config);
    assert.equal(result.lowRisk, false);
    assert.ok(rules(result).includes("files"));
  });
});

describe("comments and actions", () => {
  it("arms auto-merge for a low-risk result and disarms it when a later diff is risky", () => {
    const safe = classify(pull(), config);
    const armed = actionsFor(safe);
    assert.equal(armed.enableAutoMerge, true);
    assert.equal(armed.disableAutoMerge, false);
    assert.equal(armed.addLabel, true);
    assert.equal(armed.removeLabel, false);

    const risky = classify(pull({ files: [file("api/_pro.mjs")] }), config);
    const disarmed = actionsFor(risky);
    assert.equal(disarmed.enableAutoMerge, false);
    assert.equal(disarmed.disableAutoMerge, true);
    assert.equal(disarmed.addLabel, false);
    assert.equal(disarmed.removeLabel, true);
    assert.match(disarmed.commentBody, /api\/_pro\.mjs/);
    assert.match(disarmed.commentBody, /Auto-merge is off/);
  });

  it("posts one comment and updates it in place", () => {
    const body = commentBody(classify(pull(), config));
    const created = commentPlan([], body);
    assert.equal(created.create, body);
    assert.equal(created.updateId, null);

    const same = commentPlan([{ id: 7, body, userLogin: "github-actions[bot]" }], body);
    assert.equal(same.create, null);
    assert.equal(same.updateId, null);
    assert.deepEqual(same.deleteIds, []);

    const next = commentBody(classify(pull({ draft: true }), config));
    const edited = commentPlan([{ id: 7, body, userLogin: "github-actions[bot]" }], next);
    assert.equal(edited.create, null);
    assert.equal(edited.updateId, 7);

    const human = commentPlan([{ id: 3, body: `${COMMENT_MARKER}\nhuman`, userLogin: "mtangoz" }], next);
    assert.equal(human.create, next);
    assert.equal(human.updateId, null);

    const dupes = commentPlan([
      { id: 7, body, userLogin: "github-actions[bot]" },
      { id: 8, body: `${COMMENT_MARKER}\nold`, userLogin: "github-actions[bot]" },
    ], next);
    assert.equal(dupes.updateId, 7);
    assert.deepEqual(dupes.deleteIds, [8]);
  });

  it("rejects a broken policy file", () => {
    assert.throws(() => loadConfig({ ...rawConfig, authors: [] }), /authors/);
    assert.throws(() => loadConfig({ ...rawConfig, maxChangedLines: 0 }), /maxChangedLines/);
    assert.throws(() => loadConfig(null), /object/);
  });
});

describe("path globs", () => {
  it("keeps a single star inside one segment and lets a double star cross directories", () => {
    assert.equal(matchGlob("scripts/judge*.mjs", "scripts/judge.mjs"), true);
    assert.equal(matchGlob("scripts/judge*.mjs", "scripts/judgeCore.test.mjs"), true);
    assert.equal(matchGlob("scripts/judge*.mjs", "scripts/judge/no.mjs"), false);
    assert.equal(matchGlob("scripts/checkCore*", "scripts/checkCore.test.mjs"), true);
    assert.equal(matchGlob("api/**", "api/a/b.mjs"), true);
    assert.equal(matchGlob("api/**", "scripts/api/x.mjs"), false);
    assert.equal(matchGlob("docs/**", "docs/a/b.md"), true);
    assert.equal(matchGlob("README.md", "docs/README.md"), false);
    assert.equal(matchGlob("**/package.json", "package.json"), true);
    assert.equal(matchGlob("**/package.json", "nested/package.json"), true);
    assert.equal(matchGlob(".github/workflows/**", ".github/workflows/ci.yml"), true);
  });
});

describe("the workflow contract", () => {
  const yaml = readFileSync(join(ROOT, ".github/workflows/automerge.yml"), "utf8");
  const apply = readFileSync(join(ROOT, "scripts/automerge.mjs"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");

  it("listens to pull_request with the write scopes, and checks out the base commit only", () => {
    assert.match(yaml, /on:\n {2}pull_request:\n/);
    assert.doesNotMatch(yaml, /pull_request_target/);
    for (const type of ["opened", "synchronize", "reopened", "ready_for_review", "labeled", "unlabeled"]) {
      assert.match(yaml, new RegExp(type));
    }
    assert.match(yaml, /branches: \[main\]/);
    assert.match(yaml, /contents: write/);
    assert.match(yaml, /pull-requests: write/);
    assert.doesNotMatch(yaml, /issues: write/);
    assert.match(yaml, /github\.event\.pull_request\.base\.sha/);
    assert.match(yaml, /persist-credentials: false/);
    assert.doesNotMatch(yaml, /pull_request\.head/);
    assert.doesNotMatch(yaml, /github\.sha/);
    assert.match(yaml, /node scripts\/automerge\.mjs/);
  });

  it("enables squash auto-merge, disarms it, and classifies filenames rather than patches", () => {
    assert.match(apply, /"pr", "merge", prNumber, "--repo", repo, "--auto", "--squash"/);
    assert.match(apply, /"--disable-auto"/);
    assert.match(apply, /previous_filename/);
    assert.doesNotMatch(apply, /patch/);
    assert.doesNotMatch(apply, /shell:\s*true/);
    assert.match(readme, /docs\/AUTOMERGE\.md/);
  });
});
