import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_LOOKBACK_STATUSES,
  ARM_WORDS,
  COMPANY_NAMES,
  EMPTY_FOUR_ARM,
  FOUR_ARM_IDS,
  FOUR_ARM_STATUSES,
  HOLDOUT_IDS,
  HOLDOUT_STATUSES,
  JUDGE_COMPANY_IDS,
  MAX_EXACT_TRIALS,
  MAX_REGRESSION_RUNS,
  MIN_ACCOUNT_DENOMINATOR,
  MIN_RATE_DENOMINATOR,
  RESULTS_MARKER,
  RESULTS_VERSION,
  Z_95,
  companyIdOf,
  countWords,
  escapeHtml,
  formatResults,
  isCommitHash,
  isIsoDate,
  latestRun,
  mcnemarExactP,
  mergeRegressionRun,
  rateWords,
  renderFourArm,
  renderHoldouts,
  renderPeople,
  renderRegression,
  renderResults,
  resultsProblems,
  shareWords,
  signTestP,
  validateAccountLookbacks,
  validateFourArm,
  validateHoldout,
  validateRegressionRun,
  validateResults,
  wilsonInterval,
  withRenderedResults,
} from "./resultsCore.mjs";
import { commitOnHead, fileProblems, mergeRunFile } from "./results.mjs";

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
    skipped_green: ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
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

  it("lists every weekly run from before the first measured run, so no week reads as one that measured", () => {
    // GitHub Actions, workflow eval, scheduled runs: seven before the first measured run of 2026-11-13.
    // The first five passed while skipping every case, because no key was set. The last two failed as
    // not measured. A week left out of both lists would read, on the page, as a week that measured.
    const file = committed();
    const early = (days) => days.filter((day) => day < firstRun().date);
    assert.deepEqual(early(file.regression.skipped_green), ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    assert.deepEqual(early(file.regression.not_measured), ["2026-11-02", "2026-11-09"]);
    // One run a week, with no week missing between the first and the last.
    const all = [...early(file.regression.skipped_green), ...early(file.regression.not_measured)];
    for (let i = 1; i < all.length; i += 1) {
      assert.equal((Date.parse(all[i]) - Date.parse(all[i - 1])) / 86400000, 7, `${all[i - 1]} to ${all[i]} is one week`);
    }
    // The eval's own notes name the same weeks, so the notes and the page cannot disagree.
    const notes = read("evals/README.md").replace(/\s+/g, " ");
    assert.ok(
      notes.includes(
        "Before it, no weekly run had reached a judge. The five weekly runs from 2026-09-28 to 2026-10-26 were green skips, and the runs on 2026-11-02 and 2026-11-09 failed as not measured.",
      ),
      "evals/README.md lists the same weeks",
    );
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
    fileRefuses((f) => f.regression.skipped_green.push("2026-10-19"), "regression.skipped_green[5]", /listed twice/);
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

  it("the command that reads and writes the file keeps to the same rules, and is not shipped either", () => {
    const source = read("scripts/results.mjs");
    assert.doesNotMatch(source, LONG_DASH);
    assert.doesNotMatch(source, /\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf)\(|withResolvers|fs\.glob/);
    const specifiers = [...source.matchAll(/^import\s[^"]*"([^"]+)"/gm)].map((match) => match[1]);
    assert.ok(specifiers.length >= 4, "the imports were read");
    for (const specifier of specifiers) assert.match(specifier, /^(node:|\.\/)/, specifier);
    assert.doesNotMatch(source, /\bfetch\s*\(/, "it asks the network nothing");
    for (const file of ["package.json", "scripts/build-extension.mjs", "Dockerfile"]) {
      assert.doesNotMatch(read(file), /scripts\/results\.mjs/, file);
    }
  });
});

// ---------------------------------------------------------------------------
// Every problem at once, the limit on runs, the layout, and adding a run.

/** A second run of the weekly check, a week after the first, where two cases reached no judge. */
const laterRun = (change = {}) => ({
  date: "2026-11-16",
  run_id: 43400000001,
  commit: "0123abc",
  cases: 29,
  reached_judge: 27,
  flawed: { caught: 14, of: 15 },
  wrong_figure: { caught: 4, of: 4 },
  loaded: { caught: 3, of: 4 },
  sound: { false_alarms: 1, of: 6 },
  schema_violations: { k: 1, of: 29 },
  different_company: { k: 27, of: 29 },
  quotes: { found: 80, of: 90 },
  semantic: { caught: 20, of: 23 },
  by_company: [
    { company: "google", cases: 20 },
    { company: "other", cases: 7 },
  ],
  ...change,
});

/** The day `n` days after 2026-11-13, written YYYY-MM-DD. */
const dayAfter = (n) => new Date(Date.UTC(2026, 10, 13 + n)).toISOString().slice(0, 10);

describe("resultsProblems lists every problem, not only the first", () => {
  it("finds none in the committed file or in a valid one", () => {
    assert.deepEqual(resultsProblems(committed()), []);
    assert.deepEqual(resultsProblems(seed()), []);
  });

  it("names each bad part on its own, and its first line is what validateResults throws", () => {
    const file = seed();
    file.regression.runs.push(laterRun({ reached_judge: 40 }), laterRun({ run_id: 43400000002, commit: "XYZ" }));
    file.holdouts[0].candidate_wins = 16;
    file.signals.rated = -1;
    file.note = FREE_TEXT;
    delete file.users;
    const problems = resultsProblems(file);
    assert.deepEqual(problems, [
      "note: unknown key",
      "users: missing",
      "regression.runs[1].reached_judge: 40 is more than regression.runs[1].cases (29)",
      "regression.runs[2].commit: expected a commit hash of 7 to 40 lowercase hex characters, got a string",
      "holdouts[0].candidate_wins: 16 is more than holdouts[0].decided (15)",
      "signals.rated: expected a whole number, 0 or more, got -1",
    ]);
    assert.throws(() => validateResults(file), { message: problems[0] });
    for (const line of problems) assert.ok(!line.includes(FREE_TEXT), "a string from the file is never repeated");
  });

  it("names every date that is after `updated`, and something that is not an object at all", () => {
    const file = seed();
    file.updated = "2026-11-01";
    assert.deepEqual(resultsProblems(file), [
      "users.as_of: 2026-11-09 is after updated (2026-11-01)",
      "regression.runs[0].date: 2026-11-13 is after updated (2026-11-01)",
      "regression.not_measured[0]: 2026-11-02 is after updated (2026-11-01)",
      "regression.not_measured[1]: 2026-11-09 is after updated (2026-11-01)",
      "holdouts[0].date: 2026-11-09 is after updated (2026-11-01)",
    ]);
    assert.deepEqual(resultsProblems([]), ["results: expected an object, got a list"]);
    assert.deepEqual(resultsProblems(null), ["results: expected an object, got null"]);
    const broken = seed();
    broken.regression = FREE_TEXT;
    broken.holdouts = 3;
    assert.deepEqual(resultsProblems(broken), ["regression: expected an object, got a string", "holdouts: expected a list, got 3"]);
  });
});

describe("the file holds a bounded number of runs", () => {
  const withRuns = (n) => {
    const file = seed();
    file.updated = dayAfter(400);
    for (let i = 1; i < n; i += 1) file.regression.runs.push(laterRun({ date: dayAfter(7 * i), run_id: 43400000000 + i }));
    return file;
  };

  it("validateResults accepts the limit and refuses one more", () => {
    assert.equal(MAX_REGRESSION_RUNS, 12);
    assert.equal(validateResults(withRuns(MAX_REGRESSION_RUNS)).regression.runs.length, 12);
    refuses(validateResults, withRuns(MAX_REGRESSION_RUNS + 1), "regression.runs", /holds 13 runs, more than the 12 this file keeps/);
  });

  it("mergeRegressionRun adds a run in date order, moves `updated`, and leaves what it was given alone", () => {
    const before = seed();
    const snapshot = JSON.stringify(before);
    const block = laterRun();
    const after = mergeRegressionRun(before, block);
    assert.equal(JSON.stringify(before), snapshot, "the file it was given is not changed");
    assert.deepEqual(after.regression.runs, [firstRun(), laterRun()]);
    assert.equal(after.updated, "2026-11-16");
    assert.notEqual(after.regression.runs[1], block, "the run is copied in, not shared");
    for (const key of ["version", "users", "holdouts", "four_arm", "signals", "account_lookbacks"]) {
      assert.deepEqual(after[key], before[key], `${key} is untouched`);
    }
    assert.deepEqual(after.regression.not_measured, before.regression.not_measured);
    assert.deepEqual(after.regression.skipped_green, before.regression.skipped_green);

    // A run on the first run's own day sorts after it by run number, and `updated` does not move back.
    const sameDay = mergeRegressionRun(after, laterRun({ date: "2026-11-13", run_id: 43354935480 }));
    assert.deepEqual(sameDay.regression.runs.map((run) => run.run_id), [43354935479, 43354935480, 43400000001]);
    assert.equal(sameDay.updated, "2026-11-16");
  });

  it("refuses a run that is already there, a block that is not a run, and a run dated before the first", () => {
    refuses((block) => mergeRegressionRun(seed(), block), firstRun(), "run.run_id", /run 43354935479 is already in the file/);
    refuses((block) => mergeRegressionRun(seed(), block), laterRun({ note: FREE_TEXT }), "run.note", /unknown key/);
    refuses((block) => mergeRegressionRun(seed(), block), laterRun({ reached_judge: 30 }), "run.reached_judge");
    refuses((block) => mergeRegressionRun(seed(), block), { four_arm: EMPTY_FOUR_ARM }, "run.four_arm");
    refuses((block) => mergeRegressionRun(seed(), block), laterRun({ date: "2026-11-12" }), "run.date", /comes before the first measured run in the file, which stays first/);
    const broken = seed();
    broken.signals.rated = 1.5;
    refuses((file) => mergeRegressionRun(file, laterRun()), broken, "signals.rated");
    // With no run in the file yet, any date is the first.
    const empty = seed();
    empty.regression.runs = [];
    assert.deepEqual(mergeRegressionRun(empty, laterRun({ date: "2026-11-12" })).regression.runs.map((run) => run.date), ["2026-11-12"]);
  });

  it("past the limit it drops the oldest run after the first, which always stays", () => {
    const full = withRuns(MAX_REGRESSION_RUNS);
    const newest = laterRun({ date: dayAfter(7 * 20), run_id: 43400000099 });
    const after = mergeRegressionRun(full, newest);
    assert.equal(after.regression.runs.length, MAX_REGRESSION_RUNS);
    assert.deepEqual(after.regression.runs[0], firstRun(), "the first measured run is history and stays");
    assert.deepEqual(after.regression.runs[MAX_REGRESSION_RUNS - 1], newest);
    const ids = after.regression.runs.map((run) => run.run_id);
    assert.ok(!ids.includes(43400000001), "the oldest run after the first was dropped");
    assert.ok(ids.includes(43400000002));
    // A run older than every run kept after the first would be dropped at once, so it is refused.
    const tooOld = laterRun({ date: dayAfter(1), run_id: 43400000098 });
    refuses((block) => mergeRegressionRun(full, block), tooOld, "run.date", /older than the 11 latest runs the file keeps after the first/);
    // A run that lands in the middle is kept, and the one that falls out is still the oldest after the first.
    const middle = mergeRegressionRun(full, laterRun({ date: dayAfter(7 * 5 + 1), run_id: 43400000097 }));
    assert.equal(middle.regression.runs.length, MAX_REGRESSION_RUNS);
    assert.ok(middle.regression.runs.some((run) => run.run_id === 43400000097));
    assert.ok(!middle.regression.runs.some((run) => run.run_id === 43400000001));
  });
});

describe("formatResults writes the file in the layout it is kept in", () => {
  it("gives back the committed file byte for byte", () => {
    const text = read("data/results.json");
    assert.equal(formatResults(JSON.parse(text)), text);
  });

  it("after a run is added, every line of the old text is still there in order, but for `updated`", () => {
    // From the file as first recorded, so this test does not move when the committed file gains a run.
    const before = formatResults(seed());
    const after = formatResults(mergeRegressionRun(JSON.parse(before), laterRun()));
    assert.equal(validateResults(JSON.parse(after)).regression.runs.length, 2);
    assert.ok(after.endsWith("}\n") && !after.endsWith("\n\n"));
    const added = after.split("\n");
    let at = 0;
    let moved = 0;
    for (const line of before.split("\n")) {
      const wanted = line === '  "updated": "2026-11-13",' ? '  "updated": "2026-11-16",' : line;
      if (wanted !== line) moved += 1;
      // The old run's closing brace gains a comma, because another run now follows it.
      const found = added.findIndex((candidate, i) => i >= at && (candidate === wanted || candidate === `${wanted},`));
      assert.ok(found >= 0, `this line was lost or moved: ${line}`);
      at = found + 1;
    }
    assert.equal(moved, 1);
    assert.ok(after.includes('        "flawed": { "caught": 14, "of": 15 },\n'), "a run's small counts stay on one line");
    assert.ok(after.includes('          { "company": "other", "cases": 7 }\n'));
  });

  it("lays out a measured comparison exactly as the four-arm report writes it, so the two never fight over the file", () => {
    const file = seed();
    file.four_arm = measured();
    const text = formatResults(file);
    assert.ok(text.includes(`  "four_arm": ${JSON.stringify(measured(), null, 2).replace(/\n/g, "\n  ")},\n`));
    assert.equal(formatResults(JSON.parse(text)), text, "formatting twice changes nothing");
  });

  it("refuses to format a file that is not valid", () => {
    const file = seed();
    file.signals.rated = "0";
    refuses(formatResults, file, "signals.rated");
  });
});

// ---------------------------------------------------------------------------
// The page: what the counts become in HTML.

/** The text a reader sees: tags removed, entities decoded, white space made single. */
const textOf = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Each <li> of the first list that follows `heading`, as text. */
const itemsUnder = (html, heading) => {
  const from = html.indexOf(heading);
  assert.ok(from >= 0, `the rendering has ${heading}`);
  const listAt = html.indexOf('<ul class="steps">', from);
  const list = html.slice(listAt, html.indexOf("</ul>", listAt));
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
};

/** Words that would be a model's name, not a company's. None may appear on the page. */
const MODEL_WORDS = /\b(gpt|claude|gemini|gemma|llama|qwen|kimi|glm|grok|sonnet|opus|haiku|jev|o[1-9]-|terra)\b/i;
const CAVEAT = "these 29 cases were used to write the judge's instructions, so a full score says nothing about how good the judge is.";

describe("renderResults turns the counts into the page", () => {
  it("checks the file first and renders nothing from one that is not valid", () => {
    for (const render of [renderResults, renderRegression, renderHoldouts, renderFourArm, renderPeople]) {
      const file = seed();
      file.regression.runs[0].by_company[0].company = '<script>alert("x")</script>';
      refuses(render, file, "regression.runs[0].by_company[0].company");
      refuses(render, { ...seed(), note: FREE_TEXT }, "note");
    }
  });

  it("escapes every value it places, and uses only the markup the prose pages use", () => {
    assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
    assert.equal(escapeHtml(29), "29");
    const html = renderResults(committed());
    const tags = new Set([...html.matchAll(/<\/?([a-z0-9]+)/g)].map((match) => match[1]));
    assert.deepEqual([...tags].sort(), ["a", "h2", "li", "p", "strong", "ul"]);
    assert.doesNotMatch(html, /<(table|script|style|dl|img|iframe)\b|\son[a-z]+=|javascript:/i);
    for (const match of html.matchAll(/<(p|ul)\b([^>]*)>/g)) {
      assert.equal(match[2], match[1] === "p" ? ' class="note"' : ' class="steps"');
    }
    for (const match of html.matchAll(/<a\b([^>]*)>/g)) assert.match(match[1], /^ href="https:\/\/github\.com\/mtangoz\/grill\/[^"<>]*"$/);
    assert.doesNotMatch(html, LONG_DASH);
  });

  it("names a company for every company id and an arm for every arm id, and no model", () => {
    assert.deepEqual(Object.keys(COMPANY_NAMES), [...JUDGE_COMPANY_IDS]);
    assert.deepEqual(Object.keys(ARM_WORDS), [...FOUR_ARM_IDS]);
    for (const name of Object.values(COMPANY_NAMES)) assert.doesNotMatch(name, MODEL_WORDS);
    for (const { name, what } of Object.values(ARM_WORDS)) {
      assert.doesNotMatch(`${name} ${what}`, /\d/);
      assert.equal(what.split(/(?<=[.?!])\s+/).length, 1, "each arm is said in one sentence");
    }
    const everyCompany = seed();
    everyCompany.regression.runs[0].by_company = JUDGE_COMPANY_IDS.map((company) => ({ company, cases: 1 }));
    const text = textOf(renderRegression(everyCompany));
    assert.ok(
      text.includes(
        "Cases by the company whose model answered: OpenAI 1, Anthropic 1, Google 1, xAI 1, DeepSeek 1, Meta 1, Mistral AI 1, Moonshot AI 1, MiniMax 1, Alibaba 1, Cohere 1, Amazon 1, Microsoft 1, Nvidia 1, Perplexity 1, Z.ai 1, other companies 1.",
      ),
    );
    assert.doesNotMatch(textOf(renderResults(committed())), MODEL_WORDS);
    assert.doesNotMatch(renderResults(committed()), /\$|usd|dollar/i);
  });

  it("shows a rate only when 10 cases or more are behind it, and refuses one under that", () => {
    assert.equal(MIN_RATE_DENOMINATOR, 10);
    assert.equal(countWords(2, 6), "2 of 6");
    assert.equal(shareWords(2, 6), "2 of 6");
    assert.equal(shareWords(9, 9, { range: true }), "9 of 9");
    assert.equal(shareWords(3, 10), "3 of 10 (30 in 100)");
    assert.equal(shareWords(95, 120), "95 of 120 (79 in 100)");
    assert.equal(shareWords(95, 120, { range: true }), "95 of 120 (79 in 100, likely range 71 to 85)");
    assert.equal(rateWords(9, 15), "60 in 100");
    assert.throws(() => rateWords(2, 6), RangeError);
    assert.throws(() => rateWords(9, 9), RangeError);
    assert.throws(() => rateWords(0, 0), RangeError);
    assert.throws(() => shareWords(7, 6), RangeError);
    assert.throws(() => countWords(1.5, 6), RangeError);
  });

  it("the weekly run: a regression check by title, the caveat in the same sentence as the catches, and no rate", () => {
    const html = renderRegression(seed());
    assert.ok(html.startsWith("<h2>A weekly regression check, not a measure of quality</h2>"));
    const items = itemsUnder(html, "<h2>A weekly regression check");
    assert.equal(
      textOf(items[0]),
      `Caught. The judge caught 19 of 19 flawed plans and 4 of 4 loaded questions, but ${CAVEAT}`,
      "the counts and the caveat are one sentence",
    );
    assert.equal(textOf(items[0]).split(/(?<=[.?!])\s+/).length, 2, "the label, then one sentence");
    // The false alarms and the quotes not found are the next two items of the same list, in the same markup.
    assert.equal(textOf(items[1]), "False alarms. 2 of 6 sound plans got a false alarm. That is too few plans to say what the real rate is.");
    assert.equal(textOf(items[2]), "Quotes not found. 10 of 94 quotes the judge gave were not found in the write-up they were quoted from.");
    for (const item of items) assert.match(item, /^<strong>[A-Z][^<]*\.<\/strong> \S/, "every item has the same shape");
    assert.equal(textOf(items[3]), "Output rules. 0 of 29 answers broke the output rules.");
    assert.equal(
      textOf(items[4]),
      "A second reading. A separate quality check read the judge's answers and found the planted flaw named in 22 of 23 cases. These are the same cases, so this says nothing about how good the judge is either.",
    );
    assert.equal(items.length, 7);
    const section = textOf(html);
    assert.doesNotMatch(section, /%|percent|per cent|\bin 100\b|\brate of\b|accura/i, "no rate of any kind for this run");
    assert.doesNotMatch(html, /<ul[^>]*>(?:(?!<\/ul>)[\s\S])*<ul/, "nothing is tucked into a list inside the list");
  });

  it("the weekly run: one run, with its date, its commit and a link to its Actions run", () => {
    const html = renderRegression(seed());
    assert.ok(
      html.includes(
        '<p class="note">One run is shown, the latest that measured: 13 November 2026, commit <a href="https://github.com/mtangoz/grill/commit/303a77f">303a77f</a>, <a href="https://github.com/mtangoz/grill/actions/runs/43354935479">Actions run 43354935479</a>. All 29 cases reached a judge.</p>',
      ),
    );
    assert.equal((html.match(/actions\/runs\//g) || []).length, 1, "one run, not a history");
    // With two runs in the file the page still shows one: the latest.
    const two = mergeRegressionRun(seed(), laterRun());
    assert.equal(latestRun(two).run_id, 43400000001);
    assert.equal(latestRun(mergeRegressionRun(two, laterRun({ run_id: 43400000000 }))).run_id, 43400000001, "the same day goes to the higher run number");
    const later = renderRegression(two);
    assert.equal((later.match(/actions\/runs\//g) || []).length, 1);
    assert.ok(later.includes("https://github.com/mtangoz/grill/actions/runs/43400000001"));
    assert.ok(!later.includes("43354935479"));
  });

  it("the weekly run: says how many cases reached a judge when not all did, beside the counts", () => {
    const html = renderRegression(mergeRegressionRun(seed(), laterRun()));
    const text = textOf(html);
    assert.ok(
      text.includes(
        "Actions run 43400000001 . Only 27 of 29 cases reached a judge. A case with no answer counts as a miss, or as a false alarm on a sound plan.",
      ),
      text,
    );
    assert.ok(!text.includes("All 29 cases reached a judge."));
    const items = itemsUnder(html, "<h2>A weekly regression check");
    // Short of a full score the caveat stays in the sentence, and does not call the score full.
    assert.equal(
      textOf(items[0]),
      "Caught. The judge caught 18 of 19 flawed plans and 3 of 4 loaded questions, but these 29 cases were used to write the judge's instructions, so this score says nothing about how good the judge is.",
    );
    assert.equal(textOf(items[2]), "Quotes not found. 10 of 90 quotes the judge gave were not found in the write-up they were quoted from.");
    assert.ok(text.includes("Cases by the company whose model answered: Google 20, other companies 7."));
  });

  it("the routing figure is worded as a routing check, with its count, and never as decorrelated", () => {
    const items = itemsUnder(renderRegression(seed()), "<h2>A weekly regression check").map(textOf);
    assert.equal(
      items[5],
      "Routing. The judge came from a different company than the declared author in 29 of 29 cases. That is a routing check. It is not a measure of whether the two make different mistakes. This check names no author, so the default applies and the author is taken to be Anthropic.",
    );
    assert.equal(
      items[6],
      "Judge companies. The router picked the judge for each case. Cases by the company whose model answered: Google 8, OpenAI 14, DeepSeek 3, MiniMax 2, Moonshot AI 2.",
    );
    assert.doesNotMatch(renderResults(committed()), /decorrelat/i);
  });

  it("says plainly which weeks measured nothing, as dates", () => {
    const text = textOf(renderRegression(seed()));
    assert.ok(
      text.includes(
        "Weeks that measured nothing. The weekly runs on 2 November 2026 and 9 November 2026 failed as not measured. The runs on 28 September 2026, 5 October 2026, 12 October 2026, 19 October 2026 and 26 October 2026 passed while skipping every case, so a pass on those days measured nothing.",
      ),
    );
    const one = seed();
    one.regression.not_measured = ["2026-11-02"];
    one.regression.skipped_green = ["2026-10-19", "2026-10-26", "2026-10-12"];
    const oneText = textOf(renderRegression(one));
    assert.ok(oneText.includes("The weekly run on 2 November 2026 failed as not measured."));
    assert.ok(oneText.includes("The runs on 19 October 2026, 26 October 2026 and 12 October 2026 passed while skipping every case"));
    const none = seed();
    none.regression.not_measured = [];
    none.regression.skipped_green = [];
    assert.ok(!textOf(renderRegression(none)).includes("Weeks that measured nothing"));
  });

  it("with no measured run it says so and shows no count", () => {
    const empty = seed();
    empty.regression.runs = [];
    const html = renderRegression(empty);
    assert.ok(html.includes('<p class="note">No run of this check has measured yet, so there are no counts to show.</p>'));
    assert.ok(!html.includes("<strong>Caught.</strong>"));
    assert.equal(latestRun(empty), null);
  });

  it("the held-out check: what it compared, version 1 with its counts, and version 2 not run", () => {
    const html = renderHoldouts(seed());
    assert.ok(html.startsWith("<h2>A held-out check of one candidate rule</h2>"));
    const text = textOf(html);
    assert.ok(
      text.includes(
        "It compared two judges on the same decisions: one with today's instructions, and one with the same instructions plus one candidate rule. A rater who could not see which was which said which answer would change what you do next.",
      ),
    );
    assert.deepEqual(itemsUnder(html, "<h2>A held-out check").map(textOf), [
      "Version 1. Run on 9 November 2026. Of 15 decided pairs, the candidate rule won 9. If the two were equally good, the candidate would win that often or more about 30 times in 100. The rule stayed off.",
      "Version 2. Not run.",
    ]);
    // The chance figure is worked out from the counts, here by the sign test.
    assert.equal(Math.round(100 * signTestP(9, 15)), 30);
    // Under 10 decided pairs there is no chance figure, and a rule that was turned on says so.
    const small = seed();
    small.holdouts = [{ id: "v2", status: "run", date: "2026-11-13", decided: 9, candidate_wins: 9, rule_on: true }];
    assert.deepEqual(itemsUnder(renderHoldouts(small), "<h2>A held-out check").map(textOf), [
      "Version 2. Run on 13 November 2026. Of 9 decided pairs, the candidate rule won 9. The rule was turned on.",
    ]);
    const sure = seed();
    sure.holdouts = [{ id: "v2", status: "run", date: "2026-11-13", decided: 25, candidate_wins: 25, rule_on: false }];
    assert.ok(textOf(renderHoldouts(sure)).includes("would win that often or more less than 1 time in 100."));
    const none = seed();
    none.holdouts = [];
    assert.ok(textOf(renderHoldouts(none)).includes("No version of this check has been run."));
  });

  it("the comparison, while it is a draft or registered, holds no number at all", () => {
    const draft = renderFourArm(seed());
    assert.ok(draft.startsWith("<h2>The comparison with the same model starting fresh</h2>"));
    // The heading tag is the one place a digit is allowed: it is markup, not a number on the page.
    const withoutHeadingTags = (html) => html.replace(/<\/?h2>/g, "");
    assert.doesNotMatch(withoutHeadingTags(draft), /\d/, "not a digit, in the words or in a link");
    assert.match(withoutHeadingTags(renderRegression(seed())), /\d/, "the same reading does find the counts in a block that has them");
    const text = textOf(draft);
    assert.ok(text.includes("Draft protocol, not run. Grill has written a plan for one measurement and has not run it. Any part of the plan can still change."));
    assert.deepEqual(itemsUnder(draft, "<h2>The comparison").map(textOf), [
      "The same chat. The model that wrote the plan is asked, in the same chat, to argue the other side.",
      "The same model, starting fresh. The same model gets the plan in a new chat, with the instructions Grill gives its judge.",
      "A stronger model from the same company. A stronger model from the company that wrote the plan gets it with those same instructions.",
      "Grill as shipped. The router picks the judge, and the company that wrote the plan is left out.",
    ]);
    assert.ok(text.includes("The result will be published here whichever way it falls."));
    assert.ok(draft.includes('Read <a href="https://github.com/mtangoz/grill/blob/main/evals/four-arm/README.md">the draft protocol</a>.'));

    const registered = renderFourArm({ ...seed(), four_arm: { ...EMPTY_FOUR_ARM, status: "registered" } });
    assert.doesNotMatch(withoutHeadingTags(registered), /\d/);
    assert.ok(textOf(registered).includes("Registered protocol, not run. The plan for this measurement is fixed and it has not been run."));
    assert.ok(!/draft/i.test(registered), "a registered protocol is not called a draft");
    for (const html of [draft, registered]) {
      assert.doesNotMatch(html, /pre-?regist/i);
      assert.doesNotMatch(textOf(html), /\b(in|by|on|before|until) (january|february|march|april|may|june|july|august|september|october|november|december|20\d\d)\b/i, "no date is promised");
    }
  });

  it("the comparison, once measured, shows counts both ways and no rate where fewer than 10 cases are behind it", () => {
    const file = seed();
    file.four_arm = measured();
    // One arm with too few usable sound twins for a rate.
    file.four_arm.arms[3] = { ...file.four_arm.arms[3], alarms: 3, sound: 8 };
    const html = renderFourArm(file);
    const text = textOf(html);
    assert.ok(text.includes("Measured. The comparison ran on 13 November 2026, at commit 0123abc , on 120 flawed plans, 40 sound plans and 20 loaded questions. Every case is made up."));
    const lists = [...html.matchAll(/<ul class="steps">([\s\S]*?)<\/ul>/g)].map((match) => [...match[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => textOf(li[1])));
    assert.equal(lists.length, 3, "the arms in words, each arm's counts, and the pairs");
    assert.deepEqual(lists[1], [
      "The same chat. Planted flaws caught, counting an unusable answer as a miss: 70 of 120 (58 in 100, likely range 49 to 67). On usable answers only: 70 of 118 (59 in 100, likely range 50 to 68). Alarms on sound plans: 30 of 40 (75 in 100, likely range 60 to 86). Unusable answers: 3. This one is told to argue, so its alarms are shown and not compared.",
      "The same model, starting fresh. Planted flaws caught, counting an unusable answer as a miss: 80 of 120 (67 in 100, likely range 58 to 74). On usable answers only: 80 of 119 (67 in 100, likely range 58 to 75). Alarms on sound plans: 10 of 40 (25 in 100, likely range 14 to 40). Unusable answers: 1.",
      "A stronger model from the same company. Planted flaws caught, counting an unusable answer as a miss: 90 of 120 (75 in 100, likely range 67 to 82). On usable answers only: 90 of 120 (75 in 100, likely range 67 to 82). Alarms on sound plans: 12 of 40 (30 in 100, likely range 18 to 45). Unusable answers: 0.",
      "Grill as shipped. Planted flaws caught, counting an unusable answer as a miss: 95 of 120 (79 in 100, likely range 71 to 85). On usable answers only: 95 of 117 (81 in 100, likely range 73 to 87). Alarms on sound plans: 3 of 8. Unusable answers: 4.",
    ]);
    assert.equal(
      lists[2][0],
      "Grill as shipped against the same model, starting fresh. Counting an unusable answer as a miss: both caught it in 70 cases, only the first in 25, only the second in 10, neither in 15. On cases where both gave a usable answer: both caught it in 68 cases, only the first in 22, only the second in 9, neither in 12.",
    );
    assert.equal(lists[2].length, 3);
    // The likely range is the Wilson interval, worked out here from the same counts.
    const { low, high } = wilsonInterval(95, 120);
    assert.deepEqual([Math.round(100 * low), Math.round(100 * high)], [71, 85]);
    assert.ok(text.includes("More than half of the cases were drafted by one model family."));
    assert.ok(!textOf(renderFourArm({ ...file, four_arm: { ...file.four_arm, single_drafter: false } })).includes("drafted by one model family"));
    assert.doesNotMatch(text, /%|percent/i);
    assert.doesNotMatch(text, MODEL_WORDS);
    assert.doesNotMatch(text, /\b(won|beat|best was|did better|did worse)\b/i, "the page shows counts and names no winner");
    assert.ok(text.includes("This page does not say which one did best"));
  });

  it("people: real users, the two look-back counts under their two names, and signals", () => {
    const html = renderPeople(seed());
    assert.deepEqual(itemsUnder(html, "<h2>People</h2>").map(textOf), [
      "Real users. 1, as of 9 November 2026. What counts as a real user is set out in Grill's strategy notes .",
      "Evidenced look-backs. 0, as of the same day. What counts as one is set out in Grill's principles .",
      "Look-backs saved on Grill accounts. Not counted yet. This is a separate count from evidenced look-backs, and the two are never added together.",
      "Signals. 0 rated, 0 resolved. A signal is a short report a person chooses to send through a public form: a rating of one grill, or whether a call came true.",
    ]);
    assert.ok(html.includes('<a href="https://github.com/mtangoz/grill/blob/main/docs/STRATEGY.md">Grill\'s strategy notes</a>'));
    assert.ok(html.includes('<a href="https://github.com/mtangoz/grill/blob/main/docs/PRINCIPLES.md#north-star">Grill\'s principles</a>'));
    assert.ok(html.includes('<p class="note">The counts on this page were last updated on 13 November 2026.</p>'));
    assert.doesNotMatch(textOf(html), /\b1 look-backs?\b|look-backs in all|in total/i, "the two counts are never added");

    const counted = seed();
    counted.account_lookbacks = { status: "counted", as_of: "2026-11-13", cohort: 30, done_14d: 12, done_7d: 7, people: 6 };
    assert.equal(
      itemsUnder(renderPeople(counted), "<h2>People</h2>").map(textOf)[2],
      "Look-backs saved on Grill accounts. As of 13 November 2026, 30 look-backs had come due, from 6 people. 12 of 30 (40 in 100) were done within 14 days, and 7 of 30 (23 in 100) within 7 days. This is a separate count from evidenced look-backs, and the two are never added together.",
    );
  });

  it("puts the comparison first, then the weekly run, the held-out check and people", () => {
    const html = renderResults(committed());
    const headings = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => match[1]);
    assert.deepEqual(headings, [
      "The comparison with the same model starting fresh",
      "A weekly regression check, not a measure of quality",
      "A held-out check of one candidate rule",
      "People",
    ]);
    assert.equal(html, [renderFourArm(committed()), renderRegression(committed()), renderHoldouts(committed()), renderPeople(committed())].join("\n\n"));
  });

  it("renders the committed file, whatever it holds by now, with no rate sign and no model name", () => {
    // The figures are pinned above on the file as first recorded. Here only what must hold for any valid file.
    const html = renderResults(committed());
    const text = textOf(html);
    assert.ok(text.length > 1500, "the committed file renders to a full block");
    assert.doesNotMatch(text, /%|\bpercent\b|per cent/i);
    assert.doesNotMatch(text, MODEL_WORDS);
    assert.doesNotMatch(html, LONG_DASH);
    assert.equal(renderResults(seed()), renderResults(JSON.parse(formatResults(seed()))), "the same counts give the same page");
  });
});

describe("withRenderedResults replaces the page's one marker", () => {
  it("needs the marker exactly once, and a valid file", () => {
    assert.equal(RESULTS_MARKER, "<!-- RESULTS -->");
    const page = `<h1>How</h1>\n  ${RESULTS_MARKER}\n<p>after $& and $1</p>`;
    const built = withRenderedResults(page, seed());
    assert.ok(!built.includes(RESULTS_MARKER));
    assert.ok(built.includes(renderResults(seed())));
    assert.ok(built.startsWith("<h1>How</h1>\n  <h2>") && built.endsWith("<p>after $& and $1</p>"));
    for (const bad of ["<h1>How</h1>", `${RESULTS_MARKER}${RESULTS_MARKER}`, `${page}\n${RESULTS_MARKER}`, "<!-- results -->", null]) {
      assert.throws(() => withRenderedResults(bad, seed()), /site\/how-we-test\.html must include <!-- RESULTS --> once/);
    }
    const broken = seed();
    broken.users.real = "1";
    refuses((file) => withRenderedResults(page, file), broken, "users.real");
  });
});

// ---------------------------------------------------------------------------
// scripts/results.mjs, always on a temp copy. The committed file is never written by a test.

/** A git that answers the way the test says, in place of the real one. */
const GIT_STUB = `#!/usr/bin/env node
const mode = process.env.GIT_STUB_MODE || "yes";
const [first, second] = process.argv.slice(2);
const say = (text, code = 0) => { process.stdout.write(text + "\\n"); process.exit(code); };
if (mode === "no-repository") process.exit(128);
if (first === "rev-parse" && second === "--is-inside-work-tree") say("true");
if (first === "rev-parse" && second === "--verify") {
  if (mode === "missing" || mode === "missing-shallow") process.exit(1);
  say("0123abc0123abc0123abc0123abc0123abc0123a");
}
if (first === "rev-parse" && second === "--is-shallow-repository") say(mode === "missing-shallow" || mode === "apart-shallow" ? "true" : "false");
if (first === "merge-base" && second === "--is-ancestor") process.exit(mode === "yes" ? 0 : mode === "no" || mode === "apart-shallow" ? 1 : 128);
process.exit(129);
`;

describe("scripts/results.mjs", () => {
  const CLI = join(ROOT, "scripts", "results.mjs");
  const UNCHECKED_REFUSAL =
    "refused: run.commit: git could not say whether 0123abc can be reached from the commit checked out here. That happens in a shallow clone, and where git is not there. Use a full clone, or run git fetch --unshallow first. If you have checked that this is a run of main, pass --allow-unchecked-commit";

  // Removed when the tests end, so a test that fails part way leaves nothing behind.
  const scratchDirs = [];
  after(() => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  });

  /** A temp folder with a results file as first recorded, a run block, and a stand-in git. */
  function scratch() {
    const dir = mkdtempSync(join(tmpdir(), "grill-results-"));
    scratchDirs.push(dir);
    const file = join(dir, "results.json");
    const block = join(dir, "latest.public.json");
    // The copy starts from the file as first recorded, so these tests do not move when the committed file gains a run.
    writeFileSync(file, formatResults(seed()));
    writeFileSync(block, `${JSON.stringify(laterRun(), null, 2)}\n`);
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "git"), GIT_STUB);
    chmodSync(join(dir, "bin", "git"), 0o755);
    return { dir, file, block };
  }

  function run(dir, args, mode = "yes") {
    const env = { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GIT_STUB_MODE: mode };
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, stdout, stderr: "" };
    } catch (err) {
      return { code: err.status, stdout: `${err.stdout ?? ""}`, stderr: `${err.stderr ?? ""}` };
    }
  }

  it("check passes the committed file, reading only", () => {
    const before = read("data/results.json");
    assert.deepEqual(fileProblems(join(ROOT, "data", "results.json")), []);
    const { dir, file } = scratch();
    // A copy of the committed file, and the default path with no --file: both pass, and neither is written.
    writeFileSync(file, before);
    const done = run(dir, ["check", "--file", file]);
    assert.equal(done.code, 0);
    assert.match(done.stdout, /^ok: .*results\.json is valid\n$/);
    assert.equal(readFileSync(file, "utf8"), before, "check writes nothing");
    const inPlace = run(dir, ["check"]);
    assert.equal(inPlace.code, 0);
    assert.equal(inPlace.stdout, `ok: ${join(ROOT, "data", "results.json")} is valid\n`, "valid, and in the layout merge-run writes");
    assert.equal(read("data/results.json"), before, "the committed file is as it was");
    // The same values in another layout are still valid. One note says a merge would rewrite the file.
    writeFileSync(file, `${JSON.stringify(seed(), null, 2)}\n`);
    const otherLayout = run(dir, ["check", "--file", file]);
    assert.equal(otherLayout.code, 0);
    assert.deepEqual(otherLayout.stdout.trim().split("\n"), [
      `ok: ${file} is valid`,
      "note: the file is not in the layout merge-run writes, so the next merge-run will rewrite it as a whole",
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("check exits 1 and prints every problem, one a line", () => {
    const { dir, file } = scratch();
    const broken = seed();
    broken.regression.runs[0].sound.false_alarms = 7;
    broken.holdouts[0].decided = 8;
    broken.signals.resolved = 0.5;
    writeFileSync(file, JSON.stringify(broken));
    const done = run(dir, ["check", "--file", file]);
    assert.equal(done.code, 1);
    assert.equal(done.stdout, "");
    assert.deepEqual(done.stderr.trim().split("\n"), [
      "regression.runs[0].sound.false_alarms: 7 is more than regression.runs[0].sound.of (6)",
      "holdouts[0].candidate_wins: 9 is more than holdouts[0].decided (8)",
      "signals.resolved: expected a whole number, 0 or more, got 0.5",
      `3 problems in ${file}`,
    ]);

    writeFileSync(file, "{ not json");
    assert.deepEqual(fileProblems(file), ["results: is not JSON"]);
    assert.equal(run(dir, ["check", "--file", file]).code, 1);
    assert.deepEqual(fileProblems(join(dir, "missing.json")), [`results: cannot be read at ${join(dir, "missing.json")}`]);
    // A key written twice: JSON keeps the second value, so the first would be hidden.
    writeFileSync(file, formatResults(seed()).replace('"real": 1,', '"real": 100,\n    "real": 1,'));
    assert.deepEqual(fileProblems(file), [
      "results: the text is not the plain JSON of its own values (a key written twice, or a number written another way)",
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("merge-run adds a valid run to a copy, in the file's own layout, and the committed file is untouched", () => {
    const committedText = read("data/results.json");
    const { dir, file, block } = scratch();
    const done = run(dir, ["merge-run", block, "--file", file]);
    assert.equal(done.code, 0, done.stderr);
    assert.deepEqual(done.stdout.trim().split("\n"), [
      `added run 43400000001 (2026-11-16, commit 0123abc) to ${file}`,
      "the file now holds 2 of at most 12 runs, and its updated date is 2026-11-16",
      "next: node scripts/build-site.mjs, then the tests, then commit the file",
    ]);
    const written = readFileSync(file, "utf8");
    assert.equal(written, formatResults(mergeRegressionRun(seed(), laterRun())));
    assert.deepEqual(fileProblems(file), []);
    assert.equal(read("data/results.json"), committedText, "the committed file was not written");

    // The same run a second time is refused, and the file stays as it was.
    const again = run(dir, ["merge-run", block, "--file", file]);
    assert.equal(again.code, 1);
    assert.deepEqual(again.stderr.trim().split("\n"), ["refused: run.run_id: run 43400000001 is already in the file", "nothing was written"]);
    assert.equal(readFileSync(file, "utf8"), written);
    rmSync(dir, { recursive: true, force: true });
  });

  it("merge-run refuses a block that is not a valid run, and writes nothing", () => {
    const { dir, file, block } = scratch();
    const before = readFileSync(file, "utf8");
    const cases = [
      [JSON.stringify(laterRun({ model: "x" })), "refused: run.model: unknown key"],
      [JSON.stringify(laterRun({ cost_usd: 1 })), "refused: run.cost_usd: dollar amounts are never published in this file"],
      [JSON.stringify(laterRun({ commit: FREE_TEXT })), "refused: run.commit: expected a commit hash of 7 to 40 lowercase hex characters, got a string"],
      [JSON.stringify({ scores: [], summary: {} }), "refused: run.scores: unknown key"],
      ["not json", "refused: run: is not JSON"],
    ];
    for (const [text, line] of cases) {
      writeFileSync(block, text);
      const done = run(dir, ["merge-run", block, "--file", file]);
      assert.equal(done.code, 1, line);
      assert.deepEqual(done.stderr.trim().split("\n"), [line, "nothing was written"]);
      assert.ok(!done.stderr.includes(FREE_TEXT));
      assert.equal(readFileSync(file, "utf8"), before);
    }
    const missing = run(dir, ["merge-run", join(dir, "no-such.json"), "--file", file]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /^refused: run: cannot be read at /);
    // A results file with a problem is not added to.
    writeFileSync(block, JSON.stringify(laterRun()));
    writeFileSync(file, before.replace('"rated": 0', '"rated": -1'));
    const bad = run(dir, ["merge-run", block, "--file", file]);
    assert.equal(bad.code, 1);
    assert.deepEqual(bad.stderr.trim().split("\n"), ["refused: signals.rated: expected a whole number, 0 or more, got -1", "nothing was written"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("merge-run refuses a run whose commit is not on this branch, and says so when git cannot answer", () => {
    const { dir, file, block } = scratch();
    const before = readFileSync(file, "utf8");
    for (const mode of ["no", "missing"]) {
      const done = run(dir, ["merge-run", block, "--file", file], mode);
      assert.equal(done.code, 1, mode);
      assert.match(done.stderr, /^refused: run\.commit: 0123abc cannot be reached from the commit checked out here\. A pull request's run is not the record of main\./);
      assert.match(done.stderr, /\nnothing was written\n$/);
      assert.equal(readFileSync(file, "utf8"), before, mode);
    }
    // When git cannot answer, the run is refused as well. The line says why, and names the two ways on.
    for (const mode of ["missing-shallow", "apart-shallow", "no-repository"]) {
      const done = run(dir, ["merge-run", block, "--file", file], mode);
      assert.equal(done.code, 1, mode);
      assert.equal(done.stdout, "", mode);
      assert.deepEqual(done.stderr.trim().split("\n"), [UNCHECKED_REFUSAL, "nothing was written"], mode);
      assert.equal(readFileSync(file, "utf8"), before, mode);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("merge-run adds a run git could not check only when --allow-unchecked-commit is given, and says it was not checked", () => {
    const { dir, file, block } = scratch();
    const before = readFileSync(file, "utf8");
    for (const mode of ["missing-shallow", "apart-shallow", "no-repository"]) {
      writeFileSync(file, before);
      const done = run(dir, ["merge-run", block, "--allow-unchecked-commit", "--file", file], mode);
      assert.equal(done.code, 0, `${mode}: ${done.stderr}`);
      assert.deepEqual(done.stdout.trim().split("\n").slice(0, 2), [
        "note: git could not say whether 0123abc is on this branch, so the commit was not checked",
        `added run 43400000001 (2026-11-16, commit 0123abc) to ${file}`,
      ]);
      assert.equal(JSON.parse(readFileSync(file, "utf8")).regression.runs.length, 2);
    }
    // The flag is for a commit git could not check. It does not get a run past a plain no.
    for (const mode of ["no", "missing"]) {
      writeFileSync(file, before);
      const done = run(dir, ["merge-run", block, "--file", file, "--allow-unchecked-commit"], mode);
      assert.equal(done.code, 1, mode);
      assert.match(done.stderr, /^refused: run\.commit: 0123abc cannot be reached from the commit checked out here\./);
      assert.equal(readFileSync(file, "utf8"), before, mode);
    }
    // Where git can say yes, the flag changes nothing and no note is printed.
    const plain = run(dir, ["merge-run", block, "--file", file, "--allow-unchecked-commit"], "yes");
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(plain.stdout.split("\n")[0], `added run 43400000001 (2026-11-16, commit 0123abc) to ${file}`);

    // The same through the function, with a git that cannot answer at all.
    const noGit = () => ({ status: null, stdout: "" });
    writeFileSync(file, before);
    assert.deepEqual(mergeRunFile(block, file, noGit), { ok: false, lines: [UNCHECKED_REFUSAL, "nothing was written"] });
    assert.equal(readFileSync(file, "utf8"), before);
    const allowed = mergeRunFile(block, file, noGit, { allowUncheckedCommit: true });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.lines[0], "note: git could not say whether 0123abc is on this branch, so the commit was not checked");

    // The eval's notes and the command's own header say the same thing the command does.
    const notes = read("evals/README.md").replace(/\s+/g, " ");
    assert.ok(notes.includes("In a shallow clone git cannot tell, so the run is refused there too."), "evals/README.md says what a shallow clone does");
    assert.ok(notes.includes("`--allow-unchecked-commit` adds the run without that check"), "evals/README.md names the flag");
    assert.ok(read("scripts/results.mjs").includes("--allow-unchecked-commit"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("commitOnHead reads git's answers: yes, no, or unknown when git cannot say", () => {
    const git = (answers) => (args) => answers[`${args[0]} ${args[1]}`] ?? { status: 129, stdout: "" };
    const inside = { status: 0, stdout: "true\n" };
    const found = { status: 0, stdout: "0123abc0123abc0123abc0123abc0123abc0123a\n" };
    const asked = [];
    const yes = (args) => {
      asked.push(args);
      return git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": found, "merge-base --is-ancestor": { status: 0, stdout: "" } })(args);
    };
    assert.equal(commitOnHead("0123abc", yes), "yes");
    assert.deepEqual(asked[1], ["rev-parse", "--verify", "--quiet", "0123abc^{commit}"]);
    assert.deepEqual(asked[2], ["merge-base", "--is-ancestor", "0123abc0123abc0123abc0123abc0123abc0123a", "HEAD"]);
    const full = { status: 0, stdout: "false\n" };
    const shallow = { status: 0, stdout: "true\n" };
    const apart = { status: 1, stdout: "" };
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": found, "merge-base --is-ancestor": apart, "rev-parse --is-shallow-repository": full })), "no");
    // A shallow clone holds only part of the history, so "not under HEAD" there is not an answer.
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": found, "merge-base --is-ancestor": apart, "rev-parse --is-shallow-repository": shallow })), "unknown");
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": found, "merge-base --is-ancestor": apart })), "unknown");
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": found, "merge-base --is-ancestor": { status: 128, stdout: "" } })), "unknown");
    const missing = { status: 1, stdout: "" };
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": missing, "rev-parse --is-shallow-repository": { status: 0, stdout: "false\n" } })), "no");
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": missing, "rev-parse --is-shallow-repository": { status: 0, stdout: "true\n" } })), "unknown");
    assert.equal(commitOnHead("0123abc", git({ "rev-parse --is-inside-work-tree": inside, "rev-parse --verify": missing })), "unknown");
    assert.equal(commitOnHead("0123abc", () => ({ status: null, stdout: "" })), "unknown", "no git at all");
    assert.equal(commitOnHead("0123abc", git({})), "unknown", "not a repository");
  });

  it("mergeRunFile drops the oldest run after the first past the limit, and says which", () => {
    const { dir, file, block } = scratch();
    const full = seed();
    full.updated = dayAfter(400);
    for (let i = 1; i < MAX_REGRESSION_RUNS; i += 1) full.regression.runs.push(laterRun({ date: dayAfter(7 * i), run_id: 43400000000 + i }));
    writeFileSync(file, formatResults(full));
    writeFileSync(block, JSON.stringify(laterRun({ date: dayAfter(7 * 30), run_id: 43400000099 })));
    const done = mergeRunFile(block, file, () => ({ status: 0, stdout: "true\n" }));
    assert.equal(done.ok, true);
    assert.deepEqual(done.lines.slice(0, 3), [
      `added run 43400000099 (${dayAfter(7 * 30)}, commit 0123abc) to ${file}`,
      `dropped run 43400000001 (${dayAfter(7)}): the file keeps the first measured run and the 11 latest`,
      `the file now holds 12 of at most 12 runs, and its updated date is ${dayAfter(400)}`,
    ]);
    const kept = JSON.parse(readFileSync(file, "utf8")).regression.runs.map((r) => r.run_id);
    assert.equal(kept[0], 43354935479);
    assert.equal(kept.length, 12);
    rmSync(dir, { recursive: true, force: true });
  });

  it("an unreadable command line exits 2 with the usage line", () => {
    const { dir, file, block } = scratch();
    for (const args of [
      [],
      ["merge-run"],
      ["merge-run", block, block],
      ["check", "extra"],
      ["publish"],
      ["check", "--file"],
      ["check", "--force"],
      ["check", "--allow-unchecked-commit"],
      ["merge-run", block, "--allow-unchecked"],
    ]) {
      const done = run(dir, args.includes("--file") || args.length === 0 ? args : [...args, "--file", file]);
      assert.equal(done.code, 2, JSON.stringify(args));
      assert.equal(done.stderr, "usage: node scripts/results.mjs check [--file <path>] | merge-run <public-block.json> [--file <path>] [--allow-unchecked-commit]\n");
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
