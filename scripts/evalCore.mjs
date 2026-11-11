// evalCore.mjs — the pure half of the judge's self-improvement measurement loop.
//
// No fs, no network, no child_process — every function here takes plain data in (a case
// definition, a judge result object) and returns plain data out. eval.mjs owns the I/O
// (spawning judge.mjs, timing it, reading the case files, writing the output) and calls into
// this module for the scoring and rendering a test can pin without a live model.
//
// THE PRIVACY RULE THAT SHAPES THIS FILE: every case this scores is synthetic. The public set is
// committed under evals/cases/; a held-out set of fictional cases (`heldOut: true`) lives outside
// this repository so models and tuning can't learn it. This module never sees, and must never be
// given, a real user's decision — that is enforced by what calls it, not by anything in here, but
// it is why renderSummary is careful never to echo case content beyond a case's id, and echoes no
// case detail at all for a held-out run: a report meant to be posted to a public GitHub issue must
// stay safe to post.
//
// Zero dependencies. Node >= 20. ESM throughout.

import { GOOD_NOUL, PLANTED_FLAW_QUESTION } from "./checkCore.mjs";

/** Severities ranked so "no more severe than X" is a numeric comparison. Mirrors judgeCore's SEVERITIES. */
const SEVERITY_RANK = Object.freeze({ minor: 0, moderate: 1, serious: 2, fatal: 3 });

/** The severities a challenge must clear to count as having "caught" a planted flaw. A minor challenge is real but not what these cases are testing for. */
const CAUGHT_SEVERITIES = new Set(["fatal", "serious", "moderate"]);

function lower(v) {
  return typeof v === "string" ? v.toLowerCase() : "";
}

/**
 * The match is inside a longer number. A comma or a decimal point with a digit on
 * both sides belongs to that number, so "$2,450" is not inside "$2,450,000" or "$2,450.00".
 * A "$" or a comma that is not between digits still allows a hit: "$2,450" contains "2,450".
 */
function gluedToNumber(hay, phrase, at) {
  const end = at + phrase.length;
  const startChar = phrase[0] ?? "";
  const endChar = phrase[phrase.length - 1] ?? "";
  const before = at === 0 ? "" : hay[at - 1];
  const before2 = at < 2 ? "" : hay[at - 2];
  const after = end >= hay.length ? "" : hay[end];
  const after2 = end + 1 >= hay.length ? "" : hay[end + 1];
  const startsDigit = /[0-9]/.test(startChar);
  const endsDigit = /[0-9]/.test(endChar);
  if (/[0-9]/.test(before) && startsDigit) return true;
  if (/[0-9]/.test(after) && (endsDigit || endChar === "%")) return true;
  if (endsDigit && /[,.]/.test(after) && /[0-9]/.test(after2)) return true;
  if (startsDigit && /[,.]/.test(before) && /[0-9]/.test(before2)) return true;
  return false;
}

/** A case-insensitive phrase hit that is not glued into a longer number. */
function includesPhrase(hay, phrase) {
  if (typeof hay !== "string" || typeof phrase !== "string" || phrase.length === 0) return false;
  const h = hay.toLowerCase();
  const p = phrase.toLowerCase();
  let from = 0;
  while (from < h.length) {
    const at = h.indexOf(p, from);
    if (at < 0) return false;
    if (!gluedToNumber(h, p, at)) return true;
    from = at + 1;
  }
  return false;
}

