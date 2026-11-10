// verdictEvalCore.mjs — the pure half of the verdict-quality harness.
//
// No child processes and no network. eval-verdicts.mjs reads the case file and calls the
// judge. With --screen it also asks three cheap models to rate the full answers; the
// request itself lives in that script. eval-score.mjs reads a filled labels file and, when
// a person answered the sheet, their replies. The tests pin the holdout guard, the
// checksums, the screen, and the scorer here, with no router key and no paid call.
//
// Holdout v1 is spent. Holdout v2 is the next measurement, and it has its own checksum.
// A tuning call (purpose "tune") throws before it parses when it is asked for either
// holdout, and a tuning read returns dev rows only. The one-shot measurement uses purpose "eval".

import { createHash } from "node:crypto";

import { renderUserFacing } from "./judgeCore.mjs";

export class HoldoutLocked extends Error {
  constructor(message = "tuning scripts must not read holdout cases") {
    super(message);
    this.name = "HoldoutLocked";
  }
}

/** 60% of decided pairs, compared in integers so 9/15 is a pass on the rate and not a float miss. */
export function rateClears(wins, n) {
  return Number.isInteger(wins) && Number.isInteger(n) && n > 0 && wins * 5 >= n * 3;
}

export const SIGN_TEST_P_MAX = 0.1;

const CASE_KEYS = ["id", "subject", "context", "split"];
const SPLITS = new Set(["dev", "holdout", "holdout-v2"]);

export function caseProblems(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["the case is not a JSON object"];
  const problems = [];
  const extra = Object.keys(row).filter((key) => !CASE_KEYS.includes(key));
  if (extra.length) problems.push(`unexpected field: ${extra.join(", ")}`);
  if (typeof row.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)) problems.push("id must be kebab-case");
  if (typeof row.subject !== "string" || row.subject.trim().length < 40) problems.push("subject must be a string of at least 40 characters");
  if (typeof row.context !== "string") problems.push("context must be a string");
  if (!SPLITS.has(row.split)) problems.push('split must be "dev", "holdout", or "holdout-v2"');
  return problems;
}

/**
 * Which read this run is. Tuning is refused before any case text is parsed.
 * A dev run is always a tuning read. Holdout is the one-shot measurement.
 */
export function purposeFor({ split, tune = false } = {}) {
  if (!SPLITS.has(split)) throw new Error(`unknown split: ${split}`);
  if (tune && split !== "dev") throw new HoldoutLocked();
  return split === "dev" ? "tune" : "eval";
}

export function casesFromJsonl(text, { purpose, split } = {}) {
  if (purpose !== "tune" && purpose !== "eval") throw new Error(`unknown purpose: ${purpose}`);
  if (!SPLITS.has(split)) throw new Error(`unknown split: ${split}`);
  if (purpose === "tune" && split !== "dev") throw new HoldoutLocked();
  if (typeof text !== "string") throw new Error("cases text must be a string");
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Tuning never parses a holdout line, v1 or v2. The split sits at the end of each line
    // so this can refuse the row before the subject is turned into an object.
    if (purpose === "tune" && /"split"\s*:\s*"holdout(?:-v2)?"\s*}\s*$/.test(trimmed)) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`a case line is not JSON: ${e?.message ?? e}`);
    }
    if ((row?.split === "holdout" || row?.split === "holdout-v2") && purpose === "tune") continue;
    if (row?.split !== split) continue;
    const problems = caseProblems(row);
    if (problems.length) throw new Error(`${row?.id ?? "a case"}: ${problems.join("; ")}`);
    if (seen.has(row.id)) throw new Error(`duplicate id: ${row.id}`);
    seen.add(row.id);
    out.push({ id: row.id, subject: row.subject, context: row.context, split: row.split });
  }
  return out;
}

