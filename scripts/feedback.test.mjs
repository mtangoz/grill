// grill_feedback: a reaction is stored without the grill unless the person sends that one.
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleFeedback } from "../api/_hosted.mjs";
import { createMemoryRedis } from "./hostedCore.mjs";
import { buildGrillTools } from "../server/index.mjs";
import { hostedTools } from "./hostedCore.mjs";
import {
  FEEDBACK_POINTER,
  FEEDBACK_TOOL_DESCRIPTION,
  FEEDBACK_TTL_SECONDS,
  buildFeedbackRecord,
  decryptJson,
  deleteFeedbackForAccount,
  encryptJson,
  feedbackOfKey,
  formatFeedbackReport,
  hashAccount,
  reactionKey,
  readFeedbackRecords,
  storeFeedback,
} from "./feedbackCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CANARY = "CANARY-FEEDBACK-SUBJECT-9f3a";
const VERDICT_PROSE = "The core direction is reasonable but the headline number is asserted rather than supported.";
const LAYER = `**Shaky.** ${VERDICT_PROSE}`;
const WHEN = "2026-11-09T12:00:00.000Z";

function record(extra = {}) {
  return buildFeedbackRecord({
    rating: "meh",
    reason: "too vague",
    at: WHEN,
    model: "openai/gpt-5.6-sol",
    verdict: "shaky",
    accountId: "g_person",
    share: false,
    subject: `Decision: ship ${CANARY} next week.`,
    layer1: LAYER,
    ...extra,
  });
}

describe("a feedback record", () => {
  it("stores the rating fields and leaves out the subject and the verdict text", () => {
    const built = record();
    assert.equal(built.error, undefined);
    assert.equal(built.record.rating, "meh");
    assert.equal(built.record.reason, "too vague");
    assert.equal(built.record.at, WHEN);
    assert.equal(built.record.model, "openai/gpt-5.6-sol");
    assert.equal(built.record.verdict, "shaky");
    assert.equal(built.record.account, hashAccount("g_person"));
    assert.equal(built.record.account.includes("g_person"), false);
    assert.equal(Object.hasOwn(built.record, "subject"), false);
    assert.equal(Object.hasOwn(built.record, "layer1"), false);
    const raw = JSON.stringify(built.record);
    assert.equal(raw.includes(CANARY), false);
    assert.equal(raw.includes(VERDICT_PROSE), false);
    assert.equal(raw.includes("headline number"), false);
  });

  it("stores the subject as sent and the layer-1 note only when share is true", () => {
    const built = record({ rating: "helped", share: true, reason: "" });
    assert.equal(built.record.subject, `Decision: ship ${CANARY} next week.`);
    assert.equal(built.record.layer1, LAYER);
    assert.equal(built.record.reason, "");
    const asString = record({ share: "true" });
    assert.equal(Object.hasOwn(asString.record, "subject"), false);
    assert.equal(JSON.stringify(asString.record).includes(CANARY), false);
  });

  it("keeps a reason to one line and refuses a verdict sentence and a subject hiding in the model", () => {
    const built = record({ reason: "  line one\nline two  ", verdict: VERDICT_PROSE, model: CANARY });
    assert.equal(built.record.reason, "line one line two");
    assert.equal(built.record.verdict, "unknown");
    assert.equal(built.record.model, "");
    assert.equal(JSON.stringify(built.record).includes(CANARY), false);
    assert.equal(JSON.stringify(built.record).includes("headline number"), false);
    assert.equal(record({ rating: "great" }).error, "rating");
    assert.equal(record({ accountId: "  " }).error, "account");
  });

  it("encrypts the record, keeps it 180 days, and drops it with the account", async () => {
    const key = randomBytes(32);
    const memory = createMemoryRedis();
    const calls = [];
    const command = (args) => {
      calls.push(args.map((part) => String(part)));
      return memory.command(args);
    };
    const built = record({ share: false });
    const id = await storeFeedback(command, key, built.record);
    const blob = memory.command(["GET", `grill:hosted:feedback:${id}`]);
    assert.equal(String(blob).includes(CANARY), false);
    assert.equal(String(blob).includes("headline number"), false);
    assert.equal(String(blob).includes("too vague"), false);
    assert.equal(FEEDBACK_TTL_SECONDS, 15552000);
    assert.ok(calls.some((args) => args[0] === "SET" && args[1] === `grill:hosted:feedback:${id}` && args[3] === "EX" && args[4] === "15552000"));
    const opened = decryptJson(blob, key);
    assert.deepEqual(opened, built.record);
    assert.deepEqual(await readFeedbackRecords(command, key), [built.record]);
    await memory.command(["SET", reactionKey("g_person", "latest"), encryptJson({ subject: CANARY }, key), "EX", "900"]);
    await deleteFeedbackForAccount(command, "g_person");
    assert.equal(memory.command(["GET", `grill:hosted:feedback:${id}`]), null);
    assert.equal(memory.command(["GET", feedbackOfKey(hashAccount("g_person"))]), null);
    assert.equal(memory.command(["GET", reactionKey("g_person", "latest")]), null);
  });

  it("counts by rating, model and week, and prints opted-in grills as JSONL", () => {
    const shared = record({ rating: "helped", share: true, at: "2026-11-02T00:00:00.000Z" }).record;
    const quiet = record({ rating: "meh", share: false, at: "2026-11-09T00:00:00.000Z", model: "google/gemini-2.5-pro" }).record;
    const report = formatFeedbackReport([quiet, shared]);
    assert.deepEqual(report.lines, [
      "rating helped: 1",
      "rating meh: 1",
      "model google/gemini-2.5-pro: 1",
      "model openai/gpt-5.6-sol: 1",
      "week 2026-W45: helped 1, meh 0",
      "week 2026-W46: helped 0, meh 1",
    ]);
    const lines = report.jsonl.split("\n");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes(CANARY), true);
    assert.equal(lines[0].includes("google/gemini-2.5-pro"), false);
  });
});

