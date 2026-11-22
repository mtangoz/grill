// One test per Grill limit. The chat sentence names the limit, when it resets, and what to do.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAP_RETRY_TEXT,
  OUT_OF_CREDIT,
  SERVICE_CAP_TEXT,
  USER_CAP_TEXT,
  capBlock,
  dailyLimitMessage,
  higherDailyEndedMessage,
  keyAllowanceText,
  monthlyCheckLimitMessage,
  topupExhaustedText,
  userAllowanceUsedText,
} from "./hostedCore.mjs";
import { installedKeyLimitText } from "../server/index.mjs";

const NOW = Date.parse("2026-11-07T16:00:00.000Z");
const ACCOUNT = "https://grillyour.ai/account";

function assertPlain(text, { reset, action, addChecks = true }) {
  assert.match(text, reset);
  assert.match(text, action);
  if (!addChecks) assert.doesNotMatch(text, /add checks/i);
  assert.doesNotMatch(text, /\bPro\b|(?<!un)subscri|\$|\b\d+(?:\.\d+)?\s?(?:usd|dollars?)\b/i);
}

describe("what a person reads when a Grill limit stops the chat", () => {
  it("daily UTC cap, with top-ups off", () => {
    const text = dailyLimitMessage({ limit: 30, paid: false, topups: false, now: NOW });
    assert.match(text, /today's daily limit of 30 checks/);
    assertPlain(text, { reset: /resets at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
  });

  it("daily UTC cap when top-ups are on and there is no prepaid balance", () => {
    const text = dailyLimitMessage({ limit: 30, topups: true, origin: "https://grillyour.ai", now: NOW });
    assert.match(text, /today's daily limit of 30 checks/);
    assertPlain(text, { reset: /resets at 00:00 UTC/, action: new RegExp(`Add checks at ${ACCOUNT.replaceAll(".", "\\.")}`) });
  });

  it("higher daily cap that comes with a prepaid balance", () => {
    const text = dailyLimitMessage({ limit: 100, prepaid: true, now: NOW });
    assert.match(text, /today's higher daily limit of 100 checks/);
    assertPlain(text, { reset: /resets at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
    assert.doesNotMatch(text, /200 checks/);
  });

  it("monthly per-person spend cap, with top-ups off", () => {
    const text = capBlock({ serviceMicros: 0, userMicros: 5_000_000 }).text;
    assert.equal(text, USER_CAP_TEXT);
    assert.match(text, /this month's limit on your account/);
    assertPlain(text, { reset: /next month on the 1st at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
    assert.match(text, /Nothing was charged to you\./);
  });

  it("monthly per-person spend cap, with top-ups on", () => {
    const env = { GRILL_TOPUPS: "on" };
    const text = capBlock({ serviceMicros: 0, userMicros: 5_000_000, env, origin: "https://grillyour.ai" }).text;
    assert.equal(text, userAllowanceUsedText("https://grillyour.ai"));
    assert.match(text, /this month's 100 free checks/);
    assertPlain(text, { reset: /next month on the 1st at 00:00 UTC/, action: new RegExp(`Add checks at ${ACCOUNT.replaceAll(".", "\\.")}`) });
  });

  it("top-up balance exhausted", () => {
    const env = { GRILL_TOPUPS: "on" };
    const text = capBlock({
      serviceMicros: 0,
      userMicros: 5_000_000,
      env,
      origin: "https://grillyour.ai",
      topupPresent: true,
    }).text;
    assert.equal(text, topupExhaustedText("https://grillyour.ai"));
    assert.match(text, /prepaid balance is used up/);
    assert.match(text, /does not reset on a clock/);
    assertPlain(text, { reset: /next month on the 1st at 00:00 UTC/, action: new RegExp(`Add checks at ${ACCOUNT.replaceAll(".", "\\.")}`) });
  });

  it("service-wide cap", () => {
    const text = capBlock({ serviceMicros: 20_000_000, userMicros: 0 }).text;
    assert.equal(text, SERVICE_CAP_TEXT);
    assert.match(text, /this month's limit for everyone/);
    assertPlain(text, {
      reset: /next month on the 1st at 00:00 UTC/,
      action: /Nothing to do\. Grill is paused for everyone until next month on the 1st at 00:00 UTC/,
      addChecks: false,
    });
    assert.match(text, /Nothing was charged to you\./);
  });

  it("three grills at once", () => {
    assert.match(CAP_RETRY_TEXT, /Three grills are already running/);
    assertPlain(CAP_RETRY_TEXT, { reset: /no clock reset/, action: /Wait and retry\./, addChecks: false });
  });

  it("monthly check allowance", () => {
    const text = monthlyCheckLimitMessage({ count: 200 });
    assert.match(text, /this month's limit of 200 checks/);
    assertPlain(text, { reset: /next month on the 1st at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
    const alongside = dailyLimitMessage({ limit: 100, monthlyChecks: 47, paid: true, now: NOW });
    assert.match(alongside, /today's daily limit of 100 checks/);
    assert.match(alongside, /47 of this month's 200 checks/);
    assertPlain(alongside, { reset: /next month on the 1st at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
  });

  it("trial end, when the higher daily limit is no longer active", () => {
    const off = higherDailyEndedMessage({ limit: 30, topups: false });
    assert.match(off, /higher daily limit on this account has ended/);
    assert.match(off, /today's limit of 30 checks/);
    assertPlain(off, { reset: /resets at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
    const on = higherDailyEndedMessage({ limit: 30, topups: true, origin: "https://grillyour.ai" });
    assertPlain(on, { reset: /resets at 00:00 UTC/, action: new RegExp(`Add checks at ${ACCOUNT.replaceAll(".", "\\.")}`) });
  });

  it("router key with nothing left this month", () => {
    const text = keyAllowanceText({});
    assert.equal(text, OUT_OF_CREDIT);
    assert.match(text, /limit on the key for your account/);
    assertPlain(text, { reset: /next month on the 1st at 00:00 UTC/, action: /Wait until then\./, addChecks: false });
    const bought = keyAllowanceText({ env: { GRILL_TOPUPS: "on" }, origin: "https://grillyour.ai", topupPresent: true });
    assert.equal(bought, topupExhaustedText("https://grillyour.ai"));
  });

  it("installed tool, when the person's own key is at its limit", () => {
    const text = installedKeyLimitText("[judge] ERROR: OpenRouter returned 402 insufficient credits: {\"error\":\"limit\"}");
    assert.match(text, /OpenRouter key has hit its limit/);
    assertPlain(text, { reset: /Grill does not set when that key resets/, action: /https:\/\/openrouter\.ai\/keys/, addChecks: false });
    assert.equal(installedKeyLimitText("the judge exited 1"), "");
  });
});
