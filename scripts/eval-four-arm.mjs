#!/usr/bin/env node
/**
 * eval-four-arm.mjs: the four-arm comparison, CLI half.
 *
 * The protocol is evals/four-arm/README.md. Read it first. This script is not part of
 * npm test and must not be added to CI: a full run is paid for and is run once.
 *
 * SUBCOMMANDS
 *   validate-seeds <file>   Check a seed file. Prints counts by kind, category, flaw type and
 *                           split, the frozen checksum, the lines the README must carry, and
 *                           every problem. Exits 1 when there is a problem. Needs no key.
 *       --print-checksum    print only the frozen checksum (for seeds.sha256)
 *   assign-authors <file>   Print the seeds with an author family on each. --write saves them.
 *   preflight               Say what a run would use and what is still missing. Calls no model.
 *   author                  The author model writes each write-up once. Then, for each flawed
 *                           case, graders set two flags before any arm runs.
 *   run                     Run arms A, B, C and D on every analysed case.
 *   score                   Graders answer one blinded yes or no question per answer, and the
 *                           sheet of blinded items for the owner is written.
 *   report                  No model call. Counts, tests, the decision, and the public block.
 *                           On the frozen split it checks the registration and the seeds
 *                           again, and stops if either changed after the run.
 *       --owner-labels <f>  the owner's replies to the audit sheet ("1: yes", one per line)
 *       --results <path>    also write the block into that results file's four_arm key
 *
 * OPTIONS (author, run, score, report)
 *   --split dev|frozen      default dev. The frozen split runs only once the protocol is registered.
 *   --seeds <file>          default evals/four-arm/seeds.jsonl
 *   --arms <file>           default evals/four-arm/arms.json
 *   --checksum <file>       default evals/four-arm/seeds.sha256
 *   --out <dir>             default evals/results/four-arm/<split> (ignored by git)
 *   --concurrency <n>       default 3
 *   --resume                fill in what a stopped step left undone; never redo what is there
 *   --require-key           with no router key, exit 2 and say nothing was measured. Always
 *                           on for author, run and score on the frozen split.
 *   --audit-all             (score) put every graded item on the owner's sheet, not only 40
 *
 * ENVIRONMENT
 *   GRILL_API_KEY or OPENROUTER_API_KEY, or the key file: same as judge.mjs. The key is
 *   never printed.
 *   JUDGE_OPENROUTER_URL   loopback only, for this project's tests. A run against it is a
 *                          rehearsal and cannot be written into the committed results file.
 *   JUDGE_MODEL, JUDGE_FIXTURE, JUDGE_CHECK and GRILL_JUDGE_COMMIT are removed from every
 *   judge child, whatever is set here.
 *
 * WITH NO KEY, author, run and score on the dev split print "SKIPPED: no arm ran" and exit 0,
 * and report no score. With --require-key they exit 2 and print "Not measured". On the
 * frozen split they always do: a frozen step never ends green on a skip.
 *
 * NOT MEASURED IS HELD AT EVERY STEP. Fewer than 9 in 10 usable write-ups stops the author
 * step, and run, score and report each check it again, so a run that fell under the floor
 * cannot carry on to a result, whether or not the shell stops on the first exit 2.
 *
 * RAW ROWS (under --out, ignored by git): answers.jsonl keeps what each arm returned before
 * blinding. For arm A that is the reply, in `raw`. For arms B, C and D it is the whole
 * result judge.mjs printed, in `judge`. `critique` is the blinded text the graders read.
 *
 * EXIT CODES
 *   0   the step finished, or a dev step was skipped for lack of a key without --require-key
 *   1   a problem with the seeds, the arms file, the registration or the arguments
 *   2   Not measured: no key on the frozen split or under --require-key, too few usable
 *       write-ups, too few usable answers, the grader check was not passed, or D minus B
 *       is missing for an author family. No score is printed and no results file is changed.
 */

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveApiKey } from "./apiKey.mjs";
import {
  ARMS,
  ARM_MAX_REQUESTS,
  ARM_NAMES,
  AUDIT_AGREE_FLOOR,
  AUDIT_ITEMS,
  AUTHOR_FAMILIES,
  GRADER_VOTES,
  ID_CONFIRMED,
  MIN_ANALYSED_FLAWED,
  SEED_KEYS,
  SPLIT_MISSING_REASON,
  USABLE_FLOOR,
  analysedCases,
  armAMessages,
  armAUsable,
  armEnv,
  armValid,
  armsModelIds,
  armsModelsChecksum,
  armsProblems,
  assignAuthors,
  auditSample,
  authorMessages,
  blind,
  buildAlarmPrompt,
  buildCatchPrompt,
  buildFlagPrompt,
  buildItems,
  chatRequestBody,
  chatText,
  countWords,
  critiqueFromJudge,
  critiqueFromProse,
  eligibleGraders,
  graderRequestBody,
  itemUsable,
  judgeArgs,
  judgePromptFingerprint,
  judgeUsable,
  majority,
  medianInt,
  mergeFourArmIntoResultsText,
  parseFlagReply,
  parseGradeReply,
  parseOwnerLabels,
  parseSeedsJsonl,
  productChainUntouched,
  registrationProblems,
  renderPlumbing,
  renderReport,
  renderSeedCounts,
  seedCounts,
  seedProblems,
  seedsChecksum,
  sha256,
  singleDrafter,
  summarize,
  writeUpFloorMet,
  writeUpUsable,
} from "./fourArmCore.mjs";
import { companyIdOf, isCommitHash, isIsoDate } from "./resultsCore.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const JUDGE_CLI = join(HERE, "judge.mjs");
const DEFAULT_SEEDS = join(REPO_ROOT, "evals", "four-arm", "seeds.jsonl");
const DEFAULT_ARMS = join(REPO_ROOT, "evals", "four-arm", "arms.json");
const DEFAULT_CHECKSUM = join(REPO_ROOT, "evals", "four-arm", "seeds.sha256");
const DEFAULT_OUT = join(REPO_ROOT, "evals", "results", "four-arm");
const COMMITTED_RESULTS = join(REPO_ROOT, "data", "results.json");

const OPENROUTER_DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const COMMANDS = ["validate-seeds", "assign-authors", "preflight", "author", "run", "score", "report"];
/** The steps that call a model. On the frozen split these are never skipped for lack of a key. */
const MODEL_STEPS = ["author", "run", "score"];

