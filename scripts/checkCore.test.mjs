// Unit tests for checkCore.mjs — the pure half of the optional Jev quality check.
//
// node:test + node:assert only, no dependencies, no network. The request this builds is what a
// user's masked write-up becomes on its way to a second party, so its shape is pinned exactly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCheckRequest,
  CHECK_MAX_CHALLENGES,
  CHECK_TIMEOUT_MS,
  CHECK_WRITE_UP_BUDGET,
  CONCRETE_LEVELS,
  JEV_MODEL,
  JEV_PROVIDER,
  OUTSIDE_ALLOWLIST,
  PLANTED_FLAW_QUESTION,
  plantedFlawQuestion,
  readCheck,
  renderCheck,
} from "./checkCore.mjs";

/** A challenge as judge.mjs's result carries it (validated, ranked). */
function challenge(i, over = {}) {
  return {
    kind: "unsupported-claim",
    severity: "serious",
    target: `quoted words ${i}`,
    challenge: `challenge text ${i}`,
    what_would_have_to_be_true: `premise ${i}`,
    falsifier: `falsifier ${i}`,
    confidence: "high",
    ...over,
  };
}

function result(n, over = {}) {
  return {
    verdict: "weak",
    verdictReason: "The case is asserted, not shown.",
    steelman: "STEELMAN-NEVER-SENT",
    strongestObjection: "OBJECTION-NEVER-SENT",
    challenges: Array.from({ length: n }, (_, i) => challenge(i + 1)),
    ...over,
  };
}

/** A decisions response in the documented shape, built from explicit answers. */
function response(answers, over = {}) {
  return { id: "dec-1", model: JEV_MODEL, provider: JEV_PROVIDER, answers, usage: { input_tokens: 900, output_tokens: 10, cost: 0.0002 }, ...over };
}

const noul = (p) => ({ type: "noul", noul: p });
const score = (s) => ({ type: "score", score: s, confidence: 0.7, probabilities: [0.1, 0.2, 0.7], legend: [...CONCRETE_LEVELS] });

