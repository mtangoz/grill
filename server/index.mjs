#!/usr/bin/env node
/**
 * Grill's MCP server: the outside judge as a tool any MCP client can call, including Claude
 * Desktop chat, Claude Code and Cowork. Zero dependencies: JSON-RPC 2.0 over newline-delimited
 * stdio.
 *
 * The judge itself runs as a child process (../scripts/judge.mjs). Every rule about models,
 * privacy and verdicts lives there; this file only moves bytes, and a judge that crashes can't
 * take the server down with it.
 *
 * WHY TWO TOOLS. A judge takes 1–3 minutes, and some chat clients give a tool call about a
 * minute. `grill` waits up to GRILL_WAIT_MS (default 45 s), then returns either the report or a
 * job id. `grill_result` waits again on that job, as many times as it takes. A slow judge never
 * times out a chat.
 *
 * THE KEY. GRILL_API_KEY (filled from the install dialog) wins, then OPENROUTER_API_KEY from the
 * environment, then the key file `node scripts/judge.mjs --set-key` writes (scripts/apiKey.mjs). It goes into the judge's environment and nowhere else: it is never returned,
 * logged or echoed.
 *
 * WHO WROTE IT. A host that is not Claude (Cursor, VS Code with Copilot, Codex, Gemini CLI) sets
 * GRILL_AUTHOR in its MCP config, for example `openai` for Codex. The judge then excludes that
 * company, even when the assistant leaves the tool's `author` field empty. A value the tool call
 * sends still wins. Unset, the judge excludes Anthropic, as before.
 *
 * AS A COMMAND. `npx -y grillyour` with no arguments is this MCP server over stdio. With
 * `--set-key` it saves a key from stdin to the key file (scripts/apiKey.mjs), so an MCP config
 * never has to hold the key. `--key-status`, `--version` and `--help` print and exit.
 *
 * THE QUALITY CHECK. GRILL_CHECK (the install dialog's "Quality check with Jev" setting) set to
 * "true" or "1" passes --check, which also sends the masked write-up to Jev on OpenRouter; see
 * scripts/checkCore.mjs. That setting is the ONLY switch on this path: JUDGE_CHECK is removed
 * from the judge's environment, so a variable left in the host's shell cannot start a data flow
 * the setting says is off.
 *
 * GRILL NEWS. After a finished report, one line, at most once per process, until NEWS_UNTIL,
 * and only within NEWS_RELEASE_WINDOW_DAYS of RELEASE_DATE or on the first NEWS_MONTH_START_DAYS
 * of a UTC month. Outside those windows it adds nothing. It is text only: no network call, no
 * file, no email. GRILL_NEWS off hides it. An unset value or an unfilled ${…} placeholder leaves
 * it on, the same rule as GRILL_CHECK. A test can pass GRILL_NOW as an ISO time.
 *
 * DEEPEN TEST. Off unless GRILL_DEEPEN_TEST is exactly true, 1, on or yes. When it is on, and the
 * person already marked the decision as big, layer 1's closing line may name deepen. The judge
 * answers four depth questions only after that, when grill_result is called with detail deepen.
 * Nothing is written to disk for it. The write-up goes to the same judge again, and nowhere new.
 *
 * USAGE STATS. Off unless GRILL_USAGE_STATS is exactly true, 1, on or yes. That is the opposite
 * of GRILL_CHECK and GRILL_NEWS. GRILL_PING=off (also false, 0, no) and DO_NOT_TRACK=1 always
 * win. One metadata ping may go to Grill's site after the first successful grill, and never
 * again. It never includes the write-up. The state file is created only when the setting is
 * on, and it only records that the ping was sent. The report is returned without waiting.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { keyFilePath, maskKey, resolveApiKey, saveApiKey } from "../scripts/apiKey.mjs";
import {
  CLOSING_ASK,
  CLOSING_ASK_DEEPEN,
  DEEPEN_OFF,
  DEEPEN_ONLY_BIG,
  SCOPE_GUARD,
  deepenTestEnabled,
  normalizeDetail,
  renderDeepen,
  renderLayers,
} from "../scripts/judgeCore.mjs";

/** First use only. One line. The privacy page holds the rest. Same words as the hosted connector. */
export const ONCE_DISCLOSURE =
  "This goes to an outside judge from a different company, and the router does not keep it. https://grillyour.ai/#privacy";
