// The FAQ is plain HTML, and the same answers are in /llms.txt for agents.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsSnippet } from "./siteAnalytics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const faqPath = join(ROOT, "site/faq.html");

const QUESTIONS = [
  "How is Grill different from a pre-mortem or a decision matrix?",
  "How is Grill different from asking the same AI again?",
  "How is Grill different from a crux finder, such as Cruxes?",
  "Where does Grill work?",
  "Are there benchmarks?",
];

const ANSWERS = [
  "A pre-mortem imagines the plan has already failed and asks why. A decision matrix scores options on criteria you pick. Grill sends the decision, in your words, to a model from a different company. You get a verdict, the sharpest challenge, one cheap test, and the one question whose answer would change the call. You still decide.",
  "Asking the same assistant to critique its own draft uses the same company, and often the same model, that wrote it. Grill’s judge is from a different company, so it does not share that blind spot. A second pass in the same chat is a same-model check. It is not a grill.",
  "A crux finder, such as Cruxes at cruxes.io, looks for the one question that would change a decision, and it can quote your own words. Grill does that too, in one short line after the verdict. Grill also gives a verdict from a different company and one cheap test. Cruxes is built for a team or an agent, with a decision owner, and it runs in Claude Code, Claude and Google Docs. Grill is one person and one decision, and the call stays yours. They overlap, and neither replaces the other.",
  "Live. Copy and paste into ChatGPT, Copilot, Gemini, Grok or Muse. The Claude skill, Claude Desktop and Claude Code. Cursor, VS Code and npx.",
  "Preview. Grill in chat is invite-only. Claude.ai, ChatGPT and Grok Bot are verified working for people who were invited. Gemini should work and is still being tested: US only, a personal Google account, Keep Activity on.",
  "Planned. Meta AI in chat is coming soon. Saved history and look-back reminders are coming later. The free tool stays free.",
  "No benchmarks are published. Examples on this site use invented numbers. They are not a benchmark.",
];

function textOf(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("the FAQ", () => {
  it("answers in plain language, with honest status labels, and no script", () => {
    assert.ok(existsSync(faqPath), "site/faq.html exists");
    const faq = readFileSync(faqPath, "utf8");
    const about = readFileSync(join(ROOT, "site/about.html"), "utf8");
    assert.match(faq, /^<title>Questions about Grill \| Grill<\/title>/);
    assert.doesNotMatch(faq, /<script/i);
    assert.doesNotMatch(faq, /onclick=|javascript:/i);
    assert.equal((faq.match(/<h1>/g) || []).length, 1);
    const nav = (html) => html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0];
    assert.equal(nav(faq), nav(about));
    const plain = textOf(faq);
    for (const question of QUESTIONS) assert.ok(plain.includes(question), question);
    for (const answer of ANSWERS) assert.ok(plain.includes(answer), answer);
    assert.match(faq, /<strong>Live\.<\/strong>/);
    assert.match(faq, /<strong>Preview\.<\/strong>/);
    assert.match(faq, /<strong>Planned\.<\/strong>/);
    assert.doesNotMatch(plain, /worse than|better than|inferior|beats Cruxes|behind Cruxes/i);
    const home = readFileSync(join(ROOT, "site/page.html"), "utf8");
    assert.match(home, /href="\/faq\/"/);
  });

  it("copies the same answers into llms.txt after the page list, and the page has no script of its own", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const built = readFileSync(join(ROOT, "_site/faq/index.html"), "utf8");
    const rest = built.replace(analyticsSnippet(process.env), "");
    assert.equal(rest.match(/<script\b/gi)?.length ?? 0, 0, "/faq has a script of its own");
    assert.match(readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8"), /https:\/\/grillyour\.ai\/faq\//);
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    const pagesAt = llms.indexOf("## Pages\n");
    const faqAt = llms.indexOf("## FAQ\n");
    assert.ok(pagesAt > 0 && faqAt > pagesAt, "FAQ comes after the page list");
    assert.match(llms, /\[FAQ\]\(https:\/\/grillyour\.ai\/faq\/\):/);
    const plain = textOf(readFileSync(faqPath, "utf8"));
    const section = llms.slice(faqAt);
    for (const question of QUESTIONS) assert.ok(section.includes(question), question);
    for (const answer of ANSWERS) {
      assert.ok(plain.includes(answer), answer);
      assert.ok(section.includes(answer), `llms.txt is missing: ${answer}`);
    }
    const when = llms.slice(llms.indexOf("## When to use Grill\n"), pagesAt);
    assert.equal((when.match(/^- /gm) || []).length >= 3 && (when.match(/^- /gm) || []).length <= 5, true);
  });
});
