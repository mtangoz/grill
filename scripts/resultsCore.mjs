/**
 * The public results file, data/results.json, and the checks that keep it counts-only.
 *
 * The file is committed and public, so its shape is closed. Every value in it is one of:
 * a whole number (0 or more), true or false, a date written YYYY-MM-DD, a commit hash of
 * 7 to 40 lowercase hex characters, or an id from one of the fixed lists below.
 * Nothing else gets in: no free text, no model names, no dollar amounts, no rates and no
 * p values. Rates and p values are worked out from the counts when a page is built, with
 * the helpers at the end of this file.
 *
 * An error names the path of the first problem. It never repeats a value it was given,
 * because a string that does not belong here could be someone's words. An unknown key is
 * named only when it is a plain name of 40 characters or fewer.
 *
 * This file is pure. It imports nothing, reads no file and makes no request.
 */

export const RESULTS_VERSION = 1;

/**
 * Judge companies a result may name. The ids are the router's own vendor prefixes.
 * A served model from any other vendor is counted under "other".
 */
export const JUDGE_COMPANY_IDS = Object.freeze([
  "openai",
  "anthropic",
  "google",
  "x-ai",
  "deepseek",
  "meta-llama",
  "mistralai",
  "moonshotai",
  "minimax",
  "qwen",
  "cohere",
  "amazon",
  "microsoft",
  "nvidia",
  "perplexity",
  "z-ai",
  "other",
]);

export const HOLDOUT_IDS = Object.freeze(["v1", "v2"]);
export const HOLDOUT_STATUSES = Object.freeze(["run", "not-run"]);
export const FOUR_ARM_STATUSES = Object.freeze(["draft", "registered", "measured"]);
export const FOUR_ARM_IDS = Object.freeze(["same-chat", "fresh-brief", "stronger-same-lab", "product"]);
export const ACCOUNT_LOOKBACK_STATUSES = Object.freeze(["not-counted", "counted"]);

/** A count taken from Grill accounts is not published while its denominator is under this. */
export const MIN_ACCOUNT_DENOMINATOR = 10;

/** The comparison before it has run. Every count that would be published is absent, not zero. */
export const EMPTY_FOUR_ARM = Object.freeze({
  status: "draft",
  arms: Object.freeze([]),
  comparisons: Object.freeze([]),
});

// Which company a served model belongs to.

/** Other spellings of a vendor prefix, mapped to the id in JUDGE_COMPANY_IDS. */
const COMPANY_ALIASES = new Map([
  ["xai", "x-ai"],
  ["meta", "meta-llama"],
  ["mistral", "mistralai"],
  ["moonshot", "moonshotai"],
  ["alibaba", "qwen"],
  ["zai", "z-ai"],
]);

/**
 * Anthropic under every spelling a router is known to use: the plain prefix, a bare
 * `claude-...` slug, and the dot-separated forms some hosts use. Kept as wide as the
 * check in judgeCore.mjs, so a Claude answer is never filed under another company.
 */
const ANTHROPIC_RX = /(^|[/.])anthropic([/.]|$)|(^|[/.])claude[-.\d]/;

/**
 * The company id for a router model slug such as `vendor/model-name`.
 * Always returns an id from JUDGE_COMPANY_IDS. Anything it cannot place is "other".
 */
export function companyIdOf(modelSlug) {
  if (typeof modelSlug !== "string") return "other";
  const slug = modelSlug.trim().toLowerCase().replace(/^[^a-z0-9]+/, "");
  if (slug === "") return "other";
  if (ANTHROPIC_RX.test(slug)) return "anthropic";
  const prefix = slug.split("/")[0];
  const id = COMPANY_ALIASES.get(prefix) ?? prefix;
  return JUDGE_COMPANY_IDS.includes(id) ? id : "other";
}

// Small checks. Each one throws with the path of the value it was given.

const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMMIT_RX = /^[0-9a-f]{7,40}$/;
const PLAIN_KEY_RX = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const MONEY_KEY_RX = /usd|dollar|cost|price|spend|cents|\$/i;

/** True for a real calendar day written YYYY-MM-DD. */
export function isIsoDate(value) {
  const m = typeof value === "string" ? DATE_RX.exec(value) : null;
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(year, month - 1, day));
  return t.getUTCFullYear() === year && t.getUTCMonth() === month - 1 && t.getUTCDate() === day;
}

/** True for 7 to 40 lowercase hex characters. */
export function isCommitHash(value) {
  return typeof value === "string" && COMMIT_RX.test(value);
}

function fail(path, message) {
  throw new Error(`${path}: ${message}`);
}

function at(path, key) {
  return path ? `${path}.${key}` : key;
}

/** What was found, in words that are safe to print. A string is never repeated. */
function seen(value) {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return "a string";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * An object with exactly these keys. An extra key throws, and so does a missing one.
 * `status` is named in the message when the keys allowed depend on it.
 */
function shape(value, path, keys, status = "") {
  if (!isRecord(value)) fail(path || "results", `expected an object, got ${seen(value)}`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) refuseKey(path, key, status);
  }
  for (const key of keys) {
    if (!has(value, key)) fail(at(path, key), "missing");
  }
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Refuse a key that does not belong. Its name is repeated only when it is a plain name. */
function refuseKey(path, key, status = "") {
  const where = at(path, PLAIN_KEY_RX.test(key) ? key : "(a key that is not a plain name)");
  if (MONEY_KEY_RX.test(key)) fail(where, "dollar amounts are never published in this file");
  fail(where, status ? `not allowed while status is ${status}` : "unknown key");
}

function count(value, path) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(path, `expected a whole number, 0 or more, got ${seen(value)}`);
  }
  return value;
}

function flag(value, path) {
  if (typeof value !== "boolean") fail(path, `expected true or false, got ${seen(value)}`);
  return value;
}

function isoDate(value, path) {
  if (!isIsoDate(value)) fail(path, `expected a date written YYYY-MM-DD, got ${seen(value)}`);
  return value;
}

function commitHash(value, path) {
  if (!isCommitHash(value)) fail(path, `expected a commit hash of 7 to 40 lowercase hex characters, got ${seen(value)}`);
  return value;
}

