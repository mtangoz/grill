// When the assistant grills a plan it wrote itself, the person should see what Grill changed:
// the revised plan, each challenge and what was done about it, and the verdict before and after.
// These rules go in every place the assistant reads: the installed tool, the hosted tool, both
// sets of server instructions, and the skill. They never add a question before the verdict.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGrillTools } from "../server/index.mjs";
import { HOSTED_INSTRUCTIONS, hostedTools } from "./hostedCore.mjs";
import { OWN_PLAN_RULE } from "./judgeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = readFileSync(join(ROOT, "server/index.mjs"), "utf8");
const SKILL = readFileSync(join(ROOT, "skills/grill/SKILL.md"), "utf8");

const surfaces = () => ({
  "installed grill tool": buildGrillTools({ checkOn: true })[0].description,
  "installed grill tool (author guessed)": buildGrillTools({ checkOn: false, authorGuessed: true })[0].description,
  "hosted grill tool": hostedTools()[0].description,
  "hosted instructions": HOSTED_INSTRUCTIONS,
});

describe("show what Grill changed on the assistant's own plan", () => {
  it("names the trigger: a plan or recommendation the assistant wrote", () => {
    assert.match(OWN_PLAN_RULE, /plan or recommendation you wrote/);
  });

  it("revises after the verdict and shows the revised plan with a What Grill changed section", () => {
    assert.match(OWN_PLAN_RULE, /after the run note/);
    assert.match(OWN_PLAN_RULE, /revise/);
    assert.match(OWN_PLAN_RULE, /What Grill changed/);
    assert.match(OWN_PLAN_RULE, /each challenge/);
    assert.match(OWN_PLAN_RULE, /why you kept/);
    assert.match(OWN_PLAN_RULE, /verdict before/);
  });

  it("keeps the verdict first, sends the plan as written, and asks the person nothing", () => {
    assert.match(OWN_PLAN_RULE, /Relay Grill's result first, as written/);
    assert.match(OWN_PLAN_RULE, /send the plan as you wrote it/i);
    assert.match(OWN_PLAN_RULE, /Do not ask the person anything/);
    assert.doesNotMatch(OWN_PLAN_RULE, /before the verdict/);
  });

  it("does not let the assistant pass its own grading off as Grill's", () => {
    assert.match(OWN_PLAN_RULE, /your own summary, not Grill's verdict/);
  });

  it("makes no accuracy claim about the second model", () => {
    assert.doesNotMatch(OWN_PLAN_RULE, /catches what|blind spot|missed/i);
  });

  for (const [where, text] of Object.entries(surfaces())) {
    it(`is in the ${where}`, () => {
      assert.ok(text.includes(OWN_PLAN_RULE), where);
    });
  }

  it("is in the installed server's instructions", () => {
    assert.match(SERVER, /OWN_PLAN_RULE,\n\s*SCOPE_GUARD|SCOPE_GUARD,\n\s*OWN_PLAN_RULE/);
    assert.match(SERVER, /`\$\{OWN_PLAN_RULE\} ` \+/);
  });

  it("is in the skill, with the same section name", () => {
    assert.match(SKILL, /\*\*Your own plan:\*\*/);
    assert.match(SKILL, /What Grill changed/);
  });
});
