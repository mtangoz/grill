import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_LOOKBACK_STATUSES,
  EMPTY_FOUR_ARM,
  FOUR_ARM_IDS,
  FOUR_ARM_STATUSES,
  HOLDOUT_IDS,
  HOLDOUT_STATUSES,
  JUDGE_COMPANY_IDS,
  MAX_EXACT_TRIALS,
  MIN_ACCOUNT_DENOMINATOR,
  RESULTS_VERSION,
  Z_95,
  companyIdOf,
  isCommitHash,
  isIsoDate,
  mcnemarExactP,
  signTestP,
  validateAccountLookbacks,
  validateFourArm,
  validateHoldout,
  validateRegressionRun,
  validateResults,
  wilsonInterval,
} from "./resultsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const committed = () => JSON.parse(read("data/results.json"));

/** The first measured run of the weekly regression check, as recorded on 2026-11-13. */
const firstRun = () => ({
  date: "2026-11-13",
  run_id: 43354935479,
  commit: "303a77f",
  cases: 29,
  reached_judge: 29,
  flawed: { caught: 15, of: 15 },
  wrong_figure: { caught: 4, of: 4 },
  loaded: { caught: 4, of: 4 },
  sound: { false_alarms: 2, of: 6 },
  schema_violations: { k: 0, of: 29 },
  different_company: { k: 29, of: 29 },
  quotes: { found: 84, of: 94 },
  semantic: { caught: 22, of: 23 },
  by_company: [
    { company: "google", cases: 8 },
    { company: "openai", cases: 14 },
    { company: "deepseek", cases: 3 },
    { company: "minimax", cases: 2 },
    { company: "moonshotai", cases: 2 },
  ],
});

const firstHoldout = () => ({ id: "v1", status: "run", date: "2026-11-09", decided: 15, candidate_wins: 9, rule_on: false });

/** A valid file, built here so the refusal tests do not move when the committed file grows. */
const seed = () => ({
  version: 1,
  updated: "2026-11-13",
  users: { real: 1, as_of: "2026-11-09", evidenced_lookbacks: 0 },
  regression: {
    runs: [firstRun()],
    not_measured: ["2026-11-02", "2026-11-09"],
    skipped_green: ["2026-10-19", "2026-10-26"],
  },
  holdouts: [firstHoldout(), { id: "v2", status: "not-run" }],
  four_arm: { status: "draft", arms: [], comparisons: [] },
  signals: { rated: 0, resolved: 0 },
  account_lookbacks: { status: "not-counted" },
});

/** A measured comparison with made-up counts that add up. */
const measured = () => ({
  status: "measured",
  date: "2026-11-13",
  commit: "0123abc",
  cases: { flawed: 120, sound: 40, loaded: 20 },
  arms: [
    { arm: "same-chat", caught: 70, flawed: 120, caught_usable: 70, usable_flawed: 118, alarms: 30, sound: 40, unusable: 3 },
    { arm: "fresh-brief", caught: 80, flawed: 120, caught_usable: 80, usable_flawed: 119, alarms: 10, sound: 40, unusable: 1 },
    { arm: "stronger-same-lab", caught: 90, flawed: 120, caught_usable: 90, usable_flawed: 120, alarms: 12, sound: 40, unusable: 0 },
    { arm: "product", caught: 95, flawed: 120, caught_usable: 95, usable_flawed: 117, alarms: 14, sound: 40, unusable: 4 },
  ],
  comparisons: [
    { first: "product", second: "fresh-brief", both: 70, first_only: 25, second_only: 10, neither: 15, usable_both: 68, usable_first_only: 22, usable_second_only: 9, usable_neither: 12 },
    { first: "product", second: "same-chat", both: 60, first_only: 35, second_only: 10, neither: 15, usable_both: 60, usable_first_only: 30, usable_second_only: 10, usable_neither: 11 },
    { first: "product", second: "stronger-same-lab", both: 80, first_only: 15, second_only: 10, neither: 15, usable_both: 79, usable_first_only: 15, usable_second_only: 8, usable_neither: 14 },
  ],
  single_drafter: true,
});

const FREE_TEXT = "We are raising a seed round and Dana wants to sign on Friday";
/** An en dash or an em dash, built from code points so this file holds neither. */
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** The validator must throw an Error whose message starts with this path. */
function refuses(validate, value, path, also = null) {
  assert.throws(
    () => validate(value),
    (err) => {
      assert.ok(err instanceof Error, "throws an Error");
      assert.ok(err.message.startsWith(`${path}: `), `expected the message to name ${path}, got: ${err.message}`);
      if (also) assert.match(err.message, also);
      assert.ok(!err.message.includes(FREE_TEXT), "the message never repeats a string it was given");
      return true;
    },
  );
}

/** Change one thing in a valid file and expect a refusal at `path`. */
function fileRefuses(change, path, also = null) {
  const file = seed();
  change(file);
  refuses(validateResults, file, path, also);
}

function runRefuses(change, path, also = null) {
  const run = firstRun();
  change(run);
  refuses(validateRegressionRun, run, `run.${path}`, also);
}

function fourArmRefuses(change, path, also = null) {
  const block = measured();
  change(block);
  refuses(validateFourArm, block, path === "" ? "four_arm" : `four_arm.${path}`, also);
}

function leaves(value, path = "", out = []) {
  if (Array.isArray(value)) value.forEach((item, i) => leaves(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) leaves(item, path ? `${path}.${key}` : key, out);
  } else out.push([path, value]);
  return out;
}