function oneOf(value, path, ids) {
  if (typeof value !== "string" || !ids.includes(value)) {
    fail(path, `expected one of ${ids.join(", ")}, got ${seen(value)}`);
  }
  return value;
}

function list(value, path, each) {
  if (!Array.isArray(value)) fail(path, `expected a list, got ${seen(value)}`);
  for (let i = 0; i < value.length; i += 1) each(value[i], `${path}[${i}]`);
  return value;
}

/**
 * `value`, found at `path`, may not be more than `limit`, which is described by `what`.
 * `lead` opens the message when the value is a sum and needs a few words of its own.
 */
function atMost(value, path, limit, what, lead = String(value)) {
  if (value > limit) fail(path, `${lead} is more than ${what} (${limit})`);
}

/** The status of a block whose other keys depend on it. */
function statusOf(block, path, statuses) {
  if (!isRecord(block)) fail(path, `expected an object, got ${seen(block)}`);
  if (!Object.prototype.hasOwnProperty.call(block, "status")) fail(at(path, "status"), "missing");
  return oneOf(block.status, at(path, "status"), statuses);
}

/** A part and its whole, such as {caught, of}. The part may not be more than the whole. */
function partOf(value, path, part) {
  shape(value, path, [part, "of"]);
  count(value[part], at(path, part));
  count(value.of, at(path, "of"));
  atMost(value[part], at(path, part), value.of, at(path, "of"));
}

function dateList(value, path) {
  list(value, path, isoDate);
  value.forEach((day, i) => {
    if (value.indexOf(day) !== i) fail(`${path}[${i}]`, "the same date is listed twice");
  });
}

// The blocks. Each validator returns the block it was given, or throws.

const RUN_KEYS = Object.freeze([
  "date",
  "run_id",
  "commit",
  "cases",
  "reached_judge",
  "flawed",
  "wrong_figure",
  "loaded",
  "sound",
  "schema_violations",
  "different_company",
  "quotes",
  "semantic",
  "by_company",
]);

/**
 * One run of the weekly regression check, as counts.
 *
 *   date, run_id (the Actions run), commit
 *   cases            how many cases the run held
 *   reached_judge    how many of them got an answer from a judge
 *   flawed           {caught, of}        plain flawed cases
 *   wrong_figure     {caught, of}        flawed cases with a wrong figure
 *   loaded           {caught, of}
 *   sound            {false_alarms, of}
 *   schema_violations {k, of}            cases whose answer broke the output rules
 *   different_company {k, of}            cases served outside the declared author's company
 *   quotes           {found, of}         quoted targets found in the write-up
 *   semantic         {caught, of}        planted flaw named, scored by the quality check
 *   by_company       [{company, cases}]  which company's model served each case
 */
export function validateRegressionRun(block, path = "run") {
  shape(block, path, RUN_KEYS);
  isoDate(block.date, at(path, "date"));
  if (count(block.run_id, at(path, "run_id")) === 0) fail(at(path, "run_id"), "expected the Actions run number, got 0");
  commitHash(block.commit, at(path, "commit"));
  count(block.cases, at(path, "cases"));
  count(block.reached_judge, at(path, "reached_judge"));
  atMost(block.reached_judge, at(path, "reached_judge"), block.cases, at(path, "cases"));

  partOf(block.flawed, at(path, "flawed"), "caught");
  partOf(block.wrong_figure, at(path, "wrong_figure"), "caught");
  partOf(block.loaded, at(path, "loaded"), "caught");
  partOf(block.sound, at(path, "sound"), "false_alarms");
  const scoredForCatch = block.flawed.of + block.wrong_figure.of + block.loaded.of;
  if (scoredForCatch + block.sound.of > block.cases) {
    fail(
      at(path, "cases"),
      `flawed, wrong_figure, loaded and sound add up to ${scoredForCatch + block.sound.of}, more than cases (${block.cases})`,
    );
  }

  const answered = block.flawed.caught + block.wrong_figure.caught + block.loaded.caught + (block.sound.of - block.sound.false_alarms);
  atMost(answered, at(path, "reached_judge"), block.reached_judge, at(path, "reached_judge"), `${answered} cases were caught or cleared, which`);
  partOf(block.schema_violations, at(path, "schema_violations"), "k");
  atMost(block.schema_violations.of, at(path, "schema_violations.of"), block.cases, at(path, "cases"));
  partOf(block.different_company, at(path, "different_company"), "k");
  atMost(block.different_company.of, at(path, "different_company.of"), block.cases, at(path, "cases"));
  atMost(block.different_company.k, at(path, "different_company.k"), block.reached_judge, at(path, "reached_judge"));
  partOf(block.quotes, at(path, "quotes"), "found");
  partOf(block.semantic, at(path, "semantic"), "caught");
  atMost(block.semantic.of, at(path, "semantic.of"), scoredForCatch, "the flawed, wrong_figure and loaded cases together");

  const companies = [];
  let served = 0;
  list(block.by_company, at(path, "by_company"), (row, rowPath) => {
    shape(row, rowPath, ["company", "cases"]);
    oneOf(row.company, at(rowPath, "company"), JUDGE_COMPANY_IDS);
    if (companies.includes(row.company)) fail(at(rowPath, "company"), "the same company is listed twice");
    companies.push(row.company);
    served += count(row.cases, at(rowPath, "cases"));
  });
  const lead = `the cases add up to ${served}, which`;
  atMost(served, at(path, "by_company"), block.reached_judge, at(path, "reached_judge"), lead);
  return block;
}

/**
 * One holdout comparison of a candidate rule.
 *
 *   not run:  {id, status: "not-run"}
 *   run:      {id, status: "run", date, decided, candidate_wins, rule_on}
 */
export function validateHoldout(block, path = "holdout") {
  const status = statusOf(block, path, HOLDOUT_STATUSES);
  if (status === "not-run") {
    shape(block, path, ["id", "status"], status);
    oneOf(block.id, at(path, "id"), HOLDOUT_IDS);
    return block;
  }
  shape(block, path, ["id", "status", "date", "decided", "candidate_wins", "rule_on"]);
  oneOf(block.id, at(path, "id"), HOLDOUT_IDS);
  isoDate(block.date, at(path, "date"));
  count(block.decided, at(path, "decided"));
  count(block.candidate_wins, at(path, "candidate_wins"));
  atMost(block.candidate_wins, at(path, "candidate_wins"), block.decided, at(path, "decided"));
  flag(block.rule_on, at(path, "rule_on"));
  return block;
}

