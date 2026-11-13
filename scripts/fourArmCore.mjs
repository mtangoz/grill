/**
 * fourArmCore.mjs: the pure half of the four-arm comparison.
 *
 * The protocol is evals/four-arm/README.md. This file holds everything in it that can be
 * checked without a model: the seed rules, who writes each case, what each arm is sent,
 * how answers are blinded and graded, the counting, the statistics and the decision rule.
 * scripts/eval-four-arm.mjs does the reading, the writing and the model calls.
 *
 * THE PRODUCT JUDGE IS NOT CHANGED BY ANY OF THIS. Arms B, C and D run the unmodified
 * scripts/judge.mjs as a child process. The only thing that differs between them is the
 * child's environment: arm B and arm C set JUDGE_MODEL there, arm D leaves it unset, which
 * is the product path (the Auto Router, with the author's company left out). No model id
 * is written in this file. The ids for the comparison arms live in evals/four-arm/arms.json
 * and are read at run time.
 *
 * Nothing here reads a file, starts a process or makes a request.
 */

import { createHash } from "node:crypto";

import { AUTO_ROUTER_MAX_RETRIES, DEFAULT_CHAIN, JUDGE_TOOL, buildJudgeMessages } from "./judgeCore.mjs";
import {
  FOUR_ARM_IDS,
  FOUR_ARM_STATUSES,
  JUDGE_COMPANY_IDS,
  companyIdOf,
  isCommitHash,
  isIsoDate,
  mcnemarExactP,
  validateFourArm,
  validateResults,
  wilsonInterval,
} from "./resultsCore.mjs";
import { verdictText } from "./verdictEvalCore.mjs";

// == The fixed numbers of the protocol. The README states each one; a test keeps them in step. ==

/** The four arms, by letter, and the public id each one has in data/results.json. */
export const ARMS = Object.freeze(["A", "B", "C", "D"]);
export const ARM_IDS = Object.freeze({ A: "same-chat", B: "fresh-brief", C: "stronger-same-lab", D: "product" });
export const ARM_NAMES = Object.freeze({
  A: "the same model, same chat, told to argue the other side",
  B: "the same model, fresh context, Grill's brief",
  C: "a stronger model from the same lab, Grill's brief",
  D: "the product as shipped",
});

/** The last thing arm A is sent, after the question and a blank line. */
export const ARM_A_REQUEST = "Argue the other side.";

/** Fewer analysed flawed cases than this and the result is "too few cases to test". */
export const MIN_ANALYSED_FLAWED = 110;
/** The size of difference the case count was chosen to find. Smaller ones cannot be ruled out. */
export const EFFECT_POINTS = 15;
/** Two-sided level for the primary test, and for each secondary test after Holm. */
export const ALPHA = 0.05;
/** Arms are not ranked on alarm rate unless the gap is at least this many points. */
export const ALARM_RANK_GAP_POINTS = 30;
/** Every arm must give a usable answer on at least this share of the analysed flawed cases. */
export const USABLE_FLOOR = Object.freeze({ num: 9, den: 10 });
/** The grader check: the owner labels this many blinded items, and this many must match. */
export const AUDIT_ITEMS = 40;
export const AUDIT_AGREE_FLOOR = 34;
/** How many of the audit items are taken from sound twins, where a wrong grade costs most. */
export const AUDIT_ALARM_ITEMS = 16;
/**
 * The most requests one arm may make to a model for one case. Arm D is the product, which
 * already makes this many inside one run of judge.mjs, so the harness runs arm D once and
 * retries arms A, B and C itself up to the same number.
 */
export const ARM_MAX_REQUESTS = 1 + AUTO_ROUTER_MAX_RETRIES;
/** How many graders vote on one item. */
export const GRADER_VOTES = 3;
/** A usable write-up has this many words. A usable arm A reply has at least ARM_A_MIN_WORDS. */
export const WRITE_UP_WORDS = Object.freeze({ min: 100, max: 400 });
export const ARM_A_MIN_WORDS = 30;

/** The comparisons. The first is the primary one. The rest are the named secondary tests. */
export const PRIMARY_COMPARISON = Object.freeze({
  id: "product-vs-fresh-brief",
  first: "D",
  second: "B",
  name: "the product as shipped against the same model with a fresh context and Grill's brief",
});
export const SECONDARY_COMPARISONS = Object.freeze([
  Object.freeze({
    id: "product-vs-same-chat",
    first: "D",
    second: "A",
    name: "the product as shipped against typing \"argue the other side\" in the same chat",
  }),
  Object.freeze({
    id: "product-vs-stronger-same-lab",
    first: "D",
    second: "C",
    name: "the product as shipped against a stronger model from the same lab with Grill's brief",
  }),
  Object.freeze({
    id: "fresh-brief-vs-same-chat",
    first: "B",
    second: "A",
    name: "a fresh context and Grill's brief against the same chat, same model",
  }),
  Object.freeze({
    id: "stronger-same-lab-vs-fresh-brief",
    first: "C",
    second: "B",
    name: "a stronger model against the same model, both from the author's lab, both with Grill's brief",
  }),
]);
export const COMPARISONS = Object.freeze([PRIMARY_COMPARISON, ...SECONDARY_COMPARISONS]);

/** What a run can conclude. The words are the ones the protocol uses. */
export const OUTCOMES = Object.freeze([
  "not-measured",
  "too-few-cases",
  "no-pooled-headline",
  "d-better",
  "no-difference-of-15-found",
  "d-worse",
]);
export const OUTCOME_WORDS = Object.freeze({
  "not-measured": "Not measured",
  "too-few-cases": "too few cases to test",
  "no-pooled-headline": "no pooled headline: D minus B has opposite signs in the two author families",
  "d-better": "D better",
  "no-difference-of-15-found": `no difference of ${EFFECT_POINTS} points or more was found`,
  "d-worse": "D worse",
});

// == Seeds ======================================================================

export const SEED_KEYS = Object.freeze([
  "id",
  "kind",
  "category",
  "user_ask",
  "question",
  "flaw",
  "flaw_type",
  "twin_of",
  "author_family",
  "drafter_family",
  "split",
]);
export const SEED_KINDS = Object.freeze(["flawed", "sound", "loaded"]);
export const SEED_SPLITS = Object.freeze(["dev", "frozen"]);

/** Everyday decision domains. A seed belongs to exactly one. */
export const SEED_CATEGORIES = Object.freeze([
  "personal-money",
  "career",
  "hiring-and-team",
  "pricing-and-sales",
  "marketing",
  "operations-and-suppliers",
  "software-and-tools",
  "housing-and-moving",
  "study-and-training",
  "events-and-community",
]);

/** The planted flaw, by type. A flawed seed has exactly one. */
export const FLAW_TYPES = Object.freeze([
  "arithmetic",
  "base-rate-ignored",
  "survivorship",
  "sunk-cost",
  "dropped-requirement",
  "hidden-dependency",
  "timeline-conflict",
  "confounded-evidence",
  "small-sample",
  "selection",
  "contradicts-own-goal",
  "irreversible-no-cheap-test",
]);
/** The flaw type of every loaded seed, and of nothing else. */
export const LOADED_FLAW_TYPE = "loaded-question";
/** The flaw type of every sound seed, and of nothing else. */
export const NO_FLAW_TYPE = "none";

/** The model families that write the write-ups. They are the values judge.mjs takes as --author. */
export const AUTHOR_FAMILIES = Object.freeze(["anthropic", "openai"]);

/** Who drafted a seed: a model company, the owner, or another person. */
export const DRAFTER_FAMILIES = Object.freeze([...JUDGE_COMPANY_IDS.filter((id) => id !== "other"), "owner", "person"]);
const HUMAN_DRAFTERS = Object.freeze(["owner", "person"]);

export const ASK_WORDS = Object.freeze({ min: 60, max: 220 });
export const QUESTION_WORDS = Object.freeze({ min: 4, max: 40 });
export const FLAW_WORDS = Object.freeze({ min: 6, max: 60 });

/** What the README says in place of counts while there is no seed file. */
export const NO_SEEDS_LINE = "Seeds not written yet.";
export const SEED_COUNTS_START = "<!-- seed-counts:start -->";
export const SEED_COUNTS_END = "<!-- seed-counts:end -->";

const KEBAB_RX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLAIN_KEY_RX = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const DASH_RX = /[\u2012\u2013\u2014\u2015\u2212]/;
const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const URL_RX = new RegExp(
  [
    "\\b(?:https?|ftp)://",
    "\\bwww\\.[a-z0-9-]",
    "\\b[a-z0-9][a-z0-9-]*\\.(?:com|org|net|io|ai|app|dev|edu|gov|info|biz|uk|xyz|shop|store|site|online|tech)\\b",
  ].join("|"),
  "i",
);
const PHONE_RXS = Object.freeze([
  /\+\d{9,15}\b/,
  /\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s-]\d{2,4}){2,3}\b/,
  /\(\d{2,5}\)\s?\d{3,4}[\s-]\d{3,4}\b/,
  /\b\d{3}[.\s-]\d{3}[.\s-]\d{4}\b/,
  /\b0\d{2,4}[\s-]\d{3,4}[\s-]\d{3,4}\b/,
]);
/** Phrases from Grill's own write-up template. A seed is what a person types, not that template. */
const TEMPLATE_PHRASES = Object.freeze(["prediction, offered at", "the strongest case against"]);
const WRITE_UP_LENGTH_RX = /\b200[- ]words?\b/i;