/** Rows of one split, sorted by id, one canonical JSON object per line. Other splits do not count. */
export function splitCanonical(cases, split) {
  const lines = (Array.isArray(cases) ? cases : [])
    .filter((row) => row && row.split === split)
    .map((row) => ({ id: row.id, subject: row.subject, context: row.context, split }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => JSON.stringify(row));
  return `${lines.join("\n")}\n`;
}

/** Holdout v1 rows only. Dev rows and holdout v2 do not count. */
export function holdoutCanonical(cases) {
  return splitCanonical(cases, "holdout");
}

/** Holdout v2 rows only. The v1 holdout does not count. */
export function holdoutV2Canonical(cases) {
  return splitCanonical(cases, "holdout-v2");
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function holdoutChecksum(cases) {
  return sha256(holdoutCanonical(cases));
}

export function holdoutV2Checksum(cases) {
  return sha256(holdoutV2Canonical(cases));
}

/** v1 was measured once (9 wins, 6 losses, p=0.30) and is not a measurement again. */
export const HOLDOUT_V1_SPENT = Object.freeze({
  spent: true,
  candidateWins: 9,
  controlWins: 6,
  signTestP: "0.30",
});

export function holdoutV1SpentMessage() {
  const spent = HOLDOUT_V1_SPENT;
  return `holdout v1 is spent. It was measured once: the candidate won ${spent.candidateWins} and lost ${spent.controlWins}, p=${spent.signTestP}. Measure the next candidate on holdout v2.`;
}

/** The question put to the judge. A case that asks one uses that question. */
export function questionFor(row) {
  const text = String(row?.subject || "").replace(/\s+/g, " ").trim();
  const mark = text.indexOf("?");
  if (mark !== -1) {
    const start = Math.max(text.lastIndexOf(".", mark), text.lastIndexOf("!", mark)) + 1;
    const question = text.slice(start, mark + 1).trim();
    if (question.length > 1) return question;
  }
  return "What is the call, and what is the cheapest test?";
}

const VENDOR_SLUG = /\b(?:anthropic|openai|google|meta-llama|x-ai|mistralai|cohere|openrouter)\/[A-Za-z0-9._:-]+/gi;

/** Drop model names and the run note. The case text is not passed through here. */
export function blindOutput(text) {
  const kept = String(text || "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (/^(?:models|judge|chain asked|cost|private):/i.test(trimmed)) return false;
      return true;
    });
  return kept
    .join("\n")
    .replace(VENDOR_SLUG, "")
    .replace(/\bopenrouter\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** What a rater compares. The full note, with the model and the run note removed. */
export function verdictText(result, subject) {
  if (!result || typeof result !== "object" || typeof result.verdict !== "string" || !result.verdict) {
    return "No verdict returned.";
  }
  const note = renderUserFacing(result, { subject, detail: "full" });
  const blinded = blindOutput(note);
  return blinded || "No verdict returned.";
}

/**
 * One blind pair. `rng` returns a number in [0, 1). Below 0.5, the candidate is A.
 * The public pair has no model name and no side assignment.
 */
export function buildPair({ id, subject, context, control, candidate, rng }) {
  if (typeof rng !== "function") throw new Error("rng is required");
  const draw = rng();
  if (typeof draw !== "number" || draw < 0 || draw >= 1) throw new Error("rng must return a number in [0, 1)");
  const candidateFirst = draw < 0.5;
  return {
    pair: {
      id,
      subject,
      context,
      a: blindOutput(candidateFirst ? candidate : control),
      b: blindOutput(candidateFirst ? control : candidate),
    },
    label: {
      id,
      would_change: "",
      took_position_a: "",
      took_position_b: "",
      specific_a: "",
      specific_b: "",
      cheap_test_a: "",
      cheap_test_b: "",
      candidate_side: candidateFirst ? "A" : "B",
    },
  };
}

export const LABEL_COLUMNS = Object.freeze([
  "id",
  "would_change",
  "took_position_a",
  "took_position_b",
  "specific_a",
  "specific_b",
  "cheap_test_a",
  "cheap_test_b",
  "candidate_side",
]);

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export const SCREEN_LABEL_COLUMNS = Object.freeze([...LABEL_COLUMNS, "label_source", "sheet_n"]);

export function toCsv(rows, columns = LABEL_COLUMNS) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(row?.[column] ?? "")).join(","));
  return `${lines.join("\n")}\n`;
}