describe("grill_feedback on the tool list", () => {
  it("is listed, and the other tool descriptions only gain the short pointer on grill", () => {
    const local = buildGrillTools({ checkOn: true });
    const hosted = hostedTools();
    assert.deepEqual(
      local.map((tool) => tool.name),
      ["grill", "grill_result", "grill_look_back", "grill_feedback"],
    );
    assert.deepEqual(
      hosted.map((tool) => tool.name),
      ["grill", "grill_result", "grill_look_back", "grill_decided", "grill_feedback"],
    );
    for (const tools of [local, hosted]) {
      const feedback = tools.find((tool) => tool.name === "grill_feedback");
      assert.equal(feedback.description, FEEDBACK_TOOL_DESCRIPTION);
      assert.deepEqual(feedback.inputSchema.properties.rating.enum, ["helped", "meh"]);
      assert.deepEqual(feedback.inputSchema.required, ["rating"]);
      assert.equal(feedback.inputSchema.properties.share_grill.type, "boolean");
      const grill = tools.find((tool) => tool.name === "grill");
      assert.equal(grill.description.includes(FEEDBACK_POINTER), true);
      assert.equal(grill.description.split(FEEDBACK_POINTER).length, 2);
      const rest = grill.description.replace(FEEDBACK_POINTER, "");
      assert.equal(rest.includes("grill_feedback"), false);
      for (const name of ["grill_result", "grill_look_back"]) {
        assert.equal(tools.find((tool) => tool.name === name).description.includes("grill_feedback"), false);
      }
    }
    const decided = hosted.find((tool) => tool.name === "grill_decided");
    assert.equal(decided.description.includes("grill_feedback"), false);
    assert.equal(hosted.find((tool) => tool.name === "grill_feedback").annotations.openWorldHint, false);
    assert.equal(local.find((tool) => tool.name === "grill_feedback").annotations.openWorldHint, true);
  });
});

describe("the public feedback endpoint", () => {
  it("stores no subject or verdict text unless share_grill is true", async () => {
    const key = randomBytes(32);
    const memory = createMemoryRedis();
    const deps = {
      env: { GRILL_HOSTED: "on", GRILL_RECORD_KEY: key.toString("base64") },
      redis: async (args) => memory.command(args),
      now: Date.parse(WHEN),
    };
    const post = (body) =>
      handleFeedback(
        new Request("https://grillyour.ai/api/feedback", { method: "POST", body: JSON.stringify(body) }),
        deps,
      );
    const quiet = await post({
      rating: "meh",
      reason: "not useful",
      model: "openai/gpt-5.6-sol",
      verdict: "shaky",
      account_id: "local-1",
      share_grill: false,
      subject: CANARY,
      layer1: LAYER,
    });
    assert.equal(quiet.status, 204);
    const rows = await readFeedbackRecords((args) => memory.command(args), key);
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(rows[0]).includes(CANARY), false);
    assert.equal(JSON.stringify(rows[0]).includes("headline number"), false);
    assert.equal(rows[0].account, createHash("sha256").update("local-1").digest("hex"));
    const sent = await post({
      rating: "helped",
      reason: "",
      model: "openai/gpt-5.6-sol",
      verdict: VERDICT_PROSE,
      account_id: "local-1",
      share_grill: true,
      subject: CANARY,
      layer1: LAYER,
    });
    assert.equal(sent.status, 204);
    const both = await readFeedbackRecords((args) => memory.command(args), key);
    const shared = both.find((row) => row.rating === "helped");
    assert.equal(shared.subject, CANARY);
    assert.equal(shared.layer1, LAYER);
    assert.equal(shared.verdict, "unknown");
    const cipher = encryptJson(shared, key);
    assert.equal(cipher.includes(CANARY), false);
  });
});

describe("the privacy notes", () => {
  const line =
    "Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us.";

  it("names the 180-day reaction and does not claim Grill never sees a grill", () => {
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    const ledger = readFileSync(join(ROOT, "docs/DATA-LEDGER.md"), "utf8");
    assert.ok(privacy.includes(line));
    assert.ok(ledger.includes(line));
    assert.match(ledger, /grill:hosted:feedback:/);
    assert.match(ledger, /180 days/);
    assert.match(privacy, /180 days/);
    assert.doesNotMatch(privacy, /never sees a decision/);
    assert.doesNotMatch(ledger, /never logged or stored/);
    assert.match(ledger, /It is never logged\./);
  });
});