describe("data/results.json", () => {
  it("is valid, and validateResults hands back the same object", () => {
    const file = committed();
    assert.equal(validateResults(file), file);
    assert.equal(file.version, RESULTS_VERSION);
    assert.equal(validateResults(seed()).version, RESULTS_VERSION);
  });

  it("holds only whole numbers, true or false, dates, short commit hashes and ids from the fixed lists", () => {
    const ids = [
      ...JUDGE_COMPANY_IDS,
      ...HOLDOUT_IDS,
      ...HOLDOUT_STATUSES,
      ...FOUR_ARM_STATUSES,
      ...FOUR_ARM_IDS,
      ...ACCOUNT_LOOKBACK_STATUSES,
    ];
    const found = leaves(committed());
    assert.ok(found.length > 30, "the walk reached the values");
    for (const [path, value] of found) {
      const ok =
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
        (typeof value === "string" &&
          (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^[0-9a-f]{7,40}$/.test(value) || ids.includes(value)));
      assert.ok(ok, `${path} holds something else`);
    }
  });

  it("has no dollar sign, no decimal point and no dash character in it", () => {
    const text = read("data/results.json");
    assert.doesNotMatch(text, /\$/);
    assert.doesNotMatch(text, /\d\.\d/);
    assert.doesNotMatch(text, LONG_DASH);
  });

  it("is written as plain JSON with no repeated key hiding a second value", () => {
    const text = read("data/results.json");
    assert.equal(text.replace(/\s+/g, ""), JSON.stringify(JSON.parse(text)));
  });

  it("keeps the first measured run and the first holdout as they were recorded", () => {
    const file = committed();
    assert.deepEqual(
      file.regression.runs.find((run) => run.run_id === 43354935479),
      firstRun(),
    );
    assert.deepEqual(
      file.holdouts.find((holdout) => holdout.id === "v1"),
      firstHoldout(),
    );
    for (const day of ["2026-11-02", "2026-11-09"]) assert.ok(file.regression.not_measured.includes(day), day);
    for (const day of ["2026-10-19", "2026-10-26"]) assert.ok(file.regression.skipped_green.includes(day), day);
  });

  it("gives the same real-user count, date and evidenced look-backs as docs/STRATEGY.md", () => {
    const stated = /As of (\d{4}-\d{2}-\d{2}) the count is (\d+) real users? and (\d+) evidenced look-backs?/.exec(
      read("docs/STRATEGY.md"),
    );
    assert.ok(stated, "docs/STRATEGY.md states the count in the pinned sentence");
    assert.deepEqual(committed().users, {
      real: Number(stated[2]),
      as_of: stated[1],
      evidenced_lookbacks: Number(stated[3]),
    });
  });
});

