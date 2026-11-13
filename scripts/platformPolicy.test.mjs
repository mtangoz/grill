// Platform policy for Grill in chat (the hosted connector).
//
// A directory lists the hosted connector, and its reviewers read every tool description,
// every input-field description, the server instructions and what the tools return. Two rules
// from those reviews are checked here:
//   1. A connector must not show plans, prices, upgrades or credits.
//   2. A connector that passes text to someone else must say so.
// Every string the assistant reads, and every result that can be built without a network, is
// collected and checked. No key and no network.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as hostedCore from "./hostedCore.mjs";
import {
  CLOSING_ASK,
  CLOSING_ASK_DEEPEN,
  DEEPEN_OFF,
  DEEPEN_ONLY_BIG,
  RUN_PRIVACY_LINE,
  appendRunNote,
  renderDeepen,
  renderLayers,
} from "./judgeCore.mjs";
import { changesView, lookBack, recordBlock } from "./reflection.mjs";
import { INDEPENDENCE_RELAY, buildGrillTools, groundedAuthor } from "../server/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");

// What no hosted tool copy and no hosted tool result may contain. Each entry names the rule
// it breaks, so a failure says which one. "subscri" also sits inside "unsubscribe", which is
// not a sale, so that one word is let through.
const BANNED = [
  ["the word credit", /credit/i],
  ["the word upgrade", /upgrade/i],
  ["a subscription", /(?<!un)subscri/i],
  ["the word pricing", /pricing/i],
  ["the plan name Grill Pro", /Grill Pro/i],
  ["a Pro plan", /\bPro plan\b/i],
  ["the plan name Pro", /\bPro\b/],
  ["a price", /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:usd|dollars?)\b/i],
  ["a link to /pricing, /pro, /checkout or /notify", /\/(?:pricing|pro|checkout|notify)(?![A-Za-z0-9_-])/i],
];

function breaches(rows) {
  const found = [];
  for (const { where, text } of rows) {
    for (const [rule, pattern] of BANNED) {
      const hit = pattern.exec(String(text));
      if (hit) found.push(`${where} has ${rule}: ...${String(text).slice(Math.max(0, hit.index - 40), hit.index + 60)}...`);
    }
  }
  return found;
}

/** Every string under a tool definition: title, description, annotations and each field description. */
function stringsUnder(value, where, rows = []) {
  if (typeof value === "string") rows.push({ where, text: value });
  else if (Array.isArray(value)) value.forEach((item, index) => stringsUnder(item, `${where}[${index}]`, rows));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) stringsUnder(inner, `${where}.${key}`, rows);
  }
  return rows;
}

/** Everything an assistant reads from the hosted server before it calls a tool. */
function modelFacingRows() {
  const rows = [{ where: "server instructions", text: hostedCore.HOSTED_INSTRUCTIONS }];
  for (const tool of hostedCore.hostedTools()) stringsUnder(tool, `tool ${tool.name}`, rows);
  return rows;
}

const NEUTRAL_REPORT = {
  verdict: "weak",
  verdictReason: "The direction is reasonable but the headline number is asserted, not supported.",
  steelman: "The strongest case for the plan.",
  counterSteelman: "Keep the current plan one more quarter.",
  missingOption: "Run it for one team first.",
  crux: "Did the last launch reach the number this one assumes?",
  servedModel: "openai/gpt-5.6-sol",
  quality: { scores: { verdictFits: 0.8 } },
  challenges: [
    {
      kind: "unsupported-claim",
      severity: "serious",
      challenge: "No baseline is cited for the multiplier.",
      falsifier: "Pull the signup curve from the last comparable launch.",
      confidence: "high",
    },
    {
      kind: "missing-failure-mode",
      severity: "moderate",
      challenge: "Churn from the smallest accounts is uncounted.",
      falsifier: "Count how many of those accounts stayed last quarter.",
      confidence: "medium",
    },
  ],
};

