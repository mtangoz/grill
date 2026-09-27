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
 * environment. It goes into the judge's environment and nowhere else: it is never returned,
 * logged or echoed.
 *
 * THE QUALITY CHECK. GRILL_CHECK (the install dialog's "Quality check with Jev" setting) set to
 * "true" or "1" passes --check, which also sends the masked write-up to Jev on OpenRouter; see
 * scripts/checkCore.mjs. That setting is the ONLY switch on this path: JUDGE_CHECK is removed
 * from the judge's environment, so a variable left in the host's shell cannot start a data flow
 * the setting says is off.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const JUDGE = fileURLToPath(new URL("../scripts/judge.mjs", import.meta.url));
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SETUP_URL = "https://github.com/mtangoz/grill#set-up";
const MAX_SUBJECT_CHARS = 200_000;
const MAX_QUESTION_CHARS = 600;
const AUTHOR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function progressEveryMs() {
  const n = Number(process.env.GRILL_PROGRESS_MS);
  return Number.isInteger(n) && n >= 1 && n <= 30_000 ? n : 10_000;
}

function waitMs() {
  const n = Number(process.env.GRILL_WAIT_MS);
  return Number.isInteger(n) && n >= 1 && n <= 55_000 ? n : 45_000;
}

/** The user's key. An unfilled install-dialog placeholder arrives as literal `${…}` text; that is no key. */
function resolveApiKey(env = process.env) {
  for (const raw of [env.GRILL_API_KEY, env.OPENROUTER_API_KEY]) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value && !value.startsWith("${")) return value;
  }
  return "";
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

const SETUP_TEXT = [
  "Grill isn't set up yet: it needs a key for its model router, OpenRouter.",
  "1. Create one at https://openrouter.ai/keys. Sign in, and add a few dollars of credit; a grill costs about a cent.",
  "2. Paste it into Grill's settings where you installed it (Claude Desktop: Settings → Extensions → Grill).",
  `Step-by-step: ${SETUP_URL}`,
  "Have Grill Pro? Sign in at https://grillyour.ai/pro and paste the managed key into the same place. You can also set the judge model there.",
  "Until then, the grill skill can write the subject as a prompt for you to paste into ChatGPT or Gemini instead.",
].join("\n");

// The user must know who sees the write-up before they approve it, and whether the Jev check is
// one of them depends on their setting. The server knows the setting, so it says so here, where
// Claude reads it before every call. (A setting change restarts the server, so this stays true.)
const CHECK_NOTE = checkEnabled()
  ? "The Jev quality check is ON: Jev, a decision model from TypeSafe, also sees the masked write-up and the report, on a zero-retention endpoint. Tell the user that before they approve, and that they can skip it for this grill (pass quality_check: false) or switch it off in Grill's settings."
  : "The Jev quality check is switched OFF in Grill's settings, so only the judge sees the write-up.";

const DESCRIPTION = [
  "Send a decision, plan or forecast to an outside AI judge: a model from a different company than Claude.",
  "It writes the strongest case for and against, names the cheapest test that would settle each challenge, and gives a verdict (solid, solid if, shaky, or doesn't hold up).",
  "Before calling: write the subject, meaning the decision, every option on the table, the reasons, the prediction and confidence exactly as the user gave them, and the strongest case against.",
  "Write it as a clerk, not an advocate: a write-up that leans toward the decision gets a kinder verdict than it should, and one written by whoever helped reach it leans unless you stop it. Give the case against the same depth as the reasons and don't answer it, include the facts that cut against the decision, and leave out words that grade (clearly, strong, safe) and any recommendation of your own.",
  "Show it to the user, and call only after they approve, because it leaves their machine for a model router (zero-data-retention endpoints only).",
  CHECK_NOTE,
  "If Grill's settings name a judge model, that model is used, and it must be from a different company than the assistant that wrote the subject. A same-company pin is refused. Leave it blank to use Grill's default.",
  "Costs about a cent on the user's own key, or on a Grill Pro key, and usually takes 1–3 minutes. If the result is a job id, call grill_result with it.",
].join(" ");

