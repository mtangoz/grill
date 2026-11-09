#!/usr/bin/env node
/**
 * Optional Monday PostHog readout for Grill's own project.
 * Needs GRILL_POSTHOG_PERSONAL_API_KEY (phx_...) and GRILL_POSTHOG_PROJECT_ID on the box.
 * Never uses another company's PostHog. Prints counts only. Off = quiet exit 0.
 *
 *   node scripts/posthogReadout.mjs
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TRACKED_EVENTS } from "./siteAnalytics.mjs";

const HOSTS = {
  eu: "https://eu.posthog.com",
  us: "https://us.posthog.com",
};

export function posthogReadoutConfig(env = process.env) {
  const key = typeof env.GRILL_POSTHOG_PERSONAL_API_KEY === "string" ? env.GRILL_POSTHOG_PERSONAL_API_KEY.trim() : "";
  const projectId = typeof env.GRILL_POSTHOG_PROJECT_ID === "string" ? env.GRILL_POSTHOG_PROJECT_ID.trim() : "";
  if (!key || !projectId) return null;
  if (!/^phx_[A-Za-z0-9]+$/.test(key)) {
    const err = new Error("GRILL_POSTHOG_PERSONAL_API_KEY must be a personal API key (phx_...)");
    err.code = "bad_key";
    throw err;
  }
  if (!/^\d+$/.test(projectId)) {
    const err = new Error("GRILL_POSTHOG_PROJECT_ID must be digits");
    err.code = "bad_project";
    throw err;
  }
  const region = (typeof env.GRILL_POSTHOG_REGION === "string" ? env.GRILL_POSTHOG_REGION.trim() : "eu") || "eu";
  const host = HOSTS[region];
  if (!host) {
    const err = new Error("GRILL_POSTHOG_REGION must be eu or us");
    err.code = "bad_region";
    throw err;
  }
  return { key, projectId, host };
}

/** HogQL that returns event name and count for the last 7 days. */
export function eventsQuery(days = 7) {
  const allow = ["$pageview", ...TRACKED_EVENTS].map((e) => `'${e}'`).join(", ");
  return `SELECT event, count() AS n FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND event IN (${allow}) GROUP BY event ORDER BY n DESC`;
}

export async function readPosthogReadout(env = process.env, fetchImpl = globalThis.fetch) {
  const cfg = posthogReadoutConfig(env);
  if (!cfg) {
    const err = new Error("not configured");
    err.code = "unconfigured";
    throw err;
  }
  const url = `${cfg.host}/api/projects/${cfg.projectId}/query/`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: eventsQuery(7) } }),
  });
  if (!res.ok) {
    const err = new Error("PostHog query failed");
    err.code = "query_failed";
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const rows = Array.isArray(body?.results) ? body.results : [];
  return {
    label: "PostHog readout",
    days: 7,
    countsAsUsers: false,
    events: rows.map(([event, n]) => ({ event: String(event), n: Number(n) || 0 })),
  };
}

export function posthogReadoutLines(report) {
  if (!report?.events?.length) return ["posthog: no events in the last 7 days"];
  return [
    `posthog (last ${report.days} days):`,
    ...report.events.map((row) => `  ${row.event}: ${row.n}`),
  ];
}

async function main() {
  try {
    const report = await readPosthogReadout(process.env, globalThis.fetch);
    process.stdout.write(`${posthogReadoutLines(report).join("\n")}\n`);
  } catch (e) {
    if (e?.code === "unconfigured") {
      console.error("PostHog readout isn't configured (needs GRILL_POSTHOG_PERSONAL_API_KEY and GRILL_POSTHOG_PROJECT_ID).");
      process.exit(0);
    }
    console.error("PostHog readout couldn't be read.");
    process.exit(1);
  }
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

if (runningAsMain()) main();