import { changesView, lookBack } from "../scripts/reflection.mjs";
import { scheduleUsagePing } from "../scripts/usageStats.mjs";

const VERSION = "0.1.1";
const JUDGE = fileURLToPath(new URL("../scripts/judge.mjs", import.meta.url));
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SETUP_URL = "https://github.com/mtangoz/grill#set-up";
const MAX_SUBJECT_CHARS = 200_000;
const MAX_QUESTION_CHARS = 600;
const MAX_PASTE_CHARS = 100_000;
const AUTHOR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function progressEveryMs() {
  const n = Number(process.env.GRILL_PROGRESS_MS);
  return Number.isInteger(n) && n >= 1 && n <= 30_000 ? n : 10_000;
}

function waitMs() {
  const n = Number(process.env.GRILL_WAIT_MS);
  return Number.isInteger(n) && n >= 1 && n <= 55_000 ? n : 45_000;
}

/**
 * Test-only clock, used for the first wait only. GRILL_CLOCK_STEP_MS makes each read jump
 * forward, so that wait is already over on the second read. A fast fixture then cannot finish
 * inside the wait and skip the job id. Later waits use Date.now(), so grill_result can collect
 * the job. Unset in normal use.
 */
let waitClockSpent = false;
function waitClock() {
  if (waitClockSpent) return null;
  const step = Number(process.env.GRILL_CLOCK_STEP_MS);
  if (!Number.isInteger(step) || step < 1 || step > 60_000) return null;
  waitClockSpent = true;
  const start = Number(process.env.GRILL_CLOCK_MS);
  let t = Number.isFinite(start) ? start : 0;
  return () => {
    const value = t;
    t += step;
    return value;
  };
}

/** GRILL_AUTHOR from the host's config: a model-family name, or "" when unset or not one. */
function defaultAuthor(env = process.env) {
  const value = typeof env.GRILL_AUTHOR === "string" ? env.GRILL_AUTHOR.trim().toLowerCase() : "";
  return AUTHOR_RE.test(value) ? value : "";
}

/** The user's key: the install dialog, the environment, then the key file (../scripts/apiKey.mjs). */
function apiKey(env = process.env) {
  return resolveApiKey(env).key;
}

/**
 * Is the quality check switched on? ON BY DEFAULT (founder decision, 2026-09-26): a check on a
 * zero-retention endpoint, on the already-masked write-up, is part of what a grill is. Only an
 * explicit off turns it off: "false", "0", "off" or "no", in any case. An unset variable, an empty
 * one or an unfilled `${…}` placeholder means the user never changed the default, so it stays on.
 */
function checkEnabled(env = process.env) {
  const value = typeof env.GRILL_CHECK === "string" ? env.GRILL_CHECK.trim().toLowerCase() : "";
  return !["false", "0", "off", "no"].includes(value);
}

/** 45 days after 2026-09-29, the release that adds this line. The line stops after this date. */
export const NEWS_UNTIL = "2026-11-13";
export const NEWS_URL = "https://grillyour.ai/notify?via=tool";
const NEWS_END = Date.parse(`${NEWS_UNTIL}T23:59:59.999Z`);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * YYYY-MM-DD of this build, UTC. Release and bundle builds rewrite this line in the artifact
 * (scripts/releaseDate.mjs). A checkout uses the date written here. Reading it takes no network
 * call and no disk write.
 */
export const RELEASE_DATE = "2026-09-29";

/** Show the line when the UTC day is at most this many days before or after RELEASE_DATE. */
export const NEWS_RELEASE_WINDOW_DAYS = 7;

/** Show the line on UTC day-of-month 1 through this number. */
export const NEWS_MONTH_START_DAYS = 3;