const ARM_KEYS = Object.freeze(["arm", "caught", "flawed", "caught_usable", "usable_flawed", "alarms", "sound", "unusable"]);
const COMPARISON_CELLS = Object.freeze(["both", "first_only", "second_only", "neither"]);
const COMPARISON_KEYS = Object.freeze(["first", "second", ...COMPARISON_CELLS, ...COMPARISON_CELLS.map((cell) => `usable_${cell}`)]);

/**
 * The four-arm comparison.
 *
 *   draft or registered:  {status, arms: [], comparisons: []}   (EMPTY_FOUR_ARM is the draft)
 *   measured:             {status, date, commit, cases: {flawed, sound, loaded},
 *                          arms: [...], comparisons: [...], single_drafter}
 *
 * One arm: {arm, caught, flawed, caught_usable, usable_flawed, alarms, sound, unusable}.
 *   caught of flawed counts an unusable answer as a miss.
 *   caught_usable of usable_flawed counts usable answers only.
 *   alarms of sound is the alarm count on sound twins. unusable is that arm's unusable answers.
 * One comparison, on flawed cases: {first, second, both, first_only, second_only, neither,
 *   usable_both, usable_first_only, usable_second_only, usable_neither},
 *   where first and second are arm ids and the four cells count cases by which arm caught the flaw.
 *   The usable_ cells count the same thing on the cases where both arms gave a usable answer,
 *   so each is at most its plain cell.
 */
export function validateFourArm(block, path = "four_arm") {
  const status = statusOf(block, path, FOUR_ARM_STATUSES);
  if (status !== "measured") {
    shape(block, path, ["status", "arms", "comparisons"], status);
    for (const key of ["arms", "comparisons"]) {
      list(block[key], at(path, key), () => {});
      if (block[key].length > 0) fail(at(path, key), `must be empty while status is ${status}`);
    }
    return block;
  }

  shape(block, path, ["status", "date", "commit", "cases", "arms", "comparisons", "single_drafter"]);
  isoDate(block.date, at(path, "date"));
  commitHash(block.commit, at(path, "commit"));
  const casesPath = at(path, "cases");
  shape(block.cases, casesPath, ["flawed", "sound", "loaded"]);
  for (const key of ["flawed", "sound", "loaded"]) count(block.cases[key], at(casesPath, key));
  const allCases = block.cases.flawed + block.cases.sound + block.cases.loaded;

  const arms = new Map();
  list(block.arms, at(path, "arms"), (arm, armPath) => {
    shape(arm, armPath, ARM_KEYS);
    oneOf(arm.arm, at(armPath, "arm"), FOUR_ARM_IDS);
    if (arms.has(arm.arm)) fail(at(armPath, "arm"), "the same arm is listed twice");
    arms.set(arm.arm, arm);
    for (const key of ARM_KEYS.slice(1)) count(arm[key], at(armPath, key));
    atMost(arm.flawed, at(armPath, "flawed"), block.cases.flawed, at(casesPath, "flawed"));
    atMost(arm.caught, at(armPath, "caught"), arm.flawed, at(armPath, "flawed"));
    atMost(arm.usable_flawed, at(armPath, "usable_flawed"), arm.flawed, at(armPath, "flawed"));
    atMost(arm.caught_usable, at(armPath, "caught_usable"), arm.usable_flawed, at(armPath, "usable_flawed"));
    atMost(arm.caught_usable, at(armPath, "caught_usable"), arm.caught, at(armPath, "caught"));
    atMost(arm.sound, at(armPath, "sound"), block.cases.sound, at(casesPath, "sound"));
    atMost(arm.alarms, at(armPath, "alarms"), arm.sound, at(armPath, "sound"));
    atMost(arm.unusable, at(armPath, "unusable"), allCases, "all the cases");
    const noUsableAnswer = arm.flawed - arm.usable_flawed;
    const lead = `${noUsableAnswer} flawed cases had no usable answer, which`;
    atMost(noUsableAnswer, at(armPath, "unusable"), arm.unusable, "unusable", lead);
  });
  if (block.arms.length === 0) fail(at(path, "arms"), "a measured comparison needs at least one arm");

  const pairs = [];
  list(block.comparisons, at(path, "comparisons"), (pair, pairPath) => {
    shape(pair, pairPath, COMPARISON_KEYS);
    for (const side of ["first", "second"]) {
      oneOf(pair[side], at(pairPath, side), FOUR_ARM_IDS);
      if (!arms.has(pair[side])) fail(at(pairPath, side), "names an arm that is not in arms");
    }
    if (pair.first === pair.second) fail(at(pairPath, "second"), "an arm cannot be compared with itself");
    const name = [pair.first, pair.second].sort().join(" ");
    if (pairs.includes(name)) fail(pairPath, "the same two arms are compared twice");
    pairs.push(name);
    for (const key of COMPARISON_KEYS.slice(2)) count(pair[key], at(pairPath, key));
    const cells = pair.both + pair.first_only + pair.second_only + pair.neither;
    if (cells > block.cases.flawed) {
      fail(pairPath, `the four cells add up to ${cells}, more than ${at(casesPath, "flawed")} (${block.cases.flawed})`);
    }
    for (const cell of COMPARISON_CELLS) {
      atMost(pair[`usable_${cell}`], at(pairPath, `usable_${cell}`), pair[cell], at(pairPath, cell));
    }
    // An arm cannot have caught more cases inside a pair than it caught in all.
    for (const [side, only] of [
      ["first", "first_only"],
      ["second", "second_only"],
    ]) {
      const caught = pair.both + pair[only];
      const lead = `both and ${only} add up to ${caught}, which`;
      atMost(caught, at(pairPath, only), arms.get(pair[side]).caught, `what the ${side} arm caught`, lead);
    }
  });
  flag(block.single_drafter, at(path, "single_drafter"));
  return block;
}

/**
 * Look-backs saved on Grill accounts. A separate count from evidenced look-backs, never added to it.
 *
 *   not counted:  {status: "not-counted"}
 *   counted:      {status: "counted", as_of, cohort, done_14d, done_7d, people}
 */