function fail(message, code = 1) {
  console.error(`[four-arm] ERROR: ${message}`);
  process.exit(code);
}

function note(message) {
  console.error(`[four-arm] ${message}`);
}

// == Arguments ================================================================
function parseArgs(argv) {
  const opts = {
    command: argv[0] ?? "",
    file: "",
    split: "dev",
    seeds: DEFAULT_SEEDS,
    arms: DEFAULT_ARMS,
    checksum: DEFAULT_CHECKSUM,
    out: "",
    concurrency: 3,
    resume: false,
    requireKey: false,
    auditAll: false,
    printChecksum: false,
    write: false,
    ownerLabels: "",
    results: "",
    commit: "",
    date: "",
    backoffMs: 500,
    timeoutMs: 180000,
  };
  if (opts.command === "--help" || opts.command === "-h") opts.command = "help";
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    const whole = (name, min) => {
      const n = Number(next());
      if (!Number.isInteger(n) || n < min) fail(`${name} must be a whole number, ${min} or more`);
      return n;
    };
    switch (arg) {
      case "--split":
        opts.split = next();
        break;
      case "--seeds":
        opts.seeds = resolve(next());
        break;
      case "--arms":
        opts.arms = resolve(next());
        break;
      case "--checksum":
        opts.checksum = resolve(next());
        break;
      case "--out":
        opts.out = resolve(next());
        break;
      case "--concurrency":
        opts.concurrency = whole("--concurrency", 1);
        break;
      case "--backoff-ms":
        opts.backoffMs = whole("--backoff-ms", 0);
        break;
      case "--timeout-ms":
        opts.timeoutMs = whole("--timeout-ms", 1000);
        break;
      case "--resume":
        opts.resume = true;
        break;
      case "--require-key":
        opts.requireKey = true;
        break;
      case "--audit-all":
        opts.auditAll = true;
        break;
      case "--print-checksum":
        opts.printChecksum = true;
        break;
      case "--write":
        opts.write = true;
        break;
      case "--owner-labels":
        opts.ownerLabels = resolve(next());
        break;
      case "--results":
        opts.results = resolve(next());
        break;
      case "--commit":
        opts.commit = next();
        break;
      case "--date":
        opts.date = next();
        break;
      case "--help":
      case "-h":
        opts.command = "help";
        break;
      default:
        if (arg.startsWith("--")) fail(`unknown argument: ${arg}`);
        if (opts.file) fail(`unexpected argument: ${arg}`);
        opts.file = resolve(arg);
    }
  }
  if (opts.split !== "dev" && opts.split !== "frozen") fail(`unknown split: ${opts.split}`);
  // A green skip on the frozen split would read as a run that passed. With no key it is Not measured.
  if (opts.split === "frozen" && MODEL_STEPS.includes(opts.command)) opts.requireKey = true;
  if (!opts.out) opts.out = join(DEFAULT_OUT, opts.split);
  if (opts.commit && !isCommitHash(opts.commit)) fail("--commit must be 7 to 40 lowercase hex characters");
  if (opts.date && !isIsoDate(opts.date)) fail("--date must be written YYYY-MM-DD");
  return opts;
}