/** The words just before `at` deny the phrase: "not $2,450", "is not equal to the $2,450". */
function negatedAt(hay, at) {
  let prefix = hay.slice(Math.max(0, at - 64), at).trimEnd();
  const filler = /[\s"'“”‘’$(),:;.-]*(?:\b(?:the|a|an|is|are|was|were|be|been|being|equal|equals|equalled|equaled|to|add|adds)\b)[\s"'“”‘’$(),:;.-]*$/i;
  for (let i = 0; i < 4; i++) {
    const next = prefix.replace(filler, "");
    if (next === prefix) break;
    prefix = next;
  }
  prefix = prefix.replace(/[\s"'“”‘’$(),:;.-]+$/g, "");
  return /(?:\b(?:not|no|never|isn't|isnt|aren't|arent|wasn't|wasnt|won't|wont|cannot|can't|cant|don't|dont|doesn't|doesnt)|n't)$/i.test(prefix);
}

/** The words just after the phrase deny it: "$2,450 is incorrect", "$2,450 isn't right". */
function deniedAfter(hay, at, phraseLen) {
  const after = hay.slice(at + phraseLen, at + phraseLen + 40);
  return /^\s*(?:isn't|isnt|aren't|arent)\b/i.test(after)
    || /^\s*(?:is|are|was|were)\s+(?:not\b|incorrect\b|wrong\b|false\b|mistaken\b|inaccurate\b|erroneous\b)/i.test(after);
}

const UP_WORD = /\b(?:increas(?:e|ed|es|ing)|higher|rose|ris(?:e|es|en|ing)|grew|grown|growth)\b/i;
const DOWN_WORD = /\b(?:decreas(?:e|ed|es|ing)|lower|fell|fall(?:s|en|ing)?|drop(?:s|ped|ping)?|declin(?:e|ed|es|ing))\b/i;

/** "up", "down", "mixed", or null when the text names no direction. */
function figureDirection(text) {
  const up = UP_WORD.test(text);
  const down = DOWN_WORD.test(text);
  if (up && down) return "mixed";
  if (up) return "up";
  if (down) return "down";
  return null;
}

/** The direction stated by the correction list, or null when it states none or both. */
function caseDirection(corrections) {
  let up = false;
  let down = false;
  for (const phrase of corrections) {
    const direction = figureDirection(phrase);
    if (direction === "up" || direction === "mixed") up = true;
    if (direction === "down" || direction === "mixed") down = true;
  }
  if (up === down) return null;
  return up ? "up" : "down";
}

/**
 * A directionless phrase inherits the direction of the correction list.
 * "fell by 50%" does not state the "50% increase" those corrections name.
 * A phrase that already says "increase" or "higher" carries its own direction.
 */
function directionAgrees(sentence, phrase, caseDir) {
  const phraseDir = figureDirection(phrase);
  const sentenceDir = figureDirection(sentence);
  if (phraseDir === "up" || phraseDir === "down") return sentenceDir === phraseDir || sentenceDir === "mixed";
  if (caseDir === "up" && (sentenceDir === "down" || sentenceDir === "mixed")) return false;
  if (caseDir === "down" && (sentenceDir === "up" || sentenceDir === "mixed")) return false;
  return true;
}

const WORD_NUMBER = /^(?:fifteen|fifty|fourteen|forty|thirteen|thirty|twelve|twenty|eleven|eighteen|eighty|nineteen|ninety|seventeen|seventy|sixteen|sixty|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?/i;
const WORD_VALUE = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
});
const MONTH = /(?:january|february|march|april|may|june|july|august|september|october|november|december)/i;

/** Commas between digits and decimal points are part of one number, not a break. */
function clausesOf(text) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    const next = i + 1 < text.length ? text[i + 1] : "";
    const betweenDigits = /[0-9]/.test(prev) && /[0-9]/.test(next);
    if ((ch === "." && !betweenDigits) || ch === "!" || ch === "?" || ch === ";" || ch === "\n") {
      parts.push({ text: text.slice(start, i), start, end: i });
      start = i + 1;
      continue;
    }
    if (ch === "," && !betweenDigits) {
      parts.push({ text: text.slice(start, i), start, end: i });
      start = i + 1;
    }
  }
  parts.push({ text: text.slice(start), start, end: text.length });
  return parts;
}

function unitAfter(text, end) {
  const rest = text.slice(end);
  const points = /^\s*percentage\s+points?\b/i.exec(rest);
  if (points) return { unit: "pp", end: end + points[0].length };
  const percent = /^\s*(?:%|percent\b)/i.exec(rest);
  if (percent) return { unit: "percent", end: end + percent[0].length };
  const days = /^\s*(?:-\s*day\b|operating\s+days?\b|days?\b)/i.exec(rest);
  if (days) return { unit: "days", end: end + days[0].length };
  const dollars = /^\s*dollars?\b/i.exec(rest);
  if (dollars) return { unit: "money", end: end + dollars[0].length };
  return { unit: null, end };
}

function isDate(text, start, end) {
  const before = text.slice(Math.max(0, start - 16), start);
  const after = text.slice(end, end + 20);
  return new RegExp(`${MONTH.source}\\s*$`, "i").test(before) || new RegExp(`^\\s*(?:st|nd|rd|th)?\\s*${MONTH.source}`, "i").test(after);
}

function wordValue(raw) {
  const parts = raw.toLowerCase().split(/[-\s]+/);
  const tens = WORD_VALUE[parts[0]];
  if (tens === undefined) return null;
  if (parts.length === 1) return tens;
  const ones = WORD_VALUE[parts[1]];
  if (ones === undefined || ones > 9 || tens < 20) return null;
  return tens + ones;
}

/** Quantities in the text. A comma or decimal between digits stays inside the value. Dates are marked and are not quantities. */
function numberTokens(text) {
  const tokens = [];
  const taken = [];
  const occupy = (start, end) => taken.some((span) => start < span.end && end > span.start);
  let i = 0;
  while (i < text.length) {
    if (occupy(i, i + 1) || (i > 0 && /[A-Za-z0-9]/.test(text[i - 1]) && /[0-9]/.test(text[i]))) {
      i += 1;
      continue;
    }
    const slice = text.slice(i);
    const digit = /^(?:\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$?\d+(?:\.\d+)?)/.exec(slice);
    const word = !digit && (i === 0 || !/[A-Za-z]/.test(text[i - 1])) ? WORD_NUMBER.exec(slice) : null;
    const raw = digit?.[0] ?? word?.[0];
    if (!raw) {
      i += 1;
      continue;
    }
    const value = digit ? Number(raw.replace(/[$,]/g, "")) : wordValue(raw);
    let end = i + raw.length;
    let unit = raw.startsWith("$") ? "money" : null;
    const after = unitAfter(text, end);
    if (after.unit) {
      unit = after.unit;
      end = after.end;
    }
    if (Number.isFinite(value)) {
      tokens.push({ value, start: i, end, unit, date: isDate(text, i, end) });
      taken.push({ start: i, end });
    }
    i = end;
  }
  return tokens;
}

function sameValue(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

function unitsCompatible(wanted, found) {
  if (wanted === "days" || wanted === "percent" || wanted === "pp") return found === wanted;
  if (wanted === "money") return found === "money" || found == null;
  return found == null || found === "money";
}

/** A hedge or a hypothetical in this clause. "May" the month is not the hedge "may". */
function clauseIsHedged(clause) {
  if (/\bwould\s+be\b/i.test(clause)) return true;
  const re = /\b(might|may|could|perhaps|possibly|if|suppose|supposing|were)\b/gi;
  let match;
  while ((match = re.exec(clause))) {
    if (match[0] === "May") continue;
    return true;
  }
  return false;
}

/**
 * A matching correction: the stated number equals the correction. "$2,450.00" matches
 * "$2,450". "$2,450,000" does not. A hedge in the same clause is not a match. Matching
 * is not proof the judge calculated the figure.
 */
function statedCorrection(text, phrase, caseDir) {
  if (typeof text !== "string" || typeof phrase !== "string") return false;
  const wanted = numberTokens(phrase).filter((token) => !token.date);
  if (wanted.length === 0) return false;
  const clauses = clausesOf(text);
  for (const token of numberTokens(text)) {
    if (token.date) continue;
    const clause = clauses.find((part) => token.start >= part.start && token.start < part.end);
    if (!clause || clauseIsHedged(clause.text)) continue;
    if (negatedAt(text, token.start) || deniedAfter(text, token.start, token.end - token.start)) continue;
    if (!directionAgrees(clause.text, phrase, caseDir)) continue;
    if (wanted.some((want) => sameValue(want.value, token.value) && unitsCompatible(want.unit, token.unit))) return true;
  }
  return false;
}

function count(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

/**
 * The numbers from judge.mjs's local quote check, or null. Counts only: the missing indexes
 * point into challenge text this module never carries.
 */
function groundingOf(r) {
  const g = r.grounding;
  if (!g || typeof g !== "object" || !Number.isInteger(g.checked)) return null;
  return { checked: count(g.checked), found: Math.min(count(g.found), count(g.checked)) };
}

/**
 * The numbers from the Jev check, or null when it did not run or came back unavailable. Counts
 * and probabilities only — never its flags or its `unavailable` reason, which can carry an error
 * body, and an eval summary is written to be posted publicly.
 */
function qualityOf(r) {
  const q = r.quality;
  if (!q || typeof q !== "object" || typeof q.unavailable === "string") return null;
  const pair = (p) => ({ n: count(p?.n), good: Math.min(count(p?.good), count(p?.n)) });
  return {
    concrete: pair(q.concrete),
    engages: pair(q.engages),
    verdictFits: typeof q.verdictFits === "number" ? q.verdictFits : null,
  };
}

/**
 * Score one case against the judge's result for it.
 *
 * `result` is the parsed `--json` object judge.mjs printed (see judge.mjs's `result` shape),
 * or null/undefined when the run produced nothing usable at all (a crash, unparseable
 * stdout). A `verdict` of null — whether because the run failed outright or because the judge
 * itself returned an unrecognisable verdict (see judgeCore.reconcileVerdict) — is "no usable
 * result" either way, and is scored as the worst case for the case's kind rather than being
 * skipped: a flawed/loaded case with no usable result counts as a MISS (we did not catch the
 * flaw), a sound case with no usable result counts as a FALSE ALARM (we cannot call an
 * unreadable run "the subject held up"), and it is never counted as decorrelated (an
 * unattributable or absent run bought no verified independence either).
 *
 * Returns an object carrying only structured, closed-vocabulary fields — verdicts, severities,
 * kinds, booleans, numbers — and the case's own short `expect` metadata. It never carries
 * `caseDef.subject` or `caseDef.question`: that is what lets renderSummary describe a failure
 * without ever re-printing a case's content, and what makes eval.mjs's output file and the
 * CI markdown it produces safe to read (and post) without paging back through the subjects.
 */
/**
 * What is wrong with a case file, as a list of plain sentences; empty when it is well formed.
 * One home for the case format: the committed-case test and eval.mjs (for any set, including a
 * held-out one CI never sees) both call this.
 */
export function caseProblems(c, fileName) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return ["the case is not a JSON object"];
  const problems = [];
  if (typeof c.id !== "string" || c.id.length === 0) problems.push("id must be a non-empty string");
  else if (fileName !== undefined && fileName !== `${c.id}.json`) problems.push(`the filename must be ${c.id}.json`);
  if (!["flawed", "sound", "loaded"].includes(c.kind)) problems.push(`unknown kind: ${c.kind}`);
  if (typeof c.subject !== "string") problems.push("subject must be a string");
  else {
    const words = c.subject.trim().split(/\s+/).length;
    if (words < 120 || words > 300) problems.push(`subject word count ${words} out of [120, 300]`);
  }
  if (typeof c.question !== "string" || c.question.length === 0 || c.question.length >= 300) {
    problems.push("question must be a string of 1 to 299 characters");
  }
  if (typeof c.why !== "string" || c.why.length === 0) problems.push("why must be a non-empty string");
  if (c.heldOut !== undefined && typeof c.heldOut !== "boolean") problems.push("heldOut, when present, must be true or false");
  const expect = c.expect;
  if (!expect || typeof expect !== "object") return [...problems, "expect must be an object"];
  const mustTarget = Array.isArray(expect.must_target) ? expect.must_target : null;
  // The planted flaw must be quotable: every must_target phrase is a literal, case-insensitive
  // substring of the text it was drawn from (the subject for a flawed case, the question for a loaded one).
  const quotable = (field) => {
    if (!mustTarget || mustTarget.length === 0) {
      problems.push("expect.must_target needs at least one phrase");
      return;
    }
    const hay = typeof c[field] === "string" ? c[field].toLowerCase() : "";
    for (const phrase of mustTarget) {
      if (typeof phrase !== "string" || !hay.includes(phrase.toLowerCase())) problems.push(`"${phrase}" not found in ${field}`);
    }
  };
  if (c.kind === "flawed") {
    quotable("subject");
    if (!Array.isArray(expect.verdict_not) || !expect.verdict_not.includes("holds")) problems.push('expect.verdict_not must include "holds"');
  } else if (c.kind === "sound") {
    if (!Array.isArray(expect.verdict_in) || expect.verdict_in.length === 0) problems.push("expect.verdict_in needs at least one verdict");
    if (typeof expect.max_severity !== "string") problems.push("expect.max_severity must be a string");
  } else if (c.kind === "loaded") {
    quotable("question");
  }
  // A confident wrong figure. The corrected value must not already be in the write-up, or a
  // matching correction can be copied from the prompt. A match is not a calculation.
  if (expect.catch_in !== undefined || expect.correction !== undefined) {
    if (expect.catch_in !== "checked-or-verdict") problems.push('expect.catch_in must be "checked-or-verdict"');
    if (c.kind !== "flawed") problems.push("expect.catch_in is only for a flawed case");
    const correction = Array.isArray(expect.correction) ? expect.correction : null;
    if (!correction || correction.length === 0) problems.push("expect.correction needs at least one phrase");
    else {
      const shown = `${typeof c.subject === "string" ? c.subject : ""}\n${typeof c.question === "string" ? c.question : ""}`;
      for (const phrase of correction) {
        if (typeof phrase !== "string" || phrase.trim().length < 3) {
          problems.push("each correction phrase must be a string of at least 3 characters");
          continue;
        }
        if (includesPhrase(shown, phrase)) problems.push(`"${phrase}" must not appear in the subject or question`);
      }
    }
  }
  return problems;
}

export function scoreCase(caseDef, result) {
  const kind = caseDef?.kind ?? null;
  const r = result && typeof result === "object" ? result : {};
  const challenges = Array.isArray(r.challenges) ? r.challenges : [];
  const verdict = typeof r.verdict === "string" ? r.verdict : null;
  const usable = verdict !== null;
  const expect = caseDef?.expect ?? {};

  let caught = null;
  let matchedPhrase = null;

  if (kind === "flawed" || kind === "loaded") {
    const mustTarget = Array.isArray(expect.must_target) ? expect.must_target : [];
    // The figure cases pass on a matching correction in the verdict, or in the blockquote
    // or objection of a Checked for you challenge. That match is not proof the judge
    // calculated the figure. Quoting the wrong figure is not a match. Denying it is not a
    // match. The premise and the falsifier are not a match. Your call is not a match.
    const figureCheck = kind === "flawed" && expect.catch_in === "checked-or-verdict";
    if (!usable) {
      caught = false;
    } else if (figureCheck) {
      caught = false;
      const corrections = Array.isArray(expect.correction) ? expect.correction : [];
      const caseDir = caseDirection(corrections);
      const fromVerdict = corrections.find((phrase) => statedCorrection(r.verdictReason, phrase, caseDir));
      if (fromVerdict !== undefined) {
        caught = true;
        matchedPhrase = fromVerdict;
      } else {
        for (const c of challenges) {
          if (c?.call !== "checked" || !CAUGHT_SEVERITIES.has(c?.severity)) continue;
          const objection = `${typeof c?.target === "string" ? c.target : ""}\n${typeof c?.challenge === "string" ? c.challenge : ""}`;
          const corrected = corrections.find((phrase) => statedCorrection(objection, phrase, caseDir));
          if (corrected !== undefined) {
            caught = true;
            matchedPhrase = corrected;
            break;
          }
        }
      }
    } else {
      caught = false;
      for (const c of challenges) {
        if (!CAUGHT_SEVERITIES.has(c?.severity)) continue;
        const target = lower(c?.target);
        const hit = mustTarget.find((phrase) => target.includes(lower(phrase)));
        if (hit !== undefined) {
          caught = true;
          matchedPhrase = hit;
          break;
        }
      }
    }
  }

  // THE SEMANTIC CATCH, beside the phrase match above and never instead of it. Jev was asked
  // whether any challenge identifies the case's planted flaw in the case's own words, which sees
  // a catch the phrase match misses when the judge quotes different words. Informational only:
  // the phrase match stays the gate, because it needs no second model to be right.
  let semanticCaught = null;
  if (kind === "flawed" || kind === "loaded") {
    const p = r.quality && typeof r.quality === "object" ? r.quality.extra?.[PLANTED_FLAW_QUESTION] : undefined;
    semanticCaught = typeof p === "number" ? p >= GOOD_NOUL : null;
  }

  let falseAlarm = null;
  if (kind === "sound") {
    if (!usable) {
      falseAlarm = true;
    } else {
      const verdictIn = Array.isArray(expect.verdict_in) ? expect.verdict_in : [];
      const maxSeverity = typeof expect.max_severity === "string" ? expect.max_severity : "moderate";
      const maxRank = SEVERITY_RANK[maxSeverity] ?? SEVERITY_RANK.moderate;
      const badVerdict = verdictIn.length > 0 && !verdictIn.includes(verdict);
      const tooSevere = challenges.some((c) => (SEVERITY_RANK[c?.severity] ?? 0) > maxRank);
      falseAlarm = badVerdict || tooSevere;
    }
  }

  return {
    id: caseDef?.id ?? null,
    kind,
    verdict,
    caught,
    falseAlarm,
    matchedPhrase,
    // kind + severity only — never the challenge's target/challenge/falsifier text, which
    // quotes or paraphrases the subject.
    challengeSummary: challenges.map((c) => ({ kind: c?.kind ?? null, severity: c?.severity ?? null })),
    expect,
    schemaIssues: result?.rejected?.length || 0,
    decorrelated: usable ? (typeof r.decorrelated === "boolean" ? r.decorrelated : null) : false,
    costUsd: typeof r.costUsd === "number" ? r.costUsd : null,
    servedModel: typeof r.servedModel === "string" ? r.servedModel : null,
    grounding: groundingOf(r),
    quality: qualityOf(r),
    semanticCaught,
    // Billed even when its answers were unusable, so it counts toward the run's total either way.
    checkCostUsd: typeof r.quality?.costUsd === "number" ? r.quality.costUsd : null,
  };
}

/**
 * rate(numerator, denominator, key) — a fraction, or, when there is nothing to divide by
 * (no sound cases in this run, no cases at all), the value that trivially satisfies THAT
 * metric's own pass direction: 1 for an `atLeast` floor (nothing to catch reads as fully
 * caught), 0 for an `atMost` ceiling (nothing to alarm on reads as zero alarms). Read from
 * `CHECKS` below rather than hardcoded here, so the two can never drift apart. This is what
 * keeps an empty subset from manufacturing a regression by itself — see the "completely empty
 * scores array" test in evalCore.test.mjs, which is exactly the case a flat `denominator > 0
 * ? … : 1` default got backwards for `falseAlarmRate`/`schemaViolationRate`.
 */
function rate(numerator, denominator, key) {
  if (denominator > 0) return numerator / denominator;
  return directionOf(key) === "atMost" ? 0 : 1;
}

/**
 * The gates this loop checks, and which direction is "good" for each. `atLeast` fails
 * when the actual value falls below the threshold (a catch rate that dropped); `atMost` fails
 * when it rises above (a false-alarm or schema-violation rate that grew). decorrelatedRate is a
 * floor of 1.0: a single run answered from Claude's own family is a failure, because an
 * independent judge is the whole product. figureCatchRate is a separate floor for the
 * wrong-figure cases, so they cannot change the catch rate of the cases that came before them.
 */
const CHECKS = Object.freeze([
  { key: "catchRate", direction: "atLeast" },
  { key: "figureCatchRate", direction: "atLeast" },
  { key: "falseAlarmRate", direction: "atMost" },
  { key: "loadedCatchRate", direction: "atLeast" },
  { key: "decorrelatedRate", direction: "atLeast" }, // every run must be judged outside Claude's family
  { key: "schemaViolationRate", direction: "atMost" },
]);

/** The configured direction for a metric key, defaulting to `atLeast` for anything unlisted. */
function directionOf(key) {
  return CHECKS.find((c) => c.key === key)?.direction ?? "atLeast";
}

/**
 * good / n for an INFORMATIONAL metric, or null when there was nothing to divide. Unlike `rate`,
 * there is no pass direction to satisfy here, so an empty basis reads "n/a" — never a flattering
 * 1.0 that a reader could mistake for a measurement.
 */
function share({ good, n }) {
  return n > 0 ? good / n : null;
}

/** Sum `{good, n}` pairs over the scores that have one. */
function tally(list, pick) {
  const total = { good: 0, n: 0 };
  for (const s of list) {
    const p = pick(s);
    if (p && Number.isInteger(p.n) && p.n > 0) {
      total.good += p.good;
      total.n += p.n;
    }
  }
  return total;
}

/**
 * Roll a list of `scoreCase` results (each optionally carrying a `latencyMs` eval.mjs measured
 * around the subprocess call — a timing concern that belongs to the I/O layer, not here) up
 * into the metrics table and a pass/fail check against `thresholds`.
 *
 * Returns `{metrics, regressions, checks, informational}`. `metrics` is the flat table of actual
 * values. `regressions` is human-readable strings, one per failed threshold, suitable for a CI
 * annotation or an issue body — this is what `eval.mjs` uses to decide its exit code.
 * `checks` echoes the threshold actually applied to each metric alongside the outcome, purely
 * so `renderSummary` — which receives no separate `thresholds` argument — can render a
 * pass/fail table without recomputing or re-parsing anything.
 *
 * `informational` does the same for the quality metrics (grounding, and the Jev scores), with
 * the counts behind each rate. They are NEVER gated: they are not in CHECKS, so no threshold,
 * even one set by mistake in thresholds.json, can turn them into a regression. Seventeen cases
 * scored by a second stochastic model is a signal to read, not a bar to hold a release to.
 */
export function summarize(scores, thresholds) {
  const list = Array.isArray(scores) ? scores : [];
  const n = list.length;

  const flawed = list.filter((s) => s.kind === "flawed");
  // Wrong-figure cases have their own floor. They stay out of catchRate, which is the
  // floor the other flawed cases already had.
  const figureFlawed = flawed.filter((s) => s.expect?.catch_in === "checked-or-verdict");
  const legacyFlawed = flawed.filter((s) => s.expect?.catch_in !== "checked-or-verdict");
  const loaded = list.filter((s) => s.kind === "loaded");
  const sound = list.filter((s) => s.kind === "sound");

  const grounded = tally(list, (s) => s.grounding && { good: s.grounding.found, n: s.grounding.checked });
  const concrete = tally(list, (s) => s.quality?.concrete);
  const engages = tally(list, (s) => s.quality?.engages);
  const verdictFit = tally(
    list,
    (s) => typeof s.quality?.verdictFits === "number" && { good: s.quality.verdictFits >= GOOD_NOUL ? 1 : 0, n: 1 },
  );
  // Over the flawed and loaded cases Jev actually scored, so the phrase match beside it can be
  // counted on exactly the same cases.
  const semanticScored = [...flawed, ...loaded].filter((s) => typeof s.semanticCaught === "boolean");
  const semantic = { good: semanticScored.filter((s) => s.semanticCaught).length, n: semanticScored.length };
  const phraseOnSame = semanticScored.filter((s) => s.caught === true).length;

  const metrics = {
    catchRate: rate(legacyFlawed.filter((s) => s.caught === true).length, legacyFlawed.length, "catchRate"),
    figureCatchRate: rate(figureFlawed.filter((s) => s.caught === true).length, figureFlawed.length, "figureCatchRate"),
    falseAlarmRate: rate(sound.filter((s) => s.falseAlarm === true).length, sound.length, "falseAlarmRate"),
    loadedCatchRate: rate(loaded.filter((s) => s.caught === true).length, loaded.length, "loadedCatchRate"),
    decorrelatedRate: rate(list.filter((s) => s.decorrelated === true).length, n, "decorrelatedRate"),
    schemaViolationRate: rate(list.filter((s) => (s.schemaIssues || 0) > 0).length, n, "schemaViolationRate"),
    groundedRate: share(grounded),
    concreteRate: share(concrete),
    engagesRate: share(engages),
    verdictFitRate: share(verdictFit),
    semanticCatchRate: share(semantic),
    totalCostUsd: list.reduce(
      (sum, s) => sum + (typeof s.costUsd === "number" ? s.costUsd : 0) + (typeof s.checkCostUsd === "number" ? s.checkCostUsd : 0),
      0,
    ),
    meanLatencyMs: (() => {
      const known = list.map((s) => s.latencyMs).filter((v) => typeof v === "number");
      return known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 0;
    })(),
    n,
  };

  const notRun = "none scored (the Jev check did not run, or came back unavailable)";
  const informational = [
    { key: "groundedRate", label: "Quoted targets found in the write-up", ...grounded, unit: "challenges", none: "no challenges to check" },
    { key: "concreteRate", label: "Falsifiers scored concrete and cheap (Jev)", ...concrete, unit: "challenges scored", none: notRun },
    { key: "engagesRate", label: "Challenges that engage the write-up (Jev)", ...engages, unit: "challenges scored", none: notRun },
    { key: "verdictFitRate", label: "Verdicts that fit their challenges (Jev)", ...verdictFit, unit: "cases scored", none: notRun },
    {
      key: "semanticCatchRate",
      label: "Planted flaw identified, semantic (Jev)",
      ...semantic,
      unit: "flawed/loaded cases scored",
      note: `phrase match caught ${phraseOnSame} of the same ${semantic.n}`,
      none: notRun,
    },
  ].map((row) => ({ ...row, value: metrics[row.key] }));

  const regressions = [];
  const checks = [];
  for (const { key, direction } of CHECKS) {
    const threshold = thresholds?.[key];
    if (typeof threshold !== "number") continue; // nothing configured for this metric — nothing to check
    const actual = metrics[key];
    const pass = direction === "atLeast" ? actual >= threshold : actual <= threshold;
    checks.push({ key, direction, threshold, actual, pass });
    if (!pass) {
      regressions.push(
        direction === "atLeast"
          ? `${key} is ${actual.toFixed(2)}, below the required minimum of ${threshold}`
          : `${key} is ${actual.toFixed(2)}, above the allowed maximum of ${threshold}`,
      );
    }
  }

  return { metrics, regressions, checks, informational };
}

const METRIC_LABEL = Object.freeze({
  catchRate: "Catch rate (flawed)",
  figureCatchRate: "Catch rate (wrong figure)",
  falseAlarmRate: "False alarm rate (sound)",
  loadedCatchRate: "Catch rate (loaded)",
  decorrelatedRate: "Decorrelated rate",
  schemaViolationRate: "Schema violation rate",
});

/**
 * Render the short markdown report: a metrics table with pass/fail per threshold, then one
 * line per failed case.
 *
 * NEVER INCLUDE SUBJECT TEXT BEYOND THE CASE ID. A failed case is described only by its id,
 * its `expect` metadata (the short planted-phrase / verdict acceptance criteria already
 * committed in evals/cases/*.json — not the subject's narrative) and closed-vocabulary
 * results (verdict, challenge kind/severity). This is what a scheduled run can safely paste
 * into a GitHub issue body without spending the one resource — attention — this loop exists
 * to protect, and without ever needing to re-read a real decision to explain a miss.
 *
 * A HELD-OUT RUN (`heldOut: true`) SHOWS NO CASE AT ALL: no id, no expect phrase, no per-case
 * result. Only the rates and a count of failures, so its score can be published beside the
 * public set's without teaching anyone the test. The full scores stay in the private results file.
 */
export function renderSummary(summary, scores, { heldOut = false } = {}) {
  const { metrics = {}, regressions = [], checks = [], informational = [] } = summary ?? {};
  const list = Array.isArray(scores) ? scores : [];
  const out = [];

  out.push(heldOut ? "# Grill self-eval results (held-out set)" : "# Grill self-eval results", "");
  out.push(
    `n = ${metrics.n ?? list.length} · total cost $${(metrics.totalCostUsd ?? 0).toFixed(4)} · mean latency ${Math.round(
      metrics.meanLatencyMs ?? 0,
    )}ms`,
    "",
  );

  out.push("| Metric | Value | Threshold | Status |", "| --- | --- | --- | --- |");
  for (const c of checks) {
    const cmp = c.direction === "atLeast" ? `>= ${c.threshold}` : `<= ${c.threshold}`;
    out.push(`| ${METRIC_LABEL[c.key] ?? c.key} | ${c.actual.toFixed(2)} | ${cmp} | ${c.pass ? "PASS" : "FAIL"} |`);
  }
  out.push("");

  // A separate table, under its own heading, with no Threshold or Status column: nothing here
  // can fail a run, and a reader must never have to work out which rows do.
  if (Array.isArray(informational) && informational.length > 0) {
    out.push("## Quality (informational, not gated)", "", "| Metric | Value | Basis |", "| --- | --- | --- |");
    for (const row of informational) {
      const value = typeof row.value === "number" ? row.value.toFixed(2) : "n/a";
      const basis = row.n > 0 ? `${row.good} of ${row.n} ${row.unit}${row.note ? `; ${row.note}` : ""}` : row.none ?? "none";
      out.push(`| ${row.label} | ${value} | ${basis} |`);
    }
    out.push("");
  }

  const failedCases = list.filter((s) =>
    s.kind === "flawed" || s.kind === "loaded" ? s.caught === false : s.kind === "sound" ? s.falseAlarm === true : false,
  );

  if (heldOut) {
    out.push(
      failedCases.length > 0
        ? `_${failedCases.length} of ${list.length} cases failed. A held-out set's cases stay private; the full scores are in the results file._`
        : "_No case failures._",
      "",
    );
  } else if (failedCases.length > 0) {
    out.push("## Failed cases", "");
    for (const s of failedCases) {
      const expected =
        s.kind === "sound"
          ? `verdict in [${(s.expect?.verdict_in ?? []).join(", ")}], max severity ${s.expect?.max_severity ?? "?"}`
          : s.expect?.catch_in === "checked-or-verdict"
            ? `the verdict or a Checked for you objection stating one of: ${(s.expect?.correction ?? []).join(" | ")}`
            : `a challenge targeting one of: ${(s.expect?.must_target ?? []).join(" | ")}`;
      const got =
        s.verdict === null
          ? "no usable result (verdict null)"
          : `verdict=${s.verdict}, challenges=[${s.challengeSummary.map((c) => `${c.severity}/${c.kind}`).join(", ")}]`;
      // Tells a phrasing miss (Jev saw the flaw named in other words) from a real one.
      const semantic =
        s.semanticCaught === true
          ? "; Jev: a challenge does identify the planted flaw"
          : s.semanticCaught === false
            ? "; Jev: no challenge identifies it either"
            : "";
      out.push(`- **${s.id}** — expected ${expected}; got ${got}${semantic}`);
    }
    out.push("");
  } else {
    out.push("_No case failures._", "");
  }

  if (regressions.length > 0) {
    out.push("## Threshold regressions", "");
    for (const r of regressions) out.push(`- ${r}`);
    out.push("");
  }

  return out.join("\n");
}