/**
 * Show the news line? On by default. Only an explicit off turns it off: "false", "0", "off" or
 * "no". An unset variable, an empty one, or an unfilled `${…}` placeholder stays on.
 */
export function newsEnabled(env = process.env) {
  const value = typeof env.GRILL_NEWS === "string" ? env.GRILL_NEWS.trim().toLowerCase() : "";
  return !["false", "0", "off", "no"].includes(value);
}

export function newsOpen(now = Date.now()) {
  return now <= NEWS_END;
}

/** UTC calendar-day index, or NaN when `ms` is not a time. */
function utcDayIndex(ms) {
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return NaN;
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
}

/** UTC day index of a YYYY-MM-DD stamp, or NaN when it is not a real calendar day. */
function releaseDayIndex(releaseDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(releaseDate);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return NaN;
  return Math.floor(ms / DAY_MS);
}

export function inReleaseWindow(now = Date.now(), releaseDate = RELEASE_DATE) {
  const today = utcDayIndex(now);
  const release = releaseDayIndex(releaseDate);
  if (!Number.isFinite(today) || !Number.isFinite(release)) return false;
  return Math.abs(today - release) <= NEWS_RELEASE_WINDOW_DAYS;
}

export function inMonthStart(now = Date.now()) {
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return false;
  const day = date.getUTCDate();
  return day >= 1 && day <= NEWS_MONTH_START_DAYS;
}

/** True on a UTC day inside the release window or the month-start window. The end date is separate. */
export function newsInWindow(now = Date.now(), releaseDate = RELEASE_DATE) {
  return inReleaseWindow(now, releaseDate) || inMonthStart(now);
}

export function newsLine() {
  return [
    "---",
    `Grill news: saved decision history and look-back reminders are coming as an optional Pro plan. The free tool stays free and account-free. To hear when they arrive, leave your email at ${NEWS_URL} (one confirmation, one launch email, unsubscribe anytime). Turn this off in Grill's settings ("Show Grill news"). It stops by itself after ${NEWS_UNTIL}.`,
  ].join("\n");
}

