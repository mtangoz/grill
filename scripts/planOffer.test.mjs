import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OFFER_LINE, markerDir, planOffer, planOfferEnabled } from "./planOffer.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/planOffer.mjs");
const PLAN = "Step 1: migrate the billing table for Acme Corp. Step 2: email jane@example.com.";
const exitPlan = (session = "s-1") => ({ session_id: session, hook_event_name: "PreToolUse", tool_name: "ExitPlanMode", tool_input: { plan: PLAN } });
const freshEnv = () => ({ CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), "grill-plan-")) });

function run(stdin, env) {
  return spawnSync(process.execPath, [SCRIPT], { input: stdin, env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 10000 });
}

describe("plan offer hook", () => {
  it("offers once per session, as a line for the person and nothing else", () => {
    const env = freshEnv();
    const out = JSON.parse(planOffer(exitPlan(), env));
    assert.deepEqual(out, { systemMessage: OFFER_LINE });
    assert.match(OFFER_LINE, /grill this plan/);
    assert.equal(planOffer(exitPlan(), env), "");
    assert.ok(planOffer(exitPlan("s-2"), env), "a new session is offered again");
  });

  it("makes no permission decision, so the approval prompt is unchanged", () => {
    const out = JSON.parse(planOffer(exitPlan(), freshEnv()));
    for (const key of ["hookSpecificOutput", "decision", "continue", "stopReason", "permissionDecision"]) assert.equal(key in out, false, key);
  });

  it("never carries the plan text, and keeps only an empty marker named by a hash", () => {
    const env = freshEnv();
    const out = planOffer(exitPlan("session-abc"), env);
    assert.doesNotMatch(out, /Acme|jane|billing/);
    const files = readdirSync(markerDir(env));
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f]{32}$/);
    assert.doesNotMatch(files[0], /session-abc/);
    assert.equal(statSync(join(markerDir(env), files[0])).size, 0);
  });

  it("removes markers older than two days", () => {
    const env = freshEnv();
    planOffer(exitPlan("old"), env);
    const [old] = readdirSync(markerDir(env));
    const threeDaysAgo = (Date.now() - 3 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(join(markerDir(env), old), threeDaysAgo, threeDaysAgo);
    planOffer(exitPlan("new"), env);
    assert.equal(existsSync(join(markerDir(env), old)), false);
    assert.equal(readdirSync(markerDir(env)).length, 1);
  });

  it("ignores every other tool and any input that isn't a hook event", () => {
    const env = freshEnv();
    for (const input of [{ ...exitPlan(), tool_name: "Bash" }, { ...exitPlan(), tool_name: "EnterPlanMode" }, null, "x", 42, {}]) {
      assert.equal(planOffer(input, env), "");
    }
    assert.equal(existsSync(markerDir(env)), false, "no marker for an event it ignores");
  });

  it("is on unless GRILL_PLAN_OFFER says off, and when off it keeps nothing", () => {
    for (const value of [undefined, "", "on", "yes", "${user_config.x}"]) assert.equal(planOfferEnabled({ GRILL_PLAN_OFFER: value }), true, String(value));
    for (const value of ["off", "OFF", " false ", "0", "no"]) {
      const env = { ...freshEnv(), GRILL_PLAN_OFFER: value };
      assert.equal(planOfferEnabled(env), false, value);
      assert.equal(planOffer(exitPlan(), env), "");
      assert.equal(existsSync(markerDir(env)), false);
    }
  });

  it("offers without a session id, since it cannot count one", () => {
    const env = freshEnv();
    assert.ok(planOffer({ tool_name: "ExitPlanMode" }, env));
    assert.ok(planOffer({ tool_name: "ExitPlanMode" }, env));
  });

  it("falls back to a temp folder when Claude Code gives no data folder", () => {
    assert.equal(markerDir({}), join(tmpdir(), "grill-plan-offer"));
    assert.equal(markerDir({ CLAUDE_PLUGIN_DATA: "/data/grill" }), join("/data/grill", "plan-offer"));
  });
});

describe("plan offer hook, run as Claude Code runs it", () => {
  it("prints the offer and exits 0", () => {
    const res = run(JSON.stringify(exitPlan()), freshEnv());
    assert.equal(res.status, 0);
    assert.deepEqual(JSON.parse(res.stdout), { systemMessage: OFFER_LINE });
    assert.equal(res.stderr, "");
  });

  it("fails open: bad input, empty input, or a folder it cannot write exits 0 with no output", () => {
    const blocker = join(mkdtempSync(join(tmpdir(), "grill-plan-")), "file");
    writeFileSync(blocker, "");
    for (const [stdin, env] of [
      ["not json", freshEnv()],
      ["", freshEnv()],
      [JSON.stringify(exitPlan()), { CLAUDE_PLUGIN_DATA: blocker }],
    ]) {
      const res = run(stdin, env);
      assert.equal(res.status, 0, stdin);
      assert.equal(res.stdout, "", stdin);
      assert.equal(res.stderr, "", stdin);
    }
  });

  it("sends nothing: no network call, only node built-ins", () => {
    const source = readFileSync(SCRIPT, "utf8");
    assert.doesNotMatch(source, /fetch\(|https?:\/\/|node:(http|https|net|dns|tls|child_process)/);
    for (const [, spec] of source.matchAll(/^import .* from "([^"]+)";$/gm)) assert.match(spec, /^node:/, spec);
  });

  it("hooks/hooks.json runs it on PreToolUse for ExitPlanMode only, with a short timeout", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "hooks/hooks.json"), "utf8"));
    assert.deepEqual(Object.keys(config.hooks), ["PreToolUse"]);
    const [entry, ...rest] = config.hooks.PreToolUse;
    assert.equal(rest.length, 0);
    assert.equal(entry.matcher, "ExitPlanMode");
    assert.equal(entry.hooks.length, 1);
    const [hook] = entry.hooks;
    assert.equal(hook.type, "command");
    assert.equal(hook.command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/planOffer.mjs"');
    assert.ok(hook.timeout > 0 && hook.timeout <= 10);
    assert.match(config.description, /GRILL_PLAN_OFFER=off/);
  });
});
