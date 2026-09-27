// checkCore.mjs — the pure half of Grill's optional quality check.
//
// No fs, no network, no process, and no imports: plain data in, plain data out. judge.mjs owns
// the one HTTP call. judgeCore renders the section built here, so this file imports nothing:
// judgeCore imports it, and a cycle between the two would be a trap for whoever edits either.
//
// WHAT THIS IS FOR. A grill's report is itself one model's output, and three parts of its
// contract are checked by nothing else: every challenge names a concrete, cheap falsifier; every
// challenge attacks what the write-up actually argues; and the verdict follows the WEIGHT of the
// challenges, not their count. This asks Jev, TypeSafe's structured decision model on
// OpenRouter, to score exactly those three things, so a reader can tell a careful review from a
// sloppy one at a glance. It grades the review, never the decision, and it never changes the
// verdict, the challenges or the exit code.
//
// PRIVACY. This is a second flow of the user's write-up to a third party, so:
//   - it is OFF unless asked for (`--check`, JUDGE_CHECK=1, or the extension's "Quality check
//     with Jev" setting), and it only ever sees text judge.mjs has already masked;
//   - it is pinned to one model, JEV_MODEL, whose only OpenRouter endpoint is TypeSafe's, and
//     that endpoint is on OpenRouter's zero-data-retention list. The documented request body has
//     no routing field, so the send cannot be steered; instead the RESPONSE is checked, and an
//     answer served by anyone but TypeSafe is dropped unread (`readCheck`). The weekly upstream
//     check (scripts/upstream-check.mjs) fails if the model ever leaves the zero-retention list;
//   - the request carries the masked write-up, the question, the verdict and its reason, and
//     five challenges at most, each cut to the fields the questions need. Nothing else.
//
// Zero dependencies. Node >= 20. ESM throughout.

/** The one model the check may use. Pinned, never routed: see PRIVACY above. */
export const JEV_MODEL = "typesafe/jev-1.13";

/**
 * The provider an answer must name to be read. Jev's only OpenRouter endpoint is TypeSafe's, and
 * it is on the zero-data-retention list (checked against /api/v1/endpoints/zdr on 2026-09-26;
 * scripts/upstream-check.mjs re-checks it weekly). Compared exactly: a spelling this file has
 * not seen is treated as someone else, because the safe way to be wrong here is "unavailable".
 */
export const JEV_PROVIDER = "TypeSafe";

/** Why an answer from anyone else is dropped rather than read. Pinned by tests. */
export const OUTSIDE_ALLOWLIST = "served by an endpoint outside the zero-retention allowlist";

/**
 * How many challenges the check scores. Challenges arrive ranked most damaging first, so the top
 * five are the ones a reader acts on. Each costs two questions, and five keeps the request well
 * inside Jev's 32k-token context.
 */
export const CHECK_MAX_CHALLENGES = 5;

/**
 * Characters of the write-up the check sends. Jev's context is 32k tokens and the grill's own
 * subject budget is 140k characters (about 35k tokens), so a long write-up must be clipped for
 * this second reader. 60k characters is roughly 15–20k tokens, which leaves room for the review,
 * the questions and Jev's own framing. judge.mjs applies it with judgeCore's budgetText (clipping
 * from the end, keeping the thesis, with a marker Jev can read) and flags it in the section, so a
 * check that read only part of the write-up never looks like one that read all of it.
 */
export const CHECK_WRITE_UP_BUDGET = 60000;

/**
 * Ceiling on the check's one request, in ms. A decision model answers in seconds; this is a
 * backstop so a stalled check cannot hold the report for the judge's ten-minute budget. judge.mjs
 * also caps it at the judge's own per-attempt timeout, so one knob bounds both.
 */
export const CHECK_TIMEOUT_MS = 60000;

/** The `concrete_n` scale, lowest first. Jev's score is a probability-weighted index into it. */
export const CONCRETE_LEVELS = Object.freeze([
  "No real test is named",
  "A test is named but it is vague or costly",
  "A concrete, cheap test with a clear result",
]);

/**
 * Where an answer counts as good. A score of 1.5 sits halfway between the top two levels of a
 * three-level scale, so "good" means Jev leaned to "concrete and cheap", not merely "named". A
 * noul is a probability that the statement is true, so 0.5 is where it leans true.
 */