describe("validateResults refuses anything that is not a count, a flag, a date, a commit hash or a listed id", () => {
  it("refuses a free-text string wherever it is put, and does not repeat it", () => {
    fileRefuses((f) => (f.users.real = FREE_TEXT), "users.real", /whole number/);
    fileRefuses((f) => (f.updated = FREE_TEXT), "updated", /YYYY-MM-DD/);
    fileRefuses((f) => (f.regression.runs[0].commit = FREE_TEXT), "regression.runs[0].commit", /commit hash/);
    fileRefuses((f) => (f.regression.runs[0].by_company[0].company = FREE_TEXT), "regression.runs[0].by_company[0].company");
    fileRefuses((f) => (f.holdouts[0].rule_on = FREE_TEXT), "holdouts[0].rule_on", /true or false/);
    fileRefuses((f) => (f.holdouts[1].status = FREE_TEXT), "holdouts[1].status", /run, not-run/);
    fileRefuses((f) => (f.four_arm.status = FREE_TEXT), "four_arm.status", /draft, registered, measured/);
    fileRefuses((f) => (f.account_lookbacks.status = FREE_TEXT), "account_lookbacks.status");
    fileRefuses((f) => f.regression.not_measured.push(FREE_TEXT), "regression.not_measured[2]");
    fileRefuses((f) => (f.signals = FREE_TEXT), "signals", /expected an object/);
    fileRefuses((f) => (f.note = FREE_TEXT), "note", /unknown key/);
  });

  it("refuses a number written as a string, and a model name where a company id belongs", () => {
    fileRefuses((f) => (f.regression.runs[0].cases = "29"), "regression.runs[0].cases", /got a string/);
    fileRefuses((f) => (f.regression.runs[0].by_company[1].company = "openai/example-model"), "regression.runs[0].by_company[1].company");
  });

  it("refuses an unknown key at any depth", () => {
    fileRefuses((f) => (f.dogfood = 3), "dogfood", /unknown key/);
    fileRefuses((f) => (f.users.pending = 2), "users.pending", /unknown key/);
    fileRefuses((f) => (f.regression.last_run = "2026-11-13"), "regression.last_run", /unknown key/);
    fileRefuses((f) => (f.regression.runs[0].pass = true), "regression.runs[0].pass", /unknown key/);
    fileRefuses((f) => (f.regression.runs[0].flawed.rate = 1), "regression.runs[0].flawed.rate", /unknown key/);
    fileRefuses((f) => (f.regression.runs[0].by_company[2].model = 1), "regression.runs[0].by_company[2].model", /unknown key/);
    fileRefuses((f) => (f.signals.themes = 0), "signals.themes", /unknown key/);
    fileRefuses((f) => (f[FREE_TEXT] = 1), "(a key that is not a plain name)", /unknown key/);
  });

  it("refuses a float, including a rate or a p value", () => {
    fileRefuses((f) => (f.regression.runs[0].sound.false_alarms = 0.33), "regression.runs[0].sound.false_alarms", /got 0\.33/);
    fileRefuses((f) => (f.holdouts[0].candidate_wins = 9.5), "holdouts[0].candidate_wins", /whole number/);
    fileRefuses((f) => (f.holdouts[0].p = 0.3), "holdouts[0].p", /unknown key/);
    fileRefuses((f) => (f.signals.rated = Number.NaN), "signals.rated");
    fileRefuses((f) => (f.signals.rated = Number.POSITIVE_INFINITY), "signals.rated");
    fileRefuses((f) => (f.users.real = 2 ** 53), "users.real");
  });

  it("refuses a negative count", () => {
    fileRefuses((f) => (f.users.evidenced_lookbacks = -1), "users.evidenced_lookbacks", /got -1/);
    fileRefuses((f) => (f.regression.runs[0].quotes.found = -3), "regression.runs[0].quotes.found", /0 or more/);
    fileRefuses((f) => (f.signals.resolved = -1), "signals.resolved");
  });

  it("refuses a dollar field, by name or by value", () => {
    fileRefuses((f) => (f.regression.runs[0].cost_usd = 2), "regression.runs[0].cost_usd", /dollar amounts are never published/);
    fileRefuses((f) => (f.spend = 0), "spend", /dollar amounts are never published/);
    fileRefuses((f) => (f.four_arm.price = 45), "four_arm.price", /dollar amounts are never published/);
    fileRefuses((f) => (f.users.real = "$5"), "users.real", /whole number/);
  });

  it("refuses a company id that is not on the list", () => {
    fileRefuses((f) => (f.regression.runs[0].by_company[3].company = "acme-ai"), "regression.runs[0].by_company[3].company", /expected one of openai, anthropic/);
    fileRefuses((f) => (f.regression.runs[0].by_company[3].company = "OpenAI"), "regression.runs[0].by_company[3].company");
    fileRefuses((f) => (f.regression.runs[0].by_company[3].company = 7), "regression.runs[0].by_company[3].company");
  });

  it("refuses counts that do not add up", () => {
    fileRefuses((f) => (f.regression.runs[0].flawed.caught = 16), "regression.runs[0].flawed.caught", /16 is more than regression\.runs\[0\]\.flawed\.of \(15\)/);
    fileRefuses((f) => (f.regression.runs[0].sound.false_alarms = 7), "regression.runs[0].sound.false_alarms", /more than/);
    fileRefuses((f) => (f.regression.runs[0].reached_judge = 30), "regression.runs[0].reached_judge", /more than regression\.runs\[0\]\.cases \(29\)/);
    fileRefuses((f) => (f.regression.runs[0].sound.of = 7), "regression.runs[0].cases", /add up to 30, more than cases \(29\)/);
    fileRefuses((f) => (f.regression.runs[0].schema_violations = { k: 0, of: 30 }), "regression.runs[0].schema_violations.of", /more than/);
    fileRefuses((f) => (f.regression.runs[0].different_company = { k: 30, of: 30 }), "regression.runs[0].different_company.of", /more than/);
    fileRefuses(
      (f) => {
        f.regression.runs[0].reached_judge = 28;
        f.regression.runs[0].by_company[0].cases = 7;
      },
      "regression.runs[0].different_company.k",
      /more than regression\.runs\[0\]\.reached_judge \(28\)/,
    );
    fileRefuses((f) => (f.regression.runs[0].quotes.found = 95), "regression.runs[0].quotes.found", /more than/);
    fileRefuses((f) => (f.regression.runs[0].semantic = { caught: 22, of: 24 }), "regression.runs[0].semantic.of", /24 is more than the flawed, wrong_figure and loaded cases together \(23\)/);
    fileRefuses((f) => (f.regression.runs[0].by_company[0].cases = 9), "regression.runs[0].by_company", /add up to 30, which is more than regression\.runs\[0\]\.reached_judge \(29\)/);
    fileRefuses((f) => (f.holdouts[0].candidate_wins = 16), "holdouts[0].candidate_wins", /16 is more than holdouts\[0\]\.decided \(15\)/);
  });

  it("refuses a missing key, another version, and anything that is not an object", () => {
    for (const key of Object.keys(seed())) fileRefuses((f) => delete f[key], key, /missing/);
    fileRefuses((f) => delete f.users.as_of, "users.as_of", /missing/);
    fileRefuses((f) => delete f.regression.runs[0].semantic, "regression.runs[0].semantic", /missing/);
    fileRefuses((f) => delete f.regression.runs[0].quotes.of, "regression.runs[0].quotes.of", /missing/);
    fileRefuses((f) => (f.version = 2), "version", /expected 1, got 2/);
    fileRefuses((f) => (f.version = "1"), "version");
    for (const notAFile of [null, undefined, [], "results", 1, true]) refuses(validateResults, notAFile, "results", /expected an object/);
    fileRefuses((f) => (f.users = [1, "2026-11-09", 0]), "users", /got a list/);
    fileRefuses((f) => (f.regression.runs = {}), "regression.runs", /expected a list/);
    fileRefuses((f) => (f.holdouts = null), "holdouts", /expected a list, got null/);
    fileRefuses((f) => (f.regression.runs[0] = 29), "regression.runs[0]", /expected an object, got 29/);
  });

  it("refuses a date that is not a real day, is in another form, is listed twice or is after `updated`", () => {
    fileRefuses((f) => (f.users.as_of = "2026-02-30"), "users.as_of", /YYYY-MM-DD/);
    fileRefuses((f) => (f.users.as_of = "2026-13-01"), "users.as_of");
    fileRefuses((f) => (f.users.as_of = "9 Nov 2026"), "users.as_of");
    fileRefuses((f) => (f.users.as_of = "2026-11-09T00:00:00Z"), "users.as_of");
    fileRefuses((f) => (f.updated = 20261113), "updated", /got 20261113/);
    fileRefuses((f) => (f.regression.runs[0].date = "2026-11-9"), "regression.runs[0].date");
    fileRefuses((f) => f.regression.skipped_green.push("2026-10-19"), "regression.skipped_green[2]", /listed twice/);
    fileRefuses((f) => (f.regression.not_measured = "2026-11-02"), "regression.not_measured", /expected a list/);
    fileRefuses((f) => (f.users.as_of = "2026-11-14"), "users.as_of", /2026-11-14 is after updated \(2026-11-13\)/);
    fileRefuses((f) => (f.updated = "2026-11-12"), "regression.runs[0].date", /is after updated/);
    fileRefuses((f) => f.regression.not_measured.push("2026-11-16"), "regression.not_measured[2]", /is after updated/);
    fileRefuses((f) => (f.holdouts[0].date = "2027-01-01"), "holdouts[0].date", /is after updated/);
    assert.ok(isIsoDate("2028-02-29"));
    assert.ok(!isIsoDate("2027-02-29"));
    assert.ok(!isIsoDate(20261113));
  });

  it("refuses a commit hash that is too short, too long, upper case or not hex", () => {
    for (const bad of ["303a77", "303A77F", "303a77g", "a".repeat(41), "", "2026-11-13", 3030777]) {
      fileRefuses((f) => (f.regression.runs[0].commit = bad), "regression.runs[0].commit", /7 to 40 lowercase hex/);
    }
    for (const good of ["303a77f", "0123456", "a".repeat(40)]) {
      const file = seed();
      file.regression.runs[0].commit = good;
      assert.equal(validateResults(file), file);
      assert.ok(isCommitHash(good));
    }
  });

  it("refuses the same run, company or holdout listed twice, and a run with no run number", () => {
    fileRefuses((f) => f.regression.runs.push(firstRun()), "regression.runs[1].run_id", /listed twice/);
    fileRefuses((f) => (f.regression.runs[0].by_company[4].company = "google"), "regression.runs[0].by_company[4].company", /listed twice/);
    fileRefuses((f) => (f.holdouts[1] = firstHoldout()), "holdouts[1].id", /listed twice/);
    fileRefuses((f) => (f.holdouts[1].id = "v3"), "holdouts[1].id", /expected one of v1, v2/);
    fileRefuses((f) => (f.regression.runs[0].run_id = 0), "regression.runs[0].run_id", /Actions run number/);
  });

  it("accepts a second run, an empty history and a later update", () => {
    const more = seed();
    more.updated = "2026-11-20";
    more.regression.runs.push({ ...firstRun(), date: "2026-11-16", run_id: 43354935480, commit: "a".repeat(40) });
    more.regression.not_measured = [];
    assert.equal(validateResults(more), more);

    const bare = seed();
    bare.regression = { runs: [], not_measured: [], skipped_green: [] };
    bare.holdouts = [];
    assert.equal(validateResults(bare), bare);
  });
});