export function validateAccountLookbacks(block, path = "account_lookbacks") {
  const status = statusOf(block, path, ACCOUNT_LOOKBACK_STATUSES);
  if (status === "not-counted") {
    shape(block, path, ["status"], status);
    return block;
  }
  shape(block, path, ["status", "as_of", "cohort", "done_14d", "done_7d", "people"]);
  isoDate(block.as_of, at(path, "as_of"));
  for (const key of ["cohort", "done_14d", "done_7d", "people"]) count(block[key], at(path, key));
  if (block.cohort < MIN_ACCOUNT_DENOMINATOR) {
    fail(at(path, "cohort"), `${block.cohort} is under ${MIN_ACCOUNT_DENOMINATOR}, so this count is not published yet`);
  }
  atMost(block.done_14d, at(path, "done_14d"), block.cohort, at(path, "cohort"));
  atMost(block.done_7d, at(path, "done_7d"), block.done_14d, at(path, "done_14d"));
  atMost(block.people, at(path, "people"), block.cohort, at(path, "cohort"));
  if (block.people === 0) fail(at(path, "people"), "a cohort of look-backs belongs to at least one person");
  return block;
}

const RESULTS_KEYS = Object.freeze([
  "version",
  "updated",
  "users",
  "regression",
  "holdouts",
  "four_arm",
  "signals",
  "account_lookbacks",
]);

/**
 * The most runs of the weekly check the file holds. The first measured run is history and
 * always stays. After it come the latest runs, up to this many in all. mergeRegressionRun
 * drops the oldest run after the first when one more would go past the limit, so the file
 * cannot grow without end. The page shows one run, the latest.
 */
export const MAX_REGRESSION_RUNS = 12;

/**
 * Every check on the whole file, in order, as functions that each throw on the first problem
 * they find. validateResults stops at the first one that throws. resultsProblems runs them
 * all. A part of the file is only looked into when the part around it has the right form, so
 * a check never trips over a problem an earlier check has already named.
 */
function* resultsChecks(json) {
  if (!isRecord(json)) {
    yield () => fail("results", `expected an object, got ${seen(json)}`);
    return;
  }
  for (const key of Object.keys(json)) {
    if (!RESULTS_KEYS.includes(key)) yield () => refuseKey("", key);
  }
  for (const key of RESULTS_KEYS) {
    if (!has(json, key)) yield () => fail(key, "missing");
  }
  const dated = [];

  if (has(json, "version")) {
    yield () => {
      if (json.version !== RESULTS_VERSION) fail("version", `expected ${RESULTS_VERSION}, got ${seen(json.version)}`);
    };
  }
  if (has(json, "updated")) yield () => isoDate(json.updated, "updated");

  if (has(json, "users")) {
    yield () => {
      shape(json.users, "users", ["real", "as_of", "evidenced_lookbacks"]);
      count(json.users.real, "users.real");
      dated.push(["users.as_of", isoDate(json.users.as_of, "users.as_of")]);
      count(json.users.evidenced_lookbacks, "users.evidenced_lookbacks");
    };
  }

  if (has(json, "regression")) {
    const regression = json.regression;
    yield () => shape(regression, "regression", ["runs", "not_measured", "skipped_green"]);
    if (isRecord(regression)) {
      if (has(regression, "runs")) {
        const runs = regression.runs;
        yield () => list(runs, "regression.runs", () => {});
        if (Array.isArray(runs)) {
          const runIds = [];
          for (let i = 0; i < runs.length; i += 1) {
            const runPath = `regression.runs[${i}]`;
            yield () => {
              validateRegressionRun(runs[i], runPath);
              if (runIds.includes(runs[i].run_id)) fail(at(runPath, "run_id"), "the same run is listed twice");
              runIds.push(runs[i].run_id);
              dated.push([at(runPath, "date"), runs[i].date]);
            };
          }
          yield () => {
            if (runs.length > MAX_REGRESSION_RUNS) {
              fail("regression.runs", `holds ${runs.length} runs, more than the ${MAX_REGRESSION_RUNS} this file keeps`);
            }
          };
        }
      }
      for (const key of ["not_measured", "skipped_green"]) {
        if (!has(regression, key)) continue;
        yield () => {
          dateList(regression[key], at("regression", key));
          regression[key].forEach((day, i) => dated.push([`regression.${key}[${i}]`, day]));
        };
      }
    }
  }

  if (has(json, "holdouts")) {
    const holdouts = json.holdouts;
    yield () => list(holdouts, "holdouts", () => {});
    if (Array.isArray(holdouts)) {
      const holdoutIds = [];
      for (let i = 0; i < holdouts.length; i += 1) {
        const holdoutPath = `holdouts[${i}]`;
        yield () => {
          const holdout = holdouts[i];
          validateHoldout(holdout, holdoutPath);
          if (holdoutIds.includes(holdout.id)) fail(at(holdoutPath, "id"), "the same holdout is listed twice");
          holdoutIds.push(holdout.id);
          if (holdout.status === "run") dated.push([at(holdoutPath, "date"), holdout.date]);
        };
      }
    }
  }

  if (has(json, "four_arm")) {
    yield () => {
      validateFourArm(json.four_arm, "four_arm");
      if (json.four_arm.status === "measured") dated.push(["four_arm.date", json.four_arm.date]);
    };
  }

  if (has(json, "signals")) {
    yield () => {
      shape(json.signals, "signals", ["rated", "resolved"]);
      count(json.signals.rated, "signals.rated");
      count(json.signals.resolved, "signals.resolved");
    };
  }

  if (has(json, "account_lookbacks")) {
    yield () => {
      validateAccountLookbacks(json.account_lookbacks, "account_lookbacks");
      if (json.account_lookbacks.status === "counted") dated.push(["account_lookbacks.as_of", json.account_lookbacks.as_of]);
    };
  }

  // Read last: by now every date that passed its own check is in the list.
  if (isIsoDate(json.updated)) {
    for (const [where, day] of dated) {
      yield () => {
        if (day > json.updated) fail(where, `${day} is after updated (${json.updated})`);
      };
    }
  }
}

/**
 * The whole file. Returns the object when it is valid, and throws an Error that names the
 * path of the first problem when it is not.
 */
