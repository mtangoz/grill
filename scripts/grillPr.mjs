#!/usr/bin/env node
// Grills a medium or high risk pull request with the judge on the base commit.
// The workflow checks out that base commit and runs this file from there.
// Title, body, files, and diff come from the API. The pull request branch is
// not checked out and its code is not run.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify, commentPlan, loadConfig } from "./automergeCore.mjs";
import {
  GRILL_MARKER,
  GRILL_QUESTION,
  alreadyGrilled,
  buildWriteUp,
  formatGrillComment,
  grillLabels,
  judgeAuthorArgs,
  verdictBadge,
} from "./grillPrCore.mjs";
import { stripSecrets } from "./judgeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BOT_LOGIN = "github-actions[bot]";

function ghRaw(args, { input, allow, maxBuffer = 10 * 1024 * 1024 } = {}) {
  try {
    const stdout = execFileSync("gh", args, {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (err) {
    const stderr = `${err.stderr || ""}`;
    const stdout = `${err.stdout || ""}`;
    const text = `${stderr}\n${stdout}\n${err.message || ""}`;
    if (allow && allow(text)) return { ok: true, stdout, stderr: text };
    const error = new Error((stderr || stdout || `gh ${args.join(" ")} failed`).trim());
    error.stderr = text;
    error.code = err.code;
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

function pullDiff(repo, prNumber, maxChars) {
  try {
    const { stdout } = ghRaw(
      ["api", "--method", "GET", "-H", "Accept: application/vnd.github.diff", `repos/${repo}/pulls/${prNumber}`],
      { maxBuffer: maxChars + 1024 * 1024 },
    );
    return { diff: stdout, tooLarge: stdout.length > maxChars };
  } catch (err) {
    const text = `${err.stderr || ""} ${err.code || ""}`;
    if (/406|too large|exceeded|maxBuffer|ENOBUFS/i.test(text)) return { diff: "", tooLarge: true };
    throw err;
  }
}

function upsert(repo, prNumber, comments, body) {
  const plan = commentPlan(comments, body, BOT_LOGIN, GRILL_MARKER);
  if (plan.create) {
    ghRaw(["api", "--method", "POST", `repos/${repo}/issues/${prNumber}/comments`, "--input", "-"], {
      input: JSON.stringify({ body: plan.create }),
    });
  } else if (plan.updateId) {
    ghRaw(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${plan.updateId}`, "--input", "-"], {
      input: JSON.stringify({ body }),
    });
  }
  for (const id of plan.deleteIds) {
    ghRaw(["api", "--method", "DELETE", `repos/${repo}/issues/comments/${id}`], {
      allow: (text) => /404/.test(text),
    });
  }
}

function hasLabel(labels, name) {
  return (labels ?? []).some((label) => String(label).toLowerCase() === name.toLowerCase());
}

function ensureLabel(repo, name, color, description) {
  ghRaw(
    ["label", "create", name, "--repo", repo, "--color", color, "--description", description],
    { allow: (text) => /already exists|422/i.test(text) },
  );
}

function applyLabels(repo, prNumber, labels, plan) {
  const colors = {
    "needs-review": ["D93F0B", "Grill CI found this pull request shaky, or a person asked for a review"],
    "grill-solid": ["1D76DB", "Grill CI found this pull request solid"],
  };
  for (const name of plan.add) {
    if (hasLabel(labels, name)) continue;
    const [color, description] = colors[name] ?? ["5319E7", "Set by Grill CI"];
    ensureLabel(repo, name, color, description);
    ghRaw(["pr", "edit", prNumber, "--repo", repo, "--add-label", name]);
  }
  for (const name of plan.remove) {
    if (!hasLabel(labels, name)) continue;
    ghRaw(["pr", "edit", prNumber, "--repo", repo, "--remove-label", name], {
      allow: (text) => /not found|404/i.test(text),
    });
  }
}

function headMoved(repo, prNumber, sha) {
  const latest = ghJson([
    "api",
    "--method",
    "GET",
    `repos/${repo}/pulls/${prNumber}`,
    "--jq",
    ".head.sha",
  ]);
  return String(latest || "").toLowerCase() !== sha;
}

function runJudge(subjectPath, family) {
  const args = [
    join(ROOT, "scripts/judge.mjs"),
    "--file",
    subjectPath,
    "--question",
    GRILL_QUESTION,
    "--json",
    ...judgeAuthorArgs(family),
  ];
  const env = { ...process.env };
  for (const key of ["JUDGE_FIXTURE", "JUDGE_OPENROUTER_URL", "JUDGE_DECISIONS_URL", "JUDGE_CHECK", "JUDGE_MODEL"]) {
    delete env[key];
  }
  env.OPENROUTER_API_KEY = process.env.GRILL_CI_OPENROUTER_KEY;
  env.JUDGE_TIMEOUT_MS = "480000";
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 13 * 60 * 1000,
  });
}

function parseJudge(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("judge returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

function main() {
  const repo = requiredEnv("REPO", /^[^/\s]+\/[^/\s]+$/);
  const prNumber = requiredEnv("PR_NUMBER", /^\d+$/);
  const sha = requiredEnv("HEAD_SHA", /^[0-9a-fA-F]{7,64}$/).toLowerCase();
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is missing");

  const config = loadConfig(JSON.parse(readFileSync(join(ROOT, ".github/automerge.json"), "utf8")));
  const pr = ghJson([
    "api",
    "--method",
    "GET",
    `repos/${repo}/pulls/${prNumber}`,
    "--jq",
    "{draft, title, body, base: .base.ref, headRepo: .head.repo.full_name, author: .user.login, labels: [.labels[].name]}",
  ]);
  if (pr.base !== "main") {
    console.log(`Base branch is ${pr.base}. Nothing to do.`);
    return;
  }
  if (pr.draft !== false) {
    console.log("Draft. Grill CI skipped.");
    return;
  }
  if (pr.headRepo !== repo) {
    console.log("Fork. Grill CI skipped.");
    return;
  }
  const allowlisted = config.authors.some((author) => author.toLowerCase() === String(pr.author || "").toLowerCase());
  if (!allowlisted) {
    console.log(`Author ${pr.author || "(missing)"} is not allowlisted. Grill CI skipped.`);
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
  const reasons = result.tier === "high" ? result.highReasons : result.failures;
  console.log(`${result.tier} risk, ${result.changedLines} lines, ${result.files} files`);

  const comments = listPaged(
    `repos/${repo}/issues/${prNumber}/comments`,
    "[.[] | {id, body, userLogin: .user.login}]",
  );

  if (result.tier === "low") {
    const existing = comments.some((comment) => comment.userLogin === BOT_LOGIN && comment.body?.includes(GRILL_MARKER));
    if (existing) upsert(repo, prNumber, comments, formatGrillComment({ kind: "low", sha }));
    else console.log("Low risk. Grill CI skipped.");
    return;
  }
  if (alreadyGrilled(comments, sha)) {
    console.log(`Head ${sha} was already grilled.`);
    return;
  }
  if (headMoved(repo, prNumber, sha)) {
    console.log("Head moved before the judge. Leaving this push to the newer run.");
    return;
  }
  if (result.enormous) {
    upsert(repo, prNumber, comments, formatGrillComment({
      kind: "enormous",
      sha,
      tier: result.tier,
      changedLines: result.changedLines,
      limit: config.grillSkipChangedLines,
      reasons,
    }));
    console.log("Diff is over the grill budget. Skipped.");
    return;
  }
  if (!process.env.GRILL_CI_OPENROUTER_KEY) {
    upsert(repo, prNumber, comments, formatGrillComment({ kind: "unconfigured" }));
    console.log("Grill CI is not configured.");
    return;
  }

  const fetched = pullDiff(repo, prNumber, config.grillSkipDiffChars);
  if (fetched.tooLarge) {
    upsert(repo, prNumber, comments, formatGrillComment({
      kind: "enormous",
      sha,
      tier: result.tier,
      diffTooLarge: true,
      reasons,
    }));
    console.log("Diff is too large to send. Skipped.");
    return;
  }

  const writeUp = buildWriteUp({
    title: pr.title ?? "",
    body: pr.body ?? "",
    tier: result.tier,
    reasons,
    files: files.map((file) => ({
      path: file.filename,
      previousPath: file.previous_filename ?? null,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
    })),
    diff: fetched.diff,
    diffCharBudget: config.diffCharBudget,
  });
  if (writeUp.secrets.length > 0) {
    throw new Error("The write-up still contains a secret-shaped string. Nothing was sent.");
  }

  const dir = mkdtempSync(join(tmpdir(), "grill-ci-"));
  const subjectPath = join(dir, "subject.md");
  let child;
  try {
    writeFileSync(subjectPath, writeUp.text, { mode: 0o600 });
    child = runJudge(subjectPath, result.authorFamily);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (!child || child.status !== 0 || child.error) {
    const detail = stripSecrets(`${child?.stderr || ""}\n${child?.stdout || ""}\n${child?.error?.message || ""}`).text;
    console.error(detail.slice(0, 4000));
    upsert(repo, prNumber, comments, formatGrillComment({ kind: "error" }));
    throw new Error("judge failed");
  }

  if (headMoved(repo, prNumber, sha)) {
    console.log("Head moved while the judge ran. Dropping this result.");
    return;
  }

  let judged;
  try {
    judged = parseJudge(child.stdout);
  } catch (err) {
    console.error(stripSecrets(err instanceof Error ? err.message : String(err)).text);
    upsert(repo, prNumber, comments, formatGrillComment({ kind: "error" }));
    throw err;
  }
  const badge = verdictBadge(judged.verdict);
  const shared = {
    sha,
    tier: result.tier,
    reasons,
    servedModel: judged.servedModel,
    costUsd: judged.costUsd,
    authorFamily: result.authorFamily,
  };
  if (!badge || (Array.isArray(judged.degraded) && judged.degraded.length > 0)) {
    upsert(repo, prNumber, comments, formatGrillComment({
      ...shared,
      kind: "degraded",
      degraded: judged.degraded,
    }));
    console.log("Degraded judge run. No label change.");
    return;
  }

  applyLabels(repo, prNumber, pr.labels, grillLabels(badge, {
    needsReviewLabel: config.needsReviewLabel,
    grillSolidLabel: config.grillSolidLabel,
  }));
  upsert(repo, prNumber, comments, formatGrillComment({
    ...shared,
    kind: "result",
    badge,
    verdict: judged.verdict,
    verdictReason: judged.verdictReason,
    challenges: judged.challenges,
  }));
  console.log(`Verdict ${badge}. Model ${judged.servedModel || "unavailable"}. Cost ${judged.costUsd ?? "unknown"}.`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