describe("validateRegressionRun checks one run on its own", () => {
  it("returns a valid run, and names the path from `run` unless told another", () => {
    const run = firstRun();
    assert.equal(validateRegressionRun(run), run);
    runRefuses((r) => (r.loaded.caught = 5), "loaded.caught", /5 is more than run\.loaded\.of \(4\)/);
    runRefuses((r) => (r.judge_model = "x"), "judge_model", /unknown key/);
    runRefuses((r) => (r.total_cost_usd = 1), "total_cost_usd", /dollar amounts/);
    runRefuses((r) => delete r.reached_judge, "reached_judge", /missing/);
    runRefuses((r) => (r.by_company = [{ company: "other", cases: 30 }]), "by_company", /more than run\.reached_judge \(29\)/);
    const moved = firstRun();
    moved.wrong_figure.caught = 5;
    refuses((r) => validateRegressionRun(r, "public"), moved, "public.wrong_figure.caught");
    refuses(validateRegressionRun, null, "run", /expected an object, got null/);
  });

  it("accepts a run where some cases never reached a judge, and one where the company is unknown", () => {
    const run = firstRun();
    run.reached_judge = 27;
    run.different_company = { k: 27, of: 29 };
    run.by_company = [
      { company: "openai", cases: 20 },
      { company: "other", cases: 7 },
    ];
    assert.equal(validateRegressionRun(run), run);
    const none = {
      ...firstRun(),
      reached_judge: 0,
      flawed: { caught: 0, of: 15 },
      wrong_figure: { caught: 0, of: 4 },
      loaded: { caught: 0, of: 4 },
      sound: { false_alarms: 6, of: 6 },
      semantic: { caught: 0, of: 23 },
      different_company: { k: 0, of: 29 },
      by_company: [],
    };
    assert.equal(validateRegressionRun(none), none);
    // No judge answered, so nothing can have been caught or cleared.
    const impossible = { ...firstRun(), reached_judge: 0, different_company: { k: 0, of: 29 }, by_company: [] };
    assert.throws(() => validateRegressionRun(impossible), /reached_judge/);
    // A list with a hole is refused, not skipped.
    const holed = firstRun();
    delete holed.by_company[1];
    assert.throws(() => validateRegressionRun(holed), /by_company\[1\]/);
  });
});