const JUDGE_ERRORS = [
  "[judge] ERROR: refusing a correlated verdict",
  "[judge] ERROR: OpenRouter 402 insufficient credits",
  "[judge] ERROR: the subject contains what looks like an API key. Nothing was sent.",
  "[judge] router retry: openrouter/auto · http_429",
  "[judge] abandoned the walk after the deadline",
  "[judge] chain advance: transport",
  "",
];

const SERVICE_CODES = ["store", "clerk", "jwks", "starter-key", "key-encryption", "record-key", "clerk-delete", ""];

/** Hosted results that code builds with no judge and no store: the fixed sentences and the frames around a verdict. */
function resultRows() {
  const rows = [];
  const add = (where, text) => rows.push({ where, text: String(text ?? "") });
  // Every exported string, so a new constant is checked without being listed here.
  for (const [name, value] of Object.entries(hostedCore)) {
    if (typeof value === "string") add(`hostedCore.${name}`, value);
  }
  add("inviteOnlyText", hostedCore.inviteOnlyText("https://grillyour.ai"));
  add("hostedStillRunningText", hostedCore.hostedStillRunningText("g1.0123456789abcdef0123456789abcdef.key"));
  add("savedConfirmation with a date", hostedCore.savedConfirmation("2026-10-25"));
  add("savedConfirmation without a date", hostedCore.savedConfirmation(""));
  add("dueReminderLine 1", hostedCore.dueReminderLine(1));
  add("dueReminderLine 3", hostedCore.dueReminderLine(3));
  add("lookbackOffer", hostedCore.lookbackOffer("We ship the beta on 12 Dec.", { now: new Date("2026-11-13T12:00:00Z") }));
  add("independenceLine, unknown client", hostedCore.independenceLine({ author: "none", sourceApp: "unknown", servedModel: "openai/gpt-5.6-sol" }));
  add("independenceLine, Cursor", hostedCore.independenceLine({ author: "none", sourceApp: "cursor", servedModel: "openai/gpt-5.6-sol" }));
  add("onceDisclosureFor a known author", hostedCore.onceDisclosureFor("openai"));
  add("onceDisclosureFor nobody", hostedCore.onceDisclosureFor("none"));
  add("provenanceLine", hostedCore.provenanceLine({ servedModel: "openai/gpt-5.6-sol", declaredAuthor: "anthropic", decorrelated: true }, new Date(0)));
  add("provenanceLine, nobody excluded", hostedCore.provenanceLine({ servedModel: "openai/gpt-5.6-sol", declaredAuthor: "none", decorrelated: true }, new Date(0)));
  add("author error", hostedCore.authorForJudge({ explicit: "Open AI!" }).error);
  add("reaction reply", hostedCore.hostedFeedbackReply(false, {}));
  add("reaction reply, grill sent", hostedCore.hostedFeedbackReply(true, { subject: "x" }));
  add("reaction reply, grill gone", hostedCore.hostedFeedbackReply(true, {}));
  add("service cap", hostedCore.capBlock({ serviceMicros: 20_000_000, userMicros: 0 }).text);
  add("person cap", hostedCore.capBlock({ serviceMicros: 0, userMicros: 5_000_000 }).text);
  for (const stderr of JUDGE_ERRORS) add(`judgeFailureText(${JSON.stringify(stderr)})`, hostedCore.judgeFailureText(stderr, "ab12cd34"));
  for (const code of SERVICE_CODES) add(`serviceFailureText(${JSON.stringify(code)})`, hostedCore.serviceFailureText(code, "ab12cd34"));
  // The frame around a verdict: every layer, the run note and the closing lines, from a made-up report.
  for (const [label, options] of [
    ["plain", { subject: "We will move the launch to March because the audit is not done." }],
    ["big, deepen on", { subject: "We will move the launch to March because the audit is not done.", big: true, deepenTest: true }],
    ["thin input", { subject: "move the launch?" }],
  ]) {
    const layers = renderLayers(NEUTRAL_REPORT, options);
    for (const [name, text] of Object.entries(layers)) add(`layer ${name} (${label})`, text);
    add(`brief with run note (${label})`, appendRunNote(layers.brief, NEUTRAL_REPORT, 48_000));
  }
  add(
    "deepen layer",
    renderDeepen({
      professional: "Ask the auditor for a dated plan.",
      rawMaterial: "The audit log and the last two launch reviews.",
      methods: "A dated checklist and one dry run.",
      outsideCheck: "The auditor signs off before the date is announced.",
      rewritten: "Move the launch to March, and announce the date only after the auditor signs off.",
    }),
  );
  for (const [name, value] of Object.entries({ CLOSING_ASK, CLOSING_ASK_DEEPEN, DEEPEN_OFF, DEEPEN_ONLY_BIG, RUN_PRIVACY_LINE })) add(name, value);
  // A look-back and the changes view, from a made-up record.
  const block = recordBlock({
    date: "2026-10-01",
    title: "Move the launch to March",
    prediction: "The audit closes by 20 Feb",
    verdict: "weak",
    falsifier: "The auditor's own date",
    confidence: "70%",
    review: "2026-10-15",
    decided: "Moved it.",
  });
  add("look back, questions", lookBack({ records: block, happened: "" }));
  add("look back, scored", lookBack({ records: block, happened: "came_true: yes\nhappened: The audit closed on 18 Feb." }));
  add("changes view", changesView({ records: block, happened: "" }));
  add("look back, nothing pasted", lookBack({ records: "", happened: "" }));
  add("changes view, nothing pasted", changesView({ records: "", happened: "" }));
  return rows;
}

