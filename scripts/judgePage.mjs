/**
 * The browser judge page, as plain data.
 *
 * No fetch, no localStorage, no DOM, no Node APIs. scripts/judge-app.mjs performs the
 * one request to OpenRouter. This module builds that request, reads an Open in Grill
 * fragment, classifies the response, and renders the report with the same functions
 * the installed judge uses.
 *
 * The judge is always OpenRouter's Auto Router (`DEFAULT_CHAIN`). The author's company
 * is excluded by `autoRouterPlugin`, the same request-side ignore the server sends.
 * There is no fallback model list.
 */
import {
  DEFAULT_CHAIN,
  NO_AUTHOR_FAMILY,
  SUBJECT_BUDGET,
  VERDICT_BADGE,
  budgetText,
  buildJudgeMessages,
  checkGrounding,
  decorrelationOf,
  judgeChatBody,
  nextAttempt,
  reconcileVerdict,
  redactSensitive,
  renderJudgeReport,
  toolCallArgumentsOf,
  validateChallenges,
} from "./judgeCore.mjs";
import {
  BEFORE_YOU_DECIDE_QUESTIONS,
  REVIEW_DAYS,
  addDays,
  appendReflection,
  confidenceFromSubject,
  decisionTitle,
  falsifierFromReport,
  goalFromSubject,
  guardrailsFromSubject,
  isoDate,
  lookBack,
  predictionFromSubject,
  recordBlock,
  sourceAppLabel,
  verdictFromReport,
} from "./reflection.mjs";

export { BEFORE_YOU_DECIDE_QUESTIONS, DEFAULT_CHAIN, lookBack };

/** Where the page posts. The browser calls this directly. Grill's servers are not on the path. */
export const JUDGE_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** localStorage key for the opt-in "remember on this device" checkbox. Absent means memory only. */
export const KEY_STORAGE = "grill.judge.key";

/**
 * Assistants a visitor can name. `author` is the family `autoRouterPlugin` excludes.
 * `other` is `none`: nothing is excluded, and independence is not verified.
 * Grok's OpenRouter vendor is `x-ai`, which is the family the Pro sample path excludes.
 */
export const ASSISTANTS = Object.freeze([
  { id: "claude", label: "Claude (Anthropic)", author: "anthropic" },
  { id: "gemini", label: "Gemini (Google)", author: "google" },
  { id: "chatgpt", label: "ChatGPT (OpenAI)", author: "openai" },
  { id: "grok", label: "Grok (xAI)", author: "x-ai" },
  { id: "other", label: "Other", author: NO_AUTHOR_FAMILY },
]);

const AUTHOR_BY_FROM = Object.freeze({
  claude: "anthropic",
  anthropic: "anthropic",
  gemini: "google",
  google: "google",
  chatgpt: "openai",
  openai: "openai",
  grok: "x-ai",
  grokbot: "x-ai",
  xai: "x-ai",
  "x-ai": "x-ai",
  other: NO_AUTHOR_FAMILY,
  none: NO_AUTHOR_FAMILY,
});

const SOURCE_APP_BY_AUTHOR = Object.freeze({
  anthropic: "claude",
  google: "gemini",
  openai: "chatgpt",
  "x-ai": "grok",
});

/** The family to exclude, or "" when `from` does not name an assistant. */
export function authorForAssistant(from) {
  const key = String(from ?? "").trim().toLowerCase();
  if (!key) return "";
  return AUTHOR_BY_FROM[key] ?? "";
}

/** The `<select>` value for a fragment `from`, or "" when it does not match. */
export function assistantChoice(from) {
  const author = authorForAssistant(from);
  if (!author) return "";
  return ASSISTANTS.find((item) => item.author === author)?.id ?? "";
}

/**
 * Read an Open in Grill link.
 *
 * Only the fragment counts. A query string, including `?text=`, is ignored, so a
 * write-up placed there is not treated as the subject. `key` is never read.
 *
 * @param {string} input a fragment (`#text=…&from=claude`), or a full URL.
 * @returns {{ text: string, question: string, from: string, author: string }}
 */
export function parseJudgeFragment(input) {
  const raw = String(input ?? "").trim();
  let fragment = "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/judge") || raw.startsWith("/?")) {
    const hashAt = raw.indexOf("#");
    fragment = hashAt >= 0 ? raw.slice(hashAt + 1) : "";
  } else if (raw.startsWith("#")) {
    fragment = raw.slice(1);
  } else if (raw.startsWith("?")) {
    fragment = "";
  } else {
    fragment = raw;
  }
  const params = new URLSearchParams(fragment);
  const from = (params.get("from") ?? "").trim().toLowerCase();
  return {
    text: params.get("text") ?? "",
    question: params.get("question") ?? params.get("q") ?? "",
    from,
    author: authorForAssistant(from),
  };
}