describe("validateHoldout and validateAccountLookbacks", () => {
  it("a holdout that was not run carries no result, and one that was run carries all of it", () => {
    const run = firstHoldout();
    assert.equal(validateHoldout(run), run);
    const notRun = { id: "v2", status: "not-run" };
    assert.equal(validateHoldout(notRun), notRun);
    refuses(validateHoldout, { id: "v2", status: "not-run", decided: 0 }, "holdout.decided", /not allowed while status is not-run/);
    refuses(validateHoldout, { id: "v2", status: "run" }, "holdout.date", /missing/);
    refuses(validateHoldout, { id: "v2" }, "holdout.status", /missing/);
    refuses(validateHoldout, { ...firstHoldout(), rule_on: 0 }, "holdout.rule_on", /true or false/);
    refuses(validateHoldout, { ...firstHoldout(), outcome: "rule stays off" }, "holdout.outcome", /unknown key/);
  });

  it("account look-backs are published only once the cohort is 10 or more, and the counts must nest", () => {
    assert.equal(MIN_ACCOUNT_DENOMINATOR, 10);
    const counted = { status: "counted", as_of: "2026-11-13", cohort: 30, done_14d: 15, done_7d: 9, people: 6 };
    assert.equal(validateAccountLookbacks(counted), counted);
    const file = seed();
    file.account_lookbacks = counted;
    assert.equal(validateResults(file), file);

    refuses(validateAccountLookbacks, { ...counted, cohort: 9, done_14d: 4, done_7d: 2, people: 3 }, "account_lookbacks.cohort", /9 is under 10/);
    refuses(validateAccountLookbacks, { ...counted, done_14d: 31 }, "account_lookbacks.done_14d", /more than account_lookbacks\.cohort \(30\)/);
    refuses(validateAccountLookbacks, { ...counted, done_7d: 16 }, "account_lookbacks.done_7d", /more than account_lookbacks\.done_14d \(15\)/);
    refuses(validateAccountLookbacks, { ...counted, people: 31 }, "account_lookbacks.people", /more than/);
    refuses(validateAccountLookbacks, { ...counted, people: 0 }, "account_lookbacks.people", /at least one person/);
    refuses(validateAccountLookbacks, { ...counted, emails: 6 }, "account_lookbacks.emails", /unknown key/);
    refuses(validateAccountLookbacks, { status: "not-counted", cohort: 3 }, "account_lookbacks.cohort", /not allowed while status is not-counted/);
    refuses(validateAccountLookbacks, { status: "counted" }, "account_lookbacks.as_of", /missing/);
    fileRefuses((f) => (f.account_lookbacks = { ...counted, as_of: "2026-12-01" }), "account_lookbacks.as_of", /is after updated/);
  });
});