/** A test can pass GRILL_NOW as an ISO time. Anything else, including an unfilled placeholder, is the real clock. */
function nowMs(env = process.env) {
  const raw = typeof env.GRILL_NOW === "string" ? env.GRILL_NOW.trim() : "";
  if (raw && !raw.startsWith("${")) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

const newsState = { shown: false };

/**
 * Append the news line once, and only onto a finished report, and only inside a window before
 * NEWS_UNTIL. Skipping a window does not use up the one line. `state` is per process unless a
 * test passes its own. `now` is the clock (tests inject it; the server passes GRILL_NOW).
 */
export function withNews(report, { env = process.env, now = Date.now(), state = newsState, releaseDate = RELEASE_DATE } = {}) {
  if (!report || state.shown || !newsEnabled(env) || !newsOpen(now) || !newsInWindow(now, releaseDate)) return report;
  state.shown = true;
  return `${String(report).replace(/\s*$/, "")}\n\n${newsLine()}\n`;
}

const SETUP_TEXT = [
  "Grill isn't set up yet: it needs a key for its model router, OpenRouter.",
  "1. Create one at https://openrouter.ai/keys. Sign in, and add a few dollars of credit; a grill costs about a cent.",
  "2. Paste it into Grill's settings where you installed it (Claude Desktop: Settings → Extensions → Grill).",
  "   Or save it once for every app on this computer: run `npx -y grillyour --set-key` in a terminal, paste the key, press Enter, then Ctrl-D.",
  `Step-by-step: ${SETUP_URL}`,
  "Have Grill Pro? Sign in at https://grillyour.ai/pro and paste the managed key into the same place. You can also set the judge model there.",
  "Until then, the grill skill can write the subject as a prompt for you to paste into ChatGPT or Gemini instead.",
].join("\n");

// The user must know who sees the write-up before they approve it, and whether the Jev check is
// one of them depends on their setting. The server knows the setting, so it says so here, where
// Claude reads it before every call. (A setting change restarts the server, so this stays true.)
// Hosted Grill imports this same text so the two cannot drift.
export function buildGrillTools({ checkOn }) {
  const checkNote = checkOn
    ? "A quality check (Jev, from TypeSafe) may also see the masked write-up, on a zero-retention endpoint. Do not put that into the once-only line. The privacy link covers it. Do not mention the check or its score again. Pass quality_check: false only if the user asks to skip it."
    : "The quality check is off, so only the judge sees the write-up. Leave Jev out of the once-only sentence, and do not mention the check.";
  const description = [
    "Send a decision, plan or forecast to an outside AI judge: a model from a different company than the assistant that wrote it (Claude, unless set otherwise).",
    "The judge is picked by openrouter/auto. Do not pin a model, and do not fall back to this chat's own model for speed or cost.",
    "Send the decision as the user stated it, with whatever context is already in the chat. Do not rewrite it into a template, and do not add your own case against.",
    "Ask at most one short question, and only if the decision is truly unclear, such as 'What's the goal?'. Then call this tool. Do not wait for an OK, and do not show a write-up full of blanks.",
    "Never add a required question before the verdict on a quick or bulk grill. Ask only what the subject strictly needs.",
    `The first time you use Grill with this person, say once, as one line, and not again: ${ONCE_DISCLOSURE}`,
    checkNote,
    "After that, do not repeat the disclosure. Do not mention the judge's model, a score, a balance, or a quote check.",
    "Relay layer 1 as written. It is at most 50 words and already ends with: " +
      CLOSING_ASK +
      " On a decision they marked as big, and only while the deepen test is on, that line may also name deepen. Relay whichever line came back. Do not add deepen yourself. Do not add a fact list, a confidence question, a record, or a disclaimer.",
    "When the user says more, why, or what else, call grill_result with detail more. When they say options, help me decide, or they are stuck, call grill_result with detail options. When they say full report, call grill_result with detail full. Do not write a layer yourself.",
    "Call grill_result with detail deepen only when the person asks to deepen or go bigger. Do not call it on a quick or bulk grill, and do not ask them to. Pass big: true only when they already marked the decision as big. Never ask whether it is big.",
    "Any stated choice counts, such as do it, yes, keep it, or delay. Confidence is optional. If they did not say a percent, leave it empty and do not ask.",
    SCOPE_GUARD,
    "If Grill's settings name a judge model, that model is used, and it must be from a different company than the assistant that wrote the subject. A same-company pin is refused. Leave it blank to use Grill's default.",
    "If the result is a job id, call grill_result with it before you reply. Do not ask the user for a job id, and do not tell them how long it takes.",
  ].join(" ");
  return [
    {
      name: "grill",
      title: "Grill a decision",
      description,
      inputSchema: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "The decision as the user stated it, plus context already in the chat. Not a template, and not a case against you wrote.",
          },
          question: {
            type: "string",
            description: "Optional. Leave it empty unless the user asked a question of their own. Do not invent one.",
          },
          author: {
            type: "string",
            description:
              "Optional. The model family that wrote the subject, if not Claude, for example openai, google or xai. That family is excluded from judging. If you are not Claude, always set it to your own family.",
          },
          quality_check: {
            type: "boolean",
            description:
              "Optional. false skips the Jev quality check for this grill only, when the user asks. It never turns on a check the user switched off in settings.",
          },
          big: {
            type: "boolean",
            description:
              "Optional. true only when the person already marked this decision as big. Never ask whether it is big. Leave it off on a quick or bulk grill. It changes nothing before the verdict.",
          },
        },
        required: ["subject"],
        additionalProperties: false,
      },
      annotations: { title: "Grill a decision", readOnlyHint: true, openWorldHint: true },
    },
    {
      name: "grill_result",
      title: "Collect a grill that was still running",
      description:
        "Collect a grill that returned a job id, or a later layer of one. detail is brief (the default), more, options, full, or deepen. Call detail deepen only when the person asks to deepen or go bigger. Pass job_id when you have one. Omit it to use the latest grill. Waits up to 45 seconds if it is still running. Do not write a layer yourself.",
      inputSchema: {
        type: "object",
        properties: {
          job_id: { type: "string", description: "The job id the grill tool returned. Omit it to use the latest grill in this session." },
          detail: {
            type: "string",
            enum: ["brief", "more", "options", "full", "deepen"],
            description:
              "brief is layer 1. more is the next challenge, for more, why, or what else. options is a short decision frame. full is only when they ask for a full report. deepen is only when the person asks to deepen or go bigger.",
          },
        },
        additionalProperties: false,
      },
      annotations: { title: "Collect a grill", readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "grill_look_back",
      title: "Look back at a decision record",
      description:
        "Score one or more decision records the user pasted, against what actually happened. If they have not said what happened, ask. With view changes, show where their calls changed after a challenge instead. Stores nothing, sends nothing, and needs no key. The judge's verdict is not revised.",
      inputSchema: {
        type: "object",
        properties: {
          records: {
            type: "string",
            description: "One or more decision record blocks from earlier grills, pasted by the user.",
          },
          happened: {
            type: "string",
            description:
              "Optional. What actually happened, including whether each call came true, whether the falsifier fired, and an optional surprise line. Omit it to get the questions first.",
          },
          view: {
            type: "string",
            enum: ["score", "changes"],
            description:
              "Optional. score is the usual look-back. changes is for 'what has Grill done for me?': where a call changed after a challenge, before and after in their words, and how it turned out so far. Relay it as written.",
          },
        },
        required: ["records"],
        additionalProperties: false,
      },
      annotations: { title: "Look back", readOnlyHint: true, openWorldHint: false },
    },
  ];
}

