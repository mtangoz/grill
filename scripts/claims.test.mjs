// Grill has not measured whether a judge from a different company catches more than the
// same model starting fresh. Until it has, public copy does not claim it. And the judge
// is from a different company only when Grill can tell which AI wrote the plan, so public
// copy does not say "never" or "always" about that either.
//
// This file guards the pages, docs, skills and prompt listed below, and the built
// llms.txt that agents read. In llms.txt it also reads sentence by sentence: one that
// says "different company" has to keep the condition. It reads the built about,
// check-your-ai, demo and FAQ pages the same way, as HTML and as their Markdown twins.
// It does not read the hosted tool strings, the judge's notes, or docs/PRINCIPLES.md
// and docs/STRATEGY.md yet.
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

// An agent quotes llms.txt one sentence at a time, so a sentence there that says
// "different company" has to stand on its own. It keeps the condition, or it says what
// has not been measured, or it names the routing check by its plain name.
const STANDS_ALONE = [/\bwhen grill can tell\b/, /\bnot yet measured\b/, /\bnot measured yet\b/, /\bthan the declared author\b/];
// "Another company" says the same thing as "a different company", so it is read the same way.
const COMPANY_CLAIM = /\b(different|another) company\b/;

/** The sentences that say "different company" and would mislead if quoted alone. */
function unconditionalIn(text) {
  return String(text)
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => COMPANY_CLAIM.test(flatten(sentence)))
    .filter((sentence) => !STANDS_ALONE.some((shape) => shape.test(flatten(sentence))));
}

// The built pages this file answers for. Each has a Markdown twin that agents read.
const BUILT_PAGES = ["about", "check-your-ai", "demo", "faq"];

/** What a built page says: styles and scripts dropped, a line break where a block ends, tags removed. */
function pageText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, (block) => (/application\/ld\+json/i.test(block) ? block : " "))
    .replace(/<\/(p|li|h[1-6]|div|title|td|th|dd|dt|summary)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");
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

  it("every llms.txt sentence that says different company keeps the condition", () => {
    // The check itself: the plain claim is caught, and the three honest shapes pass.
    assert.deepEqual(unconditionalIn("You decide. An outside judge, a model from a different company, gives the case against.\nThen stop."), [
      "An outside judge, a model from a different company, gives the case against.",
    ]);
    assert.deepEqual(unconditionalIn("- [GitHub](https://example.com): A model from a Different Company."), [
      "- [GitHub](https://example.com): A model from a Different Company.",
    ]);
    assert.deepEqual(unconditionalIn("When Grill can tell which AI wrote the plan, the judge is from a different company."), []);
    assert.deepEqual(unconditionalIn("Grill’s judge is from a different company when Grill can tell which AI wrote it."), []);
    assert.deepEqual(unconditionalIn("We have not yet measured a judge from a different company against the same model starting fresh."), []);
    assert.deepEqual(unconditionalIn("The judge came from a different company than the declared author in 29 of 29 cases."), []);
    assert.deepEqual(unconditionalIn("The judge did not write your plan. You decide."), []);

    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    assert.match(llms, /different company/, "llms.txt still says when the judge is from a different company");
    assert.deepEqual(unconditionalIn(llms), []);
  });

  it("every sentence on the built pages that says different company keeps the condition, in the HTML and in the Markdown twin", () => {
    // The check itself: the two sentences these pages used to carry are caught, alone and inside
    // a paragraph whose next sentence has the condition. A tag in the middle does not hide one.
    assert.deepEqual(unconditionalIn("A model from another company gives a verdict and one cheap test."), [
      "A model from another company gives a verdict and one cheap test.",
    ]);
    assert.deepEqual(
      unconditionalIn(
        pageText(
          '<h2>Why a second AI helps</h2>\n<p class="note">A second AI from a <em>different company</em> is there to argue the other side. The judge did not write your draft. When Grill can tell which AI did, the judge comes from a different company. When it cannot, the verdict says so.</p>',
        ),
      ),
      ["A second AI from a different company is there to argue the other side."],
    );
    assert.deepEqual(unconditionalIn("An outside judge gives a verdict and one cheap test. A second AI is there to argue the other side."), []);
    assert.deepEqual(unconditionalIn(pageText("<style>p::after { content: 'a different company.'; }</style><p>You decide.</p>")), []);

    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const hits = [];
    let conditional = 0;
    for (const page of BUILT_PAGES) {
      const html = pageText(readFileSync(join(ROOT, "_site", page, "index.html"), "utf8"));
      const md = readFileSync(join(ROOT, "_site", page, "index.md"), "utf8");
      assert.ok(md.length > 200 && html.length > 200, `${page} was built, with its Markdown twin`);
      for (const [file, text] of [[`${page}/index.html`, html], [`${page}/index.md`, md]]) {
        if (COMPANY_CLAIM.test(flatten(text))) conditional += 1;
        for (const sentence of unconditionalIn(text)) hits.push(`${file}: ${sentence}`);
      }
    }
    assert.deepEqual(hits, []);
    // About, check-your-ai and the FAQ still say when the judge is from a different company. The demo does not say it.
    assert.equal(conditional, 6);
  });

  // Only the opening paragraph is read this way so far. The promise list and the paste
  // steps further down the README are not read sentence by sentence yet.
  it("the README's opening paragraph does not say different company without the condition", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const opening = readme.split("\n").filter((line) => line.startsWith("Tell the assistant you think with, "));
    assert.equal(opening.length, 1, "the README opens with how to ask for a grill");
    assert.ok(opening[0].includes("It sends the decision as you said it. An outside judge comes back with a short note: one verdict line,"));
    assert.deepEqual(unconditionalIn(opening[0]), []);
  });
});
