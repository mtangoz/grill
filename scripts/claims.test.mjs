// Grill has not measured whether a judge from a different company catches more than the
// same model starting fresh. Until it has, public copy does not claim it. And the judge
// is from a different company only when Grill can tell which AI wrote the plan, so public
// copy does not say "never" or "always" about that either.
//
// This file guards the pages, docs, skills and prompt listed below, and the built
// llms.txt that agents read. It does not read the hosted tool strings, the judge's
// notes, or docs/PRINCIPLES.md and docs/STRATEGY.md yet.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Each phrase is matched in any letter case, across line breaks and HTML tags.
const ACCURACY_CLAIMS = ["blind spot", "shares your", "correlated with", "biased one", "measurably better", "catches what"];
const ABSOLUTE_INDEPENDENCE = ["commercial interest", "never comes from", "always from a different company"];
const BANNED = [...ACCURACY_CLAIMS, ...ABSOLUTE_INDEPENDENCE];

const PAGES_AND_DOCS = [
  "README.md",
  "docs/WHY.md",
  "prompts/grill.md",
  "site/about.html",
  "site/check-your-ai.html",
  "site/demo.html",
  "site/faq.html",
  // The meta descriptions and the one-line blurbs that go into llms.txt.
  "scripts/build-site.mjs",
];

/** Every Markdown file under skills/, so a new skill file is covered the day it is added. */
function skillFiles(dir = join(ROOT, "skills")) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...skillFiles(path));
    else if (entry.name.endsWith(".md")) found.push(relative(ROOT, path));
  }
  return found.sort();
}

/** Lower case, curly quotes made straight, and every run of white space made one space. */
function flatten(text) {
  return String(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

/** The banned phrases found in a text, read both as written and with HTML tags removed. */
function bannedIn(text) {
  const raw = flatten(text);
  const plain = flatten(String(text).replace(/<[^>]+>/g, " "));
  return BANNED.filter((phrase) => raw.includes(phrase) || plain.includes(phrase));
}

describe("claims Grill does not make before they are measured", () => {
  it("the check itself catches each phrase, in any case, across a line break or a tag", () => {
    assert.equal(BANNED.length, 9);
    for (const phrase of BANNED) {
      assert.deepEqual(bannedIn(`So it ${phrase.toUpperCase()} here.`), [phrase]);
      assert.deepEqual(bannedIn(`So it ${phrase.replace(" ", "\n")} here.`), [phrase]);
      assert.deepEqual(bannedIn(`<p>So it ${phrase.replace(" ", " <em>")}</em> here.</p>`), [phrase]);
    }
    assert.deepEqual(
      bannedIn("The judge never comes from the company behind your AI, so it won’t share its blind spots."),
      ["blind spot", "never comes from"],
    );
    assert.deepEqual(bannedIn("It helped you think it through, so its critique shares your blind spots."), ["blind spot", "shares your"]);
    assert.deepEqual(bannedIn("The judge did not write your plan. Whether it catches more is not measured yet."), []);
  });

  it("public copy does not claim the judge is more accurate before it is measured", () => {
    const files = [...PAGES_AND_DOCS, ...skillFiles()];
    assert.ok(files.includes("skills/grill/SKILL.md") && files.includes("skills/weekly-review/SKILL.md"), "the two skills are read");
    const hits = [];
    for (const file of files) {
      for (const phrase of bannedIn(readFileSync(join(ROOT, file), "utf8"))) hits.push(`${file}: "${phrase}"`);
    }
    assert.deepEqual(hits, []);
  });

  it("the built llms.txt, which agents quote, does not make those claims either", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    assert.match(llms, /^## FAQ$/m, "llms.txt carries the FAQ answers");
    assert.deepEqual(bannedIn(llms), []);
  });
});