const TOOLS = buildGrillTools({ checkOn: checkEnabled() });

const jobs = new Map();

/** The judge model from settings. An empty install-dialog placeholder is the same as unset. */
function configuredJudgeModel(env = process.env) {
  const raw = typeof env.JUDGE_MODEL === "string" ? env.JUDGE_MODEL.trim() : "";
  if (!raw || raw.startsWith("${")) return "";
  return raw;
}

/** Same company rule as api/_account.mjs. Empty means Grill's default chain, which is allowed. */
function judgePinConflicts(model, author) {
  const primary = String(model).split(",")[0].trim().toLowerCase();
  if (!primary || primary.startsWith("openrouter/")) return false;
  const pin = /(^|[/.])claude[-.\d]/.test(primary) ? "anthropic" : primary.split("/")[0] === "x-ai" ? "xai" : primary.split("/")[0];
  const declared = String(author || "anthropic").trim().toLowerCase();
  const family = declared === "x-ai" || declared === "xai" ? "xai" : declared === "claude" ? "anthropic" : declared;
  return pin === family;
}

function startJob({ subject, question, author, skipCheck, big = false }) {
  const id = randomUUID().slice(0, 8);
  const dir = mkdtempSync(join(tmpdir(), "grill-"));
  const args = [JUDGE, "--json", "--out", join(dir, "report.md")];
  if (question) args.push("--question", question);
  if (author) args.push("--author", author);
  if (checkEnabled() && !skipCheck) args.push("--check");
  const env = { ...process.env, OPENROUTER_API_KEY: apiKey() };
  delete env.JUDGE_CHECK; // the setting above decides, never an inherited variable
  const model = configuredJudgeModel(env);
  if (model) env.JUDGE_MODEL = model;
  else delete env.JUDGE_MODEL;
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d;
  });
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const job = { id, startedAt: Date.now(), done: false, outcome: null, child, subject, question, author, big: big === true };
  job.promise = new Promise((resolve) => {
    const finish = (code, error) => {
      if (job.done) return;
      let report = "";
      try {
        report = readFileSync(join(dir, "report.md"), "utf8");
      } catch {
        // No report means the judge did not finish; its stderr says why.
      }
      rmSync(dir, { recursive: true, force: true });
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
      job.done = true;
      job.outcome = { code, report, stderr, error, parsed };
      const finished = code === 0 && typeof report === "string" && report.trim().length > 0;
      try {
        scheduleUsagePing({
          ok: finished,
          ms: Date.now() - job.startedAt,
          version: VERSION,
        });
      } catch {
        // The ping is optional. A throw here must not drop the report.
      }
      resolve(job.outcome);
    };
    child.on("close", (code) => finish(code, null));
    child.on("error", (e) => finish(null, e.message));
  });
  child.stdin.on("error", () => {}); // a judge that exits early must not crash the server
  child.stdin.end(subject);
  jobs.set(id, job);
  return job;
}