// ── Reading string literals out of source ────────────────────────────────────
// A result string that is not exported cannot be called from here, so the code that answers
// tool calls is also read as text. This walks JavaScript source and returns every string and
// template literal, skipping comments and regular expressions. A `${...}` in a template
// becomes the digit 0, so `$${amount} a month` reads "$0 a month" and the price rule sees it.
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "in", "of", "void", "delete", "throw", "new", "do", "else", "yield", "await", "instanceof"]);

function literalsOf(source) {
  const literals = [];
  const open = []; // templates being read; depth counts braces inside a ${...}
  const length = source.length;
  let at = 0;
  let last = ""; // the last character of code that was not white space
  let word = ""; // the identifier that character ended, if any
  let gap = true;
  const mark = (ch) => {
    last = ch;
    word = "";
    gap = false;
  };
  while (at < length) {
    const ch = source[at];
    const next = source[at + 1];
    const top = open[open.length - 1];
    if (top && top.depth === 0) {
      if (ch === "\\") {
        top.text += source.slice(at, at + 2);
        at += 2;
      } else if (ch === "`") {
        literals.push(top.text);
        open.pop();
        mark(")");
        at += 1;
      } else if (ch === "$" && next === "{") {
        top.text += "0";
        top.depth = 1;
        mark("{");
        at += 2;
      } else {
        top.text += ch;
        at += 1;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      while (at < length && source[at] !== "\n") at += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", at + 2);
      at = end < 0 ? length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let to = at + 1;
      let text = "";
      while (to < length && source[to] !== ch && source[to] !== "\n") {
        const step = source[to] === "\\" ? 2 : 1;
        text += source.slice(to, to + step);
        to += step;
      }
      literals.push(text);
      at = to + 1;
      mark(")");
      continue;
    }
    if (ch === "`") {
      open.push({ text: "", depth: 0 });
      at += 1;
      continue;
    }
    if (ch === "/") {
      // After a value a slash divides. Anywhere else, and after a word such as return, it opens a regular expression.
      const afterValue = /[A-Za-z0-9_$)\]}]/.test(last) && !(/[A-Za-z_$]/.test(last) && REGEX_AFTER_WORD.has(word));
      if (!afterValue) {
        let to = at + 1;
        let inClass = false;
        let closed = false;
        while (to < length && source[to] !== "\n") {
          const inner = source[to];
          if (inner === "\\") to += 2;
          else if (inner === "/" && !inClass) {
            closed = true;
            break;
          } else {
            if (inner === "[") inClass = true;
            else if (inner === "]") inClass = false;
            to += 1;
          }
        }
        if (closed) {
          to += 1;
          while (to < length && /[a-z]/.test(source[to])) to += 1;
          at = to;
          mark(")");
          continue;
        }
      }
    }
    if (top) {
      if (ch === "{") top.depth += 1;
      else if (ch === "}") {
        top.depth -= 1;
        if (top.depth === 0) {
          at += 1;
          continue;
        }
      }
    }
    if (/\s/.test(ch)) {
      gap = true;
    } else if (/[A-Za-z0-9_$]/.test(ch)) {
      word = gap || !/[A-Za-z0-9_$]/.test(last) ? ch : word + ch;
      last = ch;
      gap = false;
    } else {
      mark(ch);
    }
    at += 1;
  }
  return { literals, closed: open.length === 0 };
}