/** Parse a small CSV. Quoted cells may contain commas and doubled quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => String(value).trim() !== ""));
}

export function labelsFromCsv(text) {
  const table = parseCsv(text);
  if (table.length === 0) throw new Error("labels.csv is empty");
  const header = table[0].map((cell) => cell.trim());
  for (const column of LABEL_COLUMNS) {
    if (!header.includes(column)) throw new Error(`labels.csv is missing the ${column} column`);
  }
  return table.slice(1).map((cells) => {
    const row = {};
    header.forEach((column, index) => {
      row[column] = cells[index] ?? "";
    });
    return row;
  });
}

function yesNo(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "yes") return true;
  if (text === "no") return false;
  return null;
}

function tally(rows, field) {
  const out = { candidateYes: 0, candidateRated: 0, controlYes: 0, controlRated: 0 };
  for (const row of rows) {
    const side = String(row.candidate_side || "").trim().toUpperCase();
    if (side !== "A" && side !== "B") continue;
    const left = yesNo(row[`${field}_a`]);
    const right = yesNo(row[`${field}_b`]);
    const candidate = side === "A" ? left : right;
    const control = side === "A" ? right : left;
    if (candidate !== null) {
      out.candidateRated += 1;
      if (candidate) out.candidateYes += 1;
    }
    if (control !== null) {
      out.controlRated += 1;
      if (control) out.controlYes += 1;
    }
  }
  return out;
}

/**
 * One-sided exact sign test. Null is an even chance. The p-value is the probability
 * of this many candidate wins or more. Ties are not decided and are not passed here.
 */
export function signTestP(wins, n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer");
  if (!Number.isInteger(wins) || wins < 0 || wins > n) throw new Error("wins must be an integer from 0 to n");
  if (n === 0 || wins <= 0) return 1;
  let logTerm = -n * Math.log(2);
  for (let i = 0; i < wins; i++) logTerm += Math.log(n - i) - Math.log(i + 1);
  let sum = 0;
  for (let i = wins; i <= n; i++) {
    sum += Math.exp(logTerm);
    if (i < n) logTerm += Math.log(n - i) - Math.log(i + 1);
  }
  if (sum < 0) return 0;
  if (sum > 1) return 1;
  return sum;
}

function tallyDecisions(rows) {
  let decided = 0;
  let candidateWins = 0;
  let controlWins = 0;
  let ties = 0;
  let unlabeled = 0;
  for (const row of rows) {
    const choice = String(row?.would_change || "").trim().toLowerCase();
    const side = String(row?.candidate_side || "").trim().toUpperCase();
    if (choice === "tie") {
      ties += 1;
      continue;
    }
    if ((choice === "a" || choice === "b") && (side === "A" || side === "B")) {
      decided += 1;
      if (choice.toUpperCase() === side) candidateWins += 1;
      else controlWins += 1;
      continue;
    }
    unlabeled += 1;
  }
  return { decided, candidateWins, controlWins, ties, unlabeled };
}

function sourceIs(row, source) {
  return String(row?.label_source || "").trim().toLowerCase() === source;
}

/**
 * Primary gate: the candidate wins at least 60% of decided pairs, and the one-sided
 * sign-test p-value is under 0.1. A tie, a blank, or a missing side is not decided.
 * Panel labels and human labels are the same gate, reported apart. Secondary tallies
 * do not change the gate.
 */
export function scoreLabels(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const combined = tallyDecisions(list);
  const winRate = combined.decided === 0 ? null : combined.candidateWins / combined.decided;
  const p = combined.decided === 0 ? null : signTestP(combined.candidateWins, combined.decided);
  const passes = combined.decided > 0 && rateClears(combined.candidateWins, combined.decided) && p < SIGN_TEST_P_MAX;
  const pending = list.filter((row) => String(row?.sheet_n ?? "").trim() && !String(row?.would_change ?? "").trim()).length;
  return {
    rows: list.length,
    ...combined,
    winRate,
    signTestP: p,
    passes,
    pending,
    panel: tallyDecisions(list.filter((row) => sourceIs(row, "panel"))),
    human: tallyDecisions(list.filter((row) => sourceIs(row, "human"))),
    secondary: {
      took_position: tally(list, "took_position"),
      specific: tally(list, "specific"),
      cheap_test: tally(list, "cheap_test"),
    },
  };
}

