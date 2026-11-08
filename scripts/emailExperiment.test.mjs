// The weekly email test: ends on recipients, not weeks. A fixed holdout is not sent.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IMPACT_DECISION,
  IMPACT_PILOT_LAST,
  IMPACT_PILOT_START,
  emailReturnWeek,
  experimentReadout,
  impactArm,
  impactDigestWeek,
} from "./impactDigest.mjs";

describe("weekly email test design", () => {
  it("sends every Monday from the start until the backstop, not a fixed four", () => {
    assert.equal(IMPACT_PILOT_START, "2026-11-09");
    assert.equal(IMPACT_PILOT_LAST, "2027-01-25");
    assert.equal(impactDigestWeek(Date.parse("2026-12-07T15:00:00Z")).key, "2026-12-07");
    assert.equal(impactDigestWeek(Date.parse("2027-01-25T15:00:00Z")).key, "2027-01-25");
    assert.equal(impactDigestWeek(Date.parse("2027-02-01T15:00:00Z")), null);
    assert.equal(impactDigestWeek(Date.parse("2026-11-02T15:00:00Z")), null);
  });

  it("holds out about a quarter of accounts, the same way every week", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `acct_${i}`);
    const held = ids.filter((id) => impactArm(id) === "holdout").length;
    assert.ok(held > 400 && held < 600, `held ${held}`);
    for (const id of ids.slice(0, 50)) assert.equal(impactArm(id), impactArm(id));
    assert.ok(["send", "holdout"].includes(impactArm("x")));
  });

  it("credits a return to the Monday within the last seven days", () => {
    assert.equal(emailReturnWeek(Date.parse("2026-11-12T10:00:00Z")), "2026-11-09");
    assert.equal(emailReturnWeek(Date.parse("2026-11-09T15:00:00Z")), "2026-11-09");
    assert.equal(emailReturnWeek(Date.parse("2026-11-09T13:00:00Z")), null);
    assert.equal(emailReturnWeek(Date.parse("2027-02-03T10:00:00Z")), null);
  });

  it("reads out only after the thresholds plus a full week, and splits taps from activity", () => {
    const weeks = [
      { key: "2026-11-09", send: ["a", "b", "c"], holdout: ["h"], grill: ["a"], lookback: [], tap: ["b"], clicks: 2 },
    ];
    const early = experimentReadout(weeks, { recipients: 3, sends: 3, unsubscribes: 0 }, Date.parse("2026-11-12T00:00:00Z"));
    assert.equal(early.ready, false);
    const rows = experimentReadout(weeks, { recipients: IMPACT_DECISION.recipients, sends: IMPACT_DECISION.sends, unsubscribes: 1, lastSendWeek: "2026-11-09" }, Date.parse("2026-11-17T00:00:00Z"));
    assert.equal(rows.ready, true);
    assert.deepEqual(rows.send, { weeks: 3, returned: 2, activity: 1, tapOnly: 1 });
    assert.deepEqual(rows.holdout, { weeks: 1, returned: 0, activity: 0, tapOnly: 0 });
    assert.equal(rows.clicks, 2);
    assert.equal(rows.guardrail, "ok");
    const bad = experimentReadout(weeks, { recipients: 10, sends: 10, unsubscribes: 2 }, Date.parse("2026-11-17T00:00:00Z"));
    assert.equal(bad.guardrail, "pause");
  });
});