export function validateResults(json) {
  for (const check of resultsChecks(json)) check();
  return json;
}

/**
 * Every problem in the whole file, as a list of messages in the form validateResults throws.
 * An empty list means the file is valid. Each run, each holdout and each other part is
 * checked on its own, so one bad run does not hide a second one. Inside one part, only its
 * first problem is named.
 */
export function resultsProblems(json) {
  const problems = [];
  for (const check of resultsChecks(json)) {
    try {
      check();
    } catch (err) {
      problems.push(err instanceof Error ? err.message : "results: could not be checked");
    }
  }
  return problems;
}

// Maths for the page that shows these counts. Nothing here rounds: the caller decides how to print.

/** The z value for a two-sided 95% interval. */
export const Z_95 = 1.959963984540054;

/** The exact tests below work in whole numbers. Past this many trials they refuse rather than take minutes. */
export const MAX_EXACT_TRIALS = 100000;

function wholeNumber(value, name) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number, 0 or more`);
  }
}

/** How many of the 2^n equally likely outcomes of n fair coin flips show at most m heads. Exact. */
function outcomesAtMost(n, m) {
  if (n > MAX_EXACT_TRIALS) throw new RangeError(`the exact test stops at ${MAX_EXACT_TRIALS} trials`);
  const trials = BigInt(n);
  let ways = 1n;
  let total = 1n;
  for (let k = 1n; k <= BigInt(m); k += 1n) {
    ways = (ways * (trials - k + 1n)) / k;
    total += ways;
  }
  return total;
}

/** A whole number divided by 2^bits, as the nearest double. */
function overPowerOfTwo(whole, bits) {
  if (whole === 0n) return 0;
  // 64 leading bits are more than a double holds, so dropping the rest loses nothing it could keep.
  const drop = Math.max(0, whole.toString(2).length - 64);
  let top = whole >> BigInt(drop);
  if (drop > 0 && top << BigInt(drop) !== whole) top |= 1n;
  const lead = Number(top);
  // Applied in two steps, so a very small power of two cannot underflow before it meets the lead.
  const exponent = drop - bits;
  const half = Math.trunc(exponent / 2);
  return lead * 2 ** half * 2 ** (exponent - half);
}

/**
 * One-sided sign test. The chance of `wins` or more out of `decided` when each decided pair
 * is a fair coin flip. Ties are left out by the caller: `decided` counts decided pairs only.
 */
export function signTestP(wins, decided) {
  wholeNumber(wins, "wins");
  wholeNumber(decided, "decided");
  if (wins > decided) throw new RangeError("wins cannot be more than decided");
  // By symmetry, `wins` or more heads is as likely as `decided - wins` or fewer.
  return overPowerOfTwo(outcomesAtMost(decided, decided - wins), decided);
}

/**
 * Exact McNemar test, two-sided. `firstOnly` and `secondOnly` are the two discordant cells:
 * cases only the first arm caught, and cases only the second arm caught. Twice the smaller
 * tail of a fair coin over the discordant pairs, capped at 1. With no discordant pair it is 1.
 */
export function mcnemarExactP(firstOnly, secondOnly) {
  wholeNumber(firstOnly, "firstOnly");
  wholeNumber(secondOnly, "secondOnly");
  const discordant = firstOnly + secondOnly;
  if (discordant === 0) return 1;
  const smallerTail = outcomesAtMost(discordant, Math.min(firstOnly, secondOnly));
  return Math.min(1, overPowerOfTwo(smallerTail, discordant - 1));
}

/**
 * Wilson score interval for k of n, as {low, high} between 0 and 1. 95% unless z is given.
 * With n of 0 nothing is known, so the interval is the whole range.
 */
export function wilsonInterval(k, n, z = Z_95) {
  wholeNumber(k, "k");
  wholeNumber(n, "n");
  if (k > n) throw new RangeError("k cannot be more than n");
  if (typeof z !== "number" || !Number.isFinite(z) || z <= 0) throw new RangeError("z must be a number above 0");
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const z2 = z * z;
  const scale = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / scale;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / scale;
  return {
    low: k === 0 ? 0 : Math.max(0, centre - half),
    high: k === n ? 1 : Math.min(1, centre + half),
  };
}

// Writing the file, and adding one run to it.

function isLeaf(value) {
  return value === null || typeof value !== "object";
}

/**
 * One value as JSON text in the layout data/results.json is kept in: two spaces a level, a
 * list of plain values on one line, and a small object of one or two plain values on one
 * line when it sits inside a run or a list. Everything else is one key or item a line.
 */
function layout(value, depth) {
  if (isLeaf(value)) return JSON.stringify(value);
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isLeaf)) return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    return `[\n${value.map((item) => `${pad}${layout(item, depth + 1)}`).join(",\n")}\n${close}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  if (depth >= 2 && keys.length <= 2 && keys.every((key) => isLeaf(value[key]))) {
    return `{ ${keys.map((key) => `${JSON.stringify(key)}: ${JSON.stringify(value[key])}`).join(", ")} }`;
  }
  return `{\n${keys.map((key) => `${pad}${JSON.stringify(key)}: ${layout(value[key], depth + 1)}`).join(",\n")}\n${close}}`;
}

/**
 * The text of data/results.json for this object, ending in one newline. The object is
 * checked first, and so is the text, read back, before it is returned: what is checked is
 * what would be written.
 */
export function formatResults(json) {
  validateResults(json);
  const text = `${layout(json, 0)}\n`;
  validateResults(JSON.parse(text));
  return text;
}

/**
 * The file with one more run of the weekly check in it. Nothing is changed in place: the
 * result is a new object, already checked as a whole.
 *
 * Refused: a block that is not a valid run, a run whose run number is already in the file,
 * a run dated before the first measured run, and a run too old to be one of the runs kept.
 * Runs are kept in date order. `updated` moves forward to the run's date when that is later.
 * The file holds at most MAX_REGRESSION_RUNS runs: the first measured run always stays, and
 * past the limit the oldest run after it is dropped.
 */