/** Build `https://grillyour.ai/judge#text=…&from=…`. The key is not a parameter. */
export function openInGrillLink({ text = "", from = "", question = "", origin = "https://grillyour.ai" } = {}) {
  const params = new URLSearchParams();
  if (text) params.set("text", text);
  if (question) params.set("question", question);
  if (from) params.set("from", from);
  const base = String(origin || "https://grillyour.ai").replace(/\/$/, "");
  return `${base}/judge#${params.toString()}`;
}

/**
 * Mask, refuse secrets, and build the one Auto Router request.
 * Nothing here is sent. The caller posts `body` itself.
 */
export function prepareJudgeCall({ subject = "", question = "", from = "" } = {}) {
  const author = authorForAssistant(from);
  if (!String(subject ?? "").trim()) return { ok: false, error: "Paste the write-up first." };
  if (!author) return { ok: false, error: "Choose which assistant wrote this." };
  const subjectRedacted = redactSensitive(subject);
  const questionRedacted = redactSensitive(question);
  const secrets = [...new Set([...subjectRedacted.secrets, ...questionRedacted.secrets])];
  if (secrets.length > 0) {
    return {
      ok: false,
      error: `This write-up looks like it contains ${secrets.join(" and ")}. Remove it and try again. Nothing was sent.`,
    };
  }
  const clipped = budgetText(subjectRedacted.text, SUBJECT_BUDGET);
  const sentQuestion = questionRedacted.text.trim();
  return {
    ok: true,
    author,
    body: judgeChatBody({
      model: DEFAULT_CHAIN,
      messages: buildJudgeMessages({
        subject: clipped.text,
        question: sentQuestion,
        subjectLabel: "the write-up",
      }),
      author,
    }),
    sentSubject: clipped.text,
    sentQuestion,
    masked: {
      email: subjectRedacted.masked.email + questionRedacted.masked.email,
      phone: subjectRedacted.masked.phone + questionRedacted.masked.phone,
      card: subjectRedacted.masked.card + questionRedacted.masked.card,
    },
    clipped: clipped.clipped,
    originalChars: clipped.originalChars,
  };
}

/** A bad key. The page shows this for HTTP 401 and does not retry. */
export const BAD_KEY_MESSAGE = "That key was rejected. Check it and paste it again.";

/** HTTP 402, or a body that says the key has no credit. Invite keys do not refill. */
export const KEY_USED_UP_MESSAGE = "This invite key is used up. It has no credit left, so this grill did not run.";

/** HTTP 429. Shown immediately. Retrying a limit only waits longer. */
export const RATE_LIMIT_MESSAGE = "OpenRouter is limiting how often this key can be used. Wait a moment and try again.";

/** No response at all: DNS, offline, CORS, or the attempt timed out. */
export const NETWORK_MESSAGE = "The request did not reach OpenRouter. Check your connection and try again.";

/** The Auto Router still answered from the excluded company after its retries. No verdict. */
export const SAME_COMPANY_MESSAGE =
  "The model that answered is from the same company as the assistant that wrote this. No verdict was returned.";

/** A 200 that never carried the judge's tool call, after retries. */
export const NO_VERDICT_MESSAGE = "The judge did not return a verdict. Try again.";

/**
 * Friendly copy for an HTTP failure. 402 and an "insufficient credits" body both
 * say the invite key is used up. Other statuses get a short line that does not
 * echo the response body (it can contain the key).
 */
export function friendlyHttpError(status, detail = "") {
  const code = Number(status);
  const text = String(detail ?? "");
  if (code === 401) return BAD_KEY_MESSAGE;
  if (code === 402 || /insufficient credit|requires more credits|payment required|spend limit|key limit/i.test(text)) {
    return KEY_USED_UP_MESSAGE;
  }
  if (code === 429 || /rate limit/i.test(text)) return RATE_LIMIT_MESSAGE;
  if (Number.isInteger(code) && code >= 400) return `OpenRouter returned an error (${code}). Nothing was saved here.`;
  return "";
}

/**
 * What to do with one attempt. Account errors and rate limits stop at once.
 * A transient failure or an excluded-company answer follows `nextAttempt`
 * (retry the Auto Router, bounded, then stop). `accept` is the only action
 * that may be rendered as a verdict.
 */