export function renderScore(score) {
  const rate = score.winRate === null ? "n/a" : score.winRate.toFixed(4);
  const p = score.signTestP === null ? "n/a" : score.signTestP.toFixed(6);
  const line = (name, tally) =>
    `${name}_candidate: ${tally.candidateYes}/${tally.candidateRated}\n${name}_control: ${tally.controlYes}/${tally.controlRated}`;
  const arm = (name, tally) =>
    [
      `${name}_decided: ${tally.decided}`,
      `${name}_candidate_wins: ${tally.candidateWins}`,
      `${name}_control_wins: ${tally.controlWins}`,
      `${name}_ties: ${tally.ties}`,
    ].join("\n");
  return [
    `rows: ${score.rows}`,
    `decided: ${score.decided}`,
    `candidate_wins: ${score.candidateWins}`,
    `control_wins: ${score.controlWins}`,
    `ties: ${score.ties}`,
    `unlabeled: ${score.unlabeled}`,
    `win_rate: ${rate}`,
    `sign_test_p: ${p}`,
    `passes: ${score.passes ? "yes" : "no"}`,
    arm("panel", score.panel),
    arm("human", score.human),
    `pending: ${score.pending}`,
    line("took_position", score.secondary.took_position),
    line("specific", score.secondary.specific),
    line("cheap_test", score.secondary.cheap_test),
    "",
  ].join("\n");
}

/**
 * Three cheap models, three providers, none of them the Auto Router the judge uses.
 * They rate the full answer text. A trimmed answer is a different test and is not this one.
 */
export const PANEL_MODELS = Object.freeze([
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat-v3.1",
  "google/gemini-3.1-flash-lite",
]);

export const PANEL_SYSTEM =
  'You compare two full answers to the same decision. You do not know which system wrote which. Length, polish, and which letter is shown first are not reasons to prefer one. Say which answer would change the decision more: the one that would change what a careful reader does next. If they would change the same thing, or you cannot tell, choose tie. Set confident to true only when you would bet on that choice. Reply with JSON only, no markdown: {"choice":"A" or "B" or "tie","confident":true or false}';

/** The user message. Both answers are included whole. There is no length cap. */
export function buildPanelPrompt({ subject, context, a, b } = {}) {
  return [
    "Which answer would change the decision more? Read both answers in full before you choose.",
    "",
    "DECISION",
    String(subject ?? ""),
    "",
    "CONTEXT",
    String(context ?? ""),
    "",
    "ANSWER A",
    String(a ?? ""),
    "",
    "ANSWER B",
    String(b ?? ""),
  ].join("\n");
}

/** One rater's view. Below 0.5, the pair's B is shown as A, so position is not fixed. */
export function panelCall({ subject, context, a, b, rng } = {}) {
  if (typeof rng !== "function") throw new Error("rng is required");
  const draw = rng();
  if (typeof draw !== "number" || draw < 0 || draw >= 1) throw new Error("rng must return a number in [0, 1)");
  const swap = draw < 0.5;
  return {
    swap,
    prompt: buildPanelPrompt({ subject, context, a: swap ? b : a, b: swap ? a : b }),
  };
}

export function unswapChoice(choice, swap) {
  if (choice !== "A" && choice !== "B") return choice || "";
  if (!swap) return choice;
  return choice === "A" ? "B" : "A";
}

export function parsePanelVote(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj;
  try {
    obj = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  const choiceRaw = String(obj.choice ?? "").trim().toLowerCase();
  const choice = choiceRaw === "a" ? "A" : choiceRaw === "b" ? "B" : choiceRaw === "tie" ? "tie" : "";
  if (!choice) return null;
  const flag = obj.confident;
  return { choice, confident: flag === true || flag === "true" || flag === "yes" };
}

/** Assistant text from a chat completion, or "" when the body has none. */
export function panelAnswerText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
}

export function panelRequestBody({ model, prompt } = {}) {
  if (!PANEL_MODELS.includes(model)) throw new Error(`panel model is not one of the three: ${model}`);
  return {
    model,
    messages: [
      { role: "system", content: PANEL_SYSTEM },
      { role: "user", content: String(prompt ?? "") },
    ],
    temperature: 0,
    provider: { zdr: true, data_collection: "deny" },
  };
}

/**
 * Map each rater back onto the pair's A and B. Auto-label only when all three models
 * answered, all three are confident, and all three name the same side.
 */
