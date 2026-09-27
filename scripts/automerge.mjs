#!/usr/bin/env node
// Applies the low-risk decision on GitHub: label, one comment, squash auto-merge.
// The workflow checks out the base commit and runs this file from that commit.
// Changed paths come from the pulls API. Patches are dropped before classification.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { actionsFor, classify, commentPlan, loadConfig } from "./automergeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function ghRaw(args, { input, allow } = {}) {
  try {
    const stdout = execFileSync("gh", args, {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const stderr = `${err.stderr || ""}`;
    const stdout = `${err.stdout || ""}`;
    const text = `${stderr}\n${stdout}`;
    if (allow && allow(text)) return { ok: true, stdout, stderr: text };
    const error = new Error((stderr || stdout || `gh ${args.join(" ")} failed`).trim());
    error.stderr = text;
    throw error;
  }
}

function ghJson(args) {
  const { stdout } = ghRaw(args);
  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function requiredEnv(name, pattern) {
  const value = process.env[name] ?? "";
  if (!pattern.test(value)) throw new Error(`${name} is missing or unexpected`);
  return value;
}

function listPaged(path, jq) {
  const rows = [];
  for (let page = 1; page <= 40; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const batch = ghJson(["api", "--method", "GET", `${path}${sep}per_page=100&page=${page}`, "--jq", jq]);
    if (!Array.isArray(batch)) throw new Error(`expected a list from ${path}`);
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error(`too many pages from ${path}`);
}

function isPermissionError(err) {
  return /Resource not accessible|HTTP 403|403 Forbidden/i.test(err?.stderr || err?.message || "");
}

function main() {
  const repo = requiredEnv("REPO", /^[^/\s]+\/[^/\s]+$/);
  const prNumber = requiredEnv("PR_NUMBER", /^\d+$/);
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is missing");

  const config = loadConfig(JSON.parse(readFileSync(join(ROOT, ".github/automerge.json"), "utf8")));
  const pr = ghJson([
    "api",
    "--method",
    "GET",
    `repos/${repo}/pulls/${prNumber}`,
    "--jq",
    "{draft, base: .base.ref, head: .head.repo.full_name, author: .user.login, labels: [.labels[].name]}",
  ]);
  if (pr.base !== "main") {
    console.log(`Base branch is ${pr.base}. Nothing to do.`);
    return;
  }

  const files = listPaged(
    `repos/${repo}/pulls/${prNumber}/files`,
    "[.[] | {filename, status, additions, deletions, previous_filename}]",
  );
  const result = classify(
    {
      draft: pr.draft,
      author: pr.author ?? "",
      labels: pr.labels ?? [],
      files: files.map((file) => ({
        path: file.filename,
        previousPath: file.previous_filename ?? null,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
    },
    config,
  );
  const actions = actionsFor(result);
  console.log(result.lowRisk ? "low risk" : "not low risk");
  for (const failure of result.failures) console.log(`- ${failure.message}`);

  const sameRepo = pr.head === repo;
  if (!sameRepo && result.lowRisk) {
    throw new Error(`Head repository ${pr.head || "unknown"} is not ${repo}. Refusing to arm auto-merge.`);
  }

  const hasLabel = (pr.labels ?? []).some((label) => label.toLowerCase() === config.automergeLabel.toLowerCase());
  try {
    if (actions.addLabel && !hasLabel) {
      ghRaw([
        "label",
        "create",
        config.automergeLabel,
        "--repo",
        repo,
        "--color",
        "0E8A16",
        "--description",
        "Squash-merge this pull request when required checks pass",
        "--force",
      ], { allow: () => true });
      ghRaw(["pr", "edit", prNumber, "--repo", repo, "--add-label", config.automergeLabel]);
    }
    if (actions.removeLabel && hasLabel) {
      ghRaw(["pr", "edit", prNumber, "--repo", repo, "--remove-label", config.automergeLabel], {
        allow: (text) => /not found|404/i.test(text),
      });
    }
    if (actions.enableAutoMerge) {
      ghRaw(["pr", "merge", prNumber, "--repo", repo, "--auto", "--squash"], {
        allow: (text) => /already enabled/i.test(text),
      });
    }
    if (actions.disableAutoMerge) {
      ghRaw(["pr", "merge", prNumber, "--repo", repo, "--disable-auto"], {
        allow: (text) => /not enabled/i.test(text),
      });
    }

    const comments = listPaged(
      `repos/${repo}/issues/${prNumber}/comments`,
      "[.[] | {id, body, userLogin: .user.login}]",
    );
    const plan = commentPlan(comments, actions.commentBody);
    if (plan.create) {
      ghRaw(["api", "--method", "POST", `repos/${repo}/issues/${prNumber}/comments`, "--input", "-"], {
        input: JSON.stringify({ body: plan.create }),
      });
    } else if (plan.updateId) {
      ghRaw(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${plan.updateId}`, "--input", "-"], {
        input: JSON.stringify({ body: actions.commentBody }),
      });
    }
    for (const id of plan.deleteIds) {
      ghRaw(["api", "--method", "DELETE", `repos/${repo}/issues/comments/${id}`], {
        allow: (text) => /404/.test(text),
      });
    }
  } catch (err) {
    if (!result.lowRisk && isPermissionError(err)) {
      console.log("Not low risk, and the token cannot write. Fork pull requests are read-only.");
      return;
    }
    throw err;
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