async function waitFor(job, ms, onTick) {
  const clock = waitClock();
  const now = clock || Date.now;
  const deadline = now() + ms;
  while (!job.done && now() < deadline) {
    let timer;
    const tick = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.min(progressEveryMs(), Math.max(0, deadline - now())));
    });
    await Promise.race([job.promise, tick]);
    clearTimeout(timer);
    if (!job.done) onTick?.(Math.round((Date.now() - job.startedAt) / 1000));
  }
  return job.done;
}

function text(t, isError = false) {
  return { content: [{ type: "text", text: t }], isError };
}

function latestJob() {
  let best = null;
  for (const job of jobs.values()) {
    if (!best || job.startedAt >= best.startedAt) best = job;
  }
  return best;
}

function rememberLayers(job) {
  if (job.layers) return job.layers;
  const parsed = job.outcome?.parsed || {};
  job.layers = renderLayers(parsed, { subject: job.subject || "", big: job.big === true, deepenTest: deepenTestEnabled() });
  return job.layers;
}

function finishBrief(brief) {
  const body = String(brief || "").trim();
  const ask = body.endsWith(CLOSING_ASK_DEEPEN) ? CLOSING_ASK_DEEPEN : CLOSING_ASK;
  const note = body.endsWith(ask) ? body.slice(0, -ask.length).trim() : body;
  const lined = withNews(note, { now: nowMs() }).trim();
  return `${lined}\n\n${ask}\n`;
}

function runDeepen(job) {
  return new Promise((resolve) => {
    const args = [JUDGE, "--json", "--deepen"];
    if (job.question) args.push("--question", job.question);
    if (job.author) args.push("--author", job.author);
    const env = { ...process.env, OPENROUTER_API_KEY: apiKey() };
    delete env.JUDGE_CHECK;
    const fixture = typeof process.env.JUDGE_DEEPEN_FIXTURE === "string" ? process.env.JUDGE_DEEPEN_FIXTURE.trim() : "";
    if (fixture) env.JUDGE_FIXTURE = fixture;
    else delete env.JUDGE_FIXTURE;
    const model = configuredJudgeModel(env);
    if (model) env.JUDGE_MODEL = model;
    else delete env.JUDGE_MODEL;
    const child = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", () => {});
    const finish = (line) => {
      job.deepenText = line;
      resolve(line);
    };
    child.on("error", () => finish("The judge did not answer the four depth questions.\n"));
    child.on("close", () => {
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = null;
      }
      const note = renderDeepen(parsed?.depth);
      finish(note ? `${note.trim()}\n` : "The judge did not answer the four depth questions.\n");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(job.subject || "");
  });
}

async function deepenLayer(job) {
  if (!deepenTestEnabled()) return `${DEEPEN_OFF}\n`;
  if (job.big !== true) return `${DEEPEN_ONLY_BIG}\n`;
  if (job.deepenText) return job.deepenText;
  if (!job.deepenPromise) job.deepenPromise = runDeepen(job);
  let timer;
  const done = await Promise.race([
    job.deepenPromise.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), waitMs());
    }),
  ]);
  clearTimeout(timer);
  if (!done) {
    return `Still writing the deeper plan (job ${job.id}). Call grill_result again with job_id "${job.id}" and detail "deepen".\n`;
  }
  return job.deepenText;
}