export function countWords(text) {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Problems with the words of one field. Nothing a person typed is repeated, except a model name. */
function textProblems(field, text) {
  const problems = [];
  if (DASH_RX.test(text)) problems.push(`${field} has an em dash or an en dash; use a comma, a full stop or the word "to"`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) problems.push(`${field} has a control character`);
  if (EMAIL_RX.test(text)) problems.push(`${field} has what looks like an email address`);
  if (URL_RX.test(text)) problems.push(`${field} has what looks like a web address`);
  if (PHONE_RXS.some((rx) => rx.test(text))) problems.push(`${field} has what looks like a phone number`);
  const names = namesFound(text);
  if (names.length) problems.push(`${field} names an AI company or model (${names.join(", ")})`);
  return problems;
}

/** Everything wrong with one seed, as plain sentences. An empty list means the seed is valid. */
export function seedProblems(seed) {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) return ["the seed is not a JSON object"];
  const problems = [];
  const extra = Object.keys(seed).filter((key) => !SEED_KEYS.includes(key));
  if (extra.length) problems.push(`unexpected field: ${extra.map((key) => (PLAIN_KEY_RX.test(key) ? key : "(a key that is not a plain name)")).join(", ")}`);
  const missing = SEED_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(seed, key));
  if (missing.length) problems.push(`missing field: ${missing.join(", ")}`);
  const notText = SEED_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(seed, key) && typeof seed[key] !== "string");
  if (notText.length) problems.push(`not a string: ${notText.join(", ")}`);
  if (missing.length || notText.length) return problems;

  if (!KEBAB_RX.test(seed.id) || seed.id.length > 80) problems.push("id must be kebab-case, 80 characters at most");
  if (!SEED_KINDS.includes(seed.kind)) problems.push(`kind must be one of ${SEED_KINDS.join(", ")}`);
  if (!SEED_CATEGORIES.includes(seed.category)) problems.push(`category must be one of ${SEED_CATEGORIES.join(", ")}`);
  if (!SEED_SPLITS.includes(seed.split)) problems.push(`split must be one of ${SEED_SPLITS.join(", ")}`);
  if (!DRAFTER_FAMILIES.includes(seed.drafter_family)) problems.push(`drafter_family must be one of ${DRAFTER_FAMILIES.join(", ")}`);
  if (seed.author_family !== "" && !AUTHOR_FAMILIES.includes(seed.author_family)) {
    problems.push(`author_family must be empty or one of ${AUTHOR_FAMILIES.join(", ")}`);
  }

  const askWords = countWords(seed.user_ask);
  if (askWords < ASK_WORDS.min || askWords > ASK_WORDS.max) {
    problems.push(`user_ask must be ${ASK_WORDS.min} to ${ASK_WORDS.max} words (it has ${askWords})`);
  }
  if (!WRITE_UP_LENGTH_RX.test(seed.user_ask)) problems.push('user_ask must ask for a write-up of about 200 words (say "200 words")');
  const lowerAsk = seed.user_ask.toLowerCase();
  for (const phrase of TEMPLATE_PHRASES) {
    if (lowerAsk.includes(phrase)) problems.push(`user_ask uses a phrase from Grill's own write-up template ("${phrase}")`);
  }

  const questionWords = countWords(seed.question);
  if (/[\r\n]/.test(seed.question)) problems.push("question must be one line");
  if (!seed.question.trim().endsWith("?")) problems.push("question must end with a question mark");
  if (questionWords < QUESTION_WORDS.min || questionWords > QUESTION_WORDS.max) {
    problems.push(`question must be ${QUESTION_WORDS.min} to ${QUESTION_WORDS.max} words (it has ${questionWords})`);
  }

  if (seed.kind === "sound") {
    if (seed.flaw !== "") problems.push("a sound seed has an empty flaw");
    if (seed.flaw_type !== NO_FLAW_TYPE) problems.push(`a sound seed has flaw_type "${NO_FLAW_TYPE}"`);
    if (!KEBAB_RX.test(seed.twin_of)) problems.push("a sound seed names the flawed seed it corrects in twin_of");
    else if (seed.twin_of === seed.id) problems.push("twin_of cannot be the seed's own id");
  } else if (SEED_KINDS.includes(seed.kind)) {
    const flawWords = countWords(seed.flaw);
    if (/[\r\n]/.test(seed.flaw)) problems.push("flaw must be one line");
    if (flawWords < FLAW_WORDS.min || flawWords > FLAW_WORDS.max) {
      problems.push(`flaw must be one sentence of ${FLAW_WORDS.min} to ${FLAW_WORDS.max} words (it has ${flawWords})`);
    }
    if (seed.twin_of !== "") problems.push(`a ${seed.kind} seed has an empty twin_of`);
    if (seed.kind === "loaded" && seed.flaw_type !== LOADED_FLAW_TYPE) {
      problems.push(`a loaded seed has flaw_type "${LOADED_FLAW_TYPE}"`);
    }
    if (seed.kind === "flawed" && !FLAW_TYPES.includes(seed.flaw_type)) {
      problems.push(`a flawed seed has a flaw_type from: ${FLAW_TYPES.join(", ")}`);
    }
  }

  for (const field of ["user_ask", "question", "flaw"]) problems.push(...textProblems(field, seed[field]));
  return problems;
}

/** Word five-grams of an ask, for spotting one scenario written twice. */
function shingles(text) {
  const words = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out = new Set();
  for (let i = 0; i + 5 <= words.length; i += 1) out.add(words.slice(i, i + 5).join(" "));
  return out;
}

function overlap(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Two asks that share this much of their wording are the same scenario. Twins are exempt. */
export const SAME_SCENARIO_OVERLAP = 0.5;
/** A twin shares at least this much of its wording with the seed it corrects: same situation, flaw taken out. */
export const TWIN_MIN_OVERLAP = 0.2;

/**
 * Problems that only show when the seeds are read together: a repeated id, a twin that
 * points nowhere, one scenario used twice, and author families that are half assigned or
 * out of balance. Seeds that fail seedProblems are skipped here; fix those first.
 */
export function seedSetProblems(seeds) {
  const problems = [];
  const all = Array.isArray(seeds) ? seeds : [];
  const list = all.filter((seed) => seedProblems(seed).length === 0);
  const invalidIds = all.filter((seed) => !list.includes(seed) && seed && typeof seed.id === "string").map((seed) => seed.id);
  const byId = new Map();
  for (const seed of list) {
    if (byId.has(seed.id)) problems.push(`${seed.id}: the same id is used twice`);
    else byId.set(seed.id, seed);
  }

  const twinsOf = new Map();
  for (const seed of list) {
    if (seed.kind !== "sound") continue;
    const sibling = byId.get(seed.twin_of);
    if (!sibling) {
      // A sibling that is here but has its own problems is reported there, not here.
      if (!invalidIds.includes(seed.twin_of)) problems.push(`${seed.id}: twin_of names ${seed.twin_of}, which is not in this file`);
      continue;
    }
    if (sibling.kind !== "flawed") problems.push(`${seed.id}: twin_of must name a flawed seed, and ${sibling.id} is ${sibling.kind}`);
    if (sibling.split !== seed.split) problems.push(`${seed.id}: a twin is in the same split as the seed it corrects`);
    if (sibling.category !== seed.category) problems.push(`${seed.id}: a twin has the same category as the seed it corrects`);
    if (twinsOf.has(sibling.id)) problems.push(`${seed.id}: ${sibling.id} already has a twin (${twinsOf.get(sibling.id)})`);
    else twinsOf.set(sibling.id, seed.id);
    if (overlap(shingles(seed.user_ask), shingles(sibling.user_ask)) < TWIN_MIN_OVERLAP) {
      problems.push(`${seed.id}: a twin tells the same situation as ${sibling.id} with the flaw taken out, and these two asks share too little`);
    }
  }

  const assigned = list.filter((seed) => seed.author_family !== "");
  if (assigned.length > 0 && assigned.length < list.length) {
    problems.push(`author_family is set on ${assigned.length} of ${list.length} seeds; set it on all of them or on none`);
  } else if (assigned.length === list.length && list.length > 0) {
    for (const seed of list) {
      if (seed.kind !== "sound") continue;
      const sibling = byId.get(seed.twin_of);
      if (sibling && sibling.author_family !== seed.author_family) {
        problems.push(`${seed.id}: a twin has the author family of the seed it corrects (${sibling.author_family})`);
      }
    }
    for (const split of SEED_SPLITS) {
      for (const kind of ["flawed", "loaded"]) {
        const group = list.filter((seed) => seed.split === split && seed.kind === kind);
        if (group.length === 0) continue;
        const counts = AUTHOR_FAMILIES.map((family) => group.filter((seed) => seed.author_family === family).length);
        if (Math.max(...counts) - Math.min(...counts) > 1) {
          problems.push(
            `${split} ${kind} seeds are not balanced between author families (${AUTHOR_FAMILIES.map((family, i) => `${family} ${counts[i]}`).join(", ")})`,
          );
        }
      }
    }
  }

  const sets = list.map((seed) => shingles(seed.user_ask));
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.twin_of === b.id || b.twin_of === a.id) continue;
      if (overlap(sets[i], sets[j]) >= SAME_SCENARIO_OVERLAP) problems.push(`${a.id} and ${b.id}: the two asks read as the same scenario`);
    }
  }
  return problems;
}

/**
 * Read a seed file: one JSON object per line, blank lines ignored.
 * Returns the seeds that parsed and every problem found, each with its line number.
 */
export function parseSeedsJsonl(text) {
  if (typeof text !== "string") throw new Error("seed text must be a string");
  const seeds = [];
  const problems = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      problems.push(`line ${index + 1}: not JSON`);
      return;
    }
    const label = row && typeof row === "object" && typeof row.id === "string" && KEBAB_RX.test(row.id) ? ` (${row.id})` : "";
    for (const problem of seedProblems(row)) problems.push(`line ${index + 1}${label}: ${problem}`);
    seeds.push(row);
  });
  problems.push(...seedSetProblems(seeds));
  return { seeds, problems };
}

