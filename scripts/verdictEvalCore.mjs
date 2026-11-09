// verdictEvalCore.mjs — the pure half of the verdict-quality harness.
//
// No child processes and no network. eval-verdicts.mjs reads the case file and calls the
// judge. eval-score.mjs reads a filled labels file. The tests pin the holdout guard, the
// checksum, and the scorer here, with no router key and no paid call.
//
// The holdout is frozen. A tuning call (purpose "tune") throws before it parses when it
// is asked for that split, and a tuning read of the shared file returns dev rows only.
// The one-shot measurement uses purpose "eval".

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

export function caseProblems(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["the case is not a JSON object"];
  const problems = [];
  const extra = Object.keys(row).filter((key) => !CASE_KEYS.includes(key));
  if (extra.length) problems.push(`unexpected field: ${extra.join(", ")}`);
  if (typeof row.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)) problems.push("id must be kebab-case");
  if (typeof row.subject !== "string" || row.subject.trim().length < 40) problems.push("subject must be a string of at least 40 characters");
  if (typeof row.context !== "string") problems.push("context must be a string");
  if (row.split !== "dev" && row.split !== "holdout") problems.push('split must be "dev" or "holdout"');
  return problems;
}

/**
 * Which read this run is. Tuning is refused before any case text is parsed.
 * A dev run is always a tuning read. Holdout is the one-shot measurement.
 */
export function purposeFor({ split, tune = false } = {}) {
  if (split !== "dev" && split !== "holdout") throw new Error(`unknown split: ${split}`);
  if (tune && split === "holdout") throw new HoldoutLocked();
  return split === "holdout" ? "eval" : "tune";
}

export function casesFromJsonl(text, { purpose, split } = {}) {
  if (purpose !== "tune" && purpose !== "eval") throw new Error(`unknown purpose: ${purpose}`);
  if (split !== "dev" && split !== "holdout") throw new Error(`unknown split: ${split}`);
  if (purpose === "tune" && split !== "dev") throw new HoldoutLocked();
  if (typeof text !== "string") throw new Error("cases text must be a string");
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Tuning never parses a holdout line. The split sits at the end of each line so this
    // can refuse the row before the subject is turned into an object.
    if (purpose === "tune" && /"split"\s*:\s*"holdout"\s*}\s*$/.test(trimmed)) continue;
    let row;
    try {
      row = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`a case line is not JSON: ${e?.message ?? e}`);
    }
    if (row?.split === "holdout" && purpose === "tune") continue;
    if (row?.split !== split) continue;
    const problems = caseProblems(row);
    if (problems.length) throw new Error(`${row?.id ?? "a case"}: ${problems.join("; ")}`);
    if (seen.has(row.id)) throw new Error(`duplicate id: ${row.id}`);
    seen.add(row.id);
    out.push({ id: row.id, subject: row.subject, context: row.context, split: row.split });
  }
  return out;
}

/** Holdout rows only, sorted by id, one canonical JSON object per line. Dev rows do not count. */
export function holdoutCanonical(cases) {
  const lines = (Array.isArray(cases) ? cases : [])
    .filter((row) => row && row.split === "holdout")
    .map((row) => ({ id: row.id, subject: row.subject, context: row.context, split: "holdout" }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => JSON.stringify(row));
  return `${lines.join("\n")}\n`;
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

export function holdoutChecksum(cases) {
  return sha256(holdoutCanonical(cases));
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

export function toCsv(rows) {
  const lines = [LABEL_COLUMNS.join(",")];
  for (const row of rows) lines.push(LABEL_COLUMNS.map((column) => csvCell(row?.[column] ?? "")).join(","));
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

/**
 * Primary gate: the candidate wins at least 60% of decided pairs, and the one-sided
 * sign-test p-value is under 0.1. A tie, a blank, or a missing side is not decided.
 * Secondary tallies do not change the gate.
 */
export function scoreLabels(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let decided = 0;
  let candidateWins = 0;
  let controlWins = 0;
  let ties = 0;
  let unlabeled = 0;
  for (const row of list) {
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
  const winRate = decided === 0 ? null : candidateWins / decided;
  const p = decided === 0 ? null : signTestP(candidateWins, decided);
  const passes = decided > 0 && rateClears(candidateWins, decided) && p < SIGN_TEST_P_MAX;
  return {
    rows: list.length,
    decided,
    candidateWins,
    controlWins,
    ties,
    unlabeled,
    winRate,
    signTestP: p,
    passes,
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
    line("took_position", score.secondary.took_position),
    line("specific", score.secondary.specific),
    line("cheap_test", score.secondary.cheap_test),
    "",
  ].join("\n");
}