function printHelp() {
  const lines = readFileSync(new URL(import.meta.url), "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "/**");
  const end = lines.findIndex((line, i) => i > start && line.trim() === "*/");
  console.log(
    lines
      .slice(start + 1, end)
      .map((line) => line.replace(/^ \* ?/, ""))
      .join("\n"),
  );
}

// == Files ====================================================================
function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function appendJsonl(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
}

function loadSeeds(path) {
  if (!existsSync(path)) fail(`no seed file at ${path}. The seeds are not written yet, or pass --seeds.`);
  const { seeds, problems } = parseSeedsJsonl(readFileSync(path, "utf8"));
  if (problems.length) {
    for (const problem of problems) console.error(`[four-arm] seed problem: ${problem}`);
    fail(`${problems.length} problem(s) in ${path}. Run validate-seeds on it.`);
  }
  if (seeds.some((seed) => seed.author_family === "")) fail("the seeds have no author family yet. Run assign-authors first.");
  return seeds;
}

function loadArms(path) {
  let config;
  try {
    config = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return fail(`cannot read the arms file ${path}: ${e?.message ?? e}`);
  }
  const problems = armsProblems(config);
  if (problems.length) {
    for (const problem of problems) console.error(`[four-arm] arms problem: ${problem}`);
    fail(`${problems.length} problem(s) in ${path}`);
  }
  return config;
}

function checksumOnFile(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function currentCommit(opts) {
  if (opts.commit) return opts.commit;
  if (isCommitHash(process.env.GITHUB_SHA ?? "")) return process.env.GITHUB_SHA.slice(0, 12);
  const git = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" });
  const hash = git.status === 0 ? git.stdout.trim() : "";
  return isCommitHash(hash) ? hash : "";
}

// == What makes a run a rehearsal =================================================
function resolveEndpoint() {
  const raw = typeof process.env.JUDGE_OPENROUTER_URL === "string" ? process.env.JUDGE_OPENROUTER_URL.trim() : "";
  if (raw === "") return { url: OPENROUTER_DEFAULT_URL, loopback: false };
  let host = null;
  try {
    host = new URL(raw).hostname;
  } catch {
    return fail("JUDGE_OPENROUTER_URL is not a URL");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    return fail("JUDGE_OPENROUTER_URL must point at loopback. Every request carries the router key, so any other host is refused.");
  }
  return { url: raw, loopback: true };
}

/** Reasons this run cannot be a published measurement. Empty for a real frozen run. */
function rehearsalReasons(opts, endpoint) {
  const reasons = [];
  if (opts.split !== "frozen") reasons.push("the dev split");
  if (endpoint.loopback) reasons.push("a loopback endpoint");
  if (opts.seeds !== DEFAULT_SEEDS) reasons.push("a seed file other than the committed one");
  if (opts.arms !== DEFAULT_ARMS) reasons.push("an arms file other than the committed one");
  if (opts.checksum !== DEFAULT_CHECKSUM) reasons.push("a checksum file other than the committed one");
  return reasons;
}

function readMeta(opts) {
  const path = join(opts.out, "meta.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { split: opts.split, rehearsal: [], steps: {} };
}

function writeMeta(opts, meta, step, endpoint, seeds, config) {
  const reasons = rehearsalReasons(opts, endpoint);
  const next = {
    ...meta,
    split: opts.split,
    rehearsal: [...new Set([...(meta.rehearsal ?? []), ...reasons])],
    seeds_sha256: seedsChecksum(seeds),
    steps: {
      ...(meta.steps ?? {}),
      [step]: { date: opts.date || utcDate(), commit: currentCommit(opts), judge_prompt_sha256: judgePromptFingerprint(), models_sha256: armsModelsChecksum(config) },
    },
  };
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "meta.json"), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

/** The frozen split is run only on a registered protocol. Problems are listed and the step stops. */
function requireRegistration(opts, config, seeds) {
  if (opts.split !== "frozen") return;
  const problems = registrationProblems(config, { seeds, checksumOnFile: checksumOnFile(opts.checksum) });
  if (problems.length === 0) return;
  for (const problem of problems) console.error(`[four-arm] not registered: ${problem}`);
  fail("the frozen split runs only after the protocol is registered. See evals/four-arm/README.md, \"What the owner does\".");
}

/**
 * The seeds a frozen run began with are the seeds it ends with. meta.json holds the checksum
 * the first step saw, and every later step compares before it writes, so no step can carry a
 * changed seed set into the run's own record. Once write-ups exist that record must be there:
 * the author step writes it before the first write-up.
 */
function requireSameSeeds(opts, meta, seeds, since, { recordNeeded = false } = {}) {
  if (opts.split !== "frozen") return;
  if (!meta.seeds_sha256) {
    if (recordNeeded) fail(`${join(opts.out, "meta.json")} has no record of the seeds this run used, so they cannot be checked against the seeds given now.`);
    return;
  }
  if (meta.seeds_sha256 !== seedsChecksum(seeds)) fail(`the frozen seeds changed after ${since}. The set is frozen at registration.`);
}

// == Not measured =================================================================
function stepSummary(text) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  } catch (e) {
    note(`could not append to GITHUB_STEP_SUMMARY: ${e?.message ?? e}`);
  }
}

function notMeasured(reason) {
  const message = `Not measured: ${reason}`;
  console.log(`::error::${message}`);
  console.log("No score is reported and no results file was changed.");
  stepSummary(`## Four-arm comparison\n\n**${message}** No score is reported.\n`);
  process.exit(2);
}

/**
 * The write-up floor, held by every step. The author step says Not measured when it is not
 * met, and run, score and report say it again, so a run under the floor never reaches an arm,
 * a grader or a results file.
 */
function requireWriteUpFloor(opts, seeds, writeUps) {
  const floor = writeUpFloorMet(seeds, writeUps, opts.split);
  if (!floor.met) notMeasured(`only ${floor.usable} of ${floor.of} write-ups are usable.`);
  return floor;
}

/** The router key, or the skip path: the same two conventions as scripts/eval.mjs. */
function keyOrSkip(opts) {
  const found = resolveApiKey();
  if (found.key) {
    if (found.warning) note(`warning: ${found.warning}`);
    return found.key;
  }
  console.log("SKIPPED: no arm ran");
  if (!opts.requireKey) process.exit(0);
  return notMeasured("no router key, so no arm reached a model.");
}

// == Model calls ==================================================================
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function redact(text) {
  return String(text ?? "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]");
}

/** One chat request. Never throws: returns the parsed body, or why there is none. */
async function postChat(body, ctx) {
  let response;
  try {
    response = await fetch(ctx.endpoint.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ctx.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://grillyour.ai",
        "X-Title": "Grill",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(ctx.opts.timeoutMs),
    });
  } catch (e) {
    return { data: null, why: `no response: ${redact(e?.message ?? e)}` };
  }
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => {});
    return { data: null, why: `the router returned ${response.status}` };
  }
  try {
    return { data: await response.json(), why: null };
  } catch {
    return { data: null, why: "the router returned a body that is not JSON" };
  }
}