describe("validateFourArm", () => {
  it("EMPTY_FOUR_ARM is the draft shape: a status, no arms and no comparisons, and it cannot be changed", () => {
    assert.deepEqual(EMPTY_FOUR_ARM, { status: "draft", arms: [], comparisons: [] });
    assert.equal(validateFourArm(EMPTY_FOUR_ARM), EMPTY_FOUR_ARM);
    assert.ok(Object.isFrozen(EMPTY_FOUR_ARM) && Object.isFrozen(EMPTY_FOUR_ARM.arms) && Object.isFrozen(EMPTY_FOUR_ARM.comparisons));
    const registered = { ...EMPTY_FOUR_ARM, status: "registered" };
    assert.equal(validateFourArm(registered), registered);
    const today = committed().four_arm;
    if (today.status === "draft") assert.deepEqual(today, { status: "draft", arms: [], comparisons: [] });
  });

  it("a comparison that has not run holds no counts", () => {
    refuses(validateFourArm, { status: "draft" }, "four_arm.arms", /missing/);
    refuses(validateFourArm, { status: "draft", arms: [], comparisons: [], date: "2026-11-13" }, "four_arm.date", /not allowed while status is draft/);
    refuses(validateFourArm, { status: "registered", arms: measured().arms, comparisons: [] }, "four_arm.arms", /must be empty while status is registered/);
    refuses(validateFourArm, { status: "draft", arms: [], comparisons: {} }, "four_arm.comparisons", /expected a list/);
    refuses(validateFourArm, { status: "run", arms: [], comparisons: [] }, "four_arm.status", /draft, registered, measured/);
    refuses(validateFourArm, [], "four_arm", /expected an object/);
    refuses((b) => validateFourArm(b, "public"), { arms: [], comparisons: [] }, "public.status", /missing/);
  });

  it("accepts a measured comparison whose counts add up, alone and inside the file", () => {
    const block = measured();
    assert.equal(validateFourArm(block), block);
    // The usable-only cells are a subset of the plain cells.
    const tooMany = measured();
    tooMany.comparisons[0].usable_first_only = 26;
    assert.throws(() => validateFourArm(tooMany), /usable_first_only/);
    const missing = measured();
    delete missing.comparisons[0].usable_neither;
    assert.throws(() => validateFourArm(missing), /usable_neither/);
    const file = seed();
    file.four_arm = block;
    assert.equal(validateResults(file), file);
    const two = measured();
    two.arms = two.arms.filter((arm) => arm.arm === "product" || arm.arm === "fresh-brief");
    two.comparisons = two.comparisons.slice(0, 1);
    assert.equal(validateFourArm(two), two);
    fileRefuses((f) => (f.four_arm = { ...measured(), date: "2026-12-24" }), "four_arm.date", /is after updated/);
  });

  it("refuses a measured comparison with a missing part, an unknown arm or anything that is not a count", () => {
    fourArmRefuses((b) => delete b.single_drafter, "single_drafter", /missing/);
    fourArmRefuses((b) => (b.single_drafter = "yes"), "single_drafter", /true or false/);
    fourArmRefuses((b) => delete b.commit, "commit", /missing/);
    fourArmRefuses((b) => (b.cases.dev = 12), "cases.dev", /unknown key/);
    fourArmRefuses((b) => (b.arms = []), "arms", /at least one arm/);
    fourArmRefuses((b) => (b.arms[0].arm = "council"), "arms[0].arm", /same-chat, fresh-brief, stronger-same-lab, product/);
    fourArmRefuses((b) => (b.arms[1].arm = "same-chat"), "arms[1].arm", /listed twice/);
    fourArmRefuses((b) => (b.arms[2].model = "x"), "arms[2].model", /unknown key/);
    fourArmRefuses((b) => (b.arms[2].catch_rate = 0.75), "arms[2].catch_rate", /unknown key/);
    fourArmRefuses((b) => (b.arms[3].caught = 94.5), "arms[3].caught", /whole number/);
    fourArmRefuses((b) => delete b.arms[3].unusable, "arms[3].unusable", /missing/);
    fourArmRefuses((b) => (b.comparisons[0].p = 0.01), "comparisons[0].p", /unknown key/);
    fourArmRefuses((b) => (b.comparisons[0].neither = -1), "comparisons[0].neither", /0 or more/);
    fourArmRefuses((b) => (b.comparisons[1].second = "product"), "comparisons[1].second", /compared with itself/);
    fourArmRefuses((b) => (b.comparisons[1].second = "fresh-brief"), "comparisons[1]", /compared twice/);
    fourArmRefuses((b) => (b.comparisons[1] = { ...b.comparisons[0], first: "fresh-brief", second: "product" }), "comparisons[1]", /compared twice/);
    fourArmRefuses(
      (b) => {
        b.arms = b.arms.filter((arm) => arm.arm !== "same-chat");
      },
      "comparisons[1].second",
      /not in arms/,
    );
  });

  it("refuses measured counts that do not add up", () => {
    fourArmRefuses((b) => (b.arms[0].caught = 121), "arms[0].caught", /more than four_arm\.arms\[0\]\.flawed \(120\)/);
    fourArmRefuses((b) => (b.arms[0].flawed = 121), "arms[0].flawed", /more than four_arm\.cases\.flawed \(120\)/);
    fourArmRefuses((b) => (b.arms[0].usable_flawed = 121), "arms[0].usable_flawed", /more than/);
    fourArmRefuses((b) => (b.arms[0].caught_usable = 119), "arms[0].caught_usable", /more than four_arm\.arms\[0\]\.usable_flawed \(118\)/);
    fourArmRefuses((b) => (b.arms[0].caught_usable = 71), "arms[0].caught_usable", /more than four_arm\.arms\[0\]\.caught \(70\)/);
    fourArmRefuses((b) => (b.arms[1].alarms = 41), "arms[1].alarms", /more than four_arm\.arms\[1\]\.sound \(40\)/);
    fourArmRefuses((b) => (b.arms[1].sound = 41), "arms[1].sound", /more than four_arm\.cases\.sound \(40\)/);
    fourArmRefuses((b) => (b.arms[1].unusable = 181), "arms[1].unusable", /more than all the cases \(180\)/);
    fourArmRefuses((b) => (b.arms[3].unusable = 2), "arms[3].unusable", /3 flawed cases had no usable answer, which is more than unusable \(2\)/);
    fourArmRefuses((b) => (b.comparisons[0].neither = 16), "comparisons[0]", /add up to 121, more than four_arm\.cases\.flawed \(120\)/);
    fourArmRefuses(
      (b) => {
        b.comparisons[0].first_only = 26;
        b.comparisons[0].neither = 14;
      },
      "comparisons[0].first_only",
      /both and first_only add up to 96, which is more than what the first arm caught \(95\)/,
    );
    fourArmRefuses(
      (b) => {
        b.comparisons[0].second_only = 11;
        b.comparisons[0].neither = 14;
      },
      "comparisons[0].second_only",
      /both and second_only add up to 81, which is more than what the second arm caught \(80\)/,
    );
  });
});

