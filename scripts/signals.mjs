#!/usr/bin/env node
/**
 * The monthly learning report: read the public signal issues, aggregate, recommend.
 *
 *   node scripts/signals.mjs [--repo owner/name] [--period 2026-10] [--from-file issues.json]
 *
 * From the API it lists every issue in the repository and keeps the signal issues: one that
 * carries the "signal" label, or one whose title is exactly the form's title (isSignalIssue in
 * signalsCore.mjs). GITHUB_TOKEN is optional; it only raises the API rate limit.
 *
 * --from-file reads a saved array of signal issues instead of the API, for tests and offline
 * use. Every entry in the file is read. Nothing is left out by label or title.
 *
 * When GITHUB_OUTPUT is set, `signals=<count>` is appended: how many on-form signals the report
 * counted. The learn workflow reads it and posts nothing when the count is 0.
 *
 * A maintainer tool: it is not part of the extension or the plugin a user installs.
 */
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aggregate, isSignalIssue, parseSignal, recommend, renderReport } from "./signalsCore.mjs";

const PER_PAGE = 100;
/** 20,000 issues and pull requests. Past that the run fails, so a report is never quietly short. */
const MAX_PAGES = 200;

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}

/**
 * Every signal issue in the repository, open or closed. The list is not narrowed by label on
 * GitHub's side, because a signal can arrive without its label. isSignalIssue picks them here.
 */
export async function fetchSignalIssues(repo, { fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN, maxPages = MAX_PAGES } = {}) {
  const found = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues?state=all&per_page=${PER_PAGE}&page=${page}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(`GitHub API returned no list of issues for ${repo}`);
    for (const issue of batch) {
      if (!isSignalIssue(issue)) continue;
      // Keyed by issue number: a later page can repeat an issue when a new one is filed mid-read.
      found.set(Number.isInteger(issue.number) ? issue.number : `row ${found.size}`, issue);
    }
    if (batch.length < PER_PAGE) return [...found.values()];
  }
  throw new Error(`${repo} has more than ${maxPages * PER_PAGE} issues and pull requests, so the report would be incomplete`);
}

async function main() {
  const repo = arg("repo", process.env.GITHUB_REPOSITORY || "mtangoz/grill");
  const file = arg("from-file");
  const issues = file ? JSON.parse(readFileSync(file, "utf8")) : await fetchSignalIssues(repo);
  const parsed = issues.map((i) => parseSignal(i.body));
  const signals = parsed.filter(Boolean);
  const agg = aggregate(signals);
  const report = renderReport(agg, recommend(agg), { dropped: parsed.length - signals.length, period: arg("period") });
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `signals=${agg.counts.signals}\n`);
}

function runningAsMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath(import.meta.url);
  if (entry === self) return true;
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    return false;
  }
}

if (runningAsMain()) await main();
