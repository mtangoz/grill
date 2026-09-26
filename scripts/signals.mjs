#!/usr/bin/env node
/**
 * The monthly learning report: read the public "signal" issues, aggregate, recommend.
 *
 *   node scripts/signals.mjs [--repo owner/name] [--period 2026-10] [--from-file issues.json]
 *
 * GITHUB_TOKEN is optional; it only raises the API rate limit. --from-file reads a saved array of
 * issues instead of the API, for tests and offline use. A maintainer tool: it is not part of the
 * extension or the plugin a user installs.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { aggregate, parseSignal, recommend, renderReport } from "./signalsCore.mjs";

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}

async function fetchIssues(repo) {
  const issues = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues?labels=signal&state=all&per_page=100&page=${page}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}`);
    const batch = await res.json();
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return issues;
}

const repo = arg("repo", process.env.GITHUB_REPOSITORY || "mtangoz/grill");
const file = arg("from-file");
const issues = file ? JSON.parse(readFileSync(file, "utf8")) : await fetchIssues(repo);
const parsed = issues.map((i) => parseSignal(i.body));
const signals = parsed.filter(Boolean);
const agg = aggregate(signals);
const report = renderReport(agg, recommend(agg), { dropped: parsed.length - signals.length, period: arg("period") });
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