// ---------------------------------------------------------------------------
describe("buildCheckRequest — the exact request shape", () => {
  it("pins the model and sends exactly {model, state, questions}", () => {
    const req = buildCheckRequest({ subject: "the write-up", question: "q?", result: result(2) });
    assert.deepEqual(Object.keys(req).sort(), ["model", "questions", "state"]);
    assert.equal(req.model, "typesafe/jev-1.13");
    assert.equal(JEV_MODEL, "typesafe/jev-1.13");
  });

  it("puts the write-up, question, verdict and reason in state, and nothing else from the review", () => {
    const req = buildCheckRequest({ subject: "the write-up", question: "q?", result: result(1) });
    assert.deepEqual(Object.keys(req.state).sort(), ["challenges", "question", "verdict", "verdict_reason", "write_up"]);
    assert.equal(req.state.write_up, "the write-up");
    assert.equal(req.state.question, "q?");
    assert.equal(req.state.verdict, "weak");
    assert.equal(req.state.verdict_reason, "The case is asserted, not shown.");
    const wire = JSON.stringify(req);
    assert.ok(!wire.includes("STEELMAN-NEVER-SENT"), "the steelman is not sent");
    assert.ok(!wire.includes("OBJECTION-NEVER-SENT"), "the strongest objection is not sent");
  });

  it("cuts each challenge to {n, severity, kind, target, challenge, falsifier}, numbered from 1", () => {
    const req = buildCheckRequest({ subject: "s", result: result(2) });
    assert.deepEqual(req.state.challenges, [
      { n: 1, severity: "serious", kind: "unsupported-claim", target: "quoted words 1", challenge: "challenge text 1", falsifier: "falsifier 1" },
      { n: 2, severity: "serious", kind: "unsupported-claim", target: "quoted words 2", challenge: "challenge text 2", falsifier: "falsifier 2" },
    ]);
    assert.ok(!JSON.stringify(req).includes("premise 1"), "what_would_have_to_be_true is not sent");
  });

  it("caps the challenges at the top five, keeping the ranked head", () => {
    assert.equal(CHECK_MAX_CHALLENGES, 5);
    const req = buildCheckRequest({ subject: "s", result: result(7) });
    assert.equal(req.state.challenges.length, 5);
    assert.deepEqual(req.state.challenges.map((c) => c.target), [1, 2, 3, 4, 5].map((i) => `quoted words ${i}`));
    assert.ok(!JSON.stringify(req).includes("quoted words 6"));
    assert.equal(req.questions.concrete_6, undefined);
    assert.equal(req.questions.engages_6, undefined);
  });

  it("asks concrete_n (score, three levels lowest first) and engages_n (noul) for every challenge sent", () => {
    const req = buildCheckRequest({ subject: "s", result: result(3) });
    for (const n of [1, 2, 3]) {
      const c = req.questions[`concrete_${n}`];
      assert.equal(c.type, "score");
      assert.deepEqual(c.criteria, [
        "No real test is named",
        "A test is named but it is vague or costly",
        "A concrete, cheap test with a clear result",
      ]);
      assert.match(c.instructions, new RegExp(`challenge ${n} in state\\.challenges`));
      assert.match(c.instructions, /falsifier/);

      const e = req.questions[`engages_${n}`];
      assert.equal(e.type, "noul");
      assert.deepEqual(Object.keys(e.criteria).sort(), ["false", "true"]);
      assert.match(e.instructions, /actually argues, rather than a claim it never made\?/);
      assert.match(e.instructions, /loaded-framing/, "a challenge to the question is judged against the question");
    }
  });

  it("always asks verdict_fits, on weight rather than count", () => {
    const q = buildCheckRequest({ subject: "s", result: result(1) }).questions.verdict_fits;
    assert.equal(q.type, "noul");
    assert.match(q.instructions, /one fatal challenge refutes and many minor ones do not/);
    assert.deepEqual(Object.keys(q.criteria).sort(), ["false", "true"]);
  });

  it("asks answers_question only when there is a question", () => {
    assert.equal(buildCheckRequest({ subject: "s", question: "Should we?", result: result(1) }).questions.answers_question.type, "noul");
    for (const question of ["", "   ", undefined, null]) {
      assert.equal(buildCheckRequest({ subject: "s", question, result: result(1) }).questions.answers_question, undefined);
    }
  });

  it("asks exactly the built-in questions and no others", () => {
    const req = buildCheckRequest({ subject: "s", question: "q", result: result(2) });
    assert.deepEqual(Object.keys(req.questions).sort(), [
      "answers_question",
      "concrete_1",
      "concrete_2",
      "engages_1",
      "engages_2",
      "verdict_fits",
    ]);
  });

  it("merges extra questions after the built-ins, and never lets one replace a built-in", () => {
    const extra = plantedFlawQuestion("Plants a hidden assumption.");
    const req = buildCheckRequest({ subject: "s", result: result(1), extraQuestions: extra });
    assert.deepEqual(req.questions[PLANTED_FLAW_QUESTION], extra[PLANTED_FLAW_QUESTION]);
    assert.ok(req.questions.verdict_fits);
    for (const name of ["verdict_fits", "answers_question", "concrete_1", "engages_9", "Bad-Name", "__proto__"]) {
      assert.throws(() => buildCheckRequest({ subject: "s", result: result(1), extraQuestions: { [name]: { type: "noul" } } }));
    }
  });

  it("survives an empty or missing result without throwing", () => {
    for (const r of [null, undefined, {}, { challenges: "nope" }]) {
      const req = buildCheckRequest({ subject: "s", result: r });
      assert.deepEqual(req.state.challenges, []);
      assert.equal(req.state.verdict, null);
      assert.deepEqual(Object.keys(req.questions), ["verdict_fits"]);
    }
    assert.doesNotThrow(() => buildCheckRequest());
  });

  it("sends the write-up it is given and masks nothing itself — masking is judge.mjs's job, before this", () => {
    assert.equal(buildCheckRequest({ subject: "[email] said so", result: result(0) }).state.write_up, "[email] said so");
  });

  it("keeps its budgets inside what Jev and the judge can hold", () => {
    assert.ok(CHECK_WRITE_UP_BUDGET > 0 && CHECK_WRITE_UP_BUDGET <= 60000, "about 20k tokens at most, inside a 32k context");
    assert.ok(CHECK_TIMEOUT_MS > 0 && CHECK_TIMEOUT_MS <= 120000, "a decision model answers in seconds");
  });
});