describe("companyIdOf", () => {
  it("names the five companies that served the first measured run", () => {
    // The model names here are made up. Only the part before the slash decides the company.
    assert.equal(companyIdOf("google/example-flash"), "google");
    assert.equal(companyIdOf("openai/example-5.1-mini"), "openai");
    assert.equal(companyIdOf("deepseek/example-chat"), "deepseek");
    assert.equal(companyIdOf("minimax/example-m1"), "minimax");
    assert.equal(companyIdOf("moonshotai/example-k1"), "moonshotai");
  });

  it("files an unknown vendor, a router alias and an empty value under other", () => {
    for (const slug of ["acme-ai/model-1", "openrouter/auto", "gpt-something", "", "   ", null, undefined, 42, {}, "constructor/x", "other/model"]) {
      assert.equal(companyIdOf(slug), "other", String(slug));
    }
  });

  it("puts every spelling of a Claude model under anthropic", () => {
    for (const slug of [
      "claude-example-1",
      "anthropic/claude-example-1",
      "Anthropic/Claude-Example-1",
      "anthropic/another-name",
      "some-cloud/anthropic.claude-example-1",
      "us.anthropic.claude-example-1",
      "some-host/claude-3.7-example",
      "~anthropic/claude-example-latest",
      "anthropic",
    ]) {
      assert.equal(companyIdOf(slug), "anthropic", slug);
    }
  });

  it("knows the other listed vendors and their second spellings, in any case, and always answers with a listed id", () => {
    const expected = {
      "x-ai/example": "x-ai",
      "xai/example": "x-ai",
      "meta-llama/example-70b": "meta-llama",
      "meta/example": "meta-llama",
      "mistralai/example-large": "mistralai",
      "mistral/example-large": "mistralai",
      "moonshot/example": "moonshotai",
      "qwen/example-max": "qwen",
      "alibaba/example-max": "qwen",
      "cohere/example": "cohere",
      "amazon/example-pro": "amazon",
      "microsoft/example": "microsoft",
      "nvidia/example": "nvidia",
      "perplexity/example": "perplexity",
      "z-ai/example": "z-ai",
      "zai/example": "z-ai",
      "  Google/Example-Pro:free ": "google",
      "DeepSeek/Example-R1": "deepseek",
    };
    for (const [slug, id] of Object.entries(expected)) assert.equal(companyIdOf(slug), id, slug);
    for (const id of JUDGE_COMPANY_IDS) {
      assert.equal(companyIdOf(id), id, "an id maps to itself");
      assert.equal(companyIdOf(`${id}/some-model`), id);
    }
    assert.ok(Object.isFrozen(JUDGE_COMPANY_IDS));
    assert.equal(new Set(JUDGE_COMPANY_IDS).size, JUDGE_COMPANY_IDS.length);
    for (const id of ["openai", "anthropic", "google", "x-ai", "deepseek", "meta-llama", "mistralai", "moonshotai", "minimax", "qwen", "cohere", "amazon", "other"]) {
      assert.ok(JUDGE_COMPANY_IDS.includes(id), id);
    }
  });

  it("maps each company id in the committed file to itself", () => {
    for (const run of committed().regression.runs) {
      for (const row of run.by_company) assert.equal(companyIdOf(`${row.company}/any`), row.company);
    }
  });
});

/** Pascal's triangle in plain numbers. Exact up to 40 trials, where every sum fits in a double. */
function waysTable(n) {
  let row = [1];
  for (let i = 0; i < n; i += 1) row = [1, ...row.slice(1).map((v, j) => v + row[j]), 1];
  return row;
}
const sumFrom = (row, from, to) => row.slice(from, to + 1).reduce((a, b) => a + b, 0);

describe("signTestP", () => {
  it("matches values worked out by hand", () => {
    // 9 or more of 15: 5005 + 3003 + 1365 + 455 + 105 + 15 + 1 = 9949 of 32768.
    assert.equal(signTestP(9, 15), 9949 / 32768);
    assert.ok(Math.abs(signTestP(9, 15) - 0.3036) < 0.00005);
    // 12 or more of 15: 455 + 105 + 15 + 1 = 576 of 32768.
    assert.equal(signTestP(12, 15), 576 / 32768);
    // 5 or more of 10: 252 + 210 + 120 + 45 + 10 + 1 = 638 of 1024.
    assert.equal(signTestP(5, 10), 638 / 1024);
    assert.equal(signTestP(8, 15), 0.5);
    assert.equal(signTestP(15, 15), 1 / 32768);
    assert.equal(signTestP(0, 15), 1);
    assert.equal(signTestP(0, 0), 1);
    assert.equal(signTestP(1, 1), 0.5);
  });

  it("matches a count of outcomes for every case up to 40 decided", () => {
    for (let n = 0; n <= 40; n += 1) {
      const row = waysTable(n);
      for (let wins = 0; wins <= n; wins += 1) {
        assert.equal(signTestP(wins, n), sumFrom(row, wins, n) / 2 ** n, `${wins} of ${n}`);
      }
    }
  });

  it("does not round, and stays right for large counts", () => {
    assert.ok(Math.abs(signTestP(60, 100) - 0.028443966820490392) < 1e-15);
    assert.equal(signTestP(1000, 1000), 2 ** -1000);
    assert.equal(signTestP(0, 5000), 1);
    assert.equal(signTestP(2501, 5001), 0.5);
    assert.ok(signTestP(1500, 2000) > 0 && signTestP(1500, 2000) < 1e-100);
  });

  it("throws on counts that cannot be", () => {
    assert.throws(() => signTestP(16, 15), RangeError);
    assert.throws(() => signTestP(-1, 15), RangeError);
    assert.throws(() => signTestP(9.5, 15), RangeError);
    assert.throws(() => signTestP("9", 15), RangeError);
    assert.throws(() => signTestP(9), RangeError);
    assert.throws(() => signTestP(1, MAX_EXACT_TRIALS + 1), RangeError);
  });
});