async function outcomeOf(job, detail = "brief") {
  const { code, report, stderr, error, parsed } = job.outcome;
  if (parsed || report) {
    const layers = rememberLayers(job);
    const key = normalizeDetail(detail);
    if (key === "deepen") return text(await deepenLayer(job));
    if (key !== "brief") return text(`${String(layers[key] || "").trim()}\n`);
    if (!job.briefText) job.briefText = finishBrief(layers.brief);
    return text(job.briefText);
  }
  jobs.delete(job.id);
  const why = error ?? (stderr.split("\n").filter((l) => l.includes("ERROR")).join("\n") || `the judge exited ${code}`);
  return text(`The grill did not finish: ${why}`, true);
}

function pending(job) {
  const secs = Math.round((Date.now() - job.startedAt) / 1000);
  return text(
    `Still grilling (job ${job.id}, ${secs}s so far). Call grill_result with job_id "${job.id}" to collect the report. A grill usually takes 1–3 minutes.`,
  );
}

async function callTool(name, args = {}, onTick) {
  if (name === "grill") {
    const subject = typeof args.subject === "string" ? args.subject : "";
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const author = (typeof args.author === "string" ? args.author.trim().toLowerCase() : "") || defaultAuthor();
    const skipCheck = args.quality_check === false; // off for this grill only; never switches it on
    if (!subject.trim()) return text("There's no decision to grill. Send the decision as the user stated it.", true);
    if (subject.length > MAX_SUBJECT_CHARS) return text(`The subject is ${subject.length} characters; trim it under ${MAX_SUBJECT_CHARS}.`, true);
    if (question.length > MAX_QUESTION_CHARS) return text(`The question is over ${MAX_QUESTION_CHARS} characters; shorten it.`, true);
    if (author && !AUTHOR_RE.test(author)) return text("author must be a lowercase model-family name, like openai.", true);
    if (!apiKey()) return text(SETUP_TEXT, true);
    const judgeModel = configuredJudgeModel();
    if (judgeModel && judgePinConflicts(judgeModel, author)) {
      return text(
        `Grill's judge model is set to ${judgeModel}, the same company as the assistant that wrote this${author ? ` (${author})` : ""}. Pick a judge from a different company, or clear the judge model to use Grill's default.`,
        true,
      );
    }
    const job = startJob({ subject, question, author, skipCheck, big: args.big === true });
    return (await waitFor(job, waitMs(), onTick)) ? await outcomeOf(job, "brief") : pending(job);
  }
  if (name === "grill_result") {
    const id = typeof args.job_id === "string" ? args.job_id.trim() : "";
    const job = id ? jobs.get(id) : latestJob();
    if (!job) return text("No grill is waiting. Start one with the grill tool.", true);
    const detail = normalizeDetail(args.detail);
    return (await waitFor(job, waitMs(), onTick)) ? await outcomeOf(job, detail) : pending(job);
  }
  if (name === "grill_look_back") {
    const records = typeof args.records === "string" ? args.records : "";
    const happened = typeof args.happened === "string" ? args.happened : "";
    if (!records.trim()) return text("Paste one or more decision records. Grill stores nothing either way.", true);
    if (records.length > MAX_PASTE_CHARS || happened.length > MAX_PASTE_CHARS) {
      return text("That paste is too long. Split it under 100,000 characters.", true);
    }
    return text(args.view === "changes" ? changesView({ records, happened }) : lookBack({ records, happened }));
  }
  return text(`Unknown tool: ${name}`, true);
}

