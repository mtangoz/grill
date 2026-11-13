#!/usr/bin/env node
/**
 * results.mjs: check data/results.json, and add one run of the weekly check to it.
 *
 * data/results.json is the public, counts-only file that the page /how-we-test/ is built
 * from. Its rules live in scripts/resultsCore.mjs. This file only reads, asks git one
 * question, and writes.
 *
 * USAGE
 *   node scripts/results.mjs check [--file <path>]
 *   node scripts/results.mjs merge-run <public-block.json> [--file <path>]
 *
 *   check       reads the file and prints every problem in it, one a line. Exit 1 if there
 *               is any. It reads only.
 *   merge-run   adds one run. <public-block.json> is the counts-only block a measured run of
 *               scripts/eval.mjs writes beside its results in GitHub Actions
 *               (latest.public.json, in the run's eval-results artifact).
 *   --file      the results file to read and write. The default is data/results.json.
 *
 * WHAT merge-run REFUSES, changing nothing:
 *   - a block that is not a valid run (resultsCore.validateRegressionRun);
 *   - a run whose run number is already in the file;
 *   - a run whose commit cannot be reached from the commit checked out here, when git can
 *     answer. A pull request's run is made on a merge commit that is not on main, so its
 *     counts are not the record of main. When git cannot answer (no git, not a repository,
 *     or a shallow clone that does not hold the commit) the run is added and a line says the
 *     commit was not checked;
 *   - a run dated before the first measured run, or too old to be one of the runs kept.
 *
 * HOW MANY RUNS THE FILE HOLDS: at most resultsCore.MAX_REGRESSION_RUNS. The first measured
 * run always stays. Past the limit, the oldest run after it is dropped, and a line says so.
 * The page shows one run, the latest.
 *
 * The file is written back in the layout it is kept in (resultsCore.formatResults). The new
 * text is parsed and checked as a whole before it replaces the old one.
 *
 * EXIT CODES
 *   0   the file is valid, or the run was added.
 *   1   the file has a problem, or the run was refused. Nothing was written.
 *   2   the command line could not be read.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MAX_REGRESSION_RUNS, formatResults, mergeRegressionRun, resultsProblems, validateRegressionRun, validateResults } from "./resultsCore.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FILE = join(REPO_ROOT, "data", "results.json");
const USAGE = "usage: node scripts/results.mjs check [--file <path>] | merge-run <public-block.json> [--file <path>]";

/** Run git in this repository. Never throws: a git that is not there gives status null. */
function runGit(args) {
  const done = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: done.error ? null : done.status, stdout: typeof done.stdout === "string" ? done.stdout : "" };
}

/**
 * Can `commit` be reached from the commit checked out here?
 * Returns "yes", "no", or "unknown" when git cannot answer. `git` is a function that takes
 * git's arguments and returns {status, stdout}, so a test can stand in for it.
 */
export function commitOnHead(commit, git = runGit) {
  if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) return "unknown";
  const found = git(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  if (found.status !== 0) {
    // A full clone that does not hold the commit can say no. A shallow one cannot tell.
    const shallow = git(["rev-parse", "--is-shallow-repository"]);
    return shallow.status === 0 && shallow.stdout.trim() === "false" ? "no" : "unknown";
  }
  const reach = git(["merge-base", "--is-ancestor", found.stdout.trim(), "HEAD"]);
  if (reach.status === 0) return "yes";
  return reach.status === 1 ? "no" : "unknown";
}

/** A JSON file as text and as a parsed value, or the reason it could not be read. */
function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { problem: `${what}: cannot be read at ${path}` };
  }
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { problem: `${what}: is not JSON` };
  }
}

/**
 * Every problem in the results file at `path`, as lines. An empty list means it is valid.
 * A key written twice is a problem too: JSON keeps the second value and hides the first.
 */
export function fileProblems(path) {
  const read = readJson(path, "results");
  if (read.problem) return [read.problem];
  const problems = resultsProblems(read.json);
  if (read.text.replace(/\s+/g, "") !== JSON.stringify(read.json)) {
    problems.push("results: the text is not the plain JSON of its own values (a key written twice, or a number written another way)");
  }
  return problems;
}

/**
 * Add the run in `blockPath` to the results file at `filePath`.
 * Returns {ok: true, lines} after writing, or {ok: false, lines} having written nothing.
 */
export function mergeRunFile(blockPath, filePath, git = runGit) {
  const refused = (line) => ({ ok: false, lines: [`refused: ${line}`, "nothing was written"] });

  const blockRead = readJson(blockPath, "run");
  if (blockRead.problem) return refused(blockRead.problem);
  const block = blockRead.json;
  try {
    validateRegressionRun(block, "run");
  } catch (err) {
    return refused(err.message);
  }

  const problems = fileProblems(filePath);
  if (problems.length > 0) return { ok: false, lines: [...problems.map((line) => `refused: ${line}`), "nothing was written"] };
  const before = JSON.parse(readFileSync(filePath, "utf8"));

  const notes = [];
  const reach = commitOnHead(block.commit, git);
  if (reach === "no") {
    return refused(
      `run.commit: ${block.commit} cannot be reached from the commit checked out here. A pull request's run is not the record of main. If this is a run of main, bring this branch up to date with main first`,
    );
  }
  if (reach === "unknown") notes.push(`note: git could not say whether ${block.commit} is on this branch, so the commit was not checked`);

  let text;
  let after;
  try {
    after = mergeRegressionRun(before, block);
    text = formatResults(after);
    // Checked as it will be read back: the text, parsed, not the object it was built from.
    validateResults(JSON.parse(text));
  } catch (err) {
    return refused(err.message);
  }
  writeFileSync(filePath, text, "utf8");

  const kept = after.regression.runs.map((run) => run.run_id);
  const dropped = before.regression.runs.filter((run) => !kept.includes(run.run_id));
  return {
    ok: true,
    lines: [
      ...notes,
      `added run ${block.run_id} (${block.date}, commit ${block.commit}) to ${filePath}`,
      ...dropped.map((run) => `dropped run ${run.run_id} (${run.date}): the file keeps the first measured run and the ${MAX_REGRESSION_RUNS - 1} latest`),
      `the file now holds ${kept.length} of at most ${MAX_REGRESSION_RUNS} runs, and its updated date is ${after.updated}`,
      "next: node scripts/build-site.mjs, then the tests, then commit the file",
    ],
  };
}

function parseArgs(argv) {
  const opts = { command: argv[0] ?? "", rest: [], file: DEFAULT_FILE };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--file") {
      i += 1;
      if (argv[i] === undefined) return null;
      opts.file = argv[i];
    } else if (argv[i].startsWith("--")) return null;
    else opts.rest.push(argv[i]);
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!opts || (opts.command === "check" && opts.rest.length !== 0) || (opts.command === "merge-run" && opts.rest.length !== 1)) {
    console.error(USAGE);
    return 2;
  }
  if (opts.command === "check") {
    const problems = fileProblems(opts.file);
    if (problems.length === 0) {
      console.log(`ok: ${opts.file} is valid`);
      return 0;
    }
    for (const line of problems) console.error(line);
    console.error(`${problems.length} ${problems.length === 1 ? "problem" : "problems"} in ${opts.file}`);
    return 1;
  }
  if (opts.command === "merge-run") {
    const result = mergeRunFile(opts.rest[0], opts.file);
    for (const line of result.lines) (result.ok ? console.log : console.error)(line);
    return result.ok ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

// Run only when this file is the program, so a test can load the functions above.
const runningAsMain = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (runningAsMain) process.exit(main(process.argv.slice(2)));