/** The part of api/_hosted.mjs that answers tool calls: from composing a verdict to the end of the MCP handler. */
const TOOL_CODE_START = "async function composeReport(";
const TOOL_CODE_END = "export function describeError(";

function hostedToolCode() {
  const source = read("api/_hosted.mjs");
  const from = source.indexOf(TOOL_CODE_START);
  const to = source.indexOf(TOOL_CODE_END);
  assert.ok(from > 0 && to > from, "api/_hosted.mjs no longer has the functions this test reads between");
  return source.slice(from, to);
}

// The one literal in these files that states an amount. /decisions and /account show it on a
// web page. No tool result carries it: a test below checks the tool code never calls it.
const PAGE_ONLY_LITERALS = new Set(["Free for life: $0 of use each month, resets on the 1st. $0 left this month."]);

function sourceRows() {
  const rows = [];
  const scans = [
    ["scripts/hostedCore.mjs", read("scripts/hostedCore.mjs")],
    ["scripts/feedbackCore.mjs", read("scripts/feedbackCore.mjs")],
    ["scripts/reflection.mjs", read("scripts/reflection.mjs")],
    ["api/_hosted.mjs (tool code)", hostedToolCode()],
  ];
  for (const [file, source] of scans) {
    const { literals, closed } = literalsOf(source);
    assert.equal(closed, true, `${file}: the scan ended inside a template, so it lost its place`);
    for (const text of literals) {
      if (!PAGE_ONLY_LITERALS.has(text)) rows.push({ where: `a string in ${file}`, text });
    }
  }
  return rows;
}