export function resolvePanel(calls) {
  const list = Array.isArray(calls) ? calls : [];
  const expected = new Set(PANEL_MODELS);
  const seen = new Set();
  const votes = [];
  let complete = list.length === expected.size;
  for (const call of list) {
    if (!expected.has(call?.model) || seen.has(call?.model)) complete = false;
    else seen.add(call.model);
    const parsed = parsePanelVote(call?.raw);
    votes.push({
      model: call?.model || "",
      choice: parsed ? unswapChoice(parsed.choice, Boolean(call?.swap)) : "",
      confident: Boolean(parsed?.confident),
      swap: Boolean(call?.swap),
    });
  }
  if (seen.size !== expected.size) complete = false;
  const first = votes[0]?.choice;
  const unanimous =
    complete && votes.length === expected.size && votes.every((vote) => vote.confident && vote.choice && vote.choice === first);
  return { unanimous, auto: unanimous ? first : "", votes };
}

/** Panel auto-labels stay. Everything else is numbered for the human sheet, starting at 1. */
export function finishLabels(labels, results) {
  const byId = new Map((Array.isArray(results) ? results : []).map((result) => [result.id, result]));
  let n = 0;
  return (Array.isArray(labels) ? labels : []).map((label) => {
    const result = byId.get(label?.id);
    const auto = result?.unanimous && (result.auto === "A" || result.auto === "B" || result.auto === "tie");
    if (auto) return { ...label, would_change: result.auto, label_source: "panel", sheet_n: "" };
    n += 1;
    return { ...label, would_change: "", label_source: "", sheet_n: String(n) };
  });
}

/** The verdict line plus the next two non-empty lines. The rest of the answer stays off the sheet. */
export function answerExcerpt(text) {
  return String(text ?? "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function decisionLine(subject) {
  const text = String(subject ?? "").replace(/\s+/g, " ").trim();
  const mark = text.indexOf("?");
  if (mark !== -1 && mark < 240) return text.slice(0, mark + 1);
  if (text.length <= 180) return text;
  const cut = text.slice(0, 180);
  const space = cut.lastIndexOf(" ");
  return space > 80 ? cut.slice(0, space) : cut;
}

export const REPLY_START = "--- replies ---";
export const REPLY_END = "--- end ---";

export function renderHumanSheet(entries) {
  const items = Array.isArray(entries) ? entries : [];
  const lines = [
    "# Labels still needed",
    "",
    "The panel read the full answers. These pairs were split or not confident, so they are not labelled.",
    "Each answer below is its verdict line plus the next two lines. The full text is in pairs.jsonl.",
    "Fill each line in the form 1: A, 1: B, or 1: tie. A means answer A would change the decision more.",
    "",
  ];
  if (items.length === 0) {
    lines.push("Nothing for a person. The panel labelled every pair.", "");
    return lines.join("\n");
  }
  for (const item of items) {
    lines.push(`## ${item.n}. ${item.id}`, "", decisionLine(item.subject), "", "A:");
    lines.push(...answerExcerpt(item.a), "", "B:");
    lines.push(...answerExcerpt(item.b), "");
  }
  lines.push("Copy this block into replies.txt and fill it.", "", REPLY_START);
  for (const item of items) lines.push(`${item.n}: `);
  lines.push(REPLY_END, "");
  return lines.join("\n");
}

/** Lines like `1: A`. A fenced replies block wins over any example earlier in a sheet. */
export function parseReplies(text) {
  let src = String(text ?? "");
  const start = src.indexOf(REPLY_START);
  const end = src.indexOf(REPLY_END);
  if (start !== -1 && end > start) src = src.slice(start + REPLY_START.length, end);
  const byN = new Map();
  for (const line of src.split(/\n/)) {
    const match = line.trim().match(/^(\d+)\s*:\s*(A|B|tie)\s*$/i);
    if (!match) continue;
    const choice = match[2].toLowerCase() === "tie" ? "tie" : match[2].toUpperCase();
    byN.set(Number(match[1]), choice);
  }
  return [...byN.entries()].map(([n, choice]) => ({ n, choice })).sort((a, b) => a.n - b.n);
}

/** Human replies fill sheet rows. A panel label is left as the panel wrote it. */
export function applyReplies(rows, replies) {
  const byN = new Map((Array.isArray(replies) ? replies : []).map((reply) => [Number(reply.n), reply.choice]));
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (sourceIs(row, "panel")) return row;
    const n = Number(String(row?.sheet_n ?? "").trim());
    if (!Number.isInteger(n) || !byN.has(n)) return row;
    const choice = byN.get(n);
    if (choice !== "A" && choice !== "B" && choice !== "tie") return row;
    return { ...row, would_change: choice, label_source: "human" };
  });
}