export function mergeRegressionRun(json, block) {
  validateResults(json);
  validateRegressionRun(block, "run");
  const before = json.regression.runs;
  if (before.some((run) => run.run_id === block.run_id)) {
    fail("run.run_id", `run ${block.run_id} is already in the file`);
  }
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const added = copy(block);
  const runs = [...before.map(copy), added].sort((a, b) => (a.date === b.date ? a.run_id - b.run_id : a.date < b.date ? -1 : 1));
  if (before.length > 0 && runs[0] === added) {
    fail("run.date", `${block.date} is before the first measured run in the file, which stays first`);
  }
  while (runs.length > MAX_REGRESSION_RUNS) runs.splice(1, 1);
  if (!runs.includes(added)) {
    fail("run.date", `${block.date} is older than the ${MAX_REGRESSION_RUNS - 1} latest runs the file keeps after the first`);
  }
  const next = copy(json);
  next.regression.runs = runs;
  if (block.date > next.updated) next.updated = block.date;
  return validateResults(next);
}

// The page. Everything below turns the checked counts into the HTML that /how-we-test/ shows.
// A rate or a chance figure is worked out here, from the counts, and is never stored.

/** A rate is shown only when this many cases or more are behind it. Under that, the count alone. */
export const MIN_RATE_DENOMINATOR = 10;

/** The one marker in site/how-we-test.html that the rendered results take the place of. */
export const RESULTS_MARKER = "<!-- RESULTS -->";

const SOURCE_URL = "https://github.com/mtangoz/grill";

/**
 * The plain name of each company id in JUDGE_COMPANY_IDS. These are company names. A model
 * name is never shown, and the file holds none.
 */
export const COMPANY_NAMES = Object.freeze({
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "x-ai": "xAI",
  deepseek: "DeepSeek",
  "meta-llama": "Meta",
  mistralai: "Mistral AI",
  moonshotai: "Moonshot AI",
  minimax: "MiniMax",
  qwen: "Alibaba",
  cohere: "Cohere",
  amazon: "Amazon",
  microsoft: "Microsoft",
  nvidia: "Nvidia",
  perplexity: "Perplexity",
  "z-ai": "Z.ai",
  other: "other companies",
});

/** Each arm of the comparison in plain words: a short name, and one sentence on what it is. */
export const ARM_WORDS = Object.freeze({
  "same-chat": Object.freeze({
    name: "The same chat",
    what: "The model that wrote the plan is asked, in the same chat, to argue the other side.",
  }),
  "fresh-brief": Object.freeze({
    name: "The same model, starting fresh",
    what: "The same model gets the plan in a new chat, with the instructions Grill gives its judge.",
  }),
  "stronger-same-lab": Object.freeze({
    name: "A stronger model from the same company",
    what: "A stronger model from the company that wrote the plan gets it with those same instructions.",
  }),
  product: Object.freeze({
    name: "Grill as shipped",
    what: "The router picks the judge, and the company that wrote the plan is left out.",
  }),
});

const HTML_ESCAPES = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });

/** A value made safe to place in HTML text or inside a quoted attribute. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const MONTHS = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

/** A date from the file, YYYY-MM-DD, as a day a person reads: 13 November 2026. Escaped. */
function dayWords(iso) {
  if (!isIsoDate(iso)) throw new RangeError("a date on the page must be written YYYY-MM-DD");
  const [year, month, date] = iso.split("-").map(Number);
  return escapeHtml(`${date} ${MONTHS[month - 1]} ${year}`);
}

/** A whole number from the file, escaped like every other value. */
function num(value) {
  wholeNumber(value, "a count on the page");
  return escapeHtml(value);
}