describe("Grill in chat shows no plan, price, upgrade or credit", () => {
  it("in any tool description, field description or server instruction", () => {
    const rows = modelFacingRows();
    // Five tools, each with a description, and the instructions: the walk found the copy it is meant to check.
    assert.ok(rows.length > 40, `only ${rows.length} strings found`);
    assert.equal(rows.filter((row) => /^tool \w+\.description$/.test(row.where)).length, 5);
    assert.ok(rows.some((row) => row.where === "tool grill.inputSchema.properties.subject.description"));
    assert.deepEqual(breaches(rows), []);
  });

  it("in any tool result that can be built without a network", () => {
    const rows = resultRows();
    assert.ok(rows.length > 60, `only ${rows.length} strings built`);
    for (const { where, text } of rows) {
      if (!/^hostedCore\.|nothing pasted/.test(where)) assert.ok(text.trim().length > 0, `${where} built an empty string, so nothing was checked`);
    }
    assert.deepEqual(breaches(rows), []);
  });

  it("in any string in the code that answers a tool call, so a new result is checked without being listed here", () => {
    assert.deepEqual(breaches(sourceRows()), []);
    assert.doesNotMatch(hostedToolCode(), /allowanceLine/, "the allowance line is for the account pages, not for a tool result");
  });

  it("the scan of the code reads what it claims to read", () => {
    const { literals } = literalsOf(hostedToolCode());
    // Checked a second way: every plain string handed straight to toolText is among the literals found.
    const direct = [...hostedToolCode().matchAll(/toolText\("((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1]);
    assert.ok(direct.length >= 15, `only ${direct.length} direct tool results found`);
    for (const text of direct) assert.ok(literals.includes(text), `the scan missed: ${text}`);
    assert.ok(literals.includes("No grill to attach that to."));
    assert.ok(literals.some((text) => text.startsWith("Grill has no tool called 0.")), "a template literal with a ${} was not read");
    // Comments, regular expressions and code are not literals.
    const sample = literalsOf('const a = "one"; // "not this"\n/* "nor this" */ const b = /"nor [/"] this"/.test(a) ? `two ${a + "three"} $${4 / 2}` : \'five\';');
    assert.deepEqual(sample.literals, ["one", "three", "two 0 $0", "five"]);
    assert.equal(sample.closed, true);
    // The rules themselves: each one fires on the kind of line it is there to stop.
    const stopped = [
      "You're out of grill credit for this month.",
      "Upgrade for more grills.",
      "Your subscription has ended.",
      "See our pricing.",
      "Have Grill Pro?",
      "An optional Pro plan.",
      "Pro keeps your history.",
      "It is $9 a month.",
      "More at https://grillyour.ai/pro",
      "More at https://grillyour.ai/pricing",
      "Pay at /checkout?plan=month",
      "Leave your email at https://grillyour.ai/notify?via=tool",
    ];
    for (const text of stopped) assert.equal(breaches([{ where: "sample", text }]).length > 0, true, text);
    const allowed = [
      "Send a decision, plan or forecast to an outside AI judge.",
      "Use the unsubscribe link in the email.",
      "You've used this month's free grills.",
      "Call grill_result with detail provenance.",
      "The pros and cons are in the full report.",
      "https://grillyour.ai/#privacy",
    ];
    for (const text of allowed) assert.deepEqual(breaches([{ where: "sample", text }]), [], text);
  });

  it("says plainly what happened at a limit, and offers no way to get more", () => {
    assert.equal(
      hostedCore.USER_CAP_TEXT,
      "You've used this month's free grills, so this one didn't run. It starts again on the 1st. Nothing was charged to you. Questions: support@grillyour.ai.",
    );
    assert.equal(
      hostedCore.SERVICE_CAP_TEXT,
      "Grill has used up this month's free grills for everyone, so this one didn't run. It starts again on the 1st. Nothing was charged to you. Questions: support@grillyour.ai.",
    );
    assert.equal(
      hostedCore.OUT_OF_CREDIT,
      "You've reached this month's free limit, so this one didn't run. It resets on the 1st. Nothing was charged to you. Questions: support@grillyour.ai.",
    );
    assert.equal(
      hostedCore.EMAIL_CLAIMED_TEXT,
      "This email is already set up with Grill on another sign-in. Sign in with that one instead, or write to support@grillyour.ai if you've lost it.",
    );
    assert.equal(
      hostedCore.serviceFailureText("starter-key", ""),
      "Grill couldn't finish setting up your account just now. Try again in a few minutes; if it keeps happening, write to support@grillyour.ai.",
    );
    for (const text of [hostedCore.USER_CAP_TEXT, hostedCore.SERVICE_CAP_TEXT, hostedCore.OUT_OF_CREDIT]) {
      assert.doesNotMatch(text, /sooner|need more|more grills/i);
      assert.match(text, /Nothing was charged to you\./);
    }
    // The code sends the constant, not a sentence of its own.
    assert.match(hostedToolCode(), /account\.creditBlocked === "email"\) \{\s*return toolText\(EMAIL_CLAIMED_TEXT, true\);/);
  });
});

describe("the hosted grill tool reads true on every host", () => {
  const grill = hostedCore.hostedTools().find((tool) => tool.name === "grill");
  const installed = buildGrillTools({ checkOn: true }).find((tool) => tool.name === "grill");
  const sentencesOf = (text) =>
    String(text)
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

  it("does not call Claude the author, and says nothing about settings it does not have", () => {
    // ChatGPT, Grok and Cursor read this text too. The author comes from the app that connected.
    for (const { where, text } of modelFacingRows()) {
      assert.doesNotMatch(text, /\bClaude\b/, where);
      assert.doesNotMatch(text, /unless set otherwise/i, where);
      assert.doesNotMatch(text, /\bsettings\b/i, where);
    }
    assert.doesNotMatch(grill.description, /name a judge model|same-company pin|Leave it blank/);
    // The installed tool keeps both sentences. If its wording moves, the swap below would
    // silently stop working, so this fails first and says where to look.
    assert.ok(installed.description.includes(hostedCore.LOCAL_ONLY_OPENING), "server/index.mjs changed its opening sentence: update LOCAL_ONLY_OPENING in hostedCore.mjs");
    assert.ok(installed.description.includes(hostedCore.LOCAL_ONLY_JUDGE_SETTING), "server/index.mjs changed its judge-setting sentences: update LOCAL_ONLY_JUDGE_SETTING in hostedCore.mjs");
    assert.equal(grill.description.includes(hostedCore.LOCAL_ONLY_OPENING), false);
  });

  it("says the judge is from a different company only when Grill can tell who wrote the decision", () => {
    assert.equal(
      hostedCore.HOSTED_OPENING,
      "Send a decision, plan or forecast to an outside AI judge. The judge is from a different company than the one whose model wrote it, when Grill can tell which that is. When it cannot, the verdict says so.",
    );
    assert.ok(grill.description.startsWith(`${hostedCore.HOSTED_OPENING} The judge is picked by openrouter/auto.`), grill.description.slice(0, 260));
    // One "different company" in the whole description, and it is the conditional one.
    assert.equal(grill.description.split("different company").length, 2);
    assert.match(grill.description, /openrouter\/auto/);
  });

  it("asks for the author in words that fit any assistant, with examples that do exclude a company", () => {
    const author = grill.inputSchema.properties.author.description;
    assert.equal(
      author,
      "Optional. The model family that wrote the subject, for example openai, anthropic, google or x-ai. That family is excluded from judging. Set it to your own family when you know it.",
    );
    for (const example of author.match(/for example ([^.]+)\./)[1].split(/, | or /)) {
      assert.equal(groundedAuthor(example), example, `${example} must be a name that excludes a company`);
    }
    assert.equal(grill.inputSchema.properties.author.type, "string");
    assert.equal(grill.inputSchema.properties.quality_check.type, "boolean");
  });

  it("discloses the quality check by TypeSafe, and how to skip it", () => {
    assert.equal(
      hostedCore.HOSTED_CHECK_DISCLOSURE,
      "By default a quality check by TypeSafe (a model called Jev) also gets the masked write-up and the judge's verdict and challenges. Pass quality_check: false only if the person asks to skip it.",
    );
    assert.equal(grill.description.split(hostedCore.HOSTED_CHECK_DISCLOSURE).length, 2);
    assert.equal(
      grill.inputSchema.properties.quality_check.description,
      "Optional. false skips the TypeSafe quality check for this grill only, when the person asks.",
    );
    // It makes no promise about what TypeSafe keeps: that request carries no retention flag.
    assert.doesNotMatch(hostedCore.HOSTED_CHECK_DISCLOSURE, /zero|retention|not keep|never keep/i);
  });

  it("limits the no-disclosure rule to Grill's own text, in the description and in the instructions", () => {
    assert.equal(
      hostedCore.OWN_DISCLOSURE_RULE,
      "Do not add a disclosure of your own to Grill's text. Anything your own rules require, say it separately, after the run note.",
    );
    for (const [where, text] of [["grill description", grill.description], ["instructions", hostedCore.HOSTED_INSTRUCTIONS]]) {
      assert.equal(text.split(hostedCore.OWN_DISCLOSURE_RULE).length, 2, where);
      // No second, unscoped copy of the rule.
      assert.equal(text.split("Do not add a disclosure of your own").length, 2, where);
      assert.doesNotMatch(text, /Do not add your own disclosure/, where);
      assert.equal(text.split(INDEPENDENCE_RELAY).length, 2, where);
    }
    assert.match(hostedCore.HOSTED_INSTRUCTIONS, /or format rules\. Do not add a disclaimer to Grill's text\./);
    assert.doesNotMatch(hostedCore.HOSTED_INSTRUCTIONS, /do not show[^.]*disclaimer/i);
  });

  it("says each thing once", () => {
    const seen = new Map();
    for (const sentence of sentencesOf(grill.description)) seen.set(sentence, (seen.get(sentence) || 0) + 1);
    const repeated = [...seen].filter(([, count]) => count > 1).map(([sentence]) => sentence);
    assert.deepEqual(repeated, []);
    // The sentences only the hosted tool needs are still there.
    for (const kept of [
      "It never falls back to this chat's own model, for speed or cost, and it never pins a model.",
      "If the result is a job id, call grill_result with that job id right now, before you reply to the person, and keep calling until the verdict arrives.",
      "A follow: line is a job id for you.",
      "Later results leave it off.",
      "Grill's job ends at the verdict and the record.",
      "Do not write a layer yourself.",
      "Never put that line before the verdict.",
    ]) {
      assert.ok(seen.has(kept), kept);
    }
    assert.match(grill.description, /keep_records true or false only after they answer Yes or No\./);
  });
});

describe("the records question, asked before the first send", () => {
  const lines = hostedCore.CONSENT_TEXT.split("\n");
  // The paragraph the plan proposes, word for word. It waits on the owner's yes.
  const PROPOSED_NOTE =
    "Either way, your decision goes through Grill's server to an outside AI judge that OpenRouter picks, and to a quality check by TypeSafe. If you say yes, Grill keeps an encrypted record that its operators could open, and emails you on Mondays when a look-back is due unless you turn that off. What is kept and for how long: https://grillyour.ai/data-flow/";

  it("keeps the question byte for byte, and asks one question only", () => {
    assert.equal(lines[0], "Keep a record of your decisions on your Grill account? Yes / No");
    assert.equal(hostedCore.RECORDS_QUESTION, lines[0]);
    // One question mark in the whole reply: the note and the line for the assistant ask nothing.
    assert.equal(hostedCore.CONSENT_TEXT.split("?").length, 2);
    assert.equal(lines.length, 5);
    assert.equal(lines[1], "");
    assert.equal(lines[3], "");
  });

  it("says under the question where the decision goes and what a yes keeps", () => {
    assert.equal(lines[2], PROPOSED_NOTE);
    assert.equal(hostedCore.RECORDS_NOTE, PROPOSED_NOTE);
    assert.match(hostedCore.CONSENT_TEXT, /Monday/);
    assert.match(hostedCore.CONSENT_TEXT, /data-flow/);
    assert.match(hostedCore.CONSENT_TEXT, /OpenRouter/);
    assert.match(hostedCore.CONSENT_TEXT, /TypeSafe/);
    assert.match(hostedCore.CONSENT_TEXT, /operators could open/);
    // Shown before Grill has looked at who is asking, so it claims nothing about the judge's company,
    // and nothing about what the judge or the check keep.
    assert.doesNotMatch(hostedCore.CONSENT_TEXT, /different company/i);
    assert.doesNotMatch(hostedCore.CONSENT_TEXT, /Both are asked/i);
    assert.doesNotMatch(hostedCore.CONSENT_TEXT, /nothing is kept|in memory|zero.retention|does not keep|guarantee/i);
    assert.doesNotMatch(hostedCore.CONSENT_TEXT, /[–—]/);
  });

  it("keeps the address in hostedCore.mjs, and tells the assistant to show the paragraph", () => {
    assert.equal(hostedCore.DATA_FLOW_URL, "https://grillyour.ai/data-flow/");
    assert.ok(hostedCore.RECORDS_NOTE.endsWith(hostedCore.DATA_FLOW_URL));
    assert.doesNotMatch(read("api/_hosted.mjs"), /data-flow/, "the address is a constant in hostedCore.mjs, not a literal in api/_hosted.mjs");
    assert.equal(
      lines[4],
      "Ask that once, and show the paragraph under the question with it. Then call grill again with keep_records true or false. Do not send the decision until they answer.",
    );
    const grill = hostedCore.hostedTools().find((tool) => tool.name === "grill");
    assert.match(grill.description, /show that one question and the paragraph under it, and call again with keep_records true or false only after they answer Yes or No\./);
    assert.match(hostedCore.HOSTED_INSTRUCTIONS, /Relay that one question and the paragraph under it, and call again with keep_records true or false only after they answer\./);
  });
});