export const GOOD_SCORE = 1.5;
export const GOOD_NOUL = 0.5;

/** The extra question the eval loop asks about each flawed and loaded case. */
export const PLANTED_FLAW_QUESTION = "catches_planted_flaw";

/** The names buildCheckRequest owns. An extra question may never take one of them over. */
const BUILT_IN_RX = /^(?:concrete_\d+|engages_\d+|verdict_fits|answers_question)$/;

/**
 * What an extra question's name must look like, and what readCheck will copy into `extra`. A
 * closed shape means a response key can never be `__proto__` or anything else odd on the way in.
 */
const NAME_RX = /^[a-z][a-z0-9_]{0,63}$/;

function str(v) {
  return typeof v === "string" ? v : "";
}

/**
 * The request body for OpenRouter's decisions endpoint, exactly as documented:
 * `{model, state, questions}`. All questions in one request are answered in parallel.
 *
 * `subject` must be the text judge.mjs already masked (and budgeted); this function sends what it
 * is given and masks nothing itself. `result` is judge.mjs's result object, whose challenges are
 * already ranked most damaging first, so the first CHECK_MAX_CHALLENGES are the top ones. Each is
 * numbered `n` from 1, matching the report's own "### 1." headings, so `concrete_2` means the
 * challenge a reader sees as #2.
 *
 * `extraQuestions` is an optional `{name: question}` map merged after the built-in questions (the
 * eval loop's planted-flaw question). It may not reuse a built-in name: a caller that tries is
 * a bug, so this throws rather than letting one question silently replace another.
 */
export function buildCheckRequest({ subject = "", question = "", result = null, extraQuestions = null } = {}) {
  const r = result && typeof result === "object" ? result : {};
  const asked = str(question);
  const challenges = (Array.isArray(r.challenges) ? r.challenges : []).slice(0, CHECK_MAX_CHALLENGES).map((c, i) => ({
    n: i + 1,
    severity: str(c?.severity),
    kind: str(c?.kind),
    target: str(c?.target),
    challenge: str(c?.challenge),
    falsifier: str(c?.falsifier),
  }));

  const questions = {};
  for (const { n } of challenges) {
    questions[`concrete_${n}`] = {
      type: "score",
      instructions: `Look at the falsifier of challenge ${n} in state.challenges (the item whose "n" is ${n}): the test it offers to settle that challenge either way. How concrete and cheap is that test?`,
      criteria: [...CONCRETE_LEVELS],
    };
    questions[`engages_${n}`] = {
      type: "noul",
      instructions: `Does challenge ${n} in state.challenges (the item whose "n" is ${n}) engage with what the write-up in state.write_up actually argues, rather than a claim it never made? A challenge of kind "loaded-framing" attacks the question put to the reviewer (state.question) instead, so judge that kind against the question.`,
      criteria: {
        "true": "It engages with an argument or claim the write-up (or, for loaded-framing, the question) actually makes.",
        "false": "It attacks a claim that was never made, or misreads what was argued.",
      },
    };
  }
  questions.verdict_fits = {
    type: "noul",
    instructions:
      "Is the verdict in state.verdict (explained in state.verdict_reason) consistent with the weight of the challenges in state.challenges, where one fatal challenge refutes, one serious challenge rules out a plain holds, and many minor ones do not? Verdicts, mildest first: holds, holds-with-conditions, weak, refuted. Severities, worst first: fatal, serious, moderate, minor. state.challenges holds at most the five most damaging challenges.",
    criteria: {
      "true": "The verdict fits the weight of the challenges.",
      "false": "The verdict is harsher or softer than the challenges support.",
    },
  };
  // Only when there IS a question: asking whether a review answered no question would score
  // noise, and a noise score is worse than no score.
  if (asked.trim() !== "") {
    questions.answers_question = {
      type: "noul",
      instructions:
        "state.question is the question the reviewer was asked about the write-up. Does the review (state.verdict, state.verdict_reason and state.challenges) answer that question, rather than a different one?",
      criteria: {
        "true": "The review answers the question that was asked.",
        "false": "The review answers a different question, or none.",
      },
    };
  }

  for (const [name, q] of Object.entries(extraQuestions ?? {})) {
    if (!NAME_RX.test(name) || BUILT_IN_RX.test(name)) {
      throw new Error(`extra check question "${name}" is not a usable name, or would replace a built-in question`);
    }
    questions[name] = q;
  }

  return {
    model: JEV_MODEL,
    state: {
      write_up: str(subject),
      question: asked,
      verdict: typeof r.verdict === "string" ? r.verdict : null,
      verdict_reason: str(r.verdictReason),
      challenges,
    },
    questions,
  };
}