const TOOLS = [
  {
    name: "grill",
    title: "Grill a decision",
    description: DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "The approved challenge subject, in markdown." },
        question: {
          type: "string",
          description:
            "Optional. One neutral question, at most 600 characters, that never names a preferred answer: it names every option, carries none of the subject's reasons, and is not a yes-or-no question whose easy answer is the choice already made. For a forecast, ask whether the confidence is too high, too low or about right.",
        },
        author: {
          type: "string",
          description:
            "Optional. The model family that wrote the subject, if not Claude, for example openai. That family is excluded from judging too.",
        },
        quality_check: {
          type: "boolean",
          description:
            "Optional. false skips the Jev quality check for this grill only, when the user asks. It never turns on a check the user switched off in settings.",
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
    description: "Collect the report of a grill that returned a job id. Waits up to 45 seconds; call again if it is still running.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string", description: "The job id the grill tool returned." } },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { title: "Collect a grill", readOnlyHint: true, openWorldHint: false },
  },
];

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

function startJob({ subject, question, author, skipCheck }) {
  const id = randomUUID().slice(0, 8);
  const dir = mkdtempSync(join(tmpdir(), "grill-"));
  const args = [JUDGE, "--json", "--out", join(dir, "report.md")];
  if (question) args.push("--question", question);
  if (author) args.push("--author", author);
  if (checkEnabled() && !skipCheck) args.push("--check");
  const env = { ...process.env, OPENROUTER_API_KEY: resolveApiKey() };
  delete env.JUDGE_CHECK; // the setting above decides, never an inherited variable
  const model = configuredJudgeModel(env);
  if (model) env.JUDGE_MODEL = model;
  else delete env.JUDGE_MODEL;
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (d) => {
    stderr += d;
  });
  const job = { id, startedAt: Date.now(), done: false, outcome: null, child };
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
      job.done = true;
      job.outcome = { code, report, stderr, error };
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
  const deadline = Date.now() + ms;
  while (!job.done && Date.now() < deadline) {
    let timer;
    const tick = new Promise((resolve) => {
      timer = setTimeout(resolve, Math.min(progressEveryMs(), Math.max(0, deadline - Date.now())));
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

function outcomeOf(job) {
  jobs.delete(job.id);
  const { code, report, stderr, error } = job.outcome;
  if (report) return text(report);
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
    const author = typeof args.author === "string" ? args.author.trim().toLowerCase() : "";
    const skipCheck = args.quality_check === false; // off for this grill only; never switches it on
    if (!subject.trim()) return text("There's no subject to grill. Write it, show it to the user, then call again.", true);
    if (subject.length > MAX_SUBJECT_CHARS) return text(`The subject is ${subject.length} characters; trim it under ${MAX_SUBJECT_CHARS}.`, true);
    if (question.length > MAX_QUESTION_CHARS) return text(`The question is over ${MAX_QUESTION_CHARS} characters; shorten it.`, true);
    if (author && !AUTHOR_RE.test(author)) return text("author must be a lowercase model-family name, like openai.", true);
    if (!resolveApiKey()) return text(SETUP_TEXT, true);
    const judgeModel = configuredJudgeModel();
    if (judgeModel && judgePinConflicts(judgeModel, author)) {
      return text(
        `Grill's judge model is set to ${judgeModel}, the same company as the assistant that wrote this${author ? ` (${author})` : ""}. Pick a judge from a different company, or clear the judge model to use Grill's default.`,
        true,
      );
    }
    const job = startJob({ subject, question, author, skipCheck });
    return (await waitFor(job, waitMs(), onTick)) ? outcomeOf(job) : pending(job);
  }
  if (name === "grill_result") {
    const job = jobs.get(typeof args.job_id === "string" ? args.job_id.trim() : "");
    if (!job) return text("No grill is running with that job id. It may already have been collected; start a new one with the grill tool.", true);
    return (await waitFor(job, waitMs(), onTick)) ? outcomeOf(job) : pending(job);
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
            "Grill sends a decision to an outside AI judge from a different company than Claude. Write the subject as a clerk, not an advocate, and show the user the subject and get their OK before calling grill. If grill returns a job id, call grill_result until the report arrives. Relay the verdict first, then the challenges with their falsifiers, quoting the judge rather than agreeing with it, softening it or adding reassurance of your own.",
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
