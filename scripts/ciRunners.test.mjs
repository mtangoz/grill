// The two Grill CI crashes: headMoved parsed a bare `gh --jq` SHA as JSON, and
// automerge tried to disable auto-merge on a draft, which GitHub refuses.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHA = "afe1a0ab6e4e71fc11e24b8efbc61a29aa0f806f";
const REPO = "mtangoz/grill";

const GH_STUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const args = process.argv.slice(2);
let stdin = "";
if (args.includes("--input")) stdin = readFileSync(0, "utf8");
appendFileSync(process.env.GH_STUB_LOG, JSON.stringify({ args, stdin }) + "\\n");
const joined = args.join(" ");
const fail = (message) => {
  process.stderr.write(message + "\\n");
  process.exit(1);
};
if (args.includes("--disable-auto")) {
  const mode = process.env.GH_DISABLE_AUTO || "ok";
  if (mode === "draft-error") fail("Can't disable auto-merge for this pull request");
  if (mode === "not-enabled") fail("Pull request Auto merge is not enabled");
  process.exit(0);
}
if (joined.includes("/files")) {
  process.stdout.write(process.env.GH_FILES_JSON);
  process.exit(0);
}
if (joined.includes("/comments") && args.includes("GET")) {
  process.stdout.write("[]");
  process.exit(0);
}
if (joined.includes("/comments")) process.exit(0);
if (args.includes(".head.sha")) {
  process.stdout.write(process.env.GH_HEAD_SHA);
  process.exit(0);
}
if (joined.includes("/pulls/") && args.includes("GET")) {
  process.stdout.write(process.env.GH_PR_JSON);
  process.exit(0);
}
fail("unexpected gh " + joined);
`;

function highRiskFiles() {
  return JSON.stringify([
    { filename: "prompts/grill.md", status: "modified", additions: 12, deletions: 2, previous_filename: null },
  ]);
}

function runScript(script, { pr, headSha = `${SHA}\n`, disableAuto = "draft-error", extraEnv = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "grill-ci-stub-"));
  const bin = join(dir, "bin");
  const log = join(dir, "calls.jsonl");
  mkdirSync(bin);
  const stub = join(bin, "gh");
  writeFileSync(stub, GH_STUB);
  chmodSync(stub, 0o755);
  writeFileSync(log, "");
  const env = {
    ...process.env,
    ...extraEnv,
    PATH: `${bin}:${process.env.PATH}`,
    GH_STUB_LOG: log,
    GH_PR_JSON: JSON.stringify(pr),
    GH_FILES_JSON: highRiskFiles(),
    GH_HEAD_SHA: headSha,
    GH_DISABLE_AUTO: disableAuto,
    GH_TOKEN: "test-token",
    REPO,
    PR_NUMBER: "8",
    HEAD_SHA: SHA,
  };
  delete env.GRILL_CI_OPENROUTER_KEY;
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [join(ROOT, "scripts", script)], { env, encoding: "utf8" });
  } catch (err) {
    status = err.status ?? 1;
    stdout = `${err.stdout || ""}`;
    stderr = `${err.stderr || ""}`;
  } finally {
    // Keep the log; the temp dir is removed after we read it.
  }
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  rmSync(dir, { recursive: true, force: true });
  return { status, stdout, stderr, calls };
}

function postedBodies(calls) {
  return calls
    .filter((call) => call.args.includes("POST") && call.args.some((arg) => String(arg).includes("/comments")))
    .map((call) => JSON.parse(call.stdin).body);
}

describe("grillPr headMoved", () => {
  const pr = {
    draft: false,
    title: "Keep a grill from agreeing",
    body: "Judge bias correction",
    base: "main",
    headRepo: REPO,
    author: "mtangoz",
    labels: [],
  };

  it("treats a bare gh --jq SHA as text, then posts not configured and passes when no key is set", () => {
    assert.throws(() => JSON.parse(SHA), /Unexpected token/);
    const run = runScript("grillPr.mjs", { pr, headSha: `${SHA}\n` });
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    assert.match(run.stdout, /Grill CI is not configured/);
    const headCall = run.calls.find((call) => call.args.includes(".head.sha"));
    assert.ok(headCall, "headMoved did not ask gh for .head.sha");
    const bodies = postedBodies(run.calls);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /Grill CI is not configured/);
    assert.match(bodies[0], /GRILL_CI_OPENROUTER_KEY/);
  });

  it("leaves a moved head to the newer run and does not post a comment", () => {
    const run = runScript("grillPr.mjs", { pr, headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n" });
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    assert.match(run.stdout, /Head moved before the judge/);
    assert.equal(postedBodies(run.calls).length, 0);
  });
});

describe("automerge disable-auto on a draft", () => {
  const base = {
    draft: true,
    base: "main",
    head: REPO,
    author: "mtangoz",
    labels: [],
  };

  it("does not call disable-auto when auto-merge is off, so a draft's refusal does not fail the job", () => {
    const run = runScript("automerge.mjs", { pr: { ...base, autoMerge: false }, disableAuto: "draft-error" });
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    assert.equal(run.calls.some((call) => call.args.includes("--disable-auto")), false);
    assert.match(run.stdout, /not low risk/);
    const bodies = postedBodies(run.calls);
    assert.equal(bodies.length, 1);
    assert.match(bodies[0], /Auto-merge is off/);
  });

  it("still disables auto-merge when it is on", () => {
    const run = runScript("automerge.mjs", {
      pr: { ...base, draft: false, autoMerge: true },
      disableAuto: "ok",
    });
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    assert.equal(run.calls.some((call) => call.args.includes("--disable-auto")), true);
  });

  it("still tries to disable when the auto-merge field is missing, and tolerates 'not enabled'", () => {
    const run = runScript("automerge.mjs", {
      pr: { ...base, draft: false },
      disableAuto: "not-enabled",
    });
    assert.equal(run.calls.some((call) => call.args.includes("--disable-auto")), true);
    assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
    assert.doesNotMatch(run.stderr, /Can't disable auto-merge/);
  });
});