/** Try up to `max` times. The first usable answer is kept and never replaced. */
async function withRetries(max, backoffMs, attempt) {
  let last = null;
  for (let n = 1; n <= max; n++) {
    last = { ...(await attempt()), requests: n };
    if (last.usable) return last;
    if (n < max && backoffMs > 0) await sleep(backoffMs * n);
  }
  return last;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** One run of the unmodified judge CLI, with the write-up on stdin. */
function runJudgeOnce(seed, writeUp, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [JUDGE_CLI, ...judgeArgs(seed)], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (e) => done({ code: -1, result: null, why: `judge.mjs did not start: ${e?.message ?? e}` }));
    child.on("close", (code) => {
      if (code !== 0) {
        done({ code, result: null, why: `judge.mjs exited ${code}: ${redact(stderr).trim().split("\n").slice(-1)[0] ?? ""}`.slice(0, 400) });
        return;
      }
      try {
        done({ code, result: JSON.parse(stdout), why: null });
      } catch {
        done({ code, result: null, why: "judge.mjs printed something that is not JSON" });
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(writeUp);
  });
}

/** Ask graders one question until GRADER_VOTES of them have answered, or the list runs out. */
async function collectVotes(models, prompt, parse, ctx) {
  const ask = async (model) => {
    const got = await withRetries(ARM_MAX_REQUESTS, ctx.opts.backoffMs, async () => {
      const { data } = await postChat(graderRequestBody({ model, prompt }), ctx);
      const reply = data ? parse(chatText(data)) : null;
      return { usable: reply !== null, reply };
    });
    return { model, reply: got.reply };
  };
  const votes = await Promise.all(models.slice(0, GRADER_VOTES).map(ask));
  let next = GRADER_VOTES;
  while (votes.filter((vote) => vote.reply !== null).length < GRADER_VOTES && next < models.length) {
    votes.push(await ask(models[next++]));
  }
  return votes;
}

// == validate-seeds ===============================================================
function listCounts(record) {
  const entries = Object.entries(record).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return entries.length ? entries.map(([name, n]) => `${name} ${n}`).join(", ") : "none";
}

function validateSeeds(opts) {
  if (!opts.file) fail("validate-seeds needs a file: node scripts/eval-four-arm.mjs validate-seeds <file>");
  if (!existsSync(opts.file)) fail(`no such file: ${opts.file}`);
  const { seeds, problems } = parseSeedsJsonl(readFileSync(opts.file, "utf8"));
  if (opts.printChecksum) {
    if (problems.length) fail(`${problems.length} problem(s); no checksum is printed for a seed file with problems`);
    console.log(seedsChecksum(seeds));
    return;
  }
  const counts = seedCounts(seeds);
  console.log(`Seeds: ${counts.total}`);
  console.log(`By kind: ${listCounts(counts.by_kind)}`);
  console.log(`By split: ${listCounts(counts.by_split)}`);
  console.log(`By category: ${listCounts(counts.by_category)}`);
  console.log(`By flaw type: ${listCounts(counts.by_flaw_type)}`);
  console.log(`By drafter family: ${listCounts(counts.by_drafter)}`);
  console.log(`By author family: ${listCounts(counts.by_author)}`);
  if (seeds.length && seeds.every((seed) => seed && seed.author_family === "")) {
    console.log("Author families are not assigned yet. That is fine for a draft batch. Run assign-authors when the batches are merged.");
  } else {
    const byKind = counts.frozen_by_kind_and_author;
    console.log(`Frozen by kind and author family: ${Object.entries(byKind).map(([kind, families]) => `${kind} ${Object.entries(families).map(([family, n]) => `${family} ${n}`).join(" and ")}`).join("; ")}`);
  }
  console.log(`Frozen checksum: ${seedsChecksum(seeds)}`);
  console.log("");
  console.log("README lines (between the seed-count markers in evals/four-arm/README.md):");
  console.log(renderSeedCounts(seeds));
  console.log("");
  if (counts.frozen.flawed < MIN_ANALYSED_FLAWED) {
    console.log(`Note: ${counts.frozen.flawed} frozen flawed seeds. Under ${MIN_ANALYSED_FLAWED} analysed, a run can only say "too few cases to test".`);
  }
  if (problems.length === 0) {
    console.log("Problems: none");
    return;
  }
  console.log(`Problems: ${problems.length}`);
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}

// == assign-authors ===============================================================
function assignAuthorsCommand(opts) {
  if (!opts.file) fail("assign-authors needs a file");
  if (!existsSync(opts.file)) fail(`no such file: ${opts.file}`);
  const rows = readFileSync(opts.file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch {
        return fail(`line ${i + 1} is not JSON`);
      }
    });
  const bad = rows.filter((row) => seedProblems(row).length > 0).length;
  if (bad) fail(`${bad} seed(s) have problems. Run validate-seeds and fix them first.`);
  const assigned = assignAuthors(rows);
  const text = `${assigned
    .map((seed) => {
      const row = {};
      for (const key of SEED_KEYS) row[key] = seed[key];
      return JSON.stringify(row);
    })
    .join("\n")}\n`;
  if (!opts.write) {
    process.stdout.write(text);
    return;
  }
  writeFileSync(opts.file, text, "utf8");
  note(`author families written to ${opts.file}: ${AUTHOR_FAMILIES.map((family) => `${family} ${assigned.filter((seed) => seed.author_family === family).length}`).join(", ")}`);
}

// == preflight ====================================================================
function preflight(opts) {
  let problems = 0;
  const say = (line) => console.log(line);
  say("Four-arm comparison: preflight. No model is called.");
  say("");
  if (productChainUntouched()) say("Product judge chain: openrouter/auto (untouched).");
  else {
    say("Product judge chain: CHANGED. The comparison measures the product as shipped and stops here.");
    problems += 1;
  }
  say(`Judge instructions fingerprint: ${judgePromptFingerprint()}`);

  let config = null;
  try {
    config = JSON.parse(readFileSync(opts.arms, "utf8"));
  } catch (e) {
    say(`Arms file: cannot be read (${e?.message ?? e})`);
    problems += 1;
  }
  if (config) {
    const armProblems = armsProblems(config);
    say(`Arms file: status ${String(config.status)}.`);
    for (const problem of armProblems) say(`- problem: ${problem}`);
    problems += armProblems.length;
    if (armProblems.length === 0) {
      for (const family of AUTHOR_FAMILIES) {
        const entry = config.families[family];
        say(`- ${family}: author ${entry.author_model} (${entry.author_model_status}), stronger ${entry.stronger_model} (${entry.stronger_model_status})`);
      }
      for (const grader of config.graders) say(`- grader ${grader.model} (${grader.status})`);
      say(`Model ids fingerprint: ${armsModelsChecksum(config)}`);
      const unconfirmed = [
        ...AUTHOR_FAMILIES.flatMap((family) => ["author_model", "stronger_model"].filter((role) => config.families[family][`${role}_status`] !== ID_CONFIRMED)),
        ...config.graders.filter((grader) => grader.status !== ID_CONFIRMED),
      ].length;
      if (unconfirmed) say(`${unconfirmed} model id(s) still wait for the owner. They are placeholders until confirmed.`);
      say("To check the ids against the public model list (no key needed):");
      say(`  JUDGE_MODEL="${armsModelIds(config).join(",")}" node scripts/upstream-check.mjs`);
    }
  }

  let seeds = null;
  if (!existsSync(opts.seeds)) say(`Seeds: none at ${opts.seeds}. Seeds not written yet.`);
  else {
    const parsed = parseSeedsJsonl(readFileSync(opts.seeds, "utf8"));
    seeds = parsed.seeds;
    const counts = seedCounts(seeds);
    say(`Seeds: ${counts.total}. Frozen: ${counts.frozen.flawed} flawed, ${counts.frozen.sound} sound twins, ${counts.frozen.loaded} loaded. Dev: ${counts.dev.total}.`);
    say(`Frozen checksum: ${seedsChecksum(seeds)}`);
    for (const problem of parsed.problems) say(`- problem: ${problem}`);
    problems += parsed.problems.length;
    if (seeds.some((seed) => seed.author_family === "")) say("Author families: not assigned yet. Run assign-authors.");
    say(`Single-drafter set: ${singleDrafter(seeds) ? "yes. Its result may remove a quality claim and cannot restore one." : "no"}`);
    if (counts.frozen.flawed < MIN_ANALYSED_FLAWED) say(`Fewer than ${MIN_ANALYSED_FLAWED} frozen flawed seeds: a run could only say "too few cases to test".`);
    const perSplit = (n) => `${n} write-ups, ${n * ARMS.length} arm answers, up to ${n * ARMS.length * GRADER_VOTES} grader calls`;
    say(`A frozen run makes about: ${perSplit(counts.frozen.total)}.`);
    say(`A dev rehearsal makes about: ${perSplit(counts.dev.total)}.`);
  }

  if (config && seeds && armsProblems(config).length === 0) {
    const missing = registrationProblems(config, { seeds, checksumOnFile: checksumOnFile(opts.checksum) });
    if (missing.length === 0) say("Registration: complete. The frozen split can run.");
    else {
      say("Registration: not complete. The frozen split will not run until:");
      for (const problem of missing) say(`- ${problem}`);
    }
  }

  const endpoint = resolveEndpoint();
  say(`Endpoint: ${endpoint.loopback ? "loopback (a rehearsal)" : "the model router"}.`);
  const key = resolveApiKey();
  say(key.key ? `Router key: found (${key.source === "GRILL_API_KEY" || key.source === "OPENROUTER_API_KEY" ? key.source : "the key file"}).` : "Router key: none. A dev step will skip. A frozen step will be Not measured.");
  say(`Raw rows go under: ${opts.out} (ignored by git).`);
  if (problems) fail(`${problems} problem(s) found`);
  if (!key.key && opts.requireKey) notMeasured("no router key, so no arm reached a model.");
}

