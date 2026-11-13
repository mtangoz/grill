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
    if (keys.includes(key)) continue;
    const where = at(path, PLAIN_KEY_RX.test(key) ? key : "(a key that is not a plain name)");
    if (MONEY_KEY_RX.test(key)) fail(where, "dollar amounts are never published in this file");
    fail(where, status ? `not allowed while status is ${status}` : "unknown key");
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail(at(path, key), "missing");
  }
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
 * The whole file. Returns the object when it is valid, and throws an Error that names the
 * path of the first problem when it is not.
 */
export function validateResults(json) {
  shape(json, "", RESULTS_KEYS);
  if (json.version !== RESULTS_VERSION) fail("version", `expected ${RESULTS_VERSION}, got ${seen(json.version)}`);
  isoDate(json.updated, "updated");
  const dated = [];

  shape(json.users, "users", ["real", "as_of", "evidenced_lookbacks"]);
  count(json.users.real, "users.real");
  dated.push(["users.as_of", isoDate(json.users.as_of, "users.as_of")]);
  count(json.users.evidenced_lookbacks, "users.evidenced_lookbacks");

  shape(json.regression, "regression", ["runs", "not_measured", "skipped_green"]);
  const runIds = [];
  list(json.regression.runs, "regression.runs", (run, runPath) => {
    validateRegressionRun(run, runPath);
    if (runIds.includes(run.run_id)) fail(at(runPath, "run_id"), "the same run is listed twice");
    runIds.push(run.run_id);
    dated.push([at(runPath, "date"), run.date]);
  });
  for (const key of ["not_measured", "skipped_green"]) {
    dateList(json.regression[key], at("regression", key));
    json.regression[key].forEach((day, i) => dated.push([`regression.${key}[${i}]`, day]));
  }

  const holdoutIds = [];
  list(json.holdouts, "holdouts", (holdout, holdoutPath) => {
    validateHoldout(holdout, holdoutPath);
    if (holdoutIds.includes(holdout.id)) fail(at(holdoutPath, "id"), "the same holdout is listed twice");
    holdoutIds.push(holdout.id);
    if (holdout.status === "run") dated.push([at(holdoutPath, "date"), holdout.date]);
  });

  validateFourArm(json.four_arm, "four_arm");
  if (json.four_arm.status === "measured") dated.push(["four_arm.date", json.four_arm.date]);

  shape(json.signals, "signals", ["rated", "resolved"]);
  count(json.signals.rated, "signals.rated");
  count(json.signals.resolved, "signals.resolved");

  validateAccountLookbacks(json.account_lookbacks, "account_lookbacks");
  if (json.account_lookbacks.status === "counted") dated.push(["account_lookbacks.as_of", json.account_lookbacks.as_of]);

  for (const [where, day] of dated) {
    if (day > json.updated) fail(where, `${day} is after updated (${json.updated})`);
  }
  return json;
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