describe("mcnemarExactP", () => {
  it("matches values worked out by hand", () => {
    assert.equal(mcnemarExactP(0, 0), 1);
    assert.equal(mcnemarExactP(3, 3), 1);
    assert.equal(mcnemarExactP(2, 3), 1);
    assert.equal(mcnemarExactP(0, 1), 1);
    // 0 against 5: twice 1 of 32.
    assert.equal(mcnemarExactP(0, 5), 2 / 32);
    // 0 against 6: twice 1 of 64. Six discordant pairs is the fewest that can go under 0.05.
    assert.equal(mcnemarExactP(0, 6), 2 / 64);
    // 1 against 9: twice (1 + 10) of 1024.
    assert.equal(mcnemarExactP(1, 9), 22 / 1024);
    // 10 against 25 uses the smaller side, whichever is given first.
    assert.equal(mcnemarExactP(25, 10), mcnemarExactP(10, 25));
    assert.ok(Math.abs(mcnemarExactP(10, 25) - 0.0167) < 0.00005);
  });

  it("is twice the smaller tail, capped at 1, for every split up to 40 pairs, and the same either way round", () => {
    for (let n = 0; n <= 40; n += 1) {
      const row = waysTable(n);
      for (let first = 0; first <= n; first += 1) {
        const second = n - first;
        const expected = Math.min(1, (2 * sumFrom(row, 0, Math.min(first, second))) / 2 ** n);
        assert.equal(mcnemarExactP(first, second), expected, `${first} against ${second}`);
        assert.equal(mcnemarExactP(second, first), expected);
      }
    }
  });

  it("throws on counts that cannot be", () => {
    assert.throws(() => mcnemarExactP(-1, 3), RangeError);
    assert.throws(() => mcnemarExactP(1.5, 3), RangeError);
    assert.throws(() => mcnemarExactP(3), RangeError);
    assert.throws(() => mcnemarExactP(MAX_EXACT_TRIALS, 1), RangeError);
  });
});

describe("wilsonInterval", () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00005, `${actual} is not about ${expected}`);

  it("matches values worked out by hand", () => {
    // 2 of 6, the false alarms on sound cases in the first run.
    const sound = wilsonInterval(2, 6);
    near(sound.low, 0.0968);
    near(sound.high, 0.7);
    // 50 of 100: centred on a half.
    const half = wilsonInterval(50, 100);
    near(half.low, 0.4038);
    near(half.high, 0.5962);
    // 22 of 23.
    const most = wilsonInterval(22, 23);
    near(most.low, 0.7901);
    near(most.high, 0.9923);
  });

  it("at none of n and all of n has the closed form z squared over n plus z squared", () => {
    const z2 = Z_95 * Z_95;
    assert.equal(wilsonInterval(0, 10).low, 0);
    assert.ok(Math.abs(wilsonInterval(0, 10).high - z2 / (10 + z2)) < 1e-12);
    assert.equal(wilsonInterval(29, 29).high, 1);
    // A full score on 29 cases still leaves the low end near 0.88.
    assert.ok(Math.abs(wilsonInterval(29, 29).low - 29 / (29 + z2)) < 1e-12);
    near(wilsonInterval(29, 29).low, 0.883);
    assert.deepEqual(wilsonInterval(0, 0), { low: 0, high: 1 });
  });

  it("mirrors, stays inside 0 to 1 with the observed share inside it, takes another z, and does not round", () => {
    for (let n = 1; n <= 30; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        const { low, high } = wilsonInterval(k, n);
        const mirror = wilsonInterval(n - k, n);
        assert.ok(low >= 0 && high <= 1 && low <= k / n && k / n <= high, `${k} of ${n}`);
        assert.ok(Math.abs(low - (1 - mirror.high)) < 1e-12, `${k} of ${n} mirrors`);
      }
    }
    const wide = wilsonInterval(5, 10, 2.5758293035489);
    const usual = wilsonInterval(5, 10);
    assert.ok(wide.low < usual.low && wide.high > usual.high);
    assert.deepEqual(Object.keys(usual), ["low", "high"]);
    assert.notEqual(usual.low, Number(usual.low.toFixed(6)));
  });

  it("throws on counts that cannot be", () => {
    assert.throws(() => wilsonInterval(7, 6), RangeError);
    assert.throws(() => wilsonInterval(-1, 6), RangeError);
    assert.throws(() => wilsonInterval(2.5, 6), RangeError);
    assert.throws(() => wilsonInterval(2, 6, 0), RangeError);
    assert.throws(() => wilsonInterval(2, 6, Number.NaN), RangeError);
  });
});

describe("scripts/resultsCore.mjs keeps to the rules for a new script", () => {
  it("is pure: no import, no file or network access, no clock and no environment", () => {
    const source = read("scripts/resultsCore.mjs");
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bprocess\.|Date\.now|new Date\(\)|Math\.random/);
  });

  it("uses nothing newer than Node 20, and the three files hold no long dash", () => {
    const source = read("scripts/resultsCore.mjs");
    assert.doesNotMatch(source, /\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf)\(|withResolvers|fs\.glob/);
    for (const file of ["scripts/resultsCore.mjs", "scripts/resultsCore.test.mjs", "data/results.json"]) {
      assert.doesNotMatch(read(file), LONG_DASH, file);
    }
  });

  it("is not shipped in the installed tool", () => {
    for (const file of ["package.json", "scripts/build-extension.mjs", "Dockerfile"]) {
      assert.doesNotMatch(read(file), /resultsCore|results\.json/, file);
    }
  });
});