// == author =======================================================================
async function authorCommand(opts) {
  if (!productChainUntouched()) fail("the product judge chain is not the Auto Router. This harness measures the product as shipped.");
  const endpoint = resolveEndpoint();
  const key = keyOrSkip(opts);
  const config = loadArms(opts.arms);
  const seeds = loadSeeds(opts.seeds);
  requireRegistration(opts, config, seeds);
  const mine = seeds.filter((seed) => seed.split === opts.split);
  if (mine.length === 0) fail(`no ${opts.split} seeds in ${opts.seeds}`);
  const path = join(opts.out, "writeups.jsonl");
  const existing = readJsonl(path);
  if (existing.length && !opts.resume) fail(`write-ups already exist at ${path}. Each write-up is written once. Use --resume to fill in missing ones.`);
  const ctx = { key, endpoint, opts };
  const meta = readMeta(opts);
  requireSameSeeds(opts, meta, seeds, "this run began");
  writeMeta(opts, meta, "author", endpoint, seeds, config);

  const have = new Set(existing.map((row) => row.id));
  const todo = mine.filter((seed) => !have.has(seed.id));
  await mapWithConcurrency(todo, opts.concurrency, async (seed, index) => {
    const model = config.families[seed.author_family].author_model;
    const got = await withRetries(ARM_MAX_REQUESTS, opts.backoffMs, async () => {
      const { data, why } = await postChat(chatRequestBody({ model, messages: authorMessages(seed) }), ctx);
      const text = data ? chatText(data) : "";
      const served = typeof data?.model === "string" ? data.model : "";
      const valid = armValid("A", { servedModel: served }, seed.author_family);
      const usable = writeUpUsable(text) && valid.valid;
      return { usable, text, served, why: usable ? null : why ?? (valid.valid ? `the write-up has ${countWords(text)} words` : valid.reason) };
    });
    const row = {
      id: seed.id,
      kind: seed.kind,
      author_family: seed.author_family,
      author_model: model,
      served_model: got.served,
      requests: got.requests,
      usable: got.usable,
      words: countWords(got.text),
      write_up: got.usable ? got.text : "",
      sha256: got.usable ? sha256(got.text) : "",
      visible: null,
      flagged: null,
      flag_votes: [],
      note: got.why,
    };
    if (row.usable && seed.kind === "flawed") {
      const graders = eligibleGraders(config, { authorFamily: seed.author_family });
      const votes = await collectVotes(graders, buildFlagPrompt({ writeUp: row.write_up, flaw: seed.flaw }), parseFlagReply, ctx);
      row.flag_votes = votes.map((vote) => ({ model: vote.model, visible: vote.reply?.visible ?? null, flagged: vote.reply?.flagged ?? null }));
      row.visible = majority(row.flag_votes.map((vote) => vote.visible));
      row.flagged = majority(row.flag_votes.map((vote) => vote.flagged));
    }
    appendJsonl(path, row);
    note(`author ${index + 1}/${todo.length} ${seed.id}${row.usable ? "" : " (no usable write-up)"}`);
  });

  const all = readJsonl(path);
  const usable = all.filter((row) => row.usable).length;
  const { cases, dropped } = analysedCases(seeds, all, opts.split);
  console.log(`Write-ups: ${usable} of ${mine.length} usable.`);
  console.log(`Analysed cases: ${cases.filter((c) => c.kind === "flawed").length} flawed, ${cases.filter((c) => c.kind === "sound").length} sound twins, ${cases.filter((c) => c.kind === "loaded").length} loaded.`);
  console.log(`Left out by rule: ${Object.entries(dropped).map(([why, n]) => `${why} ${n}`).join(", ")}.`);
  requireWriteUpFloor(opts, seeds, all);
}

