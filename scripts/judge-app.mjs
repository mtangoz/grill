/**
 * The grillyour.ai/judge page.
 *
 * Loaded only by that page. It calls OpenRouter from the browser. The key stays in
 * memory unless the visitor ticks "Remember on this device", which writes
 * localStorage. Forget key removes it. The write-up is read from the form or from
 * the URL fragment, never from the query string.
 *
 * The build copies this file next to judgePage.mjs. The import below is that copy.
 */
import {
  ASSISTANTS,
  JUDGE_ENDPOINT,
  KEY_STORAGE,
  assistantChoice,
  classifyAttempt,
  finishVerdict,
  lookBack,
  openInGrillLink,
  parseJudgeFragment,
  prepareJudgeCall,
} from "./judgePage.mjs";
import { AUTO_ROUTER_MAX_RETRIES } from "./judgeCore.mjs";

const ATTEMPT_MS = 180000;

function byId(doc, id) {
  const node = doc.getElementById(id);
  if (!node) throw new Error(`judge page is missing #${id}`);
  return node;
}

function sleep(ms, delay) {
  if (delay) return delay(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wire the page. `env` is injectable so a test can run the same path without a browser.
 * Returns `{ grill }` which the button also calls.
 */
export function startJudgePage(env) {
  const doc = env.document;
  const storage = env.storage;
  const fetchImpl = env.fetch;
  const location = env.location;
  const delay = env.delay;
  const now = env.now || (() => new Date());

  const keyInput = byId(doc, "key");
  const remember = byId(doc, "remember");
  const forget = byId(doc, "forget");
  const assistant = byId(doc, "assistant");
  const question = byId(doc, "question");
  const writeup = byId(doc, "writeup");
  const grillButton = byId(doc, "grill");
  const error = byId(doc, "error");
  const status = byId(doc, "status");
  const result = byId(doc, "result");
  const verdict = byId(doc, "verdict");
  const model = byId(doc, "model");
  const cost = byId(doc, "cost");
  const costLine = byId(doc, "cost-line");
  const report = byId(doc, "report");
  const record = byId(doc, "record");
  const copyRecord = byId(doc, "copy-record");
  const downloadRecord = byId(doc, "download-record");
  const otherNote = byId(doc, "other-note");
  const lookRecords = byId(doc, "look-records");
  const lookHappened = byId(doc, "look-happened");
  const lookButton = byId(doc, "look-back");
  const lookOut = byId(doc, "look-out");
  const linkExample = byId(doc, "link-example");

  let memoryKey = "";
  try {
    memoryKey = storage.getItem(KEY_STORAGE) || "";
  } catch {
    memoryKey = "";
  }
  if (memoryKey) {
    keyInput.value = memoryKey;
    remember.checked = true;
  }

  const parsed = parseJudgeFragment(location.hash || "");
  if (parsed.text) writeup.value = parsed.text;
  if (parsed.question && !question.value) question.value = parsed.question;
  const choice = assistantChoice(parsed.from);
  if (choice) assistant.value = choice;

  if (linkExample) {
    linkExample.textContent = openInGrillLink({ text: "the write-up", from: "claude" }).replace(
      "the+write-up",
      "…",
    );
  }

  function syncOther() {
    otherNote.hidden = assistant.value !== "other";
  }
  syncOther();
  assistant.addEventListener("change", syncOther);

  function persistKey() {
    memoryKey = keyInput.value.trim();
    try {
      if (remember.checked && memoryKey) storage.setItem(KEY_STORAGE, memoryKey);
      else storage.removeItem(KEY_STORAGE);
    } catch {
      // Private mode can refuse storage. The key still stays in memory for this tab.
    }
  }

  remember.addEventListener("change", persistKey);
  keyInput.addEventListener("input", () => {
    memoryKey = keyInput.value;
    if (remember.checked) persistKey();
  });
  forget.addEventListener("click", () => {
    memoryKey = "";
    keyInput.value = "";
    remember.checked = false;
    try {
      storage.removeItem(KEY_STORAGE);
    } catch {
      // already gone
    }
    keyInput.focus();
  });

  function showError(message) {
    error.hidden = false;
    error.textContent = message;
    status.hidden = true;
    result.hidden = true;
  }

  function showResult(finished) {
    error.hidden = true;
    status.hidden = true;
    result.hidden = false;
    verdict.textContent = finished.verdictLabel || "(none returned)";
    model.textContent = finished.servedModel || "unknown";
    if (typeof finished.costUsd === "number") {
      costLine.hidden = false;
      cost.textContent = `$${finished.costUsd.toFixed(4)}`;
    } else {
      costLine.hidden = true;
      cost.textContent = "";
    }
    report.textContent = finished.review;
    record.value = finished.record;
    if (!lookRecords.value.trim()) lookRecords.value = finished.record;
  }

  async function grill() {
    persistKey();
    error.hidden = true;
    result.hidden = true;
    if (!memoryKey) {
      showError("Paste your OpenRouter key first.");
      return;
    }
    const prepared = prepareJudgeCall({
      subject: writeup.value,
      question: question.value,
      from: assistant.value,
    });
    if (!prepared.ok) {
      showError(prepared.error);
      return;
    }
    grillButton.disabled = true;
    status.hidden = false;
    status.textContent = "Grilling. This usually takes a minute or two. Your write-up is going to OpenRouter, not to Grill.";
    let priorCost = 0;
    let retriesUsed = 0;
    try {
      for (;;) {
        let statusCode = null;
        let data = null;
        let detail = "";
        let transportError = false;
        try {
          const response = await fetchImpl(JUDGE_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${memoryKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://grillyour.ai",
              "X-Title": "Grill",
            },
            body: JSON.stringify(prepared.body),
            redirect: "error",
            signal: AbortSignal.timeout(ATTEMPT_MS),
          });
          statusCode = response.status;
          detail = await response.text();
          try {
            data = JSON.parse(detail);
          } catch {
            data = null;
          }
        } catch {
          transportError = true;
        }
        const decision = classifyAttempt({
          status: statusCode,
          data,
          transportError,
          author: prepared.author,
          retriesUsed,
          detail,
        });
        const spent = !transportError && data && typeof data.usage?.cost === "number" ? data.usage.cost : 0;
        if (decision.action === "retry" && retriesUsed < AUTO_ROUTER_MAX_RETRIES) {
          priorCost += spent;
          retriesUsed += 1;
          status.textContent =
            decision.reason === "author-family"
              ? "That answer was from the same company. Asking the router again."
              : "The request did not finish. Trying again.";
          if (decision.backoffMs > 0) await sleep(decision.backoffMs, delay);
          continue;
        }
        if (decision.action === "accept") {
          showResult(
            finishVerdict({
              data,
              author: prepared.author,
              sentSubject: prepared.sentSubject,
              sentQuestion: prepared.sentQuestion,
              originalSubject: writeup.value,
              masked: prepared.masked,
              clipped: prepared.clipped,
              originalChars: prepared.originalChars,
              priorCostUsd: priorCost,
              now: now(),
            }),
          );
          return;
        }
        showError(decision.message || "The grill did not finish. Nothing was saved here.");
        return;
      }
    } finally {
      grillButton.disabled = false;
    }
  }

  grillButton.addEventListener("click", () => {
    void grill();
  });

  copyRecord.addEventListener("click", async () => {
    const text = record.value;
    try {
      if (!env.clipboard || typeof env.clipboard.writeText !== "function") throw new Error("no clipboard");
      await env.clipboard.writeText(text);
      copyRecord.textContent = "Copied";
    } catch {
      record.focus();
      copyRecord.textContent = "Select the record and copy it";
    }
  });

  downloadRecord.addEventListener("click", () => {
    const blob = new Blob([record.value], { type: "text/markdown;charset=utf-8" });
    const url = env.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = "grill-decision-record.md";
    doc.body.appendChild(link);
    link.click();
    link.remove();
    env.revokeObjectURL(url);
  });

  lookButton.addEventListener("click", () => {
    lookOut.hidden = false;
    lookOut.textContent = lookBack({ records: lookRecords.value, happened: lookHappened.value });
  });

  // The assistant list is the module's, so the page cannot grow a second copy.
  if (assistant.options && assistant.options.length <= 1) {
    for (const item of ASSISTANTS) {
      const option = doc.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      assistant.appendChild(option);
    }
  }

  return { grill, assistants: ASSISTANTS };
}

const root = globalThis.document;
if (root && root.getElementById && root.getElementById("grill")) {
  startJudgePage({
    document: root,
    storage: globalThis.localStorage,
    fetch: globalThis.fetch.bind(globalThis),
    location: globalThis.location,
    clipboard: globalThis.navigator.clipboard,
    createObjectURL: (blob) => globalThis.URL.createObjectURL(blob),
    revokeObjectURL: (url) => globalThis.URL.revokeObjectURL(url),
  });
}