function tally(list, keyOf) {
  const out = {};
  for (const item of list) {
    const key = keyOf(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Counts of a seed list, every way the validator prints them. */
export function seedCounts(seeds) {
  const list = (Array.isArray(seeds) ? seeds : []).filter((seed) => seed && typeof seed === "object");
  const kindsIn = (split) => {
    const inSplit = list.filter((seed) => seed.split === split);
    const out = { total: inSplit.length };
    for (const kind of SEED_KINDS) out[kind] = inSplit.filter((seed) => seed.kind === kind).length;
    return out;
  };
  return {
    total: list.length,
    by_kind: tally(list, (seed) => String(seed.kind)),
    by_category: tally(list, (seed) => String(seed.category)),
    by_flaw_type: tally(list, (seed) => String(seed.flaw_type)),
    by_split: tally(list, (seed) => String(seed.split)),
    by_drafter: tally(list, (seed) => String(seed.drafter_family)),
    by_author: tally(list, (seed) => (seed.author_family === "" ? "(not assigned)" : String(seed.author_family))),
    frozen: kindsIn("frozen"),
    dev: kindsIn("dev"),
    frozen_by_drafter: tally(list.filter((seed) => seed.split === "frozen"), (seed) => String(seed.drafter_family)),
    frozen_by_kind_and_author: Object.fromEntries(
      SEED_KINDS.map((kind) => [
        kind,
        Object.fromEntries(AUTHOR_FAMILIES.map((family) => [family, list.filter((seed) => seed.split === "frozen" && seed.kind === kind && seed.author_family === family).length])),
      ]),
    ),
    single_drafter: singleDrafter(list),
  };
}

function sortedEntries(record) {
  return Object.entries(record).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The lines the README carries between its two seed-count markers. A test compares the
 * README with this, so the stated counts cannot drift from the seed file.
 */
export function renderSeedCounts(seeds) {
  const c = seedCounts(seeds);
  const kinds = (part) => `${part.flawed} flawed, ${part.sound} sound twins, ${part.loaded} loaded (${part.total} in all)`;
  return [
    `Frozen split: ${kinds(c.frozen)}.`,
    `Dev split: ${kinds(c.dev)}.`,
    `Frozen seeds by drafter: ${sortedEntries(c.frozen_by_drafter).map(([who, n]) => `${who} ${n}`).join(", ") || "none"}.`,
    `Single-drafter set: ${c.single_drafter ? "yes" : "no"}.`,
  ].join("\n");
}

/** The text between the README's seed-count markers, or null when a marker is missing. */
export function readmeSeedCounts(readme) {
  const text = String(readme ?? "");
  const start = text.indexOf(SEED_COUNTS_START);
  const end = text.indexOf(SEED_COUNTS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start + SEED_COUNTS_START.length, end).trim();
}

/**
 * True when one model family drafted more than half of the frozen seeds. A set like that
 * can take a quality claim away but cannot bring one back. Seeds drafted by the owner or
 * by another person count toward the other half.
 */
export function singleDrafter(seeds) {
  const frozen = (Array.isArray(seeds) ? seeds : []).filter((seed) => seed && seed.split === "frozen");
  if (frozen.length === 0) return true;
  const byModelFamily = tally(
    frozen.filter((seed) => !HUMAN_DRAFTERS.includes(seed.drafter_family)),
    (seed) => String(seed.drafter_family),
  );
  const largest = Math.max(0, ...Object.values(byModelFamily));
  return largest * 2 > frozen.length;
}

export function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

/** One split, sorted by id, one object per line with the keys in SEED_KEYS order. */
export function seedsCanonical(seeds, split = "frozen") {
  const lines = (Array.isArray(seeds) ? seeds : [])
    .filter((seed) => seed && seed.split === split)
    .map((seed) => {
      const row = {};
      for (const key of SEED_KEYS) row[key] = seed[key];
      return row;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => JSON.stringify(row));
  return `${lines.join("\n")}\n`;
}

/** The checksum that registration records. It covers the frozen split, author families included. */
export function seedsChecksum(seeds) {
  return sha256(seedsCanonical(seeds, "frozen"));
}

/**
 * Give every seed an author family, before any model is called.
 *
 * Flawed and loaded seeds alternate between the families inside each split and kind, in
 * the order flaw type, category, id, so the families are balanced on all three. A sound
 * twin takes the family of the flawed seed it corrects, so the pair has one author.
 * The result depends only on the seeds, so anyone can run it again and get the same answer.
 */
export function assignAuthors(seeds, families = AUTHOR_FAMILIES) {
  const list = Array.isArray(seeds) ? seeds : [];
  if (!Array.isArray(families) || families.length === 0) throw new Error("at least one author family is needed");
  const assigned = new Map();
  let groupIndex = 0;
  for (const split of SEED_SPLITS) {
    for (const kind of ["flawed", "loaded"]) {
      const group = list
        .filter((seed) => seed.split === split && seed.kind === kind)
        .sort((a, b) => {
          const ka = `${a.flaw_type}\u0000${a.category}\u0000${a.id}`;
          const kb = `${b.flaw_type}\u0000${b.category}\u0000${b.id}`;
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
      group.forEach((seed, i) => assigned.set(seed.id, families[(i + groupIndex) % families.length]));
      groupIndex += 1;
    }
  }
  return list.map((seed) => {
    if (seed.kind === "sound") return { ...seed, author_family: assigned.get(seed.twin_of) ?? "" };
    return { ...seed, author_family: assigned.get(seed.id) ?? "" };
  });
}

// == Names: what blinding removes, and what a seed may not contain ========================

/** Router vendor prefixes. A `vendor/model` id under any of these is removed whole. */
const VENDOR_PREFIXES = Object.freeze([
  ...JUDGE_COMPANY_IDS.filter((id) => id !== "other"), "openrouter", "typesafe", "meta", "xai", "mistral",
  "moonshot", "alibaba", "zai", "tencent", "baidu", "bytedance", "bytedance-seed", "xiaomi", "stepfun",
  "inclusionai", "aion-labs", "thinkingmachines", "sakana", "nex-agi", "ibm-granite", "nousresearch", "ai21",
  "01-ai", "thedrummer",
]);

/** Company and model family names, as people write them. Matched whole, in any letter case. */
const BRAND_WORDS = Object.freeze([
  "anthropic", "claude", "open\\s?ai", "chat\\s?gpt", "gpt", "google", "deepmind", "gemini", "gemma", "x-ai", "xai",
  "grok", "deepseek", "meta-llama", "meta ai", "llama", "mistralai", "mistral", "moonshotai", "moonshot", "kimi",
  "minimax", "qwen", "alibaba", "tongyi", "cohere", "amazon", "microsoft", "copilot", "nvidia", "perplexity", "z-ai",
  "zhipu", "glm", "openrouter", "auto router", "typesafe", "jev", "baidu", "tencent", "hunyuan", "bytedance",
  "doubao", "xiaomi", "stepfun", "inclusionai", "thinkingmachines", "nousresearch",
]);

/** Words that follow a brand in a model's name: a tier, or a version. Removed with it. */
const TIER_WORDS = Object.freeze([
  "opus", "sonnet", "haiku", "fable", "pro", "flash", "lite", "ultra", "nano", "mini", "max", "turbo", "large",
  "medium", "small", "plus", "carbon", "argon", "hydrogen", "terra", "sol", "luna", "preview", "thinking",
  "instruct", "chat", "code", "codex",
]);

const escapeRx = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const VERSION = "[a-z]?\\d+(?:[.\\w]*\\w)?";
const SLUG_RX = new RegExp(`~?(?<![\\w-])(?:${VENDOR_PREFIXES.map(escapeRx).join("|")})/[A-Za-z0-9][\\w.:-]*`, "gi");
const BRAND_RX = new RegExp(
  `(?<![\\w/])(?:${BRAND_WORDS.join("|")})(?:\\d+(?:[.\\w]*\\w)?|\\b)(?:[ -](?:${VERSION}|${TIER_WORDS.join("|")})\\b)*`,
  "gi",
);
/** "Meta" the company, with its capital. The plain word "meta" is left alone. */
const META_RX = /\bMeta\b(?: AI\b)?/g;
/** OpenAI's short model names, such as o4-mini. */
const O_SERIES_RX = /\bo[1-9]-(?:mini|pro|preview)\b/gi;
const NAME_RXS = Object.freeze([SLUG_RX, BRAND_RX, META_RX, O_SERIES_RX]);

export const NAME_REMOVED = "[name removed]";

/** The AI company and model names in a text, lower-cased, each once, in the order found. */
export function namesFound(text) {
  const found = [];
  const source = String(text ?? "");
  for (const rx of NAME_RXS) {
    for (const match of source.matchAll(rx)) {
      const name = match[0].trim().toLowerCase();
      if (name && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

/**
 * The two lines of Grill's run note, and nothing wider. A line of somebody's critique that
 * merely starts with "Cost:" or "Private:" is part of the critique and stays.
 */
const RUN_NOTE_LINE_RXS = Object.freeze([/^models?:.*(?:\(judge\)|judge model not reported)/i, /^private: sent only to zero-data-retention endpoints/i]);

/**
 * What a grader is shown in place of an arm's raw output. The run note goes, and so does
 * every AI company or model name, so a grader cannot tell which arm or which model wrote
 * the text from a name in it. It cannot hide the layout: see the README on arm A.
 */
export function blind(text) {
  let out = String(text ?? "")
    .split("\n")
    .filter((line) => !RUN_NOTE_LINE_RXS.some((rx) => rx.test(line.trim())))
    .join("\n");
  for (const rx of NAME_RXS) out = out.replace(rx, NAME_REMOVED);
  const removed = escapeRx(NAME_REMOVED);
  return out
    .replace(new RegExp(`${removed}(?:[ ,/-]*${removed})+`, "g"), NAME_REMOVED)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// == arms.json: which models stand in each arm ==========================================

export const ID_UNCONFIRMED = "owner to confirm";
export const ID_CONFIRMED = "confirmed";
const ID_STATUSES = Object.freeze([ID_UNCONFIRMED, ID_CONFIRMED]);
const MODEL_ID_RX = /^[a-z0-9][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ARMS_KEYS = Object.freeze(["about", "status", "registered", "catalog_checked", "families", "graders"]);
const FAMILY_KEYS = Object.freeze(["author_model", "author_model_status", "stronger_model", "stronger_model_status"]);
const REGISTERED_KEYS = Object.freeze(["date", "commit", "seeds_sha256", "judge_prompt_sha256"]);
const SHA256_RX = /^[0-9a-f]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Everything wrong with an arms file. An empty list means it can be used for a dev run. */
export function armsProblems(config) {
  if (!isRecord(config)) return ["arms.json is not a JSON object"];
  const problems = [];
  for (const key of Object.keys(config)) if (!ARMS_KEYS.includes(key)) problems.push(`unexpected key: ${key}`);
  if (!FOUR_ARM_STATUSES.includes(config.status)) problems.push(`status must be one of ${FOUR_ARM_STATUSES.join(", ")}`);
  if (config.catalog_checked !== undefined && !isIsoDate(config.catalog_checked)) problems.push("catalog_checked must be a date written YYYY-MM-DD");

  if (!isRecord(config.families)) problems.push("families must be an object");
  else {
    const names = Object.keys(config.families);
    if (names.length !== AUTHOR_FAMILIES.length || AUTHOR_FAMILIES.some((family) => !names.includes(family))) {
      problems.push(`families must be exactly: ${AUTHOR_FAMILIES.join(", ")}`);
    }
    for (const family of names) {
      const entry = config.families[family];
      if (!isRecord(entry)) {
        problems.push(`families.${family} must be an object`);
        continue;
      }
      for (const key of Object.keys(entry)) if (!FAMILY_KEYS.includes(key)) problems.push(`families.${family}: unexpected key ${key}`);
      for (const role of ["author_model", "stronger_model"]) {
        const id = entry[role];
        if (typeof id !== "string" || !MODEL_ID_RX.test(id)) problems.push(`families.${family}.${role} must be a router model id, vendor/model`);
        else if (companyIdOf(id) !== family) problems.push(`families.${family}.${role} must be a model from ${family}`);
        if (!ID_STATUSES.includes(entry[`${role}_status`])) {
          problems.push(`families.${family}.${role}_status must be "${ID_UNCONFIRMED}" or "${ID_CONFIRMED}"`);
        }
      }
      if (typeof entry.author_model === "string" && entry.author_model === entry.stronger_model) {
        problems.push(`families.${family}: the stronger model must differ from the author model`);
      }
    }
  }

  if (!Array.isArray(config.graders)) problems.push("graders must be a list");
  else {
    if (config.graders.length < GRADER_VOTES + 1) {
      problems.push(`graders must list at least ${GRADER_VOTES + 1} models, so ${GRADER_VOTES} can vote when one is left out`);
    }
    const companies = [];
    config.graders.forEach((grader, i) => {
      if (!isRecord(grader) || typeof grader.model !== "string" || !MODEL_ID_RX.test(grader.model)) {
        problems.push(`graders[${i}].model must be a router model id, vendor/model`);
        return;
      }
      for (const key of Object.keys(grader)) if (key !== "model" && key !== "status") problems.push(`graders[${i}]: unexpected key ${key}`);
      if (!ID_STATUSES.includes(grader.status)) problems.push(`graders[${i}].status must be "${ID_UNCONFIRMED}" or "${ID_CONFIRMED}"`);
      const company = companyIdOf(grader.model);
      if (company === "other") problems.push(`graders[${i}].model is from a company that is not on the fixed list`);
      if (AUTHOR_FAMILIES.includes(company)) problems.push(`graders[${i}].model is from an author family (${company}); a grader is from neither`);
      if (companies.includes(company)) problems.push(`graders[${i}].model is a second grader from ${company}; each grader is from a different company`);
      companies.push(company);
    });
  }

  if (config.status === "draft") {
    if (config.registered !== null && config.registered !== undefined) problems.push("registered must be null while status is draft");
  } else if (FOUR_ARM_STATUSES.includes(config.status)) {
    const reg = config.registered;
    if (!isRecord(reg)) problems.push(`registered must hold ${REGISTERED_KEYS.join(", ")} once status is ${config.status}`);
    else {
      for (const key of Object.keys(reg)) if (!REGISTERED_KEYS.includes(key)) problems.push(`registered: unexpected key ${key}`);
      if (!isIsoDate(reg.date)) problems.push("registered.date must be a date written YYYY-MM-DD");
      if (!isCommitHash(reg.commit)) problems.push("registered.commit must be a commit hash");
      for (const key of ["seeds_sha256", "judge_prompt_sha256"]) {
        if (typeof reg[key] !== "string" || !SHA256_RX.test(reg[key])) problems.push(`registered.${key} must be 64 hex characters`);
      }
    }
  }
  return problems;
}

/** Every model id in an arms file, each once: authors, stronger models, then graders. */
export function armsModelIds(config) {
  const ids = [];
  for (const family of AUTHOR_FAMILIES) {
    const entry = config?.families?.[family];
    for (const id of [entry?.author_model, entry?.stronger_model]) if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  for (const grader of Array.isArray(config?.graders) ? config.graders : []) {
    if (typeof grader?.model === "string" && !ids.includes(grader.model)) ids.push(grader.model);
  }
  return ids;
}

/**
 * What still stands between a draft and a run on the frozen split. Empty means registered:
 * the ids are confirmed, the status says registered, and the seed checksum on file, the one
 * in arms.json and the one worked out from the seeds are the same.
 */
export function registrationProblems(config, { seeds, checksumOnFile } = {}) {
  const problems = armsProblems(config);
  if (problems.length) return problems;
  if (config.status === "draft") problems.push('arms.json status is "draft"; a frozen run needs "registered"');
  const unconfirmed = [];
  for (const family of AUTHOR_FAMILIES) {
    for (const role of ["author_model", "stronger_model"]) {
      if (config.families[family][`${role}_status`] !== ID_CONFIRMED) unconfirmed.push(`families.${family}.${role}`);
    }
  }
  config.graders.forEach((grader, i) => {
    if (grader.status !== ID_CONFIRMED) unconfirmed.push(`graders[${i}]`);
  });
  if (unconfirmed.length) problems.push(`model ids still marked "${ID_UNCONFIRMED}": ${unconfirmed.join(", ")}`);
  const computed = seedsChecksum(seeds);
  const onFile = typeof checksumOnFile === "string" ? checksumOnFile.trim().split(/\s+/)[0] : "";
  if (!onFile) problems.push("evals/four-arm/seeds.sha256 does not exist; it is written at registration");
  else if (onFile !== computed) problems.push("the frozen seeds do not match seeds.sha256; the set is frozen at registration");
  if (isRecord(config.registered) && config.registered.seeds_sha256 !== computed) {
    problems.push("the frozen seeds do not match registered.seeds_sha256 in arms.json");
  }
  return problems;
}

/**
 * A fingerprint of the judge's instructions and answer form at this commit. Recorded with
 * every run, so a later reader can see whether arms B, C and D used the same brief as the
 * registered protocol.
 */
export function judgePromptFingerprint() {
  const messages = buildJudgeMessages({ subject: "(the write-up)", question: "(the question)", subjectLabel: "(stdin)", env: {} });
  return sha256(JSON.stringify({ messages, tool: JUDGE_TOOL }));
}

/** True while the product judge still asks only the Auto Router. The harness refuses to run otherwise. */
export function productChainUntouched() {
  return DEFAULT_CHAIN === "openrouter/auto";
}

// == What each arm is sent ============================================================

/** The author step: the person's ask, alone, to the author model. No system prompt. */
export function authorMessages(seed) {
  return [{ role: "user", content: String(seed?.user_ask ?? "") }];
}

/**
 * Arm A: the same chat, continued. The model sees the person's ask, its own write-up as
 * its earlier turn, then the question, a blank line, and "Argue the other side."
 */
export function armAMessages(seed, writeUp) {
  return [
    { role: "user", content: String(seed?.user_ask ?? "") },
    { role: "assistant", content: String(writeUp ?? "") },
    { role: "user", content: `${String(seed?.question ?? "")}\n\n${ARM_A_REQUEST}` },
  ];
}

/**
 * The request body for the author step and for arm A. No system prompt, no tools and no
 * temperature, as in a chat. The routing block is the one judge.mjs sends, so every arm is
 * served under the same zero-retention rule.
 */
export function chatRequestBody({ model, messages } = {}) {
  if (typeof model !== "string" || !model) throw new Error("a model id is required");
  return { model, messages, usage: { include: true }, provider: { zdr: true, data_collection: "deny" } };
}

/** Arguments for judge.mjs in arms B, C and D. The write-up goes in on stdin. */
export function judgeArgs(seed) {
  if (!AUTHOR_FAMILIES.includes(seed?.author_family)) throw new Error(`${seed?.id ?? "a seed"} has no author family`);
  return ["--json", "--question", String(seed.question), "--author", seed.author_family];
}

/** Settings that would change what the judge does. Removed from every child, whatever the caller has set. */
const CHILD_ENV_REMOVED = Object.freeze(["JUDGE_MODEL", "JUDGE_FIXTURE", "JUDGE_CHECK", "GRILL_JUDGE_COMMIT"]);

/**
 * The child environment for arms B, C and D. Arm B names the author model, arm C the
 * stronger model from the same lab, and arm D names nothing, which is the product path.
 * The caller's own JUDGE_MODEL never leaks into a child.
 */
export function armEnv(arm, config, family, baseEnv = {}) {
  if (!AUTHOR_FAMILIES.includes(family)) throw new Error(`unknown author family: ${family}`);
  const env = { ...baseEnv };
  for (const key of CHILD_ENV_REMOVED) delete env[key];
  if (arm === "B") env.JUDGE_MODEL = config.families[family].author_model;
  else if (arm === "C") env.JUDGE_MODEL = config.families[family].stronger_model;
  else if (arm !== "D") throw new Error(`arm ${arm} does not run through judge.mjs`);
  return env;
}

/**
 * Did the arm's answer come from where the arm says it does? Arms A, B and C must be
 * served by the author's company. Arm D must be served by another company, checked on the
 * model that answered, as the product itself checks.
 */
export function armValid(arm, { servedModel, decorrelated } = {}, family) {
  const company = typeof servedModel === "string" && servedModel.trim() ? companyIdOf(servedModel) : null;
  if (company === null) return { valid: false, reason: "the answer did not name the model that wrote it" };
  if (arm === "D") {
    if (decorrelated !== true || company === family) return { valid: false, reason: "the product answer came from the author's company" };
    return { valid: true, reason: null };
  }
  if (company !== family) return { valid: false, reason: "the answer came from another company than the author's" };
  return { valid: true, reason: null };
}

/** The text of a chat reply, or "" when there is none. */
export function chatText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  return "";
}

export function writeUpUsable(text) {
  const words = countWords(text);
  return words >= WRITE_UP_WORDS.min && words <= WRITE_UP_WORDS.max;
}

export function armAUsable(text) {
  return countWords(text) >= ARM_A_MIN_WORDS;
}

/** A judge result is usable when it carries a verdict. Its challenges may be none. */
export function judgeUsable(result) {
  return isRecord(result) && typeof result.verdict === "string" && result.verdict !== "";
}

/** The blinded text a grader reads for arm A. */
export function critiqueFromProse(text) {
  return blind(text);
}

/** The blinded text a grader reads for arms B, C and D: the full report a person can ask for. */
export function critiqueFromJudge(result, writeUp) {
  return blind(verdictText(result, writeUp));
}

// == Graders ======================================================================

export const GRADER_SYSTEM =
  "You grade one critique of a written plan. You are not told who or what wrote the critique, and you should not guess. Length, tone and layout are not reasons for a yes or a no. Answer only the questions asked. Reply with JSON only, no markdown.";

export const CATCH_QUESTION =
  "Question 1. Does the critique point out the known problem? Answer yes only if someone who read the critique, and nothing else, would learn of this specific problem. A general doubt, a different objection, or a question that does not name the problem is a no.";
export const ALARM_QUESTION =
  "Question 1. Does the critique tell the reader not to go ahead with the plan as written? Answer yes if it says the plan fails, should be stopped, or must be reworked before going ahead. A condition to meet, a small fix made in place, or something to check while going ahead is a no.";
export const OBJECTIONS_QUESTION = "Question 2. How many separate objections does the critique raise? Count each distinct problem once.";
export const GRADE_REPLY_FORM = 'Reply with JSON only: {"answer":"yes" or "no","objections":<whole number>}';

function gradePrompt(parts, question) {
  return [...parts, question, OBJECTIONS_QUESTION, "", GRADE_REPLY_FORM].join("\n");
}

/** The yes or no question for a flawed or loaded case. The critique and the write-up are blinded here. */
export function buildCatchPrompt({ writeUp, question, flaw, critique } = {}) {
  return gradePrompt(
    ["THE PLAN", blind(writeUp), "", "THE QUESTION ASKED ABOUT IT", blind(question), "", "THE KNOWN PROBLEM", blind(flaw), "", "THE CRITIQUE", blind(critique), ""],
    CATCH_QUESTION,
  );
}

/** The yes or no question for a sound twin. The grader is not told the plan is sound. */
export function buildAlarmPrompt({ writeUp, question, critique } = {}) {
  return gradePrompt(
    ["THE PLAN", blind(writeUp), "", "THE QUESTION ASKED ABOUT IT", blind(question), "", "THE CRITIQUE", blind(critique), ""],
    ALARM_QUESTION,
  );
}

export const FLAG_REPLY_FORM = 'Reply with JSON only: {"visible":"yes" or "no","flagged":"yes" or "no"}';

/**
 * Asked once per flawed case, after the write-up exists and before any arm runs.
 * visible: can the flaw be seen in the write-up alone? Arm A also sees the person's ask.
 * flagged: did the author already point the flaw out? Then there is nothing left to catch.
 */
export function buildFlagPrompt({ writeUp, flaw } = {}) {
  return [
    "THE PLAN",
    blind(writeUp),
    "",
    "THE KNOWN PROBLEM",
    blind(flaw),
    "",
    "Question 1 (visible). Can a careful reader see the known problem from the plan as written here, using only what the plan says?",
    "Question 2 (flagged). Does the plan itself already point out this problem as a problem?",
    "",
    FLAG_REPLY_FORM,
  ].join("\n");
}

/** Temperature 0 and the same zero-retention routing block as every other request. */
export function graderRequestBody({ model, prompt, system = GRADER_SYSTEM } = {}) {
  if (typeof model !== "string" || !model) throw new Error("a grader model id is required");
  return {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: String(prompt ?? "") },
    ],
    temperature: 0,
    provider: { zdr: true, data_collection: "deny" },
  };
}

function firstJsonObject(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function yesNo(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  const text = String(value ?? "").trim().toLowerCase();
  return text === "yes" || text === "no" ? text : null;
}

/** A grader's reply to a catch or alarm prompt, or null when it cannot be read. */
export function parseGradeReply(text) {
  const parsed = firstJsonObject(text);
  const answer = yesNo(parsed?.answer);
  if (answer === null) return null;
  const n = parsed.objections;
  const objections = typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 50 ? n : null;
  return { answer, objections };
}

/** A grader's reply to the flag prompt, or null when it cannot be read. */
export function parseFlagReply(text) {
  const parsed = firstJsonObject(text);
  const visible = yesNo(parsed?.visible);
  const flagged = yesNo(parsed?.flagged);
  if (visible === null || flagged === null) return null;
  return { visible, flagged };
}

/** The answer at least two votes agree on, when it is a strict majority. Otherwise null. */
export function majority(votes) {
  const list = (Array.isArray(votes) ? votes : []).filter((vote) => vote === "yes" || vote === "no");
  const yes = list.filter((vote) => vote === "yes").length;
  const no = list.length - yes;
  if (list.length < 2 || yes === no) return null;
  return yes > no ? "yes" : "no";
}

/** The middle value of some whole numbers, or null. With an even count, the lower middle. */
export function medianInt(values) {
  const list = (Array.isArray(values) ? values : []).filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (list.length === 0) return null;
  return list[Math.floor((list.length - 1) / 2)];
}

/**
 * The graders that may vote on one case, in the listed order. A grader from the author's
 * company, or from the company that served the product arm on this case, is left out.
 * All four arms of a case get the same graders, so the choice says nothing about the arm.
 */
export function eligibleGraders(config, { authorFamily = "", servedCompany = "" } = {}) {
  return (Array.isArray(config?.graders) ? config.graders : [])
    .map((grader) => grader.model)
    .filter((model) => {
      const company = companyIdOf(model);
      return company !== authorFamily && company !== servedCompany;
    });
}

// == Counting =====================================================================

/**
 * An answer counts as usable when the arm returned one and the graders could label it.
 * An answer nobody could label is counted with the unusable ones.
 */
export function itemUsable(item) {
  return item?.usable === true && (item.label === "yes" || item.label === "no");
}

export const DROP_NO_WRITE_UP = "no usable write-up";
export const DROP_AUTHOR_FLAGGED = "the author already flagged the flaw";

/**
 * The cases that are analysed, decided before any arm runs. A seed leaves only by one of
 * two written rules: the author model gave no usable write-up, or (for a flawed seed) the
 * write-up already points the planted flaw out, so there is nothing left to catch.
 *
 * writeUps: [{id, usable, visible, flagged}] as the author step saved them.
 */
export function analysedCases(seeds, writeUps, split) {
  const byId = new Map((Array.isArray(writeUps) ? writeUps : []).map((row) => [row.id, row]));
  const cases = [];
  const dropped = { [DROP_NO_WRITE_UP]: 0, [DROP_AUTHOR_FLAGGED]: 0 };
  for (const seed of Array.isArray(seeds) ? seeds : []) {
    if (seed.split !== split) continue;
    const row = byId.get(seed.id);
    if (!row || row.usable !== true) {
      dropped[DROP_NO_WRITE_UP] += 1;
      continue;
    }
    if (seed.kind === "flawed" && row.flagged === "yes") {
      dropped[DROP_AUTHOR_FLAGGED] += 1;
      continue;
    }
    cases.push({
      id: seed.id,
      kind: seed.kind,
      author_family: seed.author_family,
      drafter_family: seed.drafter_family,
      visible: seed.kind === "flawed" && (row.visible === "yes" || row.visible === "no") ? row.visible : null,
    });
  }
  return { cases, dropped };
}

/**
 * One item per analysed case and arm, from the saved answers and grades.
 * `ownerLabels`, when given, is a Map of "id arm" to yes or no, and replaces the graders' labels.
 */
export function buildItems(cases, answers, grades, ownerLabels = null) {
  const key = (row) => `${row.id} ${row.arm}`;
  const answerOf = new Map((Array.isArray(answers) ? answers : []).map((row) => [key(row), row]));
  const gradeOf = new Map((Array.isArray(grades) ? grades : []).map((row) => [key(row), row]));
  const items = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    for (const arm of ARMS) {
      const answer = answerOf.get(`${c.id} ${arm}`);
      const grade = gradeOf.get(`${c.id} ${arm}`);
      const owner = ownerLabels ? ownerLabels.get(`${c.id} ${arm}`) : undefined;
      items.push({
        id: c.id,
        arm,
        usable: answer?.usable === true,
        label: ownerLabels ? owner ?? null : grade?.label ?? null,
        words: typeof answer?.words === "number" ? answer.words : null,
        objections: typeof grade?.objections === "number" ? grade.objections : null,
        served_company: typeof answer?.served_company === "string" ? answer.served_company : null,
      });
    }
  }
  return items;
}

/** How many answers each arm returned and how many could be graded. Counts of plumbing, not a score. */
export function renderPlumbing(cases, items) {
  const total = (Array.isArray(cases) ? cases : []).length;
  const lines = ["| Arm | Cases | Answers returned | Graded | Not usable |", "| --- | --- | --- | --- | --- |"];
  for (const arm of ARMS) {
    const mine = (Array.isArray(items) ? items : []).filter((item) => item.arm === arm);
    const returned = mine.filter((item) => item.usable === true).length;
    const graded = mine.filter((item) => itemUsable(item)).length;
    lines.push(`| ${arm}: ${ARM_NAMES[arm]} | ${total} | ${returned} | ${graded} | ${total - graded} |`);
  }
  return lines.join("\n");
}

function itemsByCase(items) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!map.has(item.id)) map.set(item.id, {});
    map.get(item.id)[item.arm] = item;
  }
  return map;
}

/** Counts for one arm over the analysed cases. */
export function armCounts(arm, cases, items) {
  const byCase = itemsByCase(items);
  const out = { flawed: 0, caught: 0, usable_flawed: 0, caught_usable: 0, sound: 0, alarms: 0, loaded: 0, usable_loaded: 0, caught_loaded: 0, unusable: 0 };
  for (const c of cases) {
    const item = byCase.get(c.id)?.[arm];
    const usable = itemUsable(item);
    const hit = usable && item.label === "yes";
    if (!usable) out.unusable += 1;
    if (c.kind === "flawed") {
      out.flawed += 1;
      if (usable) out.usable_flawed += 1;
      if (hit) {
        out.caught += 1;
        out.caught_usable += 1;
      }
    } else if (c.kind === "sound") {
      if (usable) out.sound += 1;
      if (hit) out.alarms += 1;
    } else if (c.kind === "loaded") {
      out.loaded += 1;
      if (usable) out.usable_loaded += 1;
      if (hit) out.caught_loaded += 1;
    }
  }
  return out;
}

/**
 * The paired table for two arms, over cases of one kind. The four plain cells count an
 * unusable answer as a miss. The usable_ cells count only the cases where both arms gave a
 * usable answer.
 */
export function pairTable(first, second, cases, items, { kind = "flawed" } = {}) {
  const byCase = itemsByCase(items);
  const out = {
    both: 0,
    first_only: 0,
    second_only: 0,
    neither: 0,
    usable_both: 0,
    usable_first_only: 0,
    usable_second_only: 0,
    usable_neither: 0,
  };
  for (const c of cases) {
    if (c.kind !== kind) continue;
    const a = byCase.get(c.id)?.[first];
    const b = byCase.get(c.id)?.[second];
    const hitA = itemUsable(a) && a.label === "yes";
    const hitB = itemUsable(b) && b.label === "yes";
    const cell = hitA && hitB ? "both" : hitA ? "first_only" : hitB ? "second_only" : "neither";
    out[cell] += 1;
    if (itemUsable(a) && itemUsable(b)) out[`usable_${cell}`] += 1;
  }
  return out;
}

/**
 * The counts-only block for data/results.json. It holds nothing but whole numbers, a date,
 * a commit hash, true or false, and arm ids from the fixed list, and it is checked against
 * the shape in scripts/resultsCore.mjs before it is returned.
 *
 * In this block an arm's `sound` is the sound twins it gave a usable answer on, and
 * `alarms` is how many of those raised the alarm.
 */
export function buildPublicBlock({ cases, items, date, commit, single_drafter } = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const count = (kind) => list.filter((c) => c.kind === kind).length;
  const block = {
    status: "measured",
    date,
    commit,
    cases: { flawed: count("flawed"), sound: count("sound"), loaded: count("loaded") },
    arms: ARMS.map((arm) => {
      const n = armCounts(arm, list, items);
      return {
        arm: ARM_IDS[arm],
        caught: n.caught,
        flawed: n.flawed,
        caught_usable: n.caught_usable,
        usable_flawed: n.usable_flawed,
        alarms: n.alarms,
        sound: n.sound,
        unusable: n.unusable,
      };
    }),
    comparisons: COMPARISONS.map(({ first, second }) => ({
      first: ARM_IDS[first],
      second: ARM_IDS[second],
      ...pairTable(first, second, list, items),
    })),
    single_drafter: single_drafter === true,
  };
  return validateFourArm(block);
}

// == Statistics =====================================================================

/**
 * Holm's step-down correction. Takes the raw p values of one family of tests and returns
 * the adjusted ones in the same order. An adjusted value under ALPHA is a finding.
 */
export function holm(pValues) {
  if (!Array.isArray(pValues)) throw new RangeError("p values must be a list");
  for (const p of pValues) {
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) throw new RangeError("each p value must be a number from 0 to 1");
  }
  const m = pValues.length;
  const order = pValues.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = new Array(m);
  let running = 0;
  order.forEach(([p, i], rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    out[i] = running;
  });
  return out;
}

/** One way of counting a paired table: the two discordant cells, the exact p and the gap in points. */
function pairedReading(firstOnly, secondOnly, n) {
  return {
    first_only: firstOnly,
    second_only: secondOnly,
    n,
    p: mcnemarExactP(firstOnly, secondOnly),
    points: n > 0 ? ((firstOnly - secondOnly) / n) * 100 : 0,
  };
}

/** Both ways of counting one paired table. */
export function pairedReadings(table) {
  const n = table.both + table.first_only + table.second_only + table.neither;
  const usableN = table.usable_both + table.usable_first_only + table.usable_second_only + table.usable_neither;
  return {
    misses: pairedReading(table.first_only, table.second_only, n),
    usable: pairedReading(table.usable_first_only, table.usable_second_only, usableN),
  };
}

/** +1 when the first arm is ahead and the test is under ALPHA, -1 when behind, 0 otherwise. */
function direction(reading) {
  if (!(reading.p < ALPHA)) return 0;
  return reading.first_only > reading.second_only ? 1 : reading.first_only < reading.second_only ? -1 : 0;
}

/** True when D minus B is above zero in one author family and below zero in the other. */
export function signFlip(byAuthor) {
  const signs = (Array.isArray(byAuthor) ? byAuthor : []).map((row) => Math.sign(row.first_only - row.second_only));
  return signs.includes(1) && signs.includes(-1);
}

/** Has the grader check been passed? The owner's own labels, on every item, always pass. */
export function graderCheckPassed(audit) {
  if (!isRecord(audit)) return false;
  if (audit.labels_by === "owner") return true;
  const { agree, of } = audit;
  if (!Number.isInteger(agree) || !Number.isInteger(of) || agree < 0 || agree > of) return false;
  return of >= AUDIT_ITEMS && agree * AUDIT_ITEMS >= AUDIT_AGREE_FLOOR * of;
}

/** Did every arm give a usable answer on enough of the analysed flawed cases? */
export function usableFloorMet(arms) {
  const list = Array.isArray(arms) ? arms : [];
  return FOUR_ARM_IDS.every((id) => {
    const arm = list.find((entry) => entry.arm === id);
    return Boolean(arm) && arm.flawed > 0 && arm.usable_flawed * USABLE_FLOOR.den >= arm.flawed * USABLE_FLOOR.num;
  });
}

/**
 * The decision rule, as one ordered list. It takes counts and returns one outcome.
 *
 *   1. not-measured        too few usable answers, or the grader check was not passed.
 *   2. too-few-cases       fewer than MIN_ANALYSED_FLAWED flawed cases were analysed.
 *   3. no-pooled-headline  D minus B has opposite signs in the two author families.
 *   4. d-better            D caught more than B, under ALPHA, both ways of counting.
 *   5. d-worse             B caught more than D, under ALPHA, both ways of counting.
 *   6. no-difference-of-15-found   anything else.
 *
 * A public sentence about quality is allowed only on d-better, only when D is not worse
 * than C (D caught at least as many as C, both ways of counting), and never from a
 * single-drafter set.
 *
 * facts: {
 *   analysed_flawed, usable_floor_met, audit: {agree, of, labels_by},
 *   primary: {both, first_only, second_only, neither, usable_...},             first is D, second is B
 *   product_vs_stronger: the same cells,                                       first is D, second is C
 *   by_author: [{family, first_only, second_only}],                            D minus B, misses counted
 *   single_drafter
 * }
 */
export function decideFourArm(facts) {
  const base = {
    outcome: "not-measured",
    words: OUTCOME_WORDS["not-measured"],
    reasons: [],
    counts_agree: null,
    sign_flip: null,
    d_not_worse_than_c: null,
    single_drafter: facts?.single_drafter === true,
    quality_sentence_allowed: false,
    changes: "none",
    p: null,
  };
  const done = (outcome, extra = {}) => ({ ...base, ...extra, outcome, words: OUTCOME_WORDS[outcome] });

  if (!isRecord(facts)) return done("not-measured", { reasons: ["no counts"] });
  if (facts.usable_floor_met !== true) return done("not-measured", { reasons: ["too few usable answers"] });
  if (!graderCheckPassed(facts.audit)) return done("not-measured", { reasons: ["the grader check was not passed"] });
  if (!Number.isInteger(facts.analysed_flawed) || facts.analysed_flawed < MIN_ANALYSED_FLAWED) return done("too-few-cases");

  const primary = pairedReadings(facts.primary);
  const versusStronger = pairedReadings(facts.product_vs_stronger);
  const dirs = [direction(primary.misses), direction(primary.usable)];
  const flip = signFlip(facts.by_author);
  const notWorse =
    versusStronger.misses.first_only >= versusStronger.misses.second_only && versusStronger.usable.first_only >= versusStronger.usable.second_only;
  const shared = {
    counts_agree: dirs[0] === dirs[1],
    sign_flip: flip,
    d_not_worse_than_c: notWorse,
    p: { misses: primary.misses.p, usable: primary.usable.p },
  };

  if (flip) return done("no-pooled-headline", { ...shared, changes: "no-quality-sentence" });
  if (dirs[0] === 1 && dirs[1] === 1) {
    const reasons = [];
    if (!notWorse) reasons.push("D is worse than C");
    if (base.single_drafter) reasons.push("single-drafter set");
    const allowed = reasons.length === 0;
    return done("d-better", { ...shared, reasons, quality_sentence_allowed: allowed, changes: allowed ? "may-propose-quality-sentence" : "none" });
  }
  if (dirs[0] === -1 && dirs[1] === -1) return done("d-worse", { ...shared, changes: "no-quality-sentence-and-judge-quality-floor" });
  const reasons = shared.counts_agree ? [] : ["the two ways of counting disagree, so no direction is claimed"];
  return done("no-difference-of-15-found", { ...shared, reasons, changes: "no-quality-sentence" });
}

function comparisonCells(block, firstId, secondId) {
  for (const pair of Array.isArray(block?.comparisons) ? block.comparisons : []) {
    if (pair.first === firstId && pair.second === secondId) return pair;
    if (pair.first === secondId && pair.second === firstId) {
      return {
        both: pair.both,
        first_only: pair.second_only,
        second_only: pair.first_only,
        neither: pair.neither,
        usable_both: pair.usable_both,
        usable_first_only: pair.usable_second_only,
        usable_second_only: pair.usable_first_only,
        usable_neither: pair.usable_neither,
      };
    }
  }
  return null;
}

/**
 * The facts decideFourArm needs, read from a public block. The split by author family and
 * the grader check are not in that block, so the caller passes them.
 */
export function factsFromBlock(block, { by_author = [], audit = null } = {}) {
  const empty = { both: 0, first_only: 0, second_only: 0, neither: 0, usable_both: 0, usable_first_only: 0, usable_second_only: 0, usable_neither: 0 };
  return {
    analysed_flawed: block?.cases?.flawed ?? 0,
    usable_floor_met: usableFloorMet(block?.arms),
    audit,
    primary: comparisonCells(block, ARM_IDS.D, ARM_IDS.B) ?? empty,
    product_vs_stronger: comparisonCells(block, ARM_IDS.D, ARM_IDS.C) ?? empty,
    by_author,
    single_drafter: block?.single_drafter === true,
  };
}

/**
 * Alarm on sound twins, for arms B, C and D only. Arm A is told to argue, so its alarm
 * rate is set by its instruction and is shown without being compared. Two arms are ranked
 * only when their alarm rates are ALARM_RANK_GAP_POINTS apart or more.
 */
export function alarmRanking(arms) {
  const of = (id) => {
    const arm = (Array.isArray(arms) ? arms : []).find((entry) => entry.arm === id);
    return arm && arm.sound > 0 ? arm : null;
  };
  const pairs = [];
  for (const [first, second] of [
    ["D", "B"],
    ["D", "C"],
    ["C", "B"],
  ]) {
    const a = of(ARM_IDS[first]);
    const b = of(ARM_IDS[second]);
    if (!a || !b) {
      pairs.push({ first, second, gap_points: null, ranked: false, lower_alarm: null });
      continue;
    }
    // Compared in whole numbers, so a gap of exactly 30 points is never lost to rounding.
    const cross = a.alarms * b.sound - b.alarms * a.sound;
    const ranked = Math.abs(cross) * 100 >= ALARM_RANK_GAP_POINTS * a.sound * b.sound;
    pairs.push({
      first,
      second,
      gap_points: (Math.abs(cross) / (a.sound * b.sound)) * 100,
      ranked,
      lower_alarm: ranked ? (cross < 0 ? first : second) : null,
    });
  }
  return pairs;
}

function rateOf(k, n) {
  const interval = wilsonInterval(k, n);
  return { k, n, low: interval.low, high: interval.high };
}

function splitBy(cases, items, keyOf, first, second) {
  const keys = [];
  for (const c of cases) {
    if (c.kind !== "flawed") continue;
    const key = keyOf(c);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.sort().map((key) => {
    const subset = cases.filter((c) => c.kind === "flawed" && keyOf(c) === key);
    return { key, cases: subset.length, ...pairTable(first, second, subset, items) };
  });
}

/**
 * Everything the report prints. Not public: it carries rates, intervals and p values, which
 * the public block leaves to whoever reads the counts.
 *
 * cases: [{id, kind, author_family, drafter_family, visible}] the analysed cases
 * items: [{id, arm, usable, label, words, objections, served_company}] one per case and arm
 */
export function summarize({ cases, items, date, commit, single_drafter, audit, dropped = {}, split = "frozen", deviations = [] } = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const all = Array.isArray(items) ? items : [];
  const block = buildPublicBlock({ cases: list, items: all, date, commit, single_drafter });

  const arms = ARMS.map((arm) => {
    const n = armCounts(arm, list, all);
    const mine = all.filter((item) => item.arm === arm && itemUsable(item));
    return {
      arm,
      id: ARM_IDS[arm],
      name: ARM_NAMES[arm],
      counts: n,
      catch_misses_counted: rateOf(n.caught, n.flawed),
      catch_usable_only: rateOf(n.caught_usable, n.usable_flawed),
      alarm: rateOf(n.alarms, n.sound),
      loaded: { caught: n.caught_loaded, usable: n.usable_loaded, of: n.loaded },
      median_words: medianInt(mine.map((item) => item.words)),
      median_objections: medianInt(mine.map((item) => item.objections)),
    };
  });

  const reading = ({ id, first, second, name }) => {
    const table = pairTable(first, second, list, all);
    return { id, first, second, name, table, ...pairedReadings(table) };
  };
  const primary = reading(PRIMARY_COMPARISON);
  const secondary = SECONDARY_COMPARISONS.map(reading);
  const adjusted = holm(secondary.map((test) => test.misses.p));
  secondary.forEach((test, i) => {
    test.p_holm = adjusted[i];
  });

  const byAuthor = splitBy(list, all, (c) => c.author_family, "D", "B");
  const byDrafter = splitBy(list, all, (c) => c.drafter_family, "D", "B");
  const visibleKey = (c) => (c.visible === "yes" ? "visible in the write-up" : c.visible === "no" ? "not visible in the write-up" : "not settled");
  const byVisible = { product_vs_fresh_brief: splitBy(list, all, visibleKey, "D", "B"), product_vs_same_chat: splitBy(list, all, visibleKey, "D", "A") };

  const servedBy = tally(
    all.filter((item) => item.arm === "D" && item.usable === true),
    (item) => (JUDGE_COMPANY_IDS.includes(item.served_company) ? item.served_company : "other"),
  );

  const decision = decideFourArm(
    factsFromBlock(block, {
      by_author: byAuthor.map((row) => ({ family: row.key, first_only: row.first_only, second_only: row.second_only })),
      audit,
    }),
  );

  return {
    split,
    date,
    commit,
    cases: { ...block.cases, dropped },
    arms,
    primary,
    secondary,
    alarm: alarmRanking(block.arms),
    splits: { by_author: byAuthor, by_drafter: byDrafter, by_visible: byVisible },
    product_served_by: servedBy,
    audit: audit ?? null,
    single_drafter: single_drafter === true,
    deviations,
    decision,
    public_block: block,
  };
}

const pct = (rate) => (rate.n === 0 ? "n/a" : `${rate.k} of ${rate.n} (${Math.round((rate.k / rate.n) * 100)}%, 95% interval ${Math.round(rate.low * 100)}% to ${Math.round(rate.high * 100)}%)`);
const pText = (p) => (p < 0.001 ? "under 0.001" : p.toFixed(3));
const pointsText = (n) => `${n > 0 ? "+" : ""}${n.toFixed(1)} points`;

/** The report as plain text. It names no model and no case. */
export function renderReport(report) {
  const lines = [];
  const d = report.decision;
  lines.push("# Four-arm comparison", "");
  lines.push(`Split: ${report.split}. Date: ${report.date}. Commit: ${report.commit}.`);
  lines.push(`Analysed cases: ${report.cases.flawed} flawed, ${report.cases.sound} sound twins, ${report.cases.loaded} loaded.`);
  const dropped = Object.entries(report.cases.dropped ?? {});
  if (dropped.length) lines.push(`Left out by rule before any arm ran: ${dropped.map(([why, n]) => `${why} ${n}`).join(", ")}.`);
  lines.push("", `## Result: ${d.words}`, "");
  if (d.reasons.length) lines.push(`Why: ${d.reasons.join("; ")}.`);
  if (d.outcome === "not-measured") {
    lines.push("Nothing here is a result. No counts are published.");
    return lines.join("\n");
  }
  if (d.outcome === "too-few-cases") lines.push(`Fewer than ${MIN_ANALYSED_FLAWED} flawed cases were analysed. This changes no claim.`);
  lines.push(`A public sentence about quality is ${d.quality_sentence_allowed ? "allowed to be proposed" : "not allowed"} on this result.`);
  if (report.single_drafter) lines.push("Single-drafter set: this result may remove a quality claim. It cannot restore one.");
  if (report.deviations.length) lines.push(`Deviations from the registered protocol: ${report.deviations.join("; ")}.`);

  lines.push("", "## Catch on flawed cases", "");
  lines.push("| Arm | Unusable answers counted as misses | Usable answers only | Median words | Median objections |", "| --- | --- | --- | --- | --- |");
  for (const arm of report.arms) {
    lines.push(`| ${arm.arm}: ${arm.name} | ${pct(arm.catch_misses_counted)} | ${pct(arm.catch_usable_only)} | ${arm.median_words ?? "n/a"} | ${arm.median_objections ?? "n/a"} |`);
  }

  const row = (test, holmP) =>
    `| ${test.first} against ${test.second}: ${test.name} | ${test.misses.first_only} to ${test.misses.second_only} (${pointsText(test.misses.points)}, p ${pText(test.misses.p)}) | ${test.usable.first_only} to ${test.usable.second_only} (${pointsText(test.usable.points)}, p ${pText(test.usable.p)}) | ${holmP === null ? "primary" : pText(holmP)} |`;
  lines.push("", "## Paired tests (exact McNemar, two-sided)", "");
  lines.push("Each cell reads: cases only the first arm caught, to cases only the second arm caught.", "");
  lines.push("| Test | Misses counted | Usable only | Holm p (misses counted) |", "| --- | --- | --- | --- |");
  lines.push(row(report.primary, null));
  for (const test of report.secondary) lines.push(row(test, test.p_holm));

  lines.push("", "## Alarm on sound twins", "");
  for (const arm of report.arms) lines.push(`- ${arm.arm}: ${pct(arm.alarm)}${arm.arm === "A" ? " (shown, not compared: this arm is told to argue)" : ""}`);
  for (const pair of report.alarm) {
    const gap = pair.gap_points === null ? "n/a" : `${pair.gap_points.toFixed(1)} points`;
    lines.push(`- ${pair.first} against ${pair.second}: gap ${gap}. ${pair.ranked ? `Ranked: ${pair.lower_alarm} alarms less.` : `Not ranked (under ${ALARM_RANK_GAP_POINTS} points).`}`);
  }

  lines.push("", "## Loaded cases (described, not tested)", "");
  for (const arm of report.arms) lines.push(`- ${arm.arm}: ${arm.loaded.caught} of ${arm.loaded.usable} usable answers named how the question was loaded (${arm.loaded.of} cases).`);

  const splitLines = (title, rows) => {
    lines.push("", `## ${title}`, "");
    for (const r of rows) lines.push(`- ${r.key}. Flawed cases: ${r.cases}. Only the first arm caught: ${r.first_only}. Only the second arm caught: ${r.second_only}. On usable answers only: ${r.usable_first_only} and ${r.usable_second_only}.`);
  };
  splitLines("D against B by author family", report.splits.by_author);
  if (d.sign_flip) lines.push("", "The sign flips between the two author families, so there is no pooled headline.");
  splitLines("D against B by seed drafter family", report.splits.by_drafter);
  splitLines("D against B by whether the flaw is visible in the write-up alone", report.splits.by_visible.product_vs_fresh_brief);
  splitLines("D against A by whether the flaw is visible in the write-up alone", report.splits.by_visible.product_vs_same_chat);

  lines.push("", "## Which companies served the product arm", "");
  const served = sortedEntries(report.product_served_by);
  lines.push(served.length ? served.map(([company, n]) => `${company} ${n}`).join(", ") : "none");

  if (report.audit) {
    lines.push("", "## Grader check", "");
    lines.push(
      report.audit.labels_by === "owner"
        ? "Every item was labelled by the owner, and those labels are the ones counted."
        : `The graders matched the owner on ${report.audit.agree} of ${report.audit.of} blinded items. The floor is ${AUDIT_AGREE_FLOOR} of ${AUDIT_ITEMS}.`,
    );
  }
  return lines.join("\n");
}

// == The audit sample: which blinded items the owner labels ===============================

/** A repeatable shuffle. The order depends only on the key and the items, never on the order they came in, so nobody picks the sample by hand. */
export function shuffled(list, key) {
  return list
    .map((item) => ({ item, rank: sha256(`${key}\u0000${JSON.stringify(item)}`) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map((entry) => entry.item);
}

/**
 * Pick the items the owner labels. Up to AUDIT_ALARM_ITEMS come from sound twins and the
 * rest from flawed and loaded cases, AUDIT_ITEMS in all when there are that many.
 * `graded` is [{id, arm, kind}] for every item the graders labelled.
 */
export function auditSample(graded, key, { size = AUDIT_ITEMS, alarmItems = AUDIT_ALARM_ITEMS } = {}) {
  const pool = shuffled(Array.isArray(graded) ? graded : [], key);
  const alarm = pool.filter((item) => item.kind === "sound");
  const rest = pool.filter((item) => item.kind !== "sound");
  const takeAlarm = Math.min(alarm.length, alarmItems, size);
  const takeRest = Math.min(rest.length, size - takeAlarm);
  const extraAlarm = Math.min(alarm.length - takeAlarm, size - takeAlarm - takeRest);
  return shuffled([...alarm.slice(0, takeAlarm + extraAlarm), ...rest.slice(0, takeRest)], `${key}\u0000order`);
}

/** The owner's replies: one "n: yes" or "n: no" per line. Anything else on a line is ignored. */
export function parseOwnerLabels(text) {
  const out = new Map();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*[:.)]\s*(yes|no)\b/i.exec(line);
    if (m) out.set(Number(m[1]), m[2].toLowerCase());
  }
  return out;
}

// == Writing the public block into data/results.json ==================================

/** Where the value of a top-level key starts and ends in a JSON text, or null. */
function topLevelValueSpan(text, key) {
  const stringEnd = (from) => {
    let j = from + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
    return j + 1;
  };
  const valueEnd = (from) => {
    const first = text[from];
    if (first === '"') return stringEnd(from);
    if (first !== "{" && first !== "[") {
      let j = from;
      while (j < text.length && !/[,\s}\]]/.test(text[j])) j += 1;
      return j;
    }
    let inner = 0;
    let j = from;
    while (j < text.length) {
      const ch = text[j];
      if (ch === '"') {
        j = stringEnd(j);
        continue;
      }
      if (ch === "{" || ch === "[") inner += 1;
      else if (ch === "}" || ch === "]") {
        inner -= 1;
        if (inner === 0) return j + 1;
      }
      j += 1;
    }
    return text.length;
  };
  const skipSpace = (from) => {
    let j = from;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    return j;
  };

  let i = skipSpace(0);
  if (text[i] !== "{") return null;
  i += 1;
  while (i < text.length) {
    i = skipSpace(i);
    if (text[i] === ",") {
      i += 1;
      continue;
    }
    if (text[i] !== '"') return null;
    const nameEnd = stringEnd(i);
    const colon = skipSpace(nameEnd);
    if (text[colon] !== ":") return null;
    const start = skipSpace(colon + 1);
    const end = valueEnd(start);
    let name = null;
    try {
      name = JSON.parse(text.slice(i, nameEnd));
    } catch {
      return null;
    }
    if (name === key) return { start, end };
    i = end;
  }
  return null;
}

/** The raw text of a top-level value in a JSON text, exactly as written, or null when the key is not there. */
export function topLevelValueText(text, key) {
  const span = topLevelValueSpan(String(text ?? ""), key);
  return span ? text.slice(span.start, span.end) : null;
}

function replaceTopLevelValue(text, key, value) {
  const span = topLevelValueSpan(text, key);
  if (!span) throw new Error(`the results file has no top-level "${key}"`);
  const rendered = JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
  return `${text.slice(0, span.start)}${rendered}${text.slice(span.end)}`;
}

/**
 * The text of data/results.json with its four_arm block replaced, and `updated` moved
 * forward when the block is dated later. Every other byte of the file is left as it was.
 * The new text is parsed and checked as a whole before it is returned, and the call throws
 * if anything other than those two keys changed.
 */
export function mergeFourArmIntoResultsText(text, block) {
  if (typeof text !== "string") throw new Error("the results file must be read as text");
  const before = JSON.parse(text);
  validateFourArm(block, "four_arm");
  let next = replaceTopLevelValue(text, "four_arm", block);
  if (block.status === "measured" && typeof before.updated === "string" && block.date > before.updated) {
    next = replaceTopLevelValue(next, "updated", block.date);
  }
  const after = validateResults(JSON.parse(next));
  for (const key of Object.keys(before)) {
    if (key === "four_arm" || key === "updated") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) throw new Error(`the merge changed ${key}, which it must not`);
  }
  if (JSON.stringify(after.four_arm) !== JSON.stringify(block)) throw new Error("the merged block is not the block that was given");
  return next;
}