/**
 * The eval loop's semantic catch: one extra noul asking whether any challenge found the flaw a
 * case planted, named in the case's own words (its `why`). Phrase matching (evalCore's gate) can
 * only see a catch that quotes the planted words; this sees one that names the flaw differently.
 * Returns the `extraQuestions` map for buildCheckRequest, or null when there is no flaw to name.
 */
export function plantedFlawQuestion(why) {
  let flaw = str(why).trim();
  // The eval cases write `why` as a sentence; its full stop would land before the question mark.
  while (flaw.endsWith(".")) flaw = flaw.slice(0, -1).trimEnd();
  if (flaw === "") return null;
  return {
    [PLANTED_FLAW_QUESTION]: {
      type: "noul",
      instructions: `Does any challenge identify this specific flaw: ${flaw}?`,
      criteria: {
        "true": "At least one challenge in state.challenges identifies this specific flaw.",
        "false": "No challenge in state.challenges identifies this flaw.",
      },
    },
  };
}

// ── Reading the answers: every shape check fails soft ─────────────────────────
//
// The response is untrusted input from a third party. Each reader below returns null for anything
// that is not exactly the documented shape — including a probability outside [0, 1] or a score off
// the end of its scale, which are impossible values rather than strong opinions — and a null is
// simply not counted. Nothing here throws.

function noulOf(a) {
  return a && a.type === "noul" && typeof a.noul === "number" && a.noul >= 0 && a.noul <= 1 ? a.noul : null;
}

function scoreOf(a, maxIndex) {
  return a && a.type === "score" && typeof a.score === "number" && a.score >= 0 && a.score <= maxIndex ? a.score : null;
}

function choiceOf(a) {
  return a && a.type === "choice" && typeof a.choice === "string" && a.choice !== "" ? a.choice : null;
}