/** Words joined as a list a person reads: "a", "a and b", "a, b and c". */
function listWords(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function link(href, text) {
  return `<a href="${escapeHtml(href)}">${text}</a>`;
}

function note(html) {
  return `<p class="note">${html}</p>`;
}

function steps(items) {
  return `<ul class="steps">\n${items.map((item) => `  <li>${item}</li>`).join("\n")}\n</ul>`;
}

/** "k of n", the form every count takes. */
export function countWords(k, n) {
  wholeNumber(k, "k");
  wholeNumber(n, "n");
  if (k > n) throw new RangeError("k cannot be more than n");
  return `${num(k)} of ${num(n)}`;
}

/**
 * A share out of 100, such as "79 in 100", worked out from the counts. It refuses a
 * denominator under MIN_RATE_DENOMINATOR: with that few cases a rate reads as more than it is.
 */
export function rateWords(k, n) {
  wholeNumber(k, "k");
  wholeNumber(n, "n");
  if (k > n) throw new RangeError("k cannot be more than n");
  if (n < MIN_RATE_DENOMINATOR) {
    throw new RangeError(`no rate is shown for fewer than ${MIN_RATE_DENOMINATOR} cases`);
  }
  return `${num(Math.round((100 * k) / n))} in 100`;
}

/**
 * A count with its rate when there are enough cases for one: "95 of 120 (79 in 100)".
 * Under MIN_RATE_DENOMINATOR it is the count alone: "2 of 6". With `range`, the 95% Wilson
 * interval is added in plain words: "95 of 120 (79 in 100, likely range 71 to 85)".
 */
export function shareWords(k, n, { range = false } = {}) {
  const counted = countWords(k, n);
  if (n < MIN_RATE_DENOMINATOR) return counted;
  if (!range) return `${counted} (${rateWords(k, n)})`;
  const { low, high } = wilsonInterval(k, n);
  return `${counted} (${rateWords(k, n)}, likely range ${num(Math.round(100 * low))} to ${num(Math.round(100 * high))})`;
}

/** How often a fair coin would do this well or better, in plain words, from a p value. */
function chanceWords(p) {
  const times = Math.round(100 * p);
  if (times < 1) return "less than 1 time in 100";
  if (times > 99) return "more than 99 times in 100";
  return `about ${num(times)} times in 100`;
}

/** The latest run that measured, or null when the file holds none. */
export function latestRun(json) {
  const runs = json.regression.runs;
  if (runs.length === 0) return null;
  return runs.reduce((latest, run) => (run.date > latest.date || (run.date === latest.date && run.run_id > latest.run_id) ? run : latest));
}

/** The weekly regression check: one run as counts, and the weeks that measured nothing. */
export function renderRegression(json) {
  validateResults(json);
  const out = ["<h2>A weekly regression check, not a measure of quality</h2>"];
  out.push(
    note(
      "Grill's weekly check runs its judge on a public set of made-up cases. Some hold a planted flaw, some ask a loaded question, and some are sound plans. The check can show the judge going quiet or breaking its output rules. It cannot rank one critic against another.",
    ),
  );
  const run = latestRun(json);
  if (!run) {
    out.push(note("No run of this check has measured yet, so there are no counts to show."));
  } else {
    const cases = num(run.cases);
    const reached =
      run.reached_judge === run.cases
        ? `All ${cases} cases reached a judge.`
        : `Only ${countWords(run.reached_judge, run.cases)} cases reached a judge. A case with no answer counts as a miss, or as a false alarm on a sound plan.`;
    out.push(
      note(
        `One run is shown, the latest that measured: ${dayWords(run.date)}, commit ${link(`${SOURCE_URL}/commit/${run.commit}`, escapeHtml(run.commit))}, ${link(`${SOURCE_URL}/actions/runs/${run.run_id}`, `Actions run ${num(run.run_id)}`)}. ${reached}`,
      ),
    );

    const flawedCaught = run.flawed.caught + run.wrong_figure.caught;
    const flawedOf = run.flawed.of + run.wrong_figure.of;
    const full = flawedCaught === flawedOf && run.loaded.caught === run.loaded.of;
    const items = [
      `<strong>Caught.</strong> The judge caught ${countWords(flawedCaught, flawedOf)} flawed plans and ${countWords(run.loaded.caught, run.loaded.of)} loaded questions, but these ${cases} cases were used to write the judge's instructions, so ${full ? "a full score" : "this score"} says nothing about how good the judge is.`,
      `<strong>False alarms.</strong> ${countWords(run.sound.false_alarms, run.sound.of)} sound plans got a false alarm.${run.sound.of < MIN_RATE_DENOMINATOR ? " That is too few plans to say what the real rate is." : ""}`,
    ];
    if (run.quotes.of > 0) {
      items.push(
        `<strong>Quotes not found.</strong> ${countWords(run.quotes.of - run.quotes.found, run.quotes.of)} quotes the judge gave were not found in the write-up they were quoted from.`,
      );
    }
    items.push(`<strong>Output rules.</strong> ${countWords(run.schema_violations.k, run.schema_violations.of)} answers broke the output rules.`);
    if (run.semantic.of > 0) {
      items.push(
        `<strong>A second reading.</strong> A separate quality check read the judge's answers and found the planted flaw named in ${countWords(run.semantic.caught, run.semantic.of)} cases. These are the same cases, so this says nothing about how good the judge is either.`,
      );
    }
    items.push(
      `<strong>Routing.</strong> The judge came from a different company than the declared author in ${countWords(run.different_company.k, run.different_company.of)} cases. That is a routing check. It is not a measure of whether the two make different mistakes. This check names no author, so the default applies and the author is taken to be Anthropic.`,
    );
    if (run.by_company.length > 0) {
      const rows = run.by_company.map((row) => `${escapeHtml(COMPANY_NAMES[row.company])} ${num(row.cases)}`);
      items.push(`<strong>Judge companies.</strong> The router picked the judge for each case. Cases by the company whose model answered: ${rows.join(", ")}.`);
    }
    out.push(steps(items));
  }

  const failed = json.regression.not_measured.map(dayWords);
  const skipped = json.regression.skipped_green.map(dayWords);
  const quiet = [];
  if (failed.length > 0) {
    quiet.push(`The weekly ${failed.length === 1 ? "run" : "runs"} on ${listWords(failed)} failed as not measured.`);
  }
  if (skipped.length > 0) {
    quiet.push(
      `The ${skipped.length === 1 ? "run" : "runs"} on ${listWords(skipped)} passed while skipping every case, so a pass on ${skipped.length === 1 ? "that day" : "those days"} measured nothing.`,
    );
  }
  if (quiet.length > 0) out.push(note(`<strong>Weeks that measured nothing.</strong> ${quiet.join(" ")}`));
  return out.join("\n");
}

/** The held-out check of one candidate rule: what it compared, and each version's counts. */
export function renderHoldouts(json) {
  validateResults(json);
  const out = ["<h2>A held-out check of one candidate rule</h2>"];
  out.push(
    note(
      "It compared two judges on the same decisions: one with today's instructions, and one with the same instructions plus one candidate rule. A rater who could not see which was which said which answer would change what you do next.",
    ),
  );
  if (json.holdouts.length === 0) {
    out.push(note("No version of this check has been run."));
    return out.join("\n");
  }
  const items = json.holdouts.map((holdout) => {
    const name = `<strong>Version ${escapeHtml(holdout.id.replace(/^v/, ""))}.</strong>`;
    if (holdout.status !== "run") return `${name} Not run.`;
    const chance =
      holdout.decided >= MIN_RATE_DENOMINATOR
        ? ` If the two were equally good, the candidate would win that often or more ${chanceWords(signTestP(holdout.candidate_wins, holdout.decided))}.`
        : "";
    return `${name} Run on ${dayWords(holdout.date)}. Of ${num(holdout.decided)} decided pairs, the candidate rule won ${num(holdout.candidate_wins)}.${chance} ${holdout.rule_on ? "The rule was turned on." : "The rule stayed off."}`;
  });
  out.push(steps(items));
  return out.join("\n");
}

/** One arm's counts in the measured comparison, both ways of counting. */
function armItem(arm) {
  const words = ARM_WORDS[arm.arm];
  const parts = [
    `<strong>${escapeHtml(words.name)}.</strong> Planted flaws caught, counting an unusable answer as a miss: ${shareWords(arm.caught, arm.flawed, { range: true })}.`,
    `On usable answers only: ${shareWords(arm.caught_usable, arm.usable_flawed, { range: true })}.`,
    `Alarms on sound plans: ${shareWords(arm.alarms, arm.sound, { range: true })}.`,
    `Unusable answers: ${num(arm.unusable)}.`,
  ];
  if (arm.arm === "same-chat") parts.push("This one is told to argue, so its alarms are shown and not compared.");
  return parts.join(" ");
}

/** One pair of arms in the measured comparison: the four cells, both ways of counting. */
function comparisonItem(pair) {
  const first = ARM_WORDS[pair.first].name;
  const second = ARM_WORDS[pair.second].name;
  // The second name sits mid-sentence, so its first letter is lower case unless it is the product's name.
  const secondWords = second.startsWith("Grill") ? second : `${second[0].toLowerCase()}${second.slice(1)}`;
  const cells = (prefix) =>
    `both caught it in ${num(pair[`${prefix}both`])} cases, only the first in ${num(pair[`${prefix}first_only`])}, only the second in ${num(pair[`${prefix}second_only`])}, neither in ${num(pair[`${prefix}neither`])}`;
  return `<strong>${escapeHtml(first)} against ${escapeHtml(secondWords)}.</strong> Counting an unusable answer as a miss: ${cells("")}. On cases where both gave a usable answer: ${cells("usable_")}.`;
}

/**
 * The comparison. While it is a draft or registered, this block holds no number at all:
 * there is no result, so there is nothing to count. Once measured it shows counts, both
 * ways of counting, and a rate only where MIN_RATE_DENOMINATOR cases or more are behind it.
 */
export function renderFourArm(json) {
  validateResults(json);
  const block = json.four_arm;
  const protocol = link(`${SOURCE_URL}/blob/main/evals/four-arm/README.md`, block.status === "draft" ? "the draft protocol" : "the protocol");
  const out = ["<h2>The comparison with the same model starting fresh</h2>"];
  const arms = steps(FOUR_ARM_IDS.map((id) => `<strong>${escapeHtml(ARM_WORDS[id].name)}.</strong> ${escapeHtml(ARM_WORDS[id].what)}`));

  if (block.status !== "measured") {
    const status =
      block.status === "draft"
        ? "<strong>Draft protocol, not run.</strong> Grill has written a plan for one measurement and has not run it. Any part of the plan can still change."
        : "<strong>Registered protocol, not run.</strong> The plan for this measurement is fixed and it has not been run.";
    out.push(
      note(
        `${status} It would give the same made-up write-ups to four ways of getting the case against a plan, and count how many planted flaws each one catches:`,
      ),
    );
    out.push(arms);
    out.push(
      note(
        `The main question is whether Grill as shipped catches more planted flaws than the same model starting fresh. The result will be published here whichever way it falls. Read ${protocol}.`,
      ),
    );
    return out.join("\n");
  }

  out.push(
    note(
      `<strong>Measured.</strong> The comparison ran on ${dayWords(block.date)}, at commit ${link(`${SOURCE_URL}/commit/${block.commit}`, escapeHtml(block.commit))}, on ${num(block.cases.flawed)} flawed plans, ${num(block.cases.sound)} sound plans and ${num(block.cases.loaded)} loaded questions. Every case is made up. It gave the same write-ups to these ways of getting the case against a plan:`,
    ),
  );
  out.push(arms);
  out.push(
    note(
      `What follows is counts. Where ${num(MIN_RATE_DENOMINATOR)} cases or more are behind a count, its share out of 100 is shown, with the range the true share is likely to sit in. Under ${num(MIN_RATE_DENOMINATOR)}, the count is shown alone. This page does not say which one did best: ${protocol} sets out how the result is read.`,
    ),
  );
  out.push(steps(FOUR_ARM_IDS.filter((id) => block.arms.some((arm) => arm.arm === id)).map((id) => armItem(block.arms.find((arm) => arm.arm === id)))));
  if (block.comparisons.length > 0) {
    out.push(note("Pair by pair, on the flawed plans, the number of cases where each one caught the planted flaw:"));
    out.push(steps(block.comparisons.map(comparisonItem)));
  }
  if (block.single_drafter) {
    out.push(
      note(
        "More than half of the cases were drafted by one model family. Under the protocol, a result from such a set can remove a claim about quality. It cannot support one.",
      ),
    );
  }
  return out.join("\n");
}

/** People: real users, the two look-back counts under their two names, and signals. */
export function renderPeople(json) {
  validateResults(json);
  const strategy = link(`${SOURCE_URL}/blob/main/docs/STRATEGY.md`, "Grill's strategy notes");
  const principles = link(`${SOURCE_URL}/blob/main/docs/PRINCIPLES.md#north-star`, "Grill's principles");
  const saved = json.account_lookbacks;
  const savedWords =
    saved.status === "counted"
      ? `As of ${dayWords(saved.as_of)}, ${num(saved.cohort)} look-backs had come due, from ${num(saved.people)} ${saved.people === 1 ? "person" : "people"}. ${shareWords(saved.done_14d, saved.cohort)} were done within 14 days, and ${shareWords(saved.done_7d, saved.cohort)} within 7 days.`
      : "Not counted yet.";
  const items = [
    `<strong>Real users.</strong> ${num(json.users.real)}, as of ${dayWords(json.users.as_of)}. What counts as a real user is set out in ${strategy}.`,
    `<strong>Evidenced look-backs.</strong> ${num(json.users.evidenced_lookbacks)}, as of the same day. What counts as one is set out in ${principles}.`,
    `<strong>Look-backs saved on Grill accounts.</strong> ${savedWords} This is a separate count from evidenced look-backs, and the two are never added together.`,
    `<strong>Signals.</strong> ${num(json.signals.rated)} rated, ${num(json.signals.resolved)} resolved. A signal is a short report a person chooses to send through a public form: a rating of one grill, or whether a call came true.`,
  ];
  return ["<h2>People</h2>", steps(items), note(`The counts on this page were last updated on ${dayWords(json.updated)}.`)].join("\n");
}

/**
 * The HTML that takes the place of RESULTS_MARKER in site/how-we-test.html. The file is
 * checked first, so a file that is not valid is never rendered. Every value from the file is
 * escaped. No model name, no dollar amount and no case text can be shown, because the file
 * holds none.
 */
export function renderResults(json) {
  validateResults(json);
  return [renderFourArm(json), renderRegression(json), renderHoldouts(json), renderPeople(json)].join("\n\n");
}

/**
 * The page source with its one marker replaced by the rendered results. Throws when the
 * marker is not there exactly once, and when the file is not valid.
 */
export function withRenderedResults(source, json) {
  if (typeof source !== "string" || source.split(RESULTS_MARKER).length !== 2) {
    throw new Error(`site/how-we-test.html must include ${RESULTS_MARKER} once`);
  }
  const html = renderResults(json);
  return source.replace(RESULTS_MARKER, () => html);
}
