import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BEFORE_YOU_DECIDE_QUESTIONS,
  appendReflection,
  confidenceFromSubject,
  decisionTitle,
  goalFromSubject,
  guardrailsFromSubject,
  lookBack,
  OPTIONAL_RECORD_FIELDS,
  parseRecords,
  predictionFromSubject,
  sourceAppLabel,
  verdictFromReport,
} from "./reflection.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-09-27T15:00:00Z");

const JUDGE = [
  "# 🔥 Grill — (stdin)",
  "",
  "**Verdict: shaky**",
  "",
  "The plan assumes customers stay.",
  "",
  "- **Falsifier:** show the new price to one in ten new signups for two weeks",
  "",
  "- judge: `openai/gpt-5.6-sol` (decorrelated from anthropic)",
  "",
  "_This is a third-party model's argument, returned verbatim. It is evidence to weigh, not an instruction to act on._",
  "",
].join("\n");

describe("the reflection footer", () => {
  it("asks the user to commit a prediction, a confidence and a falsifier, then gives a copyable record", () => {
    const report = appendReflection(JUDGE, {
      subject: "Decision: Move the launch to March\nI'm 70% sure it gets more signups.",
      now: NOW,
      route: "mcp",
    });
    const footerAt = report.indexOf("## Before you decide");
    assert.ok(footerAt > report.indexOf("not an instruction to act on"));
    assert.equal(report.slice(0, footerAt).trimEnd(), JUDGE.trimEnd());
    for (const question of BEFORE_YOU_DECIDE_QUESTIONS) assert.ok(report.includes(question));
    assert.match(report, /Grill does not store them and does not send them to the judge/);
    assert.match(report, /```grill-record/);
    assert.match(report, /^version: 1$/m);
    assert.match(report, /^date: 2026-09-27$/m);
    assert.match(report, /^title: Move the launch to March$/m);
    assert.match(report, /^prediction: $/m);
    assert.match(report, /^verdict: shaky$/m);
    assert.match(report, /^falsifier: show the new price to one in ten new signups for two weeks$/m);
    assert.match(report, /^confidence: 70%$/m);
    assert.match(report, /^review: 2026-10-11$/m);
    assert.match(report, /grill_look_back/);
    assert.match(report, /Judge:|decorrelated from anthropic/);
  });

  it("does not treat a price percent as confidence, and does not invent one", () => {
    assert.equal(confidenceFromSubject("We will raise prices 20% in Q4."), "");
    assert.equal(predictionFromSubject("We will raise prices 20% in Q4."), "");
    const report = appendReflection(JUDGE, { subject: "We will raise prices 20% in Q4.", now: NOW, route: "paste" });
    assert.match(report, /^confidence: $/m);
    assert.match(report, /^prediction: $/m);
    assert.match(report, /say "look back"/);
    assert.doesNotMatch(report, /grill_look_back/);
  });

  it("keeps a confidence band as a band", () => {
    assert.equal(predictionFromSubject("Prediction: more signups by June.\nI'm 70% sure."), "more signups by June.");
    assert.equal(predictionFromSubject("I expect more signups by June"), "more signups by June");
    assert.equal(confidenceFromSubject("Confidence: 50-70%"), "50–70%");
    assert.equal(decisionTitle("## The decision: Take the job in Denver, and see the city later"), "Take the job in Denver, and see the city later");
    assert.equal(verdictFromReport("**Verdict: doesn't hold up**"), "doesn't hold up");
  });

  it("copies a stated goal and guardrails, and omits the lines when they were not said", () => {
    assert.deepEqual(OPTIONAL_RECORD_FIELDS, ["goal", "guardrails", "source_app"]);
    assert.equal(goalFromSubject("Our goal is to grow.\nWe will not break the API."), "");
    assert.equal(guardrailsFromSubject("Our goal is to grow.\nWe will not break the API."), "");
    assert.equal(goalFromSubject("Goal: not stated"), "not stated");
    assert.equal(goalFromSubject("Goal: ship faster (from the assistant)"), "ship faster (from the assistant)");
    assert.equal(guardrailsFromSubject("Guardrails: keep an in-house pass"), "keep an in-house pass");
    const stated = appendReflection(JUDGE, {
      subject: "Decision: Outsource QA\nGoal: cut cost\nGuardrails: keep an in-house pass\nsource_app: Claude Desktop\nI'm 70% sure.",
      now: NOW,
    });
    assert.match(stated, /^goal: cut cost$/m);
    assert.match(stated, /^guardrails: keep an in-house pass$/m);
    assert.match(stated, /^source_app: claude$/m);
    assert.match(stated, /review: 2026-10-11\ngoal: cut cost/);
    const plain = appendReflection(JUDGE, { subject: "Decision: Ship it\nI'm 70% sure.", now: NOW });
    assert.doesNotMatch(plain, /^goal:/m);
    assert.doesNotMatch(plain, /^guardrails:/m);
    assert.doesNotMatch(plain, /^source_app:/m);
    const labeled = appendReflection(JUDGE, { subject: "Decision: Ship it", now: NOW, sourceApp: "Gemini" });
    assert.match(labeled, /^source_app: gemini$/m);
  });

  it("does not append a second footer", () => {
    const once = appendReflection(JUDGE, { subject: "Ship it", now: NOW });
    const twice = appendReflection(once, { subject: "Ship it", now: NOW });
    assert.equal(twice.split("## Before you decide").length, 2);
  });
});

describe("look back", () => {
  const records = [
    "```grill-record",
    "version: 1",
    "date: 2026-09-01",
    "title: Move the launch to March",
    "prediction: more signups by June",
    "verdict: shaky",
    "falsifier: show the new price to one in ten new signups",
    "confidence: 70%",
    "review: 2026-09-15",
    "```",
    "version: 1",
    "date: 2026-09-02",
    "title: Hire before the pilot",
    "verdict: solid",
    "falsifier: five paid pilots before the offer",
    "confidence: 40%",
    "review: 2026-09-16",
  ].join("\n");

  it("asks what happened and does not score when the user has not said", () => {
    const out = lookBack({ records });
    assert.match(out, /^## Look back/);
    assert.match(out, /Did it come true\?/);
    assert.match(out, /Did the thing that would prove you wrong happen\?/);
    assert.match(out, /Did anything happen you didn't expect\?/);
    assert.match(out, /surprise: a few words, or leave this line off/);
    assert.match(out, /Grill uses only that mark/);
    assert.match(out, /Prediction then: more signups by June/);
    assert.match(out, /Move the launch to March/);
    assert.match(out, /Hire before the pilot/);
    assert.match(out, /Nothing is stored/);
    assert.doesNotMatch(out, /## Pattern/);
    assert.equal(lookBack({ records }), out);
  });

  it("scores the calls and names the pattern, with no storage and no judge", () => {
    const happened = [
      "title: Move the launch to March",
      "came_true: no",
      "falsifier_fired: yes",
      "happened: Signups stayed flat.",
      "",
      "title: Hire before the pilot",
      "came_true: yes",
      "falsifier_fired: no",
      "happened: Five pilots paid.",
    ].join("\n");
    const out = lookBack({ records, happened });
    assert.match(out, /Prediction then: more signups by June/);
    assert.match(out, /The doubt matched what happened/);
    assert.match(out, /The falsifier fired/);
    assert.match(out, /Confidence was high, and the call missed/);
    assert.match(out, /The call and the verdict agreed/);
    assert.match(out, /Confidence was low, and the call came true/);
    assert.match(out, /## Pattern/);
    assert.match(out, /2 calls back, 1 came true/);
    assert.match(out, /sat near what happened/);
    assert.match(out, /Where the verdict doubted the call, 1 of 1 missed/);
    assert.match(out, /Where the verdict let the call stand, 1 of 1 came true/);
    assert.match(out, /Read the direction, not a score/);
    assert.match(out, /Nothing is stored/);
    assert.doesNotMatch(out, /badge|streak|points/);
  });

  it("says confidence ran hot when the numbers were surer than the results", () => {
    const hot = [
      "version: 1",
      "date: 2026-09-01",
      "title: First call",
      "verdict: solid",
      "falsifier: a",
      "confidence: 90%",
      "review: 2026-09-15",
      "version: 1",
      "date: 2026-09-02",
      "title: Second call",
      "verdict: solid",
      "falsifier: b",
      "confidence: 80%",
      "review: 2026-09-16",
    ].join("\n");
    const out = lookBack({
      records: hot,
      happened: "title: First call\ncame_true: no\n\ntitle: Second call\ncame_true: no\n",
    });
    assert.match(out, /ran hot/);
    assert.match(out, /Where the verdict let the call stand, 0 of 2 came true/);
  });

  it("flags a call marked true when the falsifier fired", () => {
    const one = "version: 1\ndate: 2026-09-01\ntitle: Raise prices\nverdict: solid if\nfalsifier: churn stays under 4%\nconfidence: 55%\nreview: 2026-10-01\n";
    const out = lookBack({
      records: one,
      happened: "came_true: yes\nfalsifier_fired: yes\nhappened: Churn hit 6% and revenue rose.",
    });
    assert.match(out, /Those two disagree/);
  });

  it("asks about a stated goal and guardrails, and reads a hit that missed the goal", () => {
    const withLines = [
      "version: 1",
      "date: 2026-09-01",
      "title: Outsource QA",
      "prediction: escaped bugs stay flat",
      "verdict: shaky",
      "falsifier: one release with both passes",
      "confidence: 70%",
      "review: 2026-09-15",
      "goal: cut QA cost before June",
      "guardrails: no release without an in-house pass",
    ].join("\n");
    const asked = lookBack({ records: withLines });
    assert.match(asked, /Did you reach the goal\? Yes, no or partly\./);
    assert.match(asked, /Did your guardrails hold\? Yes or no\./);
    assert.match(asked, /goal_met: no/);
    assert.match(asked, /guardrails_held: no/);
    const missed = lookBack({
      records: withLines,
      happened: "title: Outsource QA\ncame_true: yes\nfalsifier_fired: no\ngoal_met: no\nguardrails_held: no\nhappened: Cost fell and a bug shipped.",
    });
    assert.match(missed, /the prediction was right about the wrong target/);
    assert.match(missed, /A guardrail broke\./);
    assert.match(missed, /0 of 1 goals met, 0 of 1 guardrails held/);
    const held = lookBack({
      records: withLines,
      happened: "came_true: yes\ngoal_met: yes\nguardrails_held: yes\nhappened: Cost fell and the pass stayed.",
    });
    assert.doesNotMatch(held, /the prediction was right about the wrong target/);
    assert.match(held, /The goal was reached/);
    assert.match(held, /The guardrails held/);
    assert.match(held, /1 of 1 goals met, 1 of 1 guardrails held/);
    const partly = lookBack({
      records: withLines,
      happened: "came_true: yes\ngoal_met: partly\nguardrails_held: yes\nhappened: Cost fell a little.",
    });
    assert.match(partly, /The goal was partly reached/);
    assert.match(partly, /0 of 1 goals met, 1 of 1 guardrails held/);
    assert.doesNotMatch(partly, /the prediction was right about the wrong target/);
    const declined = "version: 1\ndate: 2026-09-01\ntitle: Ship it\nverdict: solid\nfalsifier: a\nconfidence: 50%\nreview: 2026-10-01\ngoal: not stated\n";
    assert.doesNotMatch(lookBack({ records: declined }), /Did you reach the goal/);
  });

  const oneMiss = [
    "version: 1",
    "date: 2026-09-01",
    "title: Take the job in Denver",
    "prediction: I will still want the job after a month",
    "verdict: solid",
    "falsifier: spend a long weekend there",
    "confidence: 60%",
    "review: 2026-10-01",
  ].join("\n");

  function miss(happened) {
    return lookBack({ records: oneMiss, happened });
  }

  it("reads a miss with an unmarked surprise as the world moving", () => {
    const out = miss("came_true: no\nsurprise: the office closed\nhappened: The office closed in week two.");
    assert.match(out, /It did not come true/);
    assert.match(out, /The world moved in a way the record didn't foresee/);
    assert.match(out, /Surprise: the office closed/);
    assert.doesNotMatch(out, /This was flagged and you went ahead/);
    assert.doesNotMatch(out, /grill the revised plan/i);
    const namedInWords = miss("came_true: no\nsurprise: the challenge and the falsifier both came up");
    assert.match(namedInWords, /The world moved in a way the record didn't foresee/);
    assert.doesNotMatch(namedInWords, /This was flagged and you went ahead/);
    const hit = lookBack({
      records: oneMiss,
      happened: "came_true: yes\nsurprise: a side project took off",
    });
    assert.doesNotMatch(hit, /The world moved in a way the record didn't foresee/);
    assert.doesNotMatch(hit, /This was flagged and you went ahead/);
  });

  it("reads a miss whose surprise the user marked as something the record already named", () => {
    const falsifier = miss("came_true: no\nsurprise: the weekend commute failed | matches falsifier");
    assert.match(falsifier, /This was flagged and you went ahead/);
    assert.match(falsifier, /Surprise: the weekend commute failed/);
    assert.doesNotMatch(falsifier, /The world moved in a way the record didn't foresee/);
    const challenge = miss("came_true: no\nsurprise: a rival opened an office | matches challenge 2");
    assert.match(challenge, /This was flagged and you went ahead/);
    assert.doesNotMatch(challenge, /The world moved in a way the record didn't foresee/);
    const theWord = miss("came_true: no\nsurprise: the weekend commute failed | matches the falsifier");
    assert.match(theWord, /This was flagged and you went ahead/);
    const markOnly = miss("came_true: no\nsurprise: matches challenge 2");
    assert.doesNotMatch(markOnly, /This was flagged and you went ahead/);
    assert.doesNotMatch(markOnly, /The world moved in a way the record didn't foresee/);
  });

  it("reads a miss with no surprise as a plain miss, and does not count surprises", () => {
    const plain = miss("came_true: no\nhappened: It did not work out.");
    assert.match(plain, /It did not come true, and the verdict had let it stand/);
    assert.doesNotMatch(plain, /The world moved in a way the record didn't foresee/);
    assert.doesNotMatch(plain, /This was flagged and you went ahead/);
    assert.doesNotMatch(plain, /Surprise:/);
    assert.doesNotMatch(plain, /grill the revised plan/i);
    const withSurprise = miss("came_true: no\nsurprise: the office closed | still live\nhappened: It did not work out.");
    assert.match(withSurprise, /The world moved in a way the record didn't foresee/);
    assert.match(withSurprise, /Grill the revised plan; the new record will say it replaces this one/);
    assert.equal(plain.split("## Pattern")[1], withSurprise.split("## Pattern")[1]);
    assert.doesNotMatch(withSurprise.split("## Pattern")[1], /surprise|reversal|flagged/i);
    const liveHit = lookBack({
      records: oneMiss,
      happened: "came_true: yes\nsurprise: the office moved | still live",
    });
    assert.match(liveHit, /Grill the revised plan; the new record will say it replaces this one/);
    assert.doesNotMatch(liveHit, /This was flagged and you went ahead/);
  });

  it("names a short source app and does not invent one", () => {
    assert.equal(sourceAppLabel(""), "");
    assert.equal(sourceAppLabel("   "), "");
    assert.equal(sourceAppLabel("Claude by Anthropic"), "claude");
    assert.equal(sourceAppLabel("ChatGPT"), "chatgpt");
    assert.equal(sourceAppLabel("Copilot, which can run OpenAI"), "copilot");
    assert.equal(sourceAppLabel("Gemini"), "gemini");
    assert.equal(sourceAppLabel("Grok"), "grok");
    assert.equal(sourceAppLabel("Muse"), "muse");
    assert.equal(sourceAppLabel("Notes App"), "Notes App");
    const server = readFileSync(join(ROOT, "server/index.mjs"), "utf8");
    assert.doesNotMatch(server, /source_app|sourceApp/);
    assert.match(server, /Goal and Guardrails lines/);
  });

  it("explains the record shape when the paste has none", () => {
    const out = lookBack({ records: "just some notes", happened: "it failed" });
    assert.match(out, /No decision record/);
    assert.match(out, /^date: 2026-09-27$/m);
    assert.equal(parseRecords(out).length, 1);
  });

  it("reads version 1 in any field order and skips every other version", () => {
    const shuffled = "review: 2026-10-01\nconfidence: 55%\nverdict: shaky\ntitle: Raise prices\ndate: 2026-09-01\nversion: 1\n";
    const parsed = parseRecords(shuffled);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].title, "Raise prices");
    assert.equal(parsed[0].version, "1");
    assert.equal(parsed[0].prediction, "");
    const older = "version: 1\ndate: 2026-09-01\ntitle: Raise prices\nverdict: shaky\nfalsifier: a\nconfidence: 70%\nreview: 2026-10-01\n";
    const kept = parseRecords(older);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].title, "Raise prices");
    assert.equal(kept[0].prediction, "");
    assert.deepEqual(kept[0], {
      version: "1",
      date: "2026-09-01",
      title: "Raise prices",
      prediction: "",
      verdict: "shaky",
      falsifier: "a",
      confidence: "70%",
      review: "2026-10-01",
    });
    const withOptional = [
      older.trimEnd(),
      "goal: cut cost",
      "guardrails: keep the in-house pass",
      "source_app: claude",
    ].join("\n");
    const extra = parseRecords(withOptional);
    assert.equal(extra.length, 1);
    assert.equal(extra[0].goal, "cut cost");
    assert.equal(extra[0].guardrails, "keep the in-house pass");
    assert.equal(extra[0].source_app, "claude");
    assert.equal(extra[0].title, "Raise prices");
    const mixed = [
      "version: 2",
      "date: 2026-09-01",
      "title: A later record",
      "verdict: solid",
      "falsifier: later",
      "confidence: 10%",
      "review: 2026-10-01",
      "date: 2026-09-02",
      "title: An old unversioned note",
      "verdict: shaky",
    ].join("\n");
    assert.equal(parseRecords(mixed).length, 0);
    const skipped = lookBack({ records: mixed, happened: "came_true: yes" });
    assert.match(skipped, /record version 2/);
    assert.match(skipped, /version 1 only/);
    assert.doesNotMatch(skipped, /A later record/);
    assert.doesNotMatch(skipped, /## Pattern/);
  });
});

describe("every route carries the footer and the look-back, and the judge prompt does not", () => {
  const skill = [
    readFileSync(join(ROOT, "skills/grill/SKILL.md"), "utf8"),
    readFileSync(join(ROOT, "skills/grill/reflection.md"), "utf8"),
  ].join("\n");
  const prompt = readFileSync(join(ROOT, "prompts/grill.md"), "utf8");
  const paste = readFileSync(join(ROOT, "skills/grill/paste-prompt.md"), "utf8");
  const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
  const server = readFileSync(join(ROOT, "server/index.mjs"), "utf8");

  it("the skill, the paste prompt and the site ask the same three questions", () => {
    for (const [name, text] of [
      ["skill", skill],
      ["prompt", prompt],
      ["page", page],
    ]) {
      for (const question of BEFORE_YOU_DECIDE_QUESTIONS) {
        assert.ok(text.includes(question), `${name} is missing a reflection question`);
      }
      for (const key of ["version: 1", "date:", "title:", "prediction:", "verdict:", "falsifier:", "confidence:", "review:"]) {
        assert.ok(text.includes(key), `${name} is missing the record field ${key}`);
      }
      assert.match(text, /grill-record/, `${name} is missing the record fence`);
      assert.match(text, /look back/i, `${name} has no look-back`);
      assert.match(text, /does not store|keeps nothing|stores nothing|Nothing is stored/i, `${name} does not say nothing is stored`);
    }
    const combined = "What are you trying to achieve, and is there anything this must not cost or break?";
    for (const [name, text] of [
      ["skill", skill],
      ["prompt", prompt],
    ]) {
      assert.ok(text.includes(combined), `${name} is missing the goal and guardrails question`);
      assert.match(text, /never yields/, `${name} lets the prediction question yield`);
      assert.match(text, /just grill it/, `${name} has no skip for just grill it`);
      assert.match(text, /Goal: not stated/, `${name} does not record a declined goal`);
      assert.match(text, /Did you reach the goal\? Yes, no or partly\./);
      assert.match(text, /Did your guardrails hold\? Yes or no\./);
      assert.match(text, /the prediction was right about the wrong target/);
      assert.match(text, /A guardrail broke\./);
    }
    const recordDoc = readFileSync(join(ROOT, "docs/DECISION-RECORD.md"), "utf8");
    assert.match(recordDoc, /## Optional lines/);
    assert.match(recordDoc, /2026-09-29/);
    assert.match(recordDoc, /Version stays 1/);
    for (const [name, text] of [
      ["skill", skill],
      ["prompt", prompt],
      ["page", page],
      ["record", recordDoc],
    ]) {
      assert.match(text, /Did anything happen you didn['\u2019]t expect\?/, name);
      assert.match(text, /the world moved in a way the record didn't foresee/i, name);
      assert.match(text, /this was flagged and you went ahead/i, name);
      assert.match(text, /grill the revised plan; the new record will say it replaces this one/i, name);
      if (name === "page") {
        assert.match(text, /id="surprise"/, name);
        assert.match(text, /surprise\\s\*:/, name);
      } else {
        assert.match(text, /surprise:/, name);
      }
    }
    assert.doesNotMatch(recordDoc, /^decided:|^supersedes:|^changed:/m);
  });

  it("the judge prompt is unchanged: it still opens with the company line and does not write the reflection", () => {
    const lines = paste.split("\n");
    const rules = lines.flatMap((line, index) => (line === "---" ? [index] : []));
    const judge = lines.slice(rules[0] + 1, rules.at(-1)).join("\n");
    assert.match(judge, /^Judge: <model name> by <company>$/m);
    assert.doesNotMatch(judge, /Before you decide/);
    assert.doesNotMatch(judge, /decision record/i);
    assert.ok(prompt.includes(judge));
    assert.match(skill, /Judge: <model name> by <company>/);
    assert.match(server, /grill_look_back/);
    assert.match(server, /appendReflection/);
  });
});