/** An extra question's answer as a plain value: a noul or score as a number, a choice as its string. */
function valueOf(a) {
  if (a?.type === "noul") return noulOf(a);
  if (a?.type === "score") {
    const top = Array.isArray(a.legend) && a.legend.length > 0 ? a.legend.length - 1 : Number.MAX_VALUE;
    return scoreOf(a, top);
  }
  if (a?.type === "choice") return choiceOf(a);
  return null;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Read a decisions response into the quality summary.
 *
 * Returns `{concrete: {n, good}, engages: {n, good}, verdictFits, answersQuestion, costUsd,
 * provider, flags, extra}`. `n` counts the answers that could be read, so a question Jev left
 * unanswered drops out of both sides of the ratio rather than counting as a failure.
 * `verdictFits` and `answersQuestion` are the noul probabilities, or null when not asked or not
 * readable. `extra` holds any other answer by name (the eval's planted-flaw question). `flags`
 * are sentences for a reader: a share of good answers below half, or a noul below 0.5.
 *
 * Returns `{unavailable, provider, costUsd}` instead, with nothing read from `answers`, when:
 *   - the response names any provider but JEV_PROVIDER (or none) — OUTSIDE_ALLOWLIST;
 *   - it carries no answer this can read at all.
 * `costUsd` survives either way: an unusable answer was still billed.
 */
export function readCheck(response) {
  const r = response && typeof response === "object" ? response : {};
  const provider = typeof r.provider === "string" ? r.provider : null;
  const cost = r.usage?.cost;
  const costUsd = typeof cost === "number" && Number.isFinite(cost) ? cost : null;

  // THE ALLOWLIST, BEFORE ANYTHING IS READ. By now the request has been sent; what this still
  // controls is whether an answer from an endpoint nobody vetted shapes what the user reads.
  if (provider !== JEV_PROVIDER) return { unavailable: OUTSIDE_ALLOWLIST, provider, costUsd };

  const answers = r.answers && typeof r.answers === "object" && !Array.isArray(r.answers) ? r.answers : {};
  const concrete = { n: 0, good: 0 };
  const engages = { n: 0, good: 0 };
  let verdictFits = null;
  let answersQuestion = null;
  const extra = {};

  for (const [name, answer] of Object.entries(answers)) {
    if (/^concrete_\d+$/.test(name)) {
      const s = scoreOf(answer, CONCRETE_LEVELS.length - 1);
      if (s !== null) {
        concrete.n += 1;
        if (s >= GOOD_SCORE) concrete.good += 1;
      }
    } else if (/^engages_\d+$/.test(name)) {
      const p = noulOf(answer);
      if (p !== null) {
        engages.n += 1;
        if (p >= GOOD_NOUL) engages.good += 1;
      }
    } else if (name === "verdict_fits") {
      verdictFits = noulOf(answer);
    } else if (name === "answers_question") {
      answersQuestion = noulOf(answer);
    } else if (NAME_RX.test(name)) {
      const v = valueOf(answer);
      if (v !== null) extra[name] = v;
    }
  }

  const nothingRead =
    concrete.n + engages.n === 0 && verdictFits === null && answersQuestion === null && Object.keys(extra).length === 0;
  if (nothingRead) return { unavailable: "Jev's response carried no answer this check could read", provider, costUsd };

  const flags = [];
  if (concrete.n > 0 && concrete.good / concrete.n < 0.5) {
    flags.push(
      `Only ${concrete.good} of ${plural(concrete.n, "falsifier")} scored as a concrete, cheap test, so these challenges may be hard to settle.`,
    );
  }
  if (engages.n > 0 && engages.good / engages.n < 0.5) {
    flags.push(
      `Only ${engages.good} of ${plural(engages.n, "challenge")} scored as engaging with what the write-up actually argues; the rest may attack claims it never made.`,
    );
  }
  if (verdictFits !== null && verdictFits < GOOD_NOUL) {
    flags.push("Jev doubts the verdict fits the weight of the challenges: one fatal challenge refutes, and many minor ones do not.");
  }
  if (answersQuestion !== null && answersQuestion < GOOD_NOUL) {
    flags.push("Jev doubts the review answers the question that was asked.");
  }

  return { concrete, engages, verdictFits, answersQuestion, costUsd, provider, flags, extra };
}

function leaning(p) {
  return `${p >= GOOD_NOUL ? "yes" : "doubtful"} (${p.toFixed(2)})`;
}

/**
 * The report's "Quality check (Jev)" section, as markdown lines; [] when the check was not asked
 * for. An unavailable check gets one line and never a degradation banner: the check is an
 * optional second opinion on the review, and its absence says nothing about the grill.
 */
export function renderCheck(quality) {
  if (!quality || typeof quality !== "object") return [];
  const out = ["## Quality check (Jev)", ""];

  if (typeof quality.unavailable === "string") {
    let why = quality.unavailable.trim();
    while (why.endsWith(".")) why = why.slice(0, -1);
    out.push(`quality check unavailable: ${why}. The grill above is unaffected.`, "");
    return out;
  }

  const { concrete, engages, verdictFits, answersQuestion, flags, costUsd } = quality;
  if (concrete?.n > 0) out.push(`- Falsifiers that name a concrete, cheap test: ${concrete.good} of ${concrete.n}`);
  if (engages?.n > 0) out.push(`- Challenges that engage with what the write-up argues: ${engages.good} of ${engages.n}`);
  if (typeof verdictFits === "number") out.push(`- Verdict fits the weight of the challenges: ${leaning(verdictFits)}`);
  if (typeof answersQuestion === "number") out.push(`- Review answers the question asked: ${leaning(answersQuestion)}`);
  for (const f of Array.isArray(flags) ? flags : []) out.push(`- ⚠ ${f}`);
  out.push(
    "",
    `_Scored by Jev (\`${JEV_MODEL}\`, served by ${JEV_PROVIDER} with zero data retention)${
      typeof costUsd === "number" ? ` · cost $${costUsd.toFixed(6)}` : ""
    }. It grades the review above, not your decision. Jev is on by default: ask to skip it for one grill, or switch it off in Grill's settings._`,
    "",
  );
  return out;
}
