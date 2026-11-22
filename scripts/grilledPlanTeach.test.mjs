// Teach the second way to use Grill: let the AI make the plan, grill it until it is solid,
// and show what Grill changed. The work-decision starter (experiment 2) stays as it is.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const PLAN_STARTER = "Make a plan to hit our launch date, grill it until it's solid, and show me what Grill changed.";

describe("the grilled-plan starter", () => {
  it("sits on /start under the work-decision starter, with its own copy button", () => {
    const start = read("site/start.html");
    assert.ok(start.includes(`<p id="starter-plan">${PLAN_STARTER}</p>`));
    assert.match(start, /<button class="button" type="button" id="copy-starter-plan">Copy<\/button>/);
    assert.ok(start.indexOf('id="starter-prompt"') < start.indexOf('id="starter-plan"'), "the experiment-2 starter stays first");
    assert.ok(start.includes("Grill this: ChatGPT says I should move our launch up two weeks to beat a competitor. Should I tell my boss we can do it?"));
    assert.match(start, /getElementById\("copy-starter-plan"\), document\.getElementById\("starter-plan"\)/);
  });

  it("is in the README and the any-app guide, with the reason in plain words", () => {
    for (const path of ["README.md", "docs/ANY-APP.md"]) {
      const text = read(path);
      assert.ok(text.includes(PLAN_STARTER), path);
      assert.match(text, /improves the first answer your AI gives you/, path);
    }
  });

  it("is logged as its own experiment, so its effect is not read as experiment 2's", () => {
    const loop = read("docs/experiments/analytics-loop.md");
    assert.match(loop, /3\. \*\*A grilled-plan starter on \/start\.\*\*/);
  });
});
