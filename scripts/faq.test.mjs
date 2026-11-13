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
  "A pre-mortem imagines the plan has already failed and asks why. A decision matrix scores options on criteria you pick. Grill sends the decision, in your words, to an outside judge. When Grill can tell which AI wrote the plan, the judge is from a different company. You get a verdict, the sharpest challenge, one cheap test, and the one question whose answer would change the call. You still decide.",
  "Asking the same assistant to critique its own draft uses the same company, and often the same model, that wrote it. Grill’s judge is from a different company when Grill can tell which AI wrote it. A second pass in the same chat is a same-model check. It is not a grill.",
  "A crux finder, such as Cruxes at cruxes.io, looks for the one question that would change a decision, and it can quote your own words. Grill does that too, in one short line after the verdict. Grill also gives a verdict from an outside judge and one cheap test. Cruxes is built for a team or an agent, with a decision owner, and it runs in Claude Code, Claude and Google Docs. Grill is one person and one decision, and the call stays yours. They overlap, and neither replaces the other.",
  "Live. Copy and paste into ChatGPT, Copilot, DeepSeek, Gemini, Grok or Muse. No install, no key. The Claude skill, Claude Desktop and Claude Code. Cursor, VS Code and npx. Anyone can sign up for Grill in chat. Claude.ai, ChatGPT and Grok Bot are verified working. In Claude, open Customize → Connectors → Add custom connector and paste https://grillyour.ai/mcp. Asking Claude in a chat to connect it does not work.",
  "Preview. Adding Grill as a connector inside Gemini or Muse is not verified. You can try it. Gemini: US only, a personal Google account, Keep Activity on. Muse: the steps are in the README.",
  "Planned. No further way in is listed here. The free tool stays free.",
  "If you say yes to keeping records, choices you make are saved at grillyour.ai/decisions (Your grills), with a 14-day look-back and an optional calendar link. You can also say \"look back\" in chat. It stays private, and off until you opt in.",
  "No. Whether an outside judge catches more than the same model starting fresh is not measured yet. Grill’s weekly check of its judge is a regression check on made-up cases. Those cases were used to write the judge’s instructions, so a full score says nothing about how good the judge is. The counts from that check, and what has not been measured, are at grillyour.ai/how-we-test/ (How Grill tests its judge). Examples on this site use invented numbers. They are not a benchmark.",
];

// The page lede. The one-line summary the build gives the page, in its head and in llms.txt,
// is checked on a built page in scripts/howWeTest.test.mjs.
const LEDE = "Plain answers, including what has not been measured yet.";

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
    assert.doesNotMatch(plain, /Saved history and look-back reminders are coming later/);
    assert.doesNotMatch(plain, /worse than|better than|inferior|beats Cruxes|behind Cruxes/i);
    const support = readFileSync(join(ROOT, "site/support.html"), "utf8");
    assert.match(support, /href="\/faq\/"/);
  });

  // The benchmarks answer is copied into llms.txt, so it is what an assistant quotes. It says what
  // has and has not been measured, claims no result, and sends the reader to the page with the counts.
  //
  // This test reads the page source and nothing that was built. The built page, its Markdown
  // twin and llms.txt are checked in scripts/howWeTest.test.mjs, which builds in a folder of its
  // own. A build here goes into _site, where other test files build at the same time, so what
  // is read back from it is not always this test's own build. A test there fails if a built
  // file is read here.
  it("says what has and has not been measured, and points at /how-we-test/ for the counts", () => {
    const faq = readFileSync(faqPath, "utf8");
    assert.ok(faq.includes(`<p class="lede">${LEDE}</p>`));
    const answer = faq.slice(faq.indexOf("<h2>Are there benchmarks?</h2>"), faq.indexOf('<div class="footer">'));
    assert.equal((answer.match(/<p class="note">/g) || []).length, 1, "one answer under the last question");
    assert.equal(textOf(answer), `Are there benchmarks? ${ANSWERS[7]}`);
    assert.ok(answer.includes('are at <a href="/how-we-test/">grillyour.ai/how-we-test/</a> (How Grill tests its judge).'));
    assert.ok(existsSync(join(ROOT, "site/how-we-test.html")), "the page it points at exists");
    assert.ok(ANSWERS[7].startsWith("No. Whether an outside judge catches more than the same model starting fresh is not measured yet."));
    const plain = textOf(faq);
    assert.doesNotMatch(plain, /No benchmarks are published/);
    assert.doesNotMatch(plain, /%|\bpercent\b/i, "the FAQ quotes no rate");
    assert.doesNotMatch(ANSWERS[7], /\d/, "the counts live on the page, not in the answer");
    assert.doesNotMatch(ANSWERS[7], /different company|accura|guarantee|proves?\b|outperform|more reliable/i);
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
