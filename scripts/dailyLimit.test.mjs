// The daily completed-check cap. Free and trial stay at 30. An active subscription in the
// Pro store raises it, and that store is read only once the free cap is already reached.
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_GRILL_LIMIT,
  DEFAULT_PRO_DAILY_LIMIT,
  createMemoryRedis,
  dailyLimitMessage,
  lookupActivePro,
  proAccountKey,
  proDailyLimit,
  proEmailIndexKey,
  resolveDailyLimit,
} from "./hostedCore.mjs";

const NOW = Date.parse("2026-11-07T16:00:00.000Z");
const EMAIL = "invitee@example.com";

describe("pro daily limit from the environment", () => {
  it("stays at 100 when the variable is unset", () => {
    assert.equal(DAILY_GRILL_LIMIT, 30);
    assert.equal(DEFAULT_PRO_DAILY_LIMIT, 100);
    assert.equal(proDailyLimit({}), 100);
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "" }), 100);
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "   " }), 100);
  });

  it("uses a whole-number override", () => {
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "150" }), 150);
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: " 40 " }), 40);
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "30" }), 30);
  });

  it("falls back to 100 when the value is not a whole number", () => {
    for (const value of ["nope", "1.5", "30.0", "-4", "1e2", "100abc", "Infinity", "10.0"]) {
      assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: value }), 100, value);
    }
  });

  it("never goes below 30", () => {
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "0" }), 30);
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "1" }), 30);
    assert.equal(proDailyLimit({ GRILL_PRO_DAILY_LIMIT: "29" }), 30);
  });
});

describe("who gets which daily cap", () => {
  it("keeps a free or trial account at 30", async () => {
    const row = await resolveDailyLimit({
      used: 30,
      email: EMAIL,
      env: { GRILL_PRO_DAILY_LIMIT: "150" },
      lookup: async () => false,
    });
    assert.equal(row.limit, 30);
    assert.equal(row.paid, false);
    const under = await resolveDailyLimit({ used: 29, email: EMAIL, lookup: async () => false });
    assert.equal(under.limit, 30);
    assert.equal(under.paid, false);
  });

  it("gives an active subscription 100 when the variable is unset", async () => {
    const row = await resolveDailyLimit({
      used: 30,
      email: EMAIL,
      env: {},
      lookup: async () => true,
    });
    assert.equal(row.limit, 100);
    assert.equal(row.paid, true);
  });

  it("uses the environment override for an active subscription", async () => {
    const row = await resolveDailyLimit({
      used: 40,
      email: EMAIL,
      env: { GRILL_PRO_DAILY_LIMIT: "150" },
      lookup: async () => true,
    });
    assert.equal(row.limit, 150);
    assert.equal(row.paid, true);
  });

  it("looks up the Pro store only at or after 30 completed checks", async () => {
    const calls = [];
    const lookup = async (email) => {
      calls.push(email);
      return true;
    };
    for (const used of [0, 1, 29]) {
      const row = await resolveDailyLimit({ used, email: EMAIL, lookup });
      assert.equal(row.limit, 30);
      assert.equal(row.paid, false);
    }
    assert.deepEqual(calls, []);
    const at = await resolveDailyLimit({ used: 30, email: EMAIL, lookup });
    assert.deepEqual(calls, [EMAIL]);
    assert.equal(at.limit, 100);
    assert.equal(at.paid, true);
    const after = await resolveDailyLimit({ used: 31, email: EMAIL, env: { GRILL_PRO_DAILY_LIMIT: "80" }, lookup });
    assert.deepEqual(calls, [EMAIL, EMAIL]);
    assert.equal(after.limit, 80);
    const blank = await resolveDailyLimit({ used: 50, email: "", lookup });
    assert.deepEqual(calls, [EMAIL, EMAIL]);
    assert.equal(blank.limit, 30);
    assert.equal(blank.paid, false);
  });
});

describe("the Pro store read", () => {
  function seed(subscription) {
    const memory = createMemoryRedis();
    memory.command(["SET", proEmailIndexKey(EMAIL), "acct_pro"]);
    memory.command(["SET", proAccountKey("acct_pro"), JSON.stringify({ id: "acct_pro", email: EMAIL, subscription })]);
    return memory;
  }

  it("uses the existing email index and account row", () => {
    const hash = createHash("sha256").update(EMAIL).digest("hex");
    assert.equal(proEmailIndexKey(EMAIL), `grill:email:${hash}`);
    assert.equal(proEmailIndexKey("Invitee@Example.com"), `grill:email:${hash}`);
    assert.equal(proAccountKey("acct_pro"), "grill:acct:acct_pro");
    assert.equal(proEmailIndexKey("not-an-email"), "");
  });

  it("is active only when that row says so, and reads nothing for a blank email", async () => {
    const active = seed("active");
    const reads = [];
    const command = (args) => {
      reads.push(args.map(String));
      return active.command(args);
    };
    assert.equal(await lookupActivePro(EMAIL, command), true);
    assert.deepEqual(reads, [
      ["GET", `grill:email:${createHash("sha256").update(EMAIL).digest("hex")}`],
      ["GET", "grill:acct:acct_pro"],
    ]);
    const canceled = seed("canceled");
    assert.equal(await lookupActivePro(EMAIL, (args) => canceled.command(args)), false);
    const none = seed("none");
    assert.equal(await lookupActivePro(EMAIL, (args) => none.command(args)), false);
    assert.equal(await lookupActivePro("other@example.com", (args) => active.command(args)), false);
    assert.equal(
      await lookupActivePro(EMAIL, () => {
        throw new Error("down");
      }),
      false,
    );
    let calls = 0;
    assert.equal(await lookupActivePro("", () => {
      calls += 1;
      return null;
    }), false);
    assert.equal(calls, 0);
  });
});

describe("the daily stop message", () => {
  it("tells a free account when the day resets", () => {
    assert.equal(
      dailyLimitMessage({ limit: 30, paid: false, now: NOW }),
      "You've hit today's daily limit of 30 checks on this account, so this one didn't run. It resets at 00:00 UTC. Wait until then.",
    );
    assert.match(dailyLimitMessage({ limit: 30, topups: true, origin: "https://grillyour.ai" }), /Add checks at https:\/\/grillyour\.ai\/account/);
  });

  it("tells a paid account how many of this month's 200 checks are used", () => {
    assert.equal(
      dailyLimitMessage({ limit: 100, monthlyChecks: 47, paid: true, now: NOW }),
      "You've hit today's daily limit of 100 checks on this account, so this one didn't run. It resets at 00:00 UTC. Wait until then. You've used 47 of this month's 200 checks. That allowance resets next month on the 1st at 00:00 UTC.",
    );
  });
});