// ── JSON-RPC over stdio ──────────────────────────────────────────────────────
function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg ?? {};
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      send({
        id,
        result: {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "grill", title: "Grill", version: VERSION },
          instructions:
            "Grill sends the decision as the user stated it to an outside judge from a different company. Do not rewrite it, do not add your own case against, and do not wait for an OK. Ask at most one short question, and only if the decision is truly unclear. The first time, say the outside-judge disclosure once, as one line, then never again. If grill returns a job id, call grill_result before you reply. Do not ask the user for a job id. Relay layer 1 as written. It is at most 50 words and already ends with the next-step line. Do not add a fact list or a confidence question. When the user says more, why, or what else, call grill_result with detail more. When they say options, help me decide, or they are stuck, call grill_result with detail options. When they say full report, call grill_result with detail full. Call grill_result with detail deepen only when the person asks to deepen or go bigger. Do not call it on a quick or bulk grill, and do not ask them to. Do not write a layer yourself. Do not show a record, the judge's model, a score, a balance, a quote check, or a disclaimer. The verdict never becomes the decision. If the user asks 'so should I do it?', hand the choice back and name the deciding test. Do not flip the verdict on push-back without new evidence. If the same decision is grilled again in the chat, ask what changed. Nothing changed is a re-run: show the earlier verdict beside the new one, and do not add a supersedes line. A changed choice names the earlier record and what changed. Never send the earlier verdict to the judge. Write a decision record only after the user states a choice, including a quick take. Any stated choice counts, such as do it, yes, keep it, or delay. Confidence is optional. If they did not say a percent, leave it empty and do not ask. If they never answer, write no record and set no look-back. When they say look back, call grill_look_back and relay its one line. It stores nothing. If the report ends with a 'Grill news' line, show it once, word for word, after the note and before the next-step line. The tool adds it only within 7 days of a release or on the first 3 days of a month. Don't ask about it or repeat it. " +
              SCOPE_GUARD,
        },
      });
      return;
    }
    case "ping":
      if (isRequest) send({ id, result: {} });
      return;
    case "tools/list":
      send({ id, result: { tools: TOOLS } });
      return;
    case "tools/call": {
      const token = params?._meta?.progressToken;
      const onTick =
        token === undefined
          ? undefined
          : (secs) =>
              send({
                method: "notifications/progress",
                params: { progressToken: token, progress: secs, message: `The judge is still thinking (${secs}s)` },
              });
      try {
        send({ id, result: await callTool(params?.name, params?.arguments ?? {}, onTick) });
      } catch (e) {
        send({ id, result: text(`Grill failed: ${e?.message ?? e}`, true) });
      }
      return;
    }
    default:
      if (isRequest) send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
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

const HELP = `Grill ${VERSION}: an outside AI judge for your decisions, as an MCP server.

  npx -y grillyour                 run the MCP server over stdio (what an app's MCP config starts)
  npx -y grillyour --set-key       save your model router key: paste it, press Enter, then Ctrl-D
  npx -y grillyour --key-status    say where the key comes from, without printing it
  npx -y grillyour --version

Setup for each app: ${SETUP_URL.replace("#set-up", "/blob/main/docs/ANY-APP.md")}`;

/** The command-line flags. Returns true when one was handled and the process should exit. */
function runCommand(argv) {
  const flag = argv[0];
  if (!flag) return false;
  if (flag === "--help" || flag === "-h") console.log(HELP);
  else if (flag === "--version" || flag === "-v") console.log(VERSION);
  else if (flag === "--key-status") {
    const found = resolveApiKey();
    if (!found.key) console.log(`No key yet. GRILL_API_KEY and OPENROUTER_API_KEY are unset and ${keyFilePath()} has none. Run: npx -y grillyour --set-key`);
    else console.log(`Key found: ${found.source} (${maskKey(found.key)})`);
    if (found.warning) console.log(`Warning: ${found.warning}`);
  } else if (flag === "--set-key") {
    let input = "";
    try {
      input = readFileSync(0, "utf8");
    } catch {
      // no stdin: saveApiKey reports the empty key
    }
    try {
      console.log(`Key saved to ${saveApiKey(input)} (only you can read it). Every Grill on this computer uses it.`);
    } catch (e) {
      console.error(`Not saved: ${e.message}. Paste the key, press Enter, then Ctrl-D. Never put it on the command line.`);
      process.exitCode = 1;
    }
  } else {
    console.error(`Unknown option ${flag}.\n\n${HELP}`);
    process.exitCode = 1;
  }
  return true;
}

if (runningAsMain() && !runCommand(process.argv.slice(2))) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      handle(m).catch((e) => console.error(`[grill] ${e?.message ?? e}`));
    }
  });
  rl.on("close", () => {
    for (const job of jobs.values()) if (!job.done) job.child.kill();
    process.exit(0);
  });
}