// == run ==========================================================================
async function runArm(arm, seed, writeUp, config, ctx) {
  const family = seed.author_family;
  if (arm === "A") {
    const model = config.families[family].author_model;
    return withRetries(ARM_MAX_REQUESTS, ctx.opts.backoffMs, async () => {
      const { data, why } = await postChat(chatRequestBody({ model, messages: armAMessages(seed, writeUp) }), ctx);
      const text = data ? chatText(data) : "";
      const served = typeof data?.model === "string" ? data.model : "";
      const valid = armValid("A", { servedModel: served }, family);
      const usable = armAUsable(text) && valid.valid;
      return {
        usable,
        served,
        raw: text,
        critique: usable ? critiqueFromProse(text) : "",
        verdict: null,
        challenges: null,
        cost_usd: typeof data?.usage?.cost === "number" ? data.usage.cost : null,
        why: usable ? null : why ?? (valid.valid ? "the reply was too short to be an answer" : valid.reason),
      };
    });
  }
  // Arm D is the product, which makes up to ARM_MAX_REQUESTS requests inside one run.
  const tries = arm === "D" ? 1 : ARM_MAX_REQUESTS;
  const env = armEnv(arm, config, family, process.env);
  return withRetries(tries, ctx.opts.backoffMs, async () => {
    const { result, why } = await runJudgeOnce(seed, writeUp, env);
    const served = typeof result?.servedModel === "string" ? result.servedModel : "";
    const valid = armValid(arm, { servedModel: served, decorrelated: result?.decorrelated }, family);
    const usable = judgeUsable(result) && valid.valid;
    const critique = usable ? critiqueFromJudge(result, writeUp) : "";
    return {
      usable,
      served,
      raw: critique,
      critique,
      // Everything judge.mjs printed, before blinding: the short default reply can be built
      // from it later, and so can any other layer. The run is paid for once, so it is kept.
      judge: result ?? null,
      verdict: typeof result?.verdict === "string" ? result.verdict : null,
      challenges: Array.isArray(result?.challenges) ? result.challenges.length : null,
      cost_usd: typeof result?.costUsd === "number" ? result.costUsd : null,
      why: usable ? null : why ?? (judgeUsable(result) ? valid.reason : "the judge returned no verdict"),
    };
  });
}

function loadRunInputs(opts) {
  if (!productChainUntouched()) fail("the product judge chain is not the Auto Router. This harness measures the product as shipped.");
  const config = loadArms(opts.arms);
  const seeds = loadSeeds(opts.seeds);
  requireRegistration(opts, config, seeds);
  const writeUps = readJsonl(join(opts.out, "writeups.jsonl"));
  // A write-up is written once. One that no longer matches its own checksum was edited, and the run stops.
  const edited = writeUps.filter((row) => row.usable && sha256(row.write_up) !== row.sha256).map((row) => row.id);
  if (edited.length) fail(`${edited.length} saved write-up(s) no longer match their checksum (${edited.slice(0, 5).join(", ")}). A write-up is never edited.`);
  const { cases, dropped } = analysedCases(seeds, writeUps, opts.split);
  return { config, seeds, writeUps, cases, dropped };
}

async function runCommand(opts) {
  const endpoint = resolveEndpoint();
  const key = keyOrSkip(opts);
  const { config, seeds, writeUps, cases } = loadRunInputs(opts);
  if (writeUps.length === 0) fail(`no write-ups under ${opts.out}. Run the author step first.`);
  requireWriteUpFloor(opts, seeds, writeUps);
  const meta = readMeta(opts);
  if (meta.seeds_sha256 && meta.seeds_sha256 !== seedsChecksum(seeds)) fail("the frozen seeds changed after the write-ups were made. Start again in a new --out directory.");
  const path = join(opts.out, "answers.jsonl");
  const existing = readJsonl(path);
  if (existing.length && !opts.resume) fail(`arm answers already exist at ${path}. The frozen split is run once. Use --resume to fill in what is missing.`);
  const ctx = { key, endpoint, opts };
  writeMeta(opts, meta, "run", endpoint, seeds, config);

  const seedOf = new Map(seeds.map((seed) => [seed.id, seed]));
  const writeUpOf = new Map(writeUps.map((row) => [row.id, row.write_up]));
  const have = new Set(existing.map((row) => `${row.id} ${row.arm}`));
  await mapWithConcurrency(cases, opts.concurrency, async (c, index) => {
    const seed = seedOf.get(c.id);
    const writeUp = writeUpOf.get(c.id);
    await Promise.all(
      ARMS.filter((arm) => !have.has(`${c.id} ${arm}`)).map(async (arm) => {
        const got = await runArm(arm, seed, writeUp, config, ctx);
        appendJsonl(path, {
          id: c.id,
          arm,
          usable: got.usable,
          requests: got.requests,
          served_model: got.served,
          served_company: got.served ? companyIdOf(got.served) : null,
          words: got.usable ? countWords(got.critique) : null,
          critique: got.critique,
          raw: got.raw,
          judge: got.judge ?? null,
          verdict: got.verdict,
          challenges: got.challenges,
          cost_usd: got.cost_usd,
          note: got.why,
        });
      }),
    );
    note(`run ${index + 1}/${cases.length} ${c.id}`);
  });

  const answers = readJsonl(path);
  const flawed = cases.filter((c) => c.kind === "flawed");
  if (flawed.length === 0) notMeasured("no flawed case has a usable write-up, so there was nothing for the arms to answer.");
  const flawedIds = new Set(flawed.map((c) => c.id));
  let short = null;
  for (const arm of ARMS) {
    const usable = answers.filter((row) => row.arm === arm && row.usable && flawedIds.has(row.id)).length;
    console.log(`Arm ${arm} (${ARM_NAMES[arm]}): ${usable} of ${flawed.length} flawed cases got a usable answer.`);
    if (usable * USABLE_FLOOR.den < flawed.length * USABLE_FLOOR.num && short === null) short = `arm ${arm} gave a usable answer on only ${usable} of ${flawed.length} flawed cases.`;
  }
  if (short) notMeasured(short);
}