// ---------------------------------------------------------------------------
describe("plantedFlawQuestion — the eval's semantic catch", () => {
  it("names the flaw in the case's own words, without a full stop before the question mark", () => {
    const q = plantedFlawQuestion("Plants a hidden assumption that X holds.")[PLANTED_FLAW_QUESTION];
    assert.equal(q.type, "noul");
    assert.equal(q.instructions, "Does any challenge identify this specific flaw: Plants a hidden assumption that X holds?");
    assert.deepEqual(Object.keys(q.criteria).sort(), ["false", "true"]);
  });

  it("returns null when there is no flaw to name", () => {
    for (const why of ["", "  ", ". .", undefined, null, 42]) assert.equal(plantedFlawQuestion(why), null);
  });
});

// ---------------------------------------------------------------------------
describe("readCheck — good, bad, missing and off-allowlist answers", () => {
  it("counts good answers: a score >= 1.5 and a noul >= 0.5", () => {
    const q = readCheck(
      response({
        concrete_1: score(2),
        concrete_2: score(1.5),
        concrete_3: score(1.49),
        engages_1: noul(0.5),
        engages_2: noul(0.49),
        verdict_fits: noul(0.96),
        answers_question: noul(0.8),
      }),
    );
    assert.deepEqual(q.concrete, { n: 3, good: 2 });
    assert.deepEqual(q.engages, { n: 2, good: 1 });
    assert.equal(q.verdictFits, 0.96);
    assert.equal(q.answersQuestion, 0.8);
    assert.equal(q.provider, "TypeSafe");
    assert.equal(q.costUsd, 0.0002);
    assert.deepEqual(q.flags, [], "exactly half is not below half");
    assert.deepEqual(q.extra, {});
  });

  it("flags each share below half, and a verdict or answer that leans false", () => {
    const q = readCheck(
      response({
        concrete_1: score(0.2),
        concrete_2: score(1.9),
        concrete_3: score(0.9),
        engages_1: noul(0.1),
        engages_2: noul(0.2),
        engages_3: noul(0.7),
        verdict_fits: noul(0.3),
        answers_question: noul(0.4),
      }),
    );
    assert.equal(q.flags.length, 4);
    assert.match(q.flags[0], /Only 1 of 3 falsifiers scored as a concrete, cheap test/);
    assert.match(q.flags[1], /Only 1 of 3 challenges scored as engaging/);
    assert.match(q.flags[2], /verdict fits the weight of the challenges/);
    assert.match(q.flags[3], /answers the question that was asked/);
  });

  it("counts only the answers it can read: missing ones drop out of both sides of the ratio", () => {
    const q = readCheck(response({ concrete_1: score(2), engages_1: noul(0.9) }));
    assert.deepEqual(q.concrete, { n: 1, good: 1 });
    assert.deepEqual(q.engages, { n: 1, good: 1 });
    assert.equal(q.verdictFits, null);
    assert.equal(q.answersQuestion, null);
    assert.deepEqual(q.flags, []);
  });

  it("ignores malformed answers instead of throwing: wrong type, impossible values, junk", () => {
    const q = readCheck(
      response({
        concrete_1: noul(0.9), // wrong type for a score question
        concrete_2: score(2.5), // off the end of a three-level scale
        concrete_3: score(-0.1),
        concrete_4: { type: "score", score: "2" },
        engages_1: noul(1.2), // not a probability
        engages_2: noul(Number.NaN),
        engages_3: null,
        engages_4: "yes",
        verdict_fits: { type: "noul" },
        answers_question: noul(0.7),
      }),
    );
    assert.deepEqual(q.concrete, { n: 0, good: 0 });
    assert.deepEqual(q.engages, { n: 0, good: 0 });
    assert.equal(q.verdictFits, null);
    assert.equal(q.answersQuestion, 0.7);
  });

  it("reads other answers into `extra` by name, for the eval's planted-flaw question", () => {
    const q = readCheck(
      response({
        verdict_fits: noul(0.9),
        [PLANTED_FLAW_QUESTION]: noul(0.12),
        a_choice: { type: "choice", choice: "b", confidence: 0.6, probabilities: { a: 0.4, b: 0.6 } },
        __proto__x: noul(0.5),
        "Not-A-Name": noul(0.5),
      }),
    );
    assert.equal(q.extra[PLANTED_FLAW_QUESTION], 0.12);
    assert.equal(q.extra.a_choice, "b");
    assert.equal(Object.hasOwn(q.extra, "Not-A-Name"), false);
    assert.equal(Object.hasOwn(q.extra, "__proto__x"), false, "names must start with a letter");
  });

  it("DROPS the answers when the provider is not TypeSafe, keeping only what was billed", () => {
    const answers = { concrete_1: score(2), verdict_fits: noul(0.9) };
    for (const provider of ["SomeoneElse", "typesafe", "TypeSafe ", "", null, undefined, 42]) {
      const q = readCheck(response(answers, { provider }));
      assert.equal(q.unavailable, OUTSIDE_ALLOWLIST, `provider ${JSON.stringify(provider)}`);
      assert.equal(q.unavailable, "served by an endpoint outside the zero-retention allowlist");
      assert.equal(q.concrete, undefined, "no answer survives");
      assert.equal(q.verdictFits, undefined);
      assert.equal(q.costUsd, 0.0002);
    }
  });

  it("is unavailable, not a zero score, when nothing at all can be read", () => {
    for (const r of [response({}), response(null), response([]), response({ concrete_1: "junk" })]) {
      assert.match(readCheck(r).unavailable, /no answer this check could read/);
    }
  });

  it("never throws on garbage", () => {
    for (const junk of [null, undefined, 42, "text", [], { answers: 7 }, { provider: "TypeSafe", usage: { cost: "free" } }]) {
      assert.doesNotThrow(() => readCheck(junk));
      assert.equal(typeof readCheck(junk).unavailable, "string");
    }
    assert.equal(readCheck({ provider: "TypeSafe", answers: { verdict_fits: noul(0.9) }, usage: { cost: "free" } }).costUsd, null);
  });
});