export function classifyAttempt({
  status = null,
  data = null,
  transportError = false,
  author = "",
  retriesUsed = 0,
  detail = "",
} = {}) {
  if (transportError || status == null) {
    const decision = nextAttempt({ outcome: "transport", author, router: true, retriesUsed, hasNext: false });
    return { ...decision, servedModel: null, message: NETWORK_MESSAGE };
  }
  const httpMessage = friendlyHttpError(status, detail);
  if (status === 401 || status === 402 || status === 429 || (status !== 200 && /insufficient credit|requires more credits/i.test(detail))) {
    return { action: "stop", reason: `http_${status}`, backoffMs: 0, servedModel: null, message: httpMessage || KEY_USED_UP_MESSAGE };
  }
  if (status < 200 || status >= 300 || !data || typeof data !== "object") {
    const decision = nextAttempt({ outcome: "http", status, author, router: true, retriesUsed, hasNext: false });
    return { ...decision, servedModel: null, message: httpMessage || NETWORK_MESSAGE };
  }
  const servedModel = typeof data.model === "string" && data.model.trim() ? data.model.trim() : null;
  const outcome = toolCallArgumentsOf(data) ? "usable" : "no-tool-call";
  const decision = nextAttempt({
    outcome,
    status,
    servedModel,
    author,
    router: true,
    retriesUsed,
    hasNext: false,
  });
  if (decision.action === "error") return { ...decision, servedModel, message: SAME_COMPANY_MESSAGE };
  if (decision.action === "stop") return { ...decision, servedModel, message: NO_VERDICT_MESSAGE };
  return { ...decision, servedModel, message: null };
}

function recordFields({ subject, report, author, now }) {
  return {
    date: isoDate(now),
    title: decisionTitle(subject),
    prediction: predictionFromSubject(subject),
    verdict: verdictFromReport(report) || "unknown",
    falsifier: falsifierFromReport(report) || "none named",
    confidence: confidenceFromSubject(subject),
    review: isoDate(addDays(now, REVIEW_DAYS)),
    goal: goalFromSubject(subject),
    guardrails: guardrailsFromSubject(subject),
    source_app: sourceAppLabel(SOURCE_APP_BY_AUTHOR[author] || ""),
  };
}

/**
 * Render a usable OpenRouter response. Call this only after `classifyAttempt`
 * returns `accept`. Grounding uses the masked text that was sent. The decision
 * record uses the visitor's own write-up, which never leaves the browser.
 */
export function finishVerdict({
  data,
  author = "",
  sentSubject = "",
  sentQuestion = "",
  originalSubject = "",
  masked = null,
  clipped = false,
  originalChars = 0,
  priorCostUsd = 0,
  now = new Date(),
} = {}) {
  const servedModel = typeof data?.model === "string" && data.model.trim() ? data.model.trim() : null;
  const decor = decorrelationOf(servedModel, author);
  const degraded = [];
  if (clipped) {
    degraded.push(
      `the subject was CLIPPED to ${SUBJECT_BUDGET} of ${originalChars} characters — the judge did not see the end of it, so a challenge it did not make may simply be one it could not reach`,
    );
  }
  if (!decor.decorrelated) {
    degraded.push(
      decor.reason === "author-family"
        ? `NOT AN INDEPENDENT REVIEW — ${decor.note}`
        : decor.note,
    );
  }
  let parsed = null;
  const rawArgs = toolCallArgumentsOf(data);
  if (rawArgs === null) {
    degraded.push("the judge returned no tool call");
  } else {
    try {
      parsed = JSON.parse(rawArgs);
    } catch (e) {
      degraded.push(`the judge's tool call did not parse as JSON: ${e?.message ?? e}`);
    }
  }
  const validation = validateChallenges(parsed?.challenges);
  const verdict = reconcileVerdict(parsed?.verdict, validation.challenges);
  const thisCost = typeof data?.usage?.cost === "number" ? data.usage.cost : null;
  const prior = typeof priorCostUsd === "number" && priorCostUsd > 0 ? priorCostUsd : 0;
  const costUsd = thisCost === null && prior === 0 ? null : prior + (thisCost ?? 0);
  const result = {
    subjectLabel: "the write-up",
    question: sentQuestion,
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
    notes: [],
    servedModel,
    requestedChain: [DEFAULT_CHAIN],
    declaredAuthor: author,
    decorrelated: decor.decorrelated,
    costUsd,
    masked: masked && typeof masked === "object" ? masked : { email: 0, phone: 0, card: 0 },
    grounding: checkGrounding(validation.challenges, sentSubject, sentQuestion),
    quality: null,
  };
  const review = renderJudgeReport(result);
  const sourceApp = SOURCE_APP_BY_AUTHOR[author] || "";
  const report = appendReflection(review, { subject: originalSubject || sentSubject, now, route: "site", sourceApp });
  const fields = recordFields({ subject: originalSubject || sentSubject, report: review, author, now });
  return {
    review,
    report,
    record: recordBlock(fields),
    verdictLabel: verdict.verdict ? (VERDICT_BADGE[verdict.verdict] ?? verdict.verdict) : "",
    servedModel,
    costUsd,
    decorrelated: decor.decorrelated,
    questions: BEFORE_YOU_DECIDE_QUESTIONS,
  };
}