// == score ========================================================================
function writeAuditSheet(opts, seeds, cases, writeUps, answers, grades) {
  const kindOf = new Map(cases.map((c) => [c.id, c.kind]));
  const graded = grades.filter((row) => row.label === "yes" || row.label === "no").map((row) => ({ id: row.id, arm: row.arm, kind: kindOf.get(row.id) }));
  const key = `${seedsChecksum(seeds)} audit`;
  const sample = auditSample(graded, key);
  const inSample = new Set(sample.map((item) => `${item.id} ${item.arm}`));
  const rest = opts.auditAll ? auditSample(graded.filter((item) => !inSample.has(`${item.id} ${item.arm}`)), `${key} rest`, { size: graded.length, alarmItems: graded.length }) : [];
  const seedOf = new Map(seeds.map((seed) => [seed.id, seed]));
  const writeUpOf = new Map(writeUps.map((row) => [row.id, row.write_up]));
  const answerOf = new Map(answers.map((row) => [`${row.id} ${row.arm}`, row]));
  const gradeOf = new Map(grades.map((row) => [`${row.id} ${row.arm}`, row]));

  const sheet = [
    "# Grader check: label these items",
    "",
    "Each item is one critique of one plan. You are not told which arm or which model wrote it.",
    "Answer the one question under each item with yes or no. Do not open audit-map.jsonl first.",
    `Put your answers in a text file, one per line, like "1: yes". Then run report with --owner-labels <that file>.`,
    `The first ${Math.min(sample.length, AUDIT_ITEMS)} items are the check. The graders must match you on ${AUDIT_AGREE_FLOOR} of ${AUDIT_ITEMS}.`,
    "",
  ];
  const keyRows = [];
  [...sample, ...rest].forEach((item, i) => {
    const n = i + 1;
    const seed = seedOf.get(item.id);
    const answer = answerOf.get(`${item.id} ${item.arm}`);
    sheet.push(`## Item ${n}`, "", "THE PLAN", "", blind(writeUpOf.get(item.id)), "", "THE QUESTION ASKED ABOUT IT", "", blind(seed.question), "");
    if (item.kind !== "sound") sheet.push("THE KNOWN PROBLEM", "", blind(seed.flaw), "");
    sheet.push("THE CRITIQUE", "", answer.critique, "");
    sheet.push(
      item.kind === "sound"
        ? "Does the critique tell the reader not to go ahead with the plan as written? (yes or no)"
        : "Does the critique point out the known problem? (yes or no)",
      "",
    );
    keyRows.push({ n, id: item.id, arm: item.arm, kind: item.kind, sample: i < sample.length, graders: gradeOf.get(`${item.id} ${item.arm}`).label });
  });
  writeFileSync(join(opts.out, "audit-sheet.md"), `${sheet.join("\n")}\n`, "utf8");
  writeFileSync(join(opts.out, "audit-map.jsonl"), `${keyRows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
  return keyRows.length;
}

async function scoreCommand(opts) {
  const endpoint = resolveEndpoint();
  const key = keyOrSkip(opts);
  const { config, seeds, writeUps, cases } = loadRunInputs(opts);
  if (writeUps.length === 0) fail(`no write-ups under ${opts.out}. Run the author step first.`);
  const meta = readMeta(opts);
  requireSameSeeds(opts, meta, seeds, "the arms ran", { recordNeeded: true });
  requireWriteUpFloor(opts, seeds, writeUps);
  const answers = readJsonl(join(opts.out, "answers.jsonl"));
  if (answers.length === 0) fail(`no arm answers under ${opts.out}. Run the arms first.`);
  const path = join(opts.out, "grades.jsonl");
  const existing = readJsonl(path);
  if (existing.length && !opts.resume) fail(`grades already exist at ${path}. Use --resume to fill in what is missing.`);
  const ctx = { key, endpoint, opts };
  writeMeta(opts, meta, "score", endpoint, seeds, config);

  const seedOf = new Map(seeds.map((seed) => [seed.id, seed]));
  const writeUpOf = new Map(writeUps.map((row) => [row.id, row.write_up]));
  const have = new Set(existing.map((row) => `${row.id} ${row.arm}`));
  await mapWithConcurrency(cases, opts.concurrency, async (c, index) => {
    const seed = seedOf.get(c.id);
    const mine = answers.filter((row) => row.id === c.id);
    const product = mine.find((row) => row.arm === "D");
    const graders = eligibleGraders(config, { authorFamily: c.author_family, servedCompany: product?.served_company ?? "" });
    for (const answer of mine) {
      if (!answer.usable || have.has(`${answer.id} ${answer.arm}`)) continue;
      const parts = { writeUp: writeUpOf.get(c.id), question: seed.question, flaw: seed.flaw, critique: answer.critique };
      const prompt = c.kind === "sound" ? buildAlarmPrompt(parts) : buildCatchPrompt(parts);
      const votes = await collectVotes(graders, prompt, parseGradeReply, ctx);
      appendJsonl(path, {
        id: answer.id,
        arm: answer.arm,
        question: c.kind === "sound" ? "alarm" : "catch",
        votes: votes.map((vote) => ({ model: vote.model, answer: vote.reply?.answer ?? null, objections: vote.reply?.objections ?? null })),
        label: majority(votes.map((vote) => vote.reply?.answer ?? null)),
        objections: medianInt(votes.map((vote) => vote.reply?.objections).filter((n) => typeof n === "number")),
      });
    }
    note(`score ${index + 1}/${cases.length} ${c.id}`);
  });

  const grades = readJsonl(path);
  const labelled = grades.filter((row) => row.label === "yes" || row.label === "no").length;
  const usableAnswers = answers.filter((row) => row.usable).length;
  console.log(`Graded: ${labelled} of ${usableAnswers} usable answers. ${usableAnswers - labelled} could not be labelled and count as unusable.`);
  const onSheet = writeAuditSheet(opts, seeds, cases, writeUps, answers, grades);
  console.log(`Owner's sheet: ${onSheet} blinded items at ${join(opts.out, "audit-sheet.md")}.`);
  console.log(`Next: label them, then run report with --owner-labels. The floor is ${AUDIT_AGREE_FLOOR} of ${AUDIT_ITEMS}.`);
}

// == report =======================================================================
function readAudit(opts, grades) {
  const keyPath = join(opts.out, "audit-map.jsonl");
  if (!opts.ownerLabels) return { audit: null, ownerLabels: null };
  if (!existsSync(opts.ownerLabels)) fail(`no such file: ${opts.ownerLabels}`);
  const keyRows = readJsonl(keyPath);
  if (keyRows.length === 0) fail(`no audit key under ${opts.out}. Run the score step first.`);
  const replies = parseOwnerLabels(readFileSync(opts.ownerLabels, "utf8"));
  const sample = keyRows.filter((row) => row.sample && replies.has(row.n));
  const audit = { agree: sample.filter((row) => replies.get(row.n) === row.graders).length, of: sample.length, labels_by: "graders" };
  const passed = audit.of >= AUDIT_ITEMS && audit.agree * AUDIT_ITEMS >= AUDIT_AGREE_FLOOR * audit.of;
  if (passed) return { audit, ownerLabels: null };
  // Below the floor, the owner's labels decide, and only when the owner labelled every graded item.
  const gradedKeys = grades.filter((row) => row.label === "yes" || row.label === "no").map((row) => `${row.id} ${row.arm}`);
  const owner = new Map(keyRows.filter((row) => replies.has(row.n)).map((row) => [`${row.id} ${row.arm}`, replies.get(row.n)]));
  if (gradedKeys.length > 0 && gradedKeys.every((k) => owner.has(k))) return { audit: { ...audit, labels_by: "owner" }, ownerLabels: owner };
  return { audit, ownerLabels: null };
}

function reportCommand(opts) {
  const config = loadArms(opts.arms);
  const seeds = loadSeeds(opts.seeds);
  const writeUps = readJsonl(join(opts.out, "writeups.jsonl"));
  const answers = readJsonl(join(opts.out, "answers.jsonl"));
  const grades = readJsonl(join(opts.out, "grades.jsonl"));
  const meta = readMeta(opts);
  // This is the step that decides and writes the public block, so it holds the frozen split to
  // the same registration as the steps before it, and to the seeds the run itself recorded.
  requireRegistration(opts, config, seeds);
  requireSameSeeds(opts, meta, seeds, "the run", { recordNeeded: writeUps.length > 0 });
  const rehearsal = [...new Set([...(meta.rehearsal ?? []), ...rehearsalReasons(opts, { loopback: false })])];
  const { cases, dropped } = analysedCases(seeds, writeUps, opts.split);

  console.log("# Four-arm comparison: what came back\n");
  if (rehearsal.length) console.log(`REHEARSAL, not a measurement: this run used ${rehearsal.join(", ")}.\n`);
  if (writeUps.length === 0) notMeasured("no write-ups were found. Run the author step first.");
  const floor = requireWriteUpFloor(opts, seeds, writeUps);
  if (answers.length === 0) notMeasured("no arm answers were found. Run the arms first.");
  const { audit, ownerLabels } = readAudit(opts, grades);
  const items = buildItems(cases, answers, grades, ownerLabels);
  console.log(`${renderPlumbing(cases, items)}\n`);

  const date = opts.date || meta.steps?.run?.date || utcDate();
  const commit = meta.steps?.run?.commit || currentCommit(opts);
  if (!isCommitHash(commit)) notMeasured("the run has no commit hash, so its counts cannot be published. Pass --commit.");
  const deviations = [];
  const ranWith = meta.steps?.run?.judge_prompt_sha256;
  if (config.registered && ranWith && config.registered.judge_prompt_sha256 !== ranWith) {
    deviations.push("the judge's instructions at the run were not the registered ones");
  }
  // A frozen step runs only on registered ids, so this shows only when arms.json was registered again part way through, or after.
  const stepIds = Object.values(meta.steps ?? {}).map((step) => step?.models_sha256).filter(Boolean);
  if (config.registered && stepIds.some((sum) => sum !== config.registered.models_sha256)) {
    deviations.push("the model ids at a step of the run were not the ones registered now");
  }

  if (opts.split === "dev") {
    console.log("Dev rehearsal: the dev split checks the plumbing. It produces no result and no public block.");
    return;
  }
  const report = summarize({ cases, items, date, commit, single_drafter: singleDrafter(seeds), audit, write_up_floor_met: floor.met, dropped, split: opts.split, deviations });
  if (report.decision.outcome === "not-measured") {
    const usable = items.filter((item) => itemUsable(item)).length;
    const why = report.decision.reasons.join("; ");
    if (why.includes("write-ups")) notMeasured(`only ${floor.usable} of ${floor.of} write-ups are usable.`);
    if (why.includes(SPLIT_MISSING_REASON)) {
      const families = report.splits.by_author.map((row) => row.key).join(", ") || "none";
      notMeasured(`${SPLIT_MISSING_REASON}. Flawed cases were analysed for: ${families}. D minus B is needed for each of ${AUTHOR_FAMILIES.join(" and ")}, so a sign flip can be checked.`);
    }
    if (why.includes("grader")) {
      notMeasured(
        audit
          ? `the graders matched the owner on ${audit.agree} of ${audit.of} blinded items, under the floor of ${AUDIT_AGREE_FLOOR} of ${AUDIT_ITEMS}, and the owner has not labelled every item.`
          : `the grader check has not been done. Label the items in ${join(opts.out, "audit-sheet.md")} and pass --owner-labels.`,
      );
    }
    notMeasured(`${why}: ${usable} of ${items.length} answers were usable.`);
  }

  const text = renderReport(report);
  const blockText = `${JSON.stringify(report.public_block, null, 2)}\n`;
  console.log(`${text}\n`);
  console.log("## Public block (counts only)\n");
  console.log(blockText);
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "report.md"), `${text}\n`, "utf8");
  writeFileSync(join(opts.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(opts.out, "public-block.json"), blockText, "utf8");
  stepSummary(`${text}\n`);

  if (!opts.results) return;
  if (opts.results === COMMITTED_RESULTS && rehearsal.length) {
    fail(`this run is a rehearsal (${rehearsal.join(", ")}). It is never written into data/results.json.`);
  }
  let before;
  try {
    before = readFileSync(opts.results, "utf8");
  } catch (e) {
    return fail(`cannot read ${opts.results}: ${e?.message ?? e}`);
  }
  let merged;
  try {
    // The block is parsed back from its own text first, so what is checked is what is written.
    merged = mergeFourArmIntoResultsText(before, JSON.parse(blockText));
  } catch (e) {
    return fail(`the results file was not changed: ${e?.message ?? e}`);
  }
  writeFileSync(opts.results, merged, "utf8");
  note(`four_arm block written to ${opts.results}. Published whichever way the result fell.`);
}

// == Main =========================================================================
const opts = parseArgs(process.argv.slice(2));
switch (opts.command) {
  case "help":
  case "":
    printHelp();
    process.exit(opts.command === "" ? 1 : 0);
    break;
  case "validate-seeds":
    validateSeeds(opts);
    break;
  case "assign-authors":
    assignAuthorsCommand(opts);
    break;
  case "preflight":
    preflight(opts);
    break;
  case "author":
    await authorCommand(opts);
    break;
  case "run":
    await runCommand(opts);
    break;
  case "score":
    await scoreCommand(opts);
    break;
  case "report":
    reportCommand(opts);
    break;
  default:
    fail(`unknown subcommand: ${opts.command}. One of: ${COMMANDS.join(", ")}`);
}