// ---------------------------------------------------------------------------
describe("renderCheck", () => {
  it("renders the section: counts, leanings, flags, and who scored it", () => {
    const lines = renderCheck({
      concrete: { n: 5, good: 4 },
      engages: { n: 5, good: 5 },
      verdictFits: 0.93,
      answersQuestion: 0.41,
      flags: ["Jev doubts the review answers the question that was asked."],
      costUsd: 0.00021,
      provider: "TypeSafe",
      extra: {},
    });
    const md = lines.join("\n");
    assert.equal(lines[0], "## Quality check (Jev)");
    assert.match(md, /- Falsifiers that name a concrete, cheap test: 4 of 5/);
    assert.match(md, /- Challenges that engage with what the write-up argues: 5 of 5/);
    assert.match(md, /- Verdict fits the weight of the challenges: yes \(0\.93\)/);
    assert.match(md, /- Review answers the question asked: doubtful \(0\.41\)/);
    assert.match(md, /- ⚠ Jev doubts the review answers the question that was asked\./);
    assert.match(md, /typesafe\/jev-1\.13/);
    assert.match(md, /cost \$0\.000210/);
    assert.match(md, /grades the review above, not your decision/);
  });

  it("leaves out what was not scored rather than printing 0 of 0", () => {
    const md = renderCheck({ concrete: { n: 0, good: 0 }, engages: { n: 0, good: 0 }, verdictFits: 0.8, answersQuestion: null, flags: [] }).join("\n");
    assert.ok(!md.includes("0 of 0"));
    assert.ok(!md.includes("Review answers"));
    assert.match(md, /Verdict fits/);
  });

  it("says 'quality check unavailable' in one line, and that the grill is unaffected", () => {
    const md = renderCheck({ unavailable: "OpenRouter's decisions endpoint returned 500: boom." }).join("\n");
    assert.match(md, /## Quality check \(Jev\)/);
    assert.match(md, /quality check unavailable: OpenRouter's decisions endpoint returned 500: boom\. The grill above is unaffected\./);
    assert.doesNotMatch(md, /DEGRADED/);
  });

  it("renders nothing when the check was not asked for", () => {
    for (const q of [null, undefined, "x"]) assert.deepEqual(renderCheck(q), []);
  });
});
