// The browser judge: fragment links, the shared request, and the verdict the page renders.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CHAIN } from "./judgeCore.mjs";
import { BEFORE_YOU_DECIDE_QUESTIONS } from "./reflection.mjs";
import { startJudgePage } from "./judge-app.mjs";
import {
  ASSISTANTS,
  BAD_KEY_MESSAGE,
  JUDGE_ENDPOINT,
  KEY_STORAGE,
  KEY_USED_UP_MESSAGE,
  NETWORK_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SAME_COMPANY_MESSAGE,
  assistantChoice,
  authorForAssistant,
  classifyAttempt,
  finishVerdict,
  openInGrillLink,
  parseJudgeFragment,
  prepareJudgeCall,
} from "./judgePage.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const USABLE = JSON.parse(readFileSync(join(ROOT, "scripts/fixtures/usable-response.json"), "utf8"));
const SUBJECT = "We will ship this. The plan says this will double signups within a month. I expect signups to double by November. I'm 70% sure.";

describe("Open in Grill fragments", () => {
  it("reads text and from from the fragment, and ignores a query string", () => {
    const parsed = parseJudgeFragment("#text=hello+world&from=Claude&question=will%20it%20work");
    assert.equal(parsed.text, "hello world");
    assert.equal(parsed.question, "will it work");
    assert.equal(parsed.from, "claude");
    assert.equal(parsed.author, "anthropic");
    assert.equal(assistantChoice("Claude"), "claude");

    const leaked = parseJudgeFragment("https://grillyour.ai/judge?text=leaked&from=claude");
    assert.equal(leaked.text, "");
    assert.equal(leaked.from, "");
    const kept = parseJudgeFragment("https://grillyour.ai/judge?text=leaked#text=kept&from=gemini");
    assert.equal(kept.text, "kept");
    assert.equal(kept.author, "google");
    assert.equal(parseJudgeFragment("?text=leaked&from=claude").text, "");
  });

  it("never reads a key out of the fragment", () => {
    const parsed = parseJudgeFragment("#text=hello&from=grok&key=sk-or-v1-0123456789abcdef0123456789abcdef");
    assert.equal(parsed.text, "hello");
    assert.equal(JSON.stringify(parsed).includes("sk-or"), false);
  });

  it("round-trips a link whose write-up is only in the fragment", () => {
    const link = openInGrillLink({ text: "raise prices 20%", from: "chatgpt", question: "will churn stay flat?" });
    assert.match(link, /^https:\/\/grillyour\.ai\/judge#/);
    assert.equal(link.includes("?"), false);
    assert.equal(link.includes("key="), false);
    const again = parseJudgeFragment(link);
    assert.equal(again.text, "raise prices 20%");
    assert.equal(again.from, "chatgpt");
    assert.equal(again.author, "openai");
    assert.equal(again.question, "will churn stay flat?");
  });

  it("maps each assistant to one company, and Other to no exclusion", () => {
    assert.deepEqual(
      ASSISTANTS.map((item) => [item.id, authorForAssistant(item.id)]),
      [
        ["claude", "anthropic"],
        ["gemini", "google"],
        ["chatgpt", "openai"],
        ["grok", "x-ai"],
        ["other", "none"],
      ],
    );
    assert.equal(authorForAssistant("xAI"), "x-ai");
    assert.equal(authorForAssistant("openai"), "openai");
    assert.equal(authorForAssistant(""), "");
    assert.equal(authorForAssistant("muse"), "");
  });
});

describe("the browser request", () => {
  it("asks only the Auto Router, excludes the chosen company, and sets zero retention", () => {
    const call = prepareJudgeCall({ subject: SUBJECT, question: "which option do the facts support?", from: "claude" });
    assert.equal(call.ok, true);
    assert.equal(call.body.model, DEFAULT_CHAIN);
    assert.equal(call.body.model, "openrouter/auto");
    assert.equal("models" in call.body, false);
    assert.deepEqual(call.body.provider, { zdr: true, data_collection: "deny" });
    assert.deepEqual(call.body.plugins[0].excluded_models, ["anthropic/*", "*/claude-*"]);
    assert.equal(call.body.usage.include, true);
    assert.equal(JSON.stringify(call.body).includes("gpt-"), false);
    assert.equal(JSON.stringify(call.body).includes("gemini-"), false);
    assert.equal(JSON.stringify(call.body).includes("grok-"), false);

    assert.deepEqual(prepareJudgeCall({ subject: SUBJECT, from: "gemini" }).body.plugins[0].excluded_models, ["google/*"]);
    assert.deepEqual(prepareJudgeCall({ subject: SUBJECT, from: "chatgpt" }).body.plugins[0].excluded_models, ["openai/*"]);
    assert.deepEqual(prepareJudgeCall({ subject: SUBJECT, from: "grok" }).body.plugins[0].excluded_models, ["x-ai/*"]);
    assert.deepEqual(prepareJudgeCall({ subject: SUBJECT, from: "other" }).body.plugins[0].excluded_models, []);
  });

  it("refuses a secret and masks contact details before a body exists", () => {
    const secret = "sk-or-v1-0123456789abcdef0123456789abcdef";
    const refused = prepareJudgeCall({ subject: `rotate ${secret} weekly`, from: "claude" });
    assert.equal(refused.ok, false);
    assert.equal(refused.body, undefined);
    assert.equal(refused.error.includes(secret), false);
    assert.match(refused.error, /Nothing was sent/);

    const masked = prepareJudgeCall({ subject: "Email sam@example.com about the launch.", from: "gemini" });
    assert.equal(masked.ok, true);
    assert.equal(JSON.stringify(masked.body).includes("sam@example.com"), false);
    assert.match(JSON.stringify(masked.body), /\[email\]/);
    assert.equal(masked.masked.email, 1);
  });

  it("names the three failures the page has to explain, and does not retry a dead key or a rate limit", () => {
    assert.equal(classifyAttempt({ status: 401, author: "anthropic" }).message, BAD_KEY_MESSAGE);
    assert.equal(classifyAttempt({ status: 401 }).action, "stop");
    const usedUp = classifyAttempt({ status: 402, detail: "Insufficient credits" });
    assert.equal(usedUp.action, "stop");
    assert.equal(usedUp.message, KEY_USED_UP_MESSAGE);
    assert.equal(classifyAttempt({ status: 400, detail: "This request requires more credits" }).message, KEY_USED_UP_MESSAGE);
    assert.equal(classifyAttempt({ status: 429 }).action, "stop");
    assert.equal(classifyAttempt({ status: 429 }).message, RATE_LIMIT_MESSAGE);

    const offline = classifyAttempt({ transportError: true, author: "anthropic", retriesUsed: 0 });
    assert.equal(offline.action, "retry");
    assert.equal(offline.message, NETWORK_MESSAGE);
    assert.equal(classifyAttempt({ transportError: true, retriesUsed: 2 }).action, "stop");
  });

  it("retries an excluded company, then refuses the verdict", () => {
    const same = { model: "anthropic/claude-opus-4", choices: USABLE.choices, usage: { cost: 0.01 } };
    const first = classifyAttempt({ status: 200, data: same, author: "anthropic", retriesUsed: 0 });
    assert.equal(first.action, "retry");
    assert.equal(first.reason, "author-family");
    const last = classifyAttempt({ status: 200, data: same, author: "anthropic", retriesUsed: 2 });
    assert.equal(last.action, "error");
    assert.equal(last.message, SAME_COMPANY_MESSAGE);
    const ok = classifyAttempt({ status: 200, data: USABLE, author: "anthropic", retriesUsed: 0 });
    assert.equal(ok.action, "accept");
  });
});

describe("the rendered verdict and the decision record", () => {
  it("shows the plain verdict, the served model, the cost, and a version 1 record", () => {
    const finished = finishVerdict({
      data: USABLE,
      author: "anthropic",
      sentSubject: SUBJECT,
      sentQuestion: "which option do the facts support?",
      originalSubject: SUBJECT,
      now: new Date("2026-10-03T12:00:00Z"),
    });
    assert.equal(finished.verdictLabel, "shaky");
    assert.equal(finished.servedModel, "openai/gpt-5.6-sol");
    assert.equal(finished.costUsd, 0.0123);
    assert.match(finished.review, /\*\*Verdict: shaky\*\*/);
    assert.match(finished.review, /openai\/gpt-5\.6-sol/);
    assert.match(finished.review, /cost: \$0\.0123/);
    assert.doesNotMatch(finished.review, /Before you decide/);
    assert.match(finished.report, /## Before you decide/);
    for (const question of BEFORE_YOU_DECIDE_QUESTIONS) assert.ok(finished.report.includes(question));
    assert.match(finished.record, /```grill-record/);
    assert.match(finished.record, /version: 1/);
    assert.match(finished.record, /date: 2026-10-03/);
    assert.match(finished.record, /review: 2026-10-17/);
    assert.match(finished.record, /verdict: shaky/);
    assert.match(finished.record, /source_app: claude/);
    assert.match(finished.record, /70%/);
    assert.doesNotMatch(finished.record, /^decided:/m);
    assert.doesNotMatch(finished.record, /^supersedes:/m);
    assert.doesNotMatch(finished.record, /^changed:/m);
    assert.match(finished.report, /A decided line is what you chose/);
    assert.match(finished.report, /add supersedes/);
  });
});

describe("the page wires the fragment, the key, and the errors", () => {
  function field(value = "") {
    const listeners = {};
    return {
      value,
      textContent: "",
      hidden: false,
      disabled: false,
      checked: false,
      options: [{}, {}, {}, {}, {}, {}],
      focus() {},
      addEventListener(type, fn) {
        (listeners[type] ||= []).push(fn);
      },
      dispatch(type) {
        for (const fn of listeners[type] || []) fn({ preventDefault() {} });
      },
    };
  }

  function mount({ hash = "", stored = null, fetchImpl }) {
    const nodes = {
      key: field(),
      remember: field(),
      forget: field(),
      assistant: field(),
      question: field(),
      writeup: field(),
      grill: field(),
      error: field(),
      status: field(),
      result: field(),
      verdict: field(),
      model: field(),
      cost: field(),
      "cost-line": field(),
      report: field(),
      record: field(),
      "copy-record": field(),
      "download-record": field(),
      "other-note": field(),
      "look-records": field(),
      "look-happened": field(),
      "look-back": field(),
      "look-out": field(),
      "link-example": field(),
    };
    const store = new Map();
    if (stored) store.set(KEY_STORAGE, stored);
    const seen = [];
    const page = startJudgePage({
      document: {
        getElementById: (id) => nodes[id],
        createElement: () => field(),
        body: { appendChild() {}, removeChild() {} },
      },
      storage: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, v),
        removeItem: (k) => store.delete(k),
      },
      fetch: async (url, init) => {
        seen.push({ url, init });
        return fetchImpl(url, init);
      },
      location: { hash },
      delay: () => Promise.resolve(),
      clipboard: { writeText: async () => {} },
      createObjectURL: () => "blob:record",
      revokeObjectURL: () => {},
      now: () => new Date("2026-10-03T12:00:00Z"),
    });
    return { nodes, store, seen, page };
  }

  it("fills the form from the fragment and does not store a key unless asked", async () => {
    const { nodes, store } = mount({ hash: "#text=We%20will%20raise%20prices&from=gemini&question=which%20option" });
    assert.equal(nodes.writeup.value, "We will raise prices");
    assert.equal(nodes.question.value, "which option");
    assert.equal(nodes.assistant.value, "gemini");
    assert.equal(store.has(KEY_STORAGE), false);

    nodes.key.value = "sk-or-v1-remember-me";
    nodes.remember.checked = true;
    nodes.remember.dispatch("change");
    assert.equal(store.get(KEY_STORAGE), "sk-or-v1-remember-me");
    nodes.remember.checked = false;
    nodes.remember.dispatch("change");
    assert.equal(store.has(KEY_STORAGE), false);
    assert.equal(nodes.key.value, "sk-or-v1-remember-me");
    nodes.forget.dispatch("click");
    assert.equal(nodes.key.value, "");
  });

  it("loads a remembered key, and a 401 is one request with a clear error", async () => {
    const { nodes, store, seen, page } = mount({
      stored: "sk-or-v1-saved",
      fetchImpl: async () => ({ status: 401, text: async () => "{\"error\":\"no\"}" }),
    });
    assert.equal(nodes.key.value, "sk-or-v1-saved");
    assert.equal(nodes.remember.checked, true);
    nodes.assistant.value = "claude";
    nodes.writeup.value = SUBJECT;
    await page.grill();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, JUDGE_ENDPOINT);
    assert.equal(seen[0].init.headers.Authorization, "Bearer sk-or-v1-saved");
    assert.equal(seen[0].init.redirect, "error");
    const body = JSON.parse(seen[0].init.body);
    assert.equal(body.model, "openrouter/auto");
    assert.equal("models" in body, false);
    assert.equal(nodes.error.textContent, BAD_KEY_MESSAGE);
    assert.equal(nodes.result.hidden, true);
    assert.equal(store.get(KEY_STORAGE), "sk-or-v1-saved");
  });

  it("does not call OpenRouter when the write-up contains a key", async () => {
    const { nodes, seen, page } = mount({
      fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify(USABLE) }),
    });
    nodes.key.value = "sk-or-v1-real";
    nodes.assistant.value = "claude";
    nodes.writeup.value = "use sk-or-v1-0123456789abcdef0123456789abcdef in prod";
    await page.grill();
    assert.equal(seen.length, 0);
    assert.match(nodes.error.textContent, /Nothing was sent/);
    assert.equal(nodes.error.textContent.includes("0123456789abcdef"), false);
  });
});

describe("the judge page source", () => {
  const html = readFileSync(join(ROOT, "site/judge.html"), "utf8");
  const app = readFileSync(join(ROOT, "scripts/judge-app.mjs"), "utf8");

  it("has the reflection questions, a fragment-only reader, and no analytics or fallback models", () => {
    for (const question of BEFORE_YOU_DECIDE_QUESTIONS) assert.ok(html.includes(question), question);
    assert.match(html, /Hear the strongest case against your plan, then decide for yourself/);
    assert.match(html, /The verdict never becomes the decision/);
    assert.match(html, /does not tell you what to decide/);
    assert.match(html, /Before you decide/);
    assert.match(html, /grill-record/);
    assert.match(html, /supersedes/);
    assert.match(html, /surprise line is optional/);
    assert.match(html, /Nothing is stored/);
    assert.match(html, /Remember on this device/);
    assert.match(html, /Forget key/);
    assert.match(html, /Grill it/);
    assert.match(html, /Hold Systems/);
    assert.doesNotMatch(html, /_vercel\/insights|window\.va|googletagmanager|google-analytics/);
    assert.doesNotMatch(html, /location\.search/);
    assert.doesNotMatch(app, /location\.search/);
    assert.match(app, /location\.hash/);
    assert.match(app, /JUDGE_ENDPOINT/);
    assert.doesNotMatch(`${html}\n${app}`, /gpt-\d|gemini-\d|claude-opus|claude-sonnet|grok-\d|deepseek\//);
    assert.equal(html.includes("method=\"get\""), false);
    assert.match(html, /type="button"/);
  });
});
