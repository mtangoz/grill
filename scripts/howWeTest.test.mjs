// /how-we-test/ says what Grill has and has not measured about its judge. The numbers on it
// come from data/results.json when the site is built, through scripts/resultsCore.mjs.
//
// Every test here reads a BUILT page, its Markdown twin, and llms.txt where that matters.
// The site is built in a scratch copy of the files the build reads, so these tests never
// share _site with the other test files, and a test can break its own copy to prove the
// build stops. Three copies are built:
//   - the tree as committed, to check the page a visitor gets today;
//   - the same tree with the results file as first recorded on 2026-11-13, so the exact
//     figures can be pinned without a test edit each time a new run is added;
//   - the same tree with a later run and a measured comparison, to check those branches.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latestRun, renderResults, validateResults } from "./resultsCore.mjs";
import { START_REF_LABELS } from "./weeklyMetricsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const committedResults = () => JSON.parse(read("data/results.json"));

const URL_PATH = "how-we-test/";
const CANONICAL = `https://grillyour.ai/${URL_PATH}`;
const TITLE = "How Grill tests its judge | Grill";
const H1 = "How Grill tests its judge.";
const LEDE = "Not measured yet: whether an outside judge catches more than the same model starting fresh.";
const DESCRIPTION = `${LEDE} What Grill has measured so far, as counts.`;
const BLURB = `${LEDE} What has been measured, as counts: a weekly regression check, one held-out check of a candidate rule, and how many people use Grill.`;
const RULE = "The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. When it cannot, the verdict says so.";
const CTA = '<p class="cta"><a class="button" href="/start/?ref=how-we-test">Connect Grill</a></p>';
const SOURCE = "https://github.com/mtangoz/grill";

/** An en dash or an em dash, built from code points so this file holds neither. */
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** The results file as first recorded: the one measured run of 2026-11-13 and what went with it. */
const firstRecorded = () => ({
  version: 1,
  updated: "2026-11-13",
  users: { real: 1, as_of: "2026-11-09", evidenced_lookbacks: 0 },
  regression: {
    runs: [
      {
        date: "2026-11-13",
        run_id: 43354935479,
        commit: "303a77f",
        cases: 29,
        reached_judge: 29,
        flawed: { caught: 15, of: 15 },
        wrong_figure: { caught: 4, of: 4 },
        loaded: { caught: 4, of: 4 },
        sound: { false_alarms: 2, of: 6 },
        schema_violations: { k: 0, of: 29 },
        different_company: { k: 29, of: 29 },
        quotes: { found: 84, of: 94 },
        semantic: { caught: 22, of: 23 },
        by_company: [
          { company: "google", cases: 8 },
          { company: "openai", cases: 14 },
          { company: "deepseek", cases: 3 },
          { company: "minimax", cases: 2 },
          { company: "moonshotai", cases: 2 },
        ],
      },
    ],
    not_measured: ["2026-11-02", "2026-11-09"],
    skipped_green: ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"],
  },
  holdouts: [
    { id: "v1", status: "run", date: "2026-11-09", decided: 15, candidate_wins: 9, rule_on: false },
    { id: "v2", status: "not-run" },
  ],
  four_arm: { status: "draft", arms: [], comparisons: [] },
  signals: { rated: 0, resolved: 0 },
  account_lookbacks: { status: "not-counted" },
});

/**
 * Every line a reader sees on the page built from that file, in order, from the heading to
 * the footer. A link is its words. This is the whole page: a sentence that is not here is
 * not on the page, so a new claim cannot be added without this text being changed with it.
 */
const FIRST_PAGE_TEXT = [
  "How Grill tests its judge.",
  "Not measured yet: whether an outside judge catches more than the same model starting fresh.",
  "What has not been measured yet",
  "Grill sends your plan to an outside judge. We have not measured whether that judge catches more than the model that wrote the plan would, starting fresh with no chat behind it. Until that is measured, Grill does not claim it. This page shows what has been measured, as counts, and says what has not.",
  "What is true by rule",
  "The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. When it cannot, the verdict says so. That is a rule about who the judge is. It is not a result about how well it judges.",
  "The comparison with the same model starting fresh",
  "Draft protocol, not run. Grill has written a plan for one measurement and has not run it. Any part of the plan can still change. It would give the same made-up write-ups to four ways of getting the case against a plan, and count how many planted flaws each one catches:",
  "The same chat. The model that wrote the plan is asked, in the same chat, to argue the other side.",
  "The same model, starting fresh. The same model gets the plan in a new chat, with the instructions Grill gives its judge.",
  "A stronger model from the same company. A stronger model from the company that wrote the plan gets it with those same instructions.",
  "Grill as shipped. The router picks the judge, and the company that wrote the plan is left out.",
  "The main question is whether Grill as shipped catches more planted flaws than the same model starting fresh. The result will be published here whichever way it falls. Read the draft protocol.",
  "A weekly regression check, not a measure of quality",
  "Grill's weekly check runs its judge on a public set of made-up cases. Some hold a planted flaw, some ask a loaded question, and some are sound plans. The check can show the judge going quiet or breaking its output rules. It cannot rank one critic against another.",
  "One run is shown, the latest that measured: 13 November 2026, commit 303a77f, Actions run 43354935479. All 29 cases reached a judge.",
  "Caught. The judge caught 19 of 19 flawed plans and 4 of 4 loaded questions, but these 29 cases were used to write the judge's instructions, so a full score says nothing about how good the judge is.",
  "False alarms. 2 of 6 sound plans got a false alarm. That is too few plans to say what the real rate is.",
  "Quotes not found. 10 of 94 quotes the judge gave were not found in the write-up they were quoted from.",
  "Output rules. 0 of 29 answers broke the output rules.",
  "A second reading. A separate quality check read the judge's answers and found the planted flaw named in 22 of 23 cases. These are the same cases, so this says nothing about how good the judge is either.",
  "Routing. The judge came from a different company than the declared author in 29 of 29 cases. That is a routing check. It is not a measure of whether the two make different mistakes. This check names no author, so the default applies and the author is taken to be Anthropic.",
  "Judge companies. The router picked the judge for each case. Cases by the company whose model answered: Google 8, OpenAI 14, DeepSeek 3, MiniMax 2, Moonshot AI 2.",
  "Weeks that measured nothing. The weekly runs on 2 November 2026 and 9 November 2026 failed as not measured. The runs on 28 September 2026, 5 October 2026, 12 October 2026, 19 October 2026 and 26 October 2026 passed while skipping every case, so a pass on those days measured nothing.",
  "A held-out check of one candidate rule",
  "It compared two judges on the same decisions: one with today's instructions, and one with the same instructions plus one candidate rule. A rater who could not see which was which said which answer would change what you do next.",
  "Version 1. Run on 9 November 2026. Of 15 decided pairs, the candidate rule won 9. If the two were equally good, the candidate would win that often or more about 30 times in 100. The rule stayed off.",
  "Version 2. Not run.",
  "People",
  "Real users. 1, as of 9 November 2026. What counts as a real user is set out in Grill's strategy notes.",
  "Evidenced look-backs. 0, as of the same day. What counts as one is set out in Grill's principles.",
  "Look-backs saved on Grill accounts. Not counted yet. This is a separate count from evidenced look-backs, and the two are never added together.",
  "Signals. 0 rated, 0 resolved. A signal is a short report a person chooses to send through a public form: a rating of one grill, or whether a call came true.",
  "The counts on this page were last updated on 13 November 2026.",
  "Connect Grill",
  "Open source · Contribute · GitHub · Privacy · About · Contact",
  "Made at Hold",
].join("\n");

/** A later state: a second run where two cases reached no judge, and a measured comparison. */
const laterState = () => {
  const file = firstRecorded();
  file.updated = "2026-11-20";
  file.regression.runs.push({
    date: "2026-11-16",
    run_id: 43400000001,
    commit: "0123abc",
    cases: 29,
    reached_judge: 27,
    flawed: { caught: 14, of: 15 },
    wrong_figure: { caught: 4, of: 4 },
    loaded: { caught: 3, of: 4 },
    sound: { false_alarms: 1, of: 6 },
    schema_violations: { k: 1, of: 29 },
    different_company: { k: 27, of: 29 },
    quotes: { found: 80, of: 90 },
    semantic: { caught: 20, of: 23 },
    by_company: [
      { company: "google", cases: 20 },
      { company: "other", cases: 7 },
    ],
  });
  file.four_arm = {
    status: "measured",
    date: "2026-11-20",
    commit: "0123abc",
    cases: { flawed: 120, sound: 40, loaded: 20 },
    arms: [
      { arm: "fresh-brief", caught: 80, flawed: 120, caught_usable: 80, usable_flawed: 119, alarms: 10, sound: 40, unusable: 1 },
      { arm: "product", caught: 95, flawed: 120, caught_usable: 95, usable_flawed: 117, alarms: 3, sound: 8, unusable: 4 },
    ],
    comparisons: [
      { first: "product", second: "fresh-brief", both: 70, first_only: 25, second_only: 10, neither: 15, usable_both: 68, usable_first_only: 22, usable_second_only: 9, usable_neither: 12 },
    ],
    single_drafter: true,
  };
  return validateResults(file);
};

// ---------------------------------------------------------------------------
// Building in a scratch copy.

/** The files a script loads from its own folder tree, by following its relative imports. */
function withImports(entry, found = new Set()) {
  if (found.has(entry)) return found;
  found.add(entry);
  const source = read(entry);
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) {
    withImports(join(dirname(entry), match[1]), found);
  }
  return found;
}

const scratchDirs = [];

/** A scratch copy of everything the site build reads. `change(dir)` may edit it before it is built. */
function scratchTree(change = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "grill-how-we-test-"));
  scratchDirs.push(dir);
  cpSync(join(ROOT, "site"), join(dir, "site"), { recursive: true });
  cpSync(join(ROOT, "data"), join(dir, "data"), { recursive: true });
  for (const file of withImports("scripts/build-site.mjs")) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(ROOT, file), join(dir, file));
  }
  change(dir);
  return dir;
}

/** Run the copied build. Deploy and feature switches from the shell are left out, so every build is the plain one. */
function buildIn(dir, extra = {}) {
  const env = { ...extra };
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(GRILL_|VERCEL_)/.test(name)) env[name] = value;
  }
  Object.assign(env, extra);
  execFileSync(process.execPath, [join(dir, "scripts", "build-site.mjs")], { env, stdio: "pipe" });
  const out = (file) => readFileSync(join(dir, "_site", file), "utf8");
  return { html: out(`${URL_PATH}index.html`), md: out(`${URL_PATH}index.md`), llms: out("llms.txt"), sitemap: out("sitemap.xml"), out };
}

/** The build's error text when it stops, or null when it builds. */
function buildFailure(dir) {
  try {
    buildIn(dir);
    return null;
  } catch (err) {
    return `${err.stderr ?? ""}`;
  }
}

const withResultsFile = (json) => (dir) => writeFileSync(join(dir, "data", "results.json"), `${JSON.stringify(json, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Reading a built page.

const decode = (text) =>
  text
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The page's own markup: from <main to </main>, without the shared head, styles and analytics. */
const mainOf = (html) => {
  const from = html.indexOf('<main id="top"');
  const to = html.indexOf("</main>", from);
  assert.ok(from > 0 && to > from, "the built page has a <main>");
  return html.slice(from, to);
};

/** What a reader sees in a piece of HTML: one line a block, tags removed, entities decoded. */
const textOf = (html) =>
  decode(
    html
      .replace(/<\/(p|li|h[1-6]|div|ul)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/[ \t]+/g, " "),
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

/** The page from its heading to the end of <main>: all of it but the shared header. */
const fromHeading = (html) => {
  const main = mainOf(html);
  const at = main.indexOf("<h1>");
  assert.ok(at > 0, "the built page has an <h1>");
  return main.slice(at);
};

/** The shared header: what <main> holds above the heading. */
const headerOf = (html) => {
  const main = mainOf(html);
  return main.slice(0, main.indexOf("<h1>"));
};

/** One section of the built HTML: from its <h2> to the next <h2>, or to the call to action. */
function htmlSection(html, heading) {
  const main = mainOf(html);
  const from = main.indexOf(`<h2>${heading}</h2>`);
  assert.ok(from >= 0, `the page has the section "${heading}"`);
  const rest = main.slice(from + 4);
  const ends = [rest.indexOf("<h2>"), rest.indexOf('<p class="cta">')].filter((at) => at >= 0);
  return main.slice(from, from + 4 + Math.min(...ends));
}

/** The same section of the Markdown twin: from its "## " line to the next one, or to the call to action. */
function mdSection(md, heading) {
  const from = md.indexOf(`## ${heading}\n`);
  assert.ok(from >= 0, `the Markdown twin has the section "${heading}"`);
  const rest = md.slice(from + 3);
  const ends = [rest.indexOf("\n## "), rest.indexOf("\n[Connect Grill]")].filter((at) => at >= 0);
  return md.slice(from, from + 3 + Math.min(...ends));
}

/** The items of the first list in a section of HTML, as text. */
const itemsOf = (sectionHtml) => {
  const list = sectionHtml.match(/<ul class="steps">([\s\S]*?)<\/ul>/);
  assert.ok(list, "the section has a list");
  return [...list[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
};

/** The Markdown twin's text with its link targets and emphasis marks removed, to compare with the page's text. */
const mdText = (md) =>
  md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^- /gm, "")
    .replace(/[ \t]+/g, " ");

/** The whole Markdown twin as the lines a reader sees: its heading marks are removed as well. */
const twinLines = (md) =>
  mdText(md)
    .split("\n")
    .map((line) => line.replace(/^#{1,6} /, "").trim())
    .filter(Boolean)
    .join("\n");

const SECTIONS = {
  notMeasured: "What has not been measured yet",
  rule: "What is true by rule",
  comparison: "The comparison with the same model starting fresh",
  weekly: "A weekly regression check, not a measure of quality",
  heldOut: "A held-out check of one candidate rule",
  people: "People",
};

// Words and claims this page must never carry. The first group is the plan's list for all public copy.
const NEVER = [
  "blind spot",
  "shares your",
  "correlated with",
  "biased one",
  "measurably better",
  "commercial interest",
  "does not answer to the same company",
  "never comes from",
  "always from a different company",
  "sees none of your chat",
  "has no memory of you",
  "if you say no, nothing is kept",
  "in memory only",
  "nothing is kept",
  "catches what",
  "guarantee",
  "decorrelat",
  "pre-regist",
  "preregist",
  "accuracy",
  "accurate",
  "benchmark",
];
/** Words that would be a model's name, not a company's. */
const MODEL_WORDS = /\b(gpt|claude|gemini|gemma|llama|qwen|kimi|glm|grok|sonnet|opus|haiku|jev|terra)\b/i;

// A sentence that says "different company" has to stand on its own when it is quoted:
// it keeps the condition, or it names the routing check by its plain name.
const STANDS_ALONE = [/\bwhen grill can tell\b/i, /\bnot measured yet\b/i, /\bthan the declared author\b/i];
const unconditional = (text) =>
  text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .filter((sentence) => /\b(different|another) company\b/i.test(sentence))
    .filter((sentence) => !STANDS_ALONE.some((shape) => shape.test(sentence)));

let today; // built from the tree as committed
let first; // built with the results file as first recorded
let later; // built with a later run and a measured comparison

before(() => {
  today = buildIn(scratchTree());
  first = buildIn(scratchTree(withResultsFile(firstRecorded())));
  later = buildIn(scratchTree(withResultsFile(laterState())));
});

after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("the /how-we-test page", () => {
  it("is a script-free prose page in the shared chrome, with one marker for the results", () => {
    const source = read("site/how-we-test.html");
    const about = read("site/about.html");
    assert.ok(source.startsWith(`<title>${TITLE}</title>\n`));
    assert.doesNotMatch(source, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script|<table|<dl[\s>]|onclick=|javascript:/i);
    assert.equal((source.match(/<h1>/g) ?? []).length, 1);
    assert.ok(source.includes(`<h1>${H1}</h1>`));
    // The header and the footer are the about page's, byte for byte.
    const header = (html) => html.slice(html.indexOf('<main id="top" class="prose">'), html.indexOf("  <h1>"));
    const footer = (html) => html.slice(html.indexOf('  <div class="footer">'));
    assert.ok(header(about).includes('<nav aria-label="Sections">') && footer(about).includes("Made at"), "the about page still has both");
    assert.equal(header(source), header(about));
    assert.equal(footer(source), footer(about));
    assert.equal(source.split("<!-- RESULTS -->").length - 1, 1, "the results marker is there once");
    assert.doesNotMatch(source, LONG_DASH);
    const classes = new Set([...source.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
    assert.deepEqual([...classes].sort(), ["button", "cta", "footer", "lede", "mark", "note", "prose", "top"]);
    // Nothing in the source is a count: every number on the page comes from the results file.
    const prose = source.slice(source.indexOf("<h1>"), source.indexOf('<div class="footer">')).replace(/<\/?h[12]>/g, "");
    assert.doesNotMatch(prose, /\d/, "the page source holds no number of its own");
  });

  it("builds to /how-we-test/ with a Markdown twin, the results in place, and no script of its own", () => {
    for (const built of [today, first, later]) {
      assert.match(built.html, new RegExp(`<title>${TITLE.replace(/[|]/g, "\\|")}</title>`));
      assert.ok(built.html.includes(`<link rel="canonical" href="${CANONICAL}">`));
      assert.ok(built.html.includes(`<meta property="og:url" content="${CANONICAL}">`));
      assert.ok(built.html.includes(`<meta property="og:title" content="${TITLE}">`));
      assert.match(built.html, /--paper:/, "the page borrows the site's styles");
      assert.ok(!built.html.includes("<!-- RESULTS -->") && !built.md.includes("RESULTS"), "the marker is gone");
      assert.equal((built.html.match(/<h1>/g) ?? []).length, 1);
      assert.ok(built.md.startsWith(`# ${H1}\n`));
      assert.doesNotMatch(mainOf(built.html), /<script|<style|<table/i);
      assert.doesNotMatch(built.html, /application\/ld\+json/i);
      assert.ok(built.sitemap.includes(`<loc>${CANONICAL}</loc>`));
    }
    // The page a visitor gets is built from the committed file, by the renderer, and from nothing else.
    assert.ok(today.html.includes(renderResults(committedResults())), "today's page carries the committed results");
    assert.ok(first.html.includes(renderResults(firstRecorded())));
    // The twin says what the page says, section for section.
    for (const built of [today, first, later]) {
      const pageHeadings = [...mainOf(built.html).matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => decode(match[1]));
      const twinHeadings = [...built.md.matchAll(/^## (.*)$/gm)].map((match) => match[1]);
      assert.deepEqual(pageHeadings, Object.values(SECTIONS));
      assert.deepEqual(twinHeadings, pageHeadings);
      for (const heading of pageHeadings) {
        const page = textOf(htmlSection(built.html, heading)).replace(/\s+/g, " ");
        const twin = mdText(mdSection(built.md, heading)).replace(/^## /, "").replace(/\s+/g, " ").trim();
        assert.equal(twin, page, `the twin's "${heading}" section says what the page says`);
      }
    }
  });

  it("says these lines and no others, on the page and in its Markdown twin", () => {
    // The whole reader-visible text, compared as one piece. Any sentence added to
    // site/how-we-test.html, or to what the renderer writes for this file, fails here.
    assert.equal(textOf(fromHeading(first.html)), FIRST_PAGE_TEXT);
    assert.equal(twinLines(first.md), FIRST_PAGE_TEXT);
    for (const built of [today, first, later]) {
      // The twin says, line for line, what the page says, whatever the results file holds.
      assert.equal(twinLines(built.md), textOf(fromHeading(built.html)));
      // Above the heading there is only the shared header, the same markup as on the about page.
      assert.ok(headerOf(built.html).includes('<nav aria-label="Sections">'));
      assert.equal(headerOf(built.html), headerOf(built.out("about/index.html")));
      // And nothing a reader sees is written outside <main>.
      const body = built.html.slice(built.html.indexOf("<body"), built.html.indexOf("</body>"));
      assert.ok(body.startsWith("<body"), "the built page has a <body>");
      assert.equal(textOf(body.replace(/<main[\s\S]*<\/main>/, "").replace(/<script\b[\s\S]*?<\/script>/gi, "")), "");
    }
  });

  it("with a later run and a measured comparison, changes these lines and adds no others", () => {
    const firstLines = FIRST_PAGE_TEXT.split("\n");
    const laterLines = textOf(fromHeading(later.html)).split("\n");
    // Every line of the later page is one the first page has, or one of these.
    assert.deepEqual(
      laterLines.filter((line) => !firstLines.includes(line)),
      [
        "Measured. The comparison ran on 20 November 2026, at commit 0123abc, on 120 flawed plans, 40 sound plans and 20 loaded questions. Every case is made up. It gave the same write-ups to these ways of getting the case against a plan:",
        "What follows is counts. Where 10 cases or more are behind a count, its share out of 100 is shown, with the range the true share is likely to sit in. Under 10, the count is shown alone. This page does not say which one did best: the protocol sets out how the result is read.",
        "The same model, starting fresh. Planted flaws caught, counting an unusable answer as a miss: 80 of 120 (67 in 100, likely range 58 to 74). On usable answers only: 80 of 119 (67 in 100, likely range 58 to 75). Alarms on sound plans: 10 of 40 (25 in 100, likely range 14 to 40). Unusable answers: 1.",
        "Grill as shipped. Planted flaws caught, counting an unusable answer as a miss: 95 of 120 (79 in 100, likely range 71 to 85). On usable answers only: 95 of 117 (81 in 100, likely range 73 to 87). Alarms on sound plans: 3 of 8. Unusable answers: 4.",
        "Pair by pair, on the flawed plans, the number of cases where each one caught the planted flaw:",
        "Grill as shipped against the same model, starting fresh. Counting an unusable answer as a miss: both caught it in 70 cases, only the first in 25, only the second in 10, neither in 15. On cases where both gave a usable answer: both caught it in 68 cases, only the first in 22, only the second in 9, neither in 12.",
        "More than half of the cases were drafted by one model family. Under the protocol, a result from such a set can remove a claim about quality. It cannot support one.",
        "One run is shown, the latest that measured: 16 November 2026, commit 0123abc, Actions run 43400000001. Only 27 of 29 cases reached a judge. A case with no answer counts as a miss, or as a false alarm on a sound plan.",
        "Caught. The judge caught 18 of 19 flawed plans and 3 of 4 loaded questions, but these 29 cases were used to write the judge's instructions, so this score says nothing about how good the judge is.",
        "False alarms. 1 of 6 sound plans got a false alarm. That is too few plans to say what the real rate is.",
        "Quotes not found. 10 of 90 quotes the judge gave were not found in the write-up they were quoted from.",
        "Output rules. 1 of 29 answers broke the output rules.",
        "A second reading. A separate quality check read the judge's answers and found the planted flaw named in 20 of 23 cases. These are the same cases, so this says nothing about how good the judge is either.",
        "Routing. The judge came from a different company than the declared author in 27 of 29 cases. That is a routing check. It is not a measure of whether the two make different mistakes. This check names no author, so the default applies and the author is taken to be Anthropic.",
        "Judge companies. The router picked the judge for each case. Cases by the company whose model answered: Google 20, other companies 7.",
        "The counts on this page were last updated on 20 November 2026.",
      ],
    );
  });

  it("is served by the routes that already exist, with no rewrite of its own", () => {
    const config = JSON.parse(read("vercel.json"));
    assert.ok(!JSON.stringify(config).includes("how-we-test"), "vercel.json does not name the page");
    const generic = config.routes.filter((route) => typeof route.dest === "string" && /^\/\$1\/index\.(html|md)$/.test(route.dest));
    assert.equal(generic.length, 2, "one generic route for the page and one for its Markdown twin");
    for (const route of generic) {
      for (const path of ["/how-we-test", "/how-we-test/"]) {
        const match = path.match(new RegExp(route.src));
        assert.ok(match, `${route.dest} answers ${path}`);
        const file = route.dest.replace("$1", match[1]).slice(1);
        assert.ok(existsSync(join(scratchDirs[0], "_site", file)), `${file} was built`);
      }
      assert.equal(route.check, true);
    }
    for (const rule of config.rewrites) assert.ok(!/^\/how-we-test/.test(rule.source));
  });

  // (a)
  it("opens with what has not been measured yet, and the description, the blurb and llms.txt lead with it", () => {
    for (const built of [today, first]) {
      const main = mainOf(built.html);
      assert.match(main, new RegExp(`<h1>${H1.replace(/\./g, "\\.")}</h1>\\s*<p class="lede">${LEDE.replace(/[.]/g, "\\.")}</p>`), "the lede is the first thing under the heading");
      assert.ok(built.md.startsWith(`# ${H1}\n\n${LEDE}\n\n## ${SECTIONS.notMeasured}\n`), "the twin opens the same way");
      const opening = textOf(htmlSection(built.html, SECTIONS.notMeasured));
      assert.ok(opening.includes("We have not measured whether that judge catches more than the model that wrote the plan would, starting fresh with no chat behind it."));
      assert.ok(opening.includes("Until that is measured, Grill does not claim it."));
      assert.ok(mdSection(built.md, SECTIONS.notMeasured).includes("Until that is measured, Grill does not claim it."));

      const description = built.html.match(/<meta name="description" content="([^"]*)">/)?.[1];
      assert.equal(description, DESCRIPTION);
      assert.ok(description.startsWith("Not measured yet"));
      assert.ok(description.length < 160, `the description is ${description.length} characters`);
      assert.ok(built.html.includes(`<meta property="og:description" content="${DESCRIPTION}">`));

      const line = built.llms.split("\n").filter((l) => l.includes(`](${CANONICAL})`));
      assert.deepEqual(line, [`- [How Grill tests its judge](${CANONICAL}): ${BLURB}`]);
      assert.ok(BLURB.startsWith("Not measured yet"));
    }
  });

  // (b)
  it("titles the weekly run a regression check, puts the caveat in the sentence with the counts, and gives no rate", () => {
    const section = htmlSection(first.html, SECTIONS.weekly);
    const twin = mdSection(first.md, SECTIONS.weekly);
    assert.ok(section.startsWith("<h2>A weekly regression check, not a measure of quality</h2>"));
    const caught =
      "The judge caught 19 of 19 flawed plans and 4 of 4 loaded questions, but these 29 cases were used to write the judge's instructions, so a full score says nothing about how good the judge is.";
    const items = itemsOf(section);
    assert.equal(decode(items[0]), `<strong>Caught.</strong> ${caught}`);
    assert.equal(caught.split(/(?<=[.?!])\s+/).length, 1, "the counts and the caveat are one sentence");
    assert.ok(twin.includes(`- **Caught.** ${caught}\n`));
    for (const text of [textOf(section), twin]) {
      assert.doesNotMatch(text, /%|percent|per cent|\bin 100\b|\brate of\b/i, "no rate of any kind for this run");
      assert.doesNotMatch(text, /accura|benchmark|quality score/i);
      assert.ok(text.includes("It cannot rank one critic against another."));
    }
    // Today's page, whatever run it shows, keeps the caveat inside the sentence that holds the catch counts.
    const run = latestRun(committedResults());
    const todayCaught = decode(itemsOf(htmlSection(today.html, SECTIONS.weekly))[0]);
    assert.match(
      todayCaught,
      new RegExp(
        `^<strong>Caught\\.</strong> The judge caught ${run.flawed.caught + run.wrong_figure.caught} of ${run.flawed.of + run.wrong_figure.of} flawed plans and ${run.loaded.caught} of ${run.loaded.of} loaded questions, but these ${run.cases} cases were used to write the judge's instructions, so (a full|this) score says nothing about how good the judge is\\.$`,
      ),
    );
    assert.doesNotMatch(textOf(htmlSection(today.html, SECTIONS.weekly)), /%|percent|per cent|\bin 100\b/i);
  });

  it("gives the false alarms and the quotes not found the same weight as the catches", () => {
    const section = htmlSection(first.html, SECTIONS.weekly);
    const items = itemsOf(section).map(decode);
    assert.equal(items[1], "<strong>False alarms.</strong> 2 of 6 sound plans got a false alarm. That is too few plans to say what the real rate is.");
    assert.equal(items[2], "<strong>Quotes not found.</strong> 10 of 94 quotes the judge gave were not found in the write-up they were quoted from.");
    // Same list, same markup, straight after the catches, and not inside anything smaller.
    assert.equal((section.match(/<ul\b/g) ?? []).length, 1, "one list holds every count");
    for (const item of items) assert.match(item, /^<strong>[A-Z][^<]*\.<\/strong> \S/);
    assert.doesNotMatch(section, /<small|<details|class="small"|class="more"/);
    const twin = mdSection(first.md, SECTIONS.weekly).split("\n").filter((line) => line.startsWith("- "));
    assert.ok(twin[0].startsWith("- **Caught.** "));
    assert.equal(twin[1], "- **False alarms.** 2 of 6 sound plans got a false alarm. That is too few plans to say what the real rate is.");
    assert.equal(twin[2], "- **Quotes not found.** 10 of 94 quotes the judge gave were not found in the write-up they were quoted from.");
    // On today's page the two items are still second and third, whatever the counts are.
    const now = itemsOf(htmlSection(today.html, SECTIONS.weekly));
    assert.match(now[1], /^<strong>False alarms\.<\/strong> \d+ of \d+ sound plans got a false alarm\./);
    assert.match(now[2], /^<strong>Quotes not found\.<\/strong> \d+ of \d+ quotes the judge gave were not found/);
  });

  it("shows one run, with its date, its commit and a link to its Actions run", () => {
    const section = htmlSection(first.html, SECTIONS.weekly);
    assert.ok(
      section.includes(
        `<p class="note">One run is shown, the latest that measured: 13 November 2026, commit <a href="${SOURCE}/commit/303a77f">303a77f</a>, <a href="${SOURCE}/actions/runs/43354935479">Actions run 43354935479</a>. All 29 cases reached a judge.</p>`,
      ),
    );
    assert.ok(
      mdSection(first.md, SECTIONS.weekly).includes(
        `One run is shown, the latest that measured: 13 November 2026, commit [303a77f](${SOURCE}/commit/303a77f), [Actions run 43354935479](${SOURCE}/actions/runs/43354935479). All 29 cases reached a judge.`,
      ),
    );
    for (const built of [today, first, later]) {
      assert.equal((built.html.match(/\/actions\/runs\//g) ?? []).length, 1, "one run, not a history");
      assert.equal((built.md.match(/\/actions\/runs\//g) ?? []).length, 1);
    }
    const run = latestRun(committedResults());
    assert.ok(today.html.includes(`<a href="${SOURCE}/actions/runs/${run.run_id}">Actions run ${run.run_id}</a>`), "today's page links the latest run in the committed file");
    assert.ok(today.html.includes(`<a href="${SOURCE}/commit/${run.commit}">${run.commit}</a>`));
  });

  it("says how many cases reached a judge when not all did, beside the counts", () => {
    const section = textOf(htmlSection(later.html, SECTIONS.weekly));
    const twin = mdSection(later.md, SECTIONS.weekly);
    const reached = "Only 27 of 29 cases reached a judge. A case with no answer counts as a miss, or as a false alarm on a sound plan.";
    assert.ok(section.includes(`Actions run 43400000001. ${reached}`), section);
    assert.ok(twin.includes(reached));
    assert.ok(!section.includes("All 29 cases reached a judge."));
    assert.ok(!later.html.includes("43354935479"), "the older run is not shown");
    assert.ok(
      section.includes(
        "The judge caught 18 of 19 flawed plans and 3 of 4 loaded questions, but these 29 cases were used to write the judge's instructions, so this score says nothing about how good the judge is.",
      ),
    );
  });

  // (c)
  it("words the routing figure as a routing check, with its count, and never says decorrelated", () => {
    const routing =
      "The judge came from a different company than the declared author in 29 of 29 cases. That is a routing check. It is not a measure of whether the two make different mistakes. This check names no author, so the default applies and the author is taken to be Anthropic.";
    assert.ok(itemsOf(htmlSection(first.html, SECTIONS.weekly)).map(decode).includes(`<strong>Routing.</strong> ${routing}`));
    assert.ok(mdSection(first.md, SECTIONS.weekly).includes(`- **Routing.** ${routing}\n`));
    const run = latestRun(committedResults());
    assert.ok(
      textOf(htmlSection(today.html, SECTIONS.weekly)).includes(
        `The judge came from a different company than the declared author in ${run.different_company.k} of ${run.different_company.of} cases. That is a routing check. It is not a measure of whether the two make different mistakes.`,
      ),
    );
    for (const built of [today, first, later]) {
      assert.doesNotMatch(built.html, /decorrelat/i);
      assert.doesNotMatch(built.md, /decorrelat/i);
      assert.doesNotMatch(built.llms, /decorrelat/i);
    }
  });

  // (d)
  it("lists which companies' models served as judge, as counts by company, with no model name", () => {
    const companies = "The router picked the judge for each case. Cases by the company whose model answered: Google 8, OpenAI 14, DeepSeek 3, MiniMax 2, Moonshot AI 2.";
    assert.ok(itemsOf(htmlSection(first.html, SECTIONS.weekly)).map(decode).includes(`<strong>Judge companies.</strong> ${companies}`));
    assert.ok(mdSection(first.md, SECTIONS.weekly).includes(`- **Judge companies.** ${companies}\n`));
    assert.ok(textOf(htmlSection(later.html, SECTIONS.weekly)).includes("Cases by the company whose model answered: Google 20, other companies 7."));
    for (const built of [today, first, later]) {
      for (const text of [textOf(mainOf(built.html)), mdText(built.md)]) {
        assert.doesNotMatch(text, MODEL_WORDS, "a company is named, never a model");
        assert.doesNotMatch(text, /\b(openai|google|anthropic|deepseek|minimax|moonshotai|x-ai|meta-llama|mistralai|qwen)\/\S/i, "no model slug");
        assert.doesNotMatch(text, /\$|\busd\b|dollar|\bcents?\b/i, "no dollar amount");
      }
    }
  });

  // (e)
  it("says plainly which weeks measured nothing, as dates", () => {
    const weeks =
      "Weeks that measured nothing. The weekly runs on 2 November 2026 and 9 November 2026 failed as not measured. The runs on 28 September 2026, 5 October 2026, 12 October 2026, 19 October 2026 and 26 October 2026 passed while skipping every case, so a pass on those days measured nothing.";
    assert.ok(textOf(htmlSection(first.html, SECTIONS.weekly)).includes(weeks));
    assert.ok(mdText(mdSection(first.md, SECTIONS.weekly)).includes(weeks));
    const committed = committedResults();
    const section = textOf(htmlSection(today.html, SECTIONS.weekly));
    for (const day of [...committed.regression.not_measured, ...committed.regression.skipped_green]) {
      const [year, month, date] = day.split("-").map(Number);
      const words = `${date} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1]} ${year}`;
      assert.ok(section.includes(words), `today's page names ${day}`);
    }
  });

  // (f)
  it("gives the held-out check: what it compared, version 1 with its counts, and version 2 not run", () => {
    const section = htmlSection(first.html, SECTIONS.heldOut);
    const compared =
      "It compared two judges on the same decisions: one with today's instructions, and one with the same instructions plus one candidate rule. A rater who could not see which was which said which answer would change what you do next.";
    assert.ok(textOf(section).includes(compared));
    assert.deepEqual(itemsOf(section).map(decode), [
      "<strong>Version 1.</strong> Run on 9 November 2026. Of 15 decided pairs, the candidate rule won 9. If the two were equally good, the candidate would win that often or more about 30 times in 100. The rule stayed off.",
      "<strong>Version 2.</strong> Not run.",
    ]);
    const twin = mdSection(first.md, SECTIONS.heldOut);
    assert.ok(twin.includes(compared));
    assert.ok(twin.includes("- **Version 1.** Run on 9 November 2026. Of 15 decided pairs, the candidate rule won 9."));
    assert.ok(twin.includes("The rule stayed off.\n- **Version 2.** Not run."));
    // What it compared is what the eval's own notes say it compared, and no more.
    const notes = read("evals/verdict-quality/README.md");
    assert.ok(notes.includes("A blind comparison of two judges on the same decision. The current judge is today's prompt. The candidate is that prompt plus one rule"));
    assert.ok(notes.includes("a blind rater says which output would change what you do next"));
    assert.ok(notes.includes("The candidate won 9 of those pairs and lost 6, p=0.30."));
    assert.doesNotMatch(textOf(section), /\b(better|worse|improv\w*|proved|proves|shows that|because)\b/i, "no claim beyond the counts");
  });

  // (g)
  it("calls the comparison a draft protocol that has not run, names its four arms, and links the protocol", () => {
    const section = htmlSection(first.html, SECTIONS.comparison);
    const twin = mdSection(first.md, SECTIONS.comparison);
    assert.match(textOf(section), /^The comparison with the same model starting fresh\nDraft protocol, not run\. /);
    assert.ok(twin.includes("**Draft protocol, not run.** Grill has written a plan for one measurement and has not run it."));
    const arms = [
      "<strong>The same chat.</strong> The model that wrote the plan is asked, in the same chat, to argue the other side.",
      "<strong>The same model, starting fresh.</strong> The same model gets the plan in a new chat, with the instructions Grill gives its judge.",
      "<strong>A stronger model from the same company.</strong> A stronger model from the company that wrote the plan gets it with those same instructions.",
      "<strong>Grill as shipped.</strong> The router picks the judge, and the company that wrote the plan is left out.",
    ];
    assert.deepEqual(itemsOf(section).map(decode), arms);
    for (const arm of arms) {
      const said = arm.replace(/<strong>[^<]*<\/strong> /, "");
      assert.equal(said.split(/(?<=[.?!])\s+/).length, 1, "one sentence an arm");
      assert.ok(twin.includes(`** ${said}\n`), "the twin lists the same arm");
    }
    for (const text of [textOf(section), twin]) {
      assert.ok(text.includes("The result will be published here whichever way it falls."));
      assert.ok(text.includes("The main question is whether Grill as shipped catches more planted flaws than the same model starting fresh."));
    }
    const link = `${SOURCE}/blob/main/evals/four-arm/README.md`;
    assert.ok(section.includes(`Read <a href="${link}">the draft protocol</a>.`));
    assert.ok(twin.includes(`Read [the draft protocol](${link}).`));
    assert.ok(existsSync(join(ROOT, "evals/four-arm/README.md")), "the linked file is in the repository");
    // The four arms are the protocol's own four.
    const protocol = read("evals/four-arm/README.md");
    for (const row of ["| A | The same model, same chat |", "| B | The same model, fresh context, Grill's brief |", "| C | A stronger model from the same lab, Grill's brief |", "| D | The product as shipped |"]) {
      assert.ok(protocol.includes(row), row);
    }
  });

  it("puts no number at all in the comparison's block while it is a draft, on the page or in the twin", () => {
    const committed = committedResults();
    // When the comparison has been measured, this page's opening is out of date. Rewrite the lede in
    // site/how-we-test.html, the description and the blurb in scripts/build-site.mjs, and the FAQ
    // answer, in the pull request that commits the result. Then change this test to say what is true.
    assert.notEqual(
      committed.four_arm.status,
      "measured",
      "the comparison has been measured: the page still opens with 'Not measured yet', so rewrite the opening, the description, the blurb and this test",
    );
    for (const built of [today, first]) {
      const section = htmlSection(built.html, SECTIONS.comparison).replace(/<\/?h2>/g, "");
      assert.doesNotMatch(section, /\d/, "not a digit in the words, the markup or a link");
      assert.doesNotMatch(mdSection(built.md, SECTIONS.comparison).replace(/^## /, ""), /\d/);
    }
    assert.match(htmlSection(first.html, SECTIONS.weekly).replace(/<\/?h2>/g, ""), /\d/, "the same reading finds the counts in a section that has them");
  });

  it("once the comparison is measured, shows counts both ways and no rate where fewer than 10 cases are behind it", () => {
    const section = textOf(htmlSection(later.html, SECTIONS.comparison));
    const twin = mdText(mdSection(later.md, SECTIONS.comparison));
    for (const text of [section, twin]) {
      assert.ok(text.includes("Measured. The comparison ran on 20 November 2026, at commit 0123abc, on 120 flawed plans, 40 sound plans and 20 loaded questions. Every case is made up."));
      assert.ok(
        text.includes(
          "Grill as shipped. Planted flaws caught, counting an unusable answer as a miss: 95 of 120 (79 in 100, likely range 71 to 85). On usable answers only: 95 of 117 (81 in 100, likely range 73 to 87). Alarms on sound plans: 3 of 8. Unusable answers: 4.",
        ),
      );
      assert.ok(text.includes("Alarms on sound plans: 10 of 40 (25 in 100, likely range 14 to 40)."));
      assert.ok(
        text.includes(
          "Grill as shipped against the same model, starting fresh. Counting an unusable answer as a miss: both caught it in 70 cases, only the first in 25, only the second in 10, neither in 15. On cases where both gave a usable answer: both caught it in 68 cases, only the first in 22, only the second in 9, neither in 12.",
        ),
      );
      assert.doesNotMatch(text, /3 of 8 \(/, "eight cases are too few for a rate");
      assert.doesNotMatch(text, /%|percent/i);
      assert.ok(text.includes("This page does not say which one did best"));
      assert.ok(text.includes("More than half of the cases were drafted by one model family."));
      assert.doesNotMatch(text, /Draft protocol/);
    }
  });

  // (h)
  it("gives real users and the two look-back counts under their two names, never added, and the signals", () => {
    const section = htmlSection(first.html, SECTIONS.people);
    assert.deepEqual(itemsOf(section).map(decode), [
      `<strong>Real users.</strong> 1, as of 9 November 2026. What counts as a real user is set out in <a href="${SOURCE}/blob/main/docs/STRATEGY.md">Grill's strategy notes</a>.`,
      `<strong>Evidenced look-backs.</strong> 0, as of the same day. What counts as one is set out in <a href="${SOURCE}/blob/main/docs/PRINCIPLES.md#north-star">Grill's principles</a>.`,
      "<strong>Look-backs saved on Grill accounts.</strong> Not counted yet. This is a separate count from evidenced look-backs, and the two are never added together.",
      "<strong>Signals.</strong> 0 rated, 0 resolved. A signal is a short report a person chooses to send through a public form: a rating of one grill, or whether a call came true.",
    ]);
    const twin = mdSection(first.md, SECTIONS.people);
    assert.ok(twin.includes(`- **Real users.** 1, as of 9 November 2026. What counts as a real user is set out in [Grill's strategy notes](${SOURCE}/blob/main/docs/STRATEGY.md).`));
    assert.ok(twin.includes("- **Evidenced look-backs.** 0, as of the same day."));
    assert.ok(twin.includes("- **Look-backs saved on Grill accounts.** Not counted yet. This is a separate count from evidenced look-backs, and the two are never added together."));
    assert.ok(twin.includes("- **Signals.** 0 rated, 0 resolved."));
    assert.ok(twin.includes("The counts on this page were last updated on 13 November 2026."));
    // The page links the definitions. It does not restate what a real user is.
    assert.doesNotMatch(textOf(section), /a real user is a person|outside the maintainers|who ran|ran (a|at least one)\b/i);
    assert.match(read("docs/STRATEGY.md"), /A real user is a person outside the maintainers/);
    assert.match(read("docs/PRINCIPLES.md"), /^## North Star$/m);
    assert.match(read("docs/PRINCIPLES.md"), /Evidenced look-backs are reported alongside the 100, and never added to it\./);
    // Today's page shows the committed counts under the same two names.
    const committed = committedResults();
    const now = itemsOf(htmlSection(today.html, SECTIONS.people)).map(decode);
    assert.ok(now[0].startsWith(`<strong>Real users.</strong> ${committed.users.real}, as of `));
    assert.ok(now[1].startsWith(`<strong>Evidenced look-backs.</strong> ${committed.users.evidenced_lookbacks}, `));
    assert.ok(now[2].startsWith("<strong>Look-backs saved on Grill accounts.</strong> "));
    assert.ok(now[2].endsWith("This is a separate count from evidenced look-backs, and the two are never added together."));
    assert.ok(now[3].startsWith(`<strong>Signals.</strong> ${committed.signals.rated} rated, ${committed.signals.resolved} resolved.`));
  });

  // (i)
  it("states the rule in its conditional shape, and no sentence says different company without the condition", () => {
    for (const built of [today, first, later]) {
      const rule = htmlSection(built.html, SECTIONS.rule);
      assert.ok(rule.includes(`<p class="note">${RULE} That is a rule about who the judge is. It is not a result about how well it judges.</p>`));
      assert.ok(mdSection(built.md, SECTIONS.rule).includes(`${RULE} That is a rule about who the judge is.`));
      const page = textOf(mainOf(built.html));
      assert.ok((page.match(/\b(different|another) company\b/gi) ?? []).length >= 2, "the page does say it, in the rule and in the routing check");
      assert.deepEqual(unconditional(page), []);
      assert.deepEqual(unconditional(mdText(built.md)), []);
      const line = built.llms.split("\n").find((l) => l.includes(`](${CANONICAL})`));
      assert.deepEqual(unconditional(line), []);
    }
    // The check itself: the plain claim is caught.
    assert.deepEqual(unconditional("You decide. The judge is from a different company. Then stop."), ["The judge is from a different company."]);
  });

  it("uses none of the words Grill does not say, promises no date, and shows no rate sign anywhere", () => {
    for (const built of [today, first, later]) {
      const line = built.llms.split("\n").find((l) => l.includes(`](${CANONICAL})`));
      const description = built.html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? "";
      for (const [where, raw] of [["the page", textOf(mainOf(built.html))], ["the twin", mdText(built.md)], ["the llms.txt line", line], ["the description", description]]) {
        const text = raw.toLowerCase().replace(/\s+/g, " ");
        for (const phrase of NEVER) assert.ok(!text.includes(phrase), `${where} says "${phrase}"`);
        assert.doesNotMatch(raw, /%|\bpercent\b|per cent/i, `${where} shows a rate sign`);
        assert.doesNotMatch(raw, LONG_DASH, `${where} has a long dash`);
        assert.doesNotMatch(raw, /\b(soon|shortly|next (week|month|quarter|year)|by (the end of|early|late|mid)|this (month|quarter|year)|coming)\b/i, `${where} promises a time`);
      }
    }
    // A date on the page is a day something happened, on or before the day the counts were updated.
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    for (const [built, updated] of [[today, committedResults().updated], [first, "2026-11-13"], [later, "2026-11-20"]]) {
      const days = [...textOf(mainOf(built.html)).matchAll(/\b(\d{1,2}) ([A-Z][a-z]+) (20\d\d)\b/g)].map(
        (match) => `${match[3]}-${String(months.indexOf(match[2]) + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`,
      );
      assert.ok(days.length >= 5, "the page gives its dates");
      for (const day of days) assert.ok(day <= updated, `${day} is not after ${updated}`);
    }
  });

  // (j)
  it("ends with exactly one call to action, tagged for this page", () => {
    assert.ok(read("site/demo.html").includes('<p class="cta"><a class="button" href="/start/?ref=demo">Connect Grill</a>'), "the button is the one the demo page uses");
    for (const built of [today, first, later]) {
      const main = mainOf(built.html);
      assert.equal(main.split(CTA).length - 1, 1);
      assert.equal((main.match(/class="cta"/g) ?? []).length, 1);
      assert.equal((main.match(/class="button"/g) ?? []).length, 1);
      assert.match(main, new RegExp(`${CTA.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*<div class="footer">`), "nothing follows the button but the footer");
      assert.equal((main.match(/href="\/start\//g) ?? []).length, 2, "the nav link and the button");
      assert.ok(built.md.includes("\n[Connect Grill](https://grillyour.ai/start/?ref=how-we-test)\n"));
      assert.equal((built.md.match(/\?ref=how-we-test/g) ?? []).length, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// What the page leans on in other code.
//
// Two things on the page are true only if code outside the page makes them so:
//   - "When it cannot, the verdict says so." The installed tool and the hosted connector have
//     to add a line that says independence was not verified when Grill could not tell who
//     wrote the plan.
//   - The button's label, ?ref=how-we-test. The weekly report reads a label only when it is
//     in START_REF_LABELS.
// Both come with the change to the hosted and installed code, which is made apart from this
// page. While none of it is in this tree, neither holds and the page must not ship from it.
// The test then runs as a to-do: it fails in the report without failing the run. Once any
// part of that change is here, the test is an ordinary one and all of it must be here.
const NOT_VERIFIED = /independence[ _]not[ _]verified/i;
const VERDICT_CODE = ["server/index.mjs", "scripts/hostedCore.mjs"];
const saysSoIn = (file) => NOT_VERIFIED.test(read(file));
const labelIsRead = START_REF_LABELS.includes("how-we-test");
const notBackedYet = !labelIsRead && !VERDICT_CODE.some(saysSoIn);

describe("what /how-we-test/ leans on in other code", () => {
  it(
    "the verdict says when independence was not verified, and the weekly report reads this page's label",
    { todo: notBackedYet ? "the hosted and installed code that makes both true is not merged here yet, so do not ship the page from this tree" : false },
    () => {
      assert.ok(textOf(mainOf(first.html)).includes("When it cannot, the verdict says so."), "the page says it");
      assert.ok(mainOf(first.html).includes('href="/start/?ref=how-we-test"'), "the button carries the label");
      const missing = [];
      for (const file of VERDICT_CODE) {
        if (!saysSoIn(file)) missing.push(`${file} has no line that says independence was not verified`);
      }
      if (!labelIsRead) missing.push("START_REF_LABELS in scripts/weeklyMetricsCore.mjs does not hold how-we-test");
      assert.deepEqual(missing, []);
    },
  );
});

describe("the way to /how-we-test/", () => {
  it("is linked once from the about page, the FAQ and the README, and each says what the page holds", () => {
    const about = read("site/about.html");
    const aboutLink = 'What has been measured about the judge, and what has not, is on <a href="/how-we-test/">How Grill tests its judge</a>.';
    assert.equal(about.split(aboutLink).length - 1, 1);
    assert.equal((about.match(/how-we-test/g) ?? []).length, 1, "one link, and nothing else about the page");
    assert.ok(today.out("about/index.md").includes("is on [How Grill tests its judge](https://grillyour.ai/how-we-test/)."));

    const faq = read("site/faq.html");
    assert.equal((faq.match(/href="\/how-we-test\/"/g) ?? []).length, 1);
    assert.ok(today.out("faq/index.md").includes("[grillyour.ai/how-we-test/](https://grillyour.ai/how-we-test/)"));

    const readme = read("README.md");
    const readmeLink = "What has been measured about the judge, and what has not: [grillyour.ai/how-we-test](https://grillyour.ai/how-we-test/).";
    assert.equal(readme.split(readmeLink).length - 1, 1);
    assert.equal((readme.match(/how-we-test/g) ?? []).length, 2, "the link's words and its address, once");
    const promises = readme.slice(readme.indexOf("## What Grill promises"), readme.indexOf("## Set up"));
    assert.ok(promises.includes(readmeLink), "it sits with the promises");

    // The page is in the list an assistant reads, between the other pages and the FAQ answers.
    const pagesAt = today.llms.indexOf("## Pages\n");
    const faqAt = today.llms.indexOf("## FAQ\n");
    const lineAt = today.llms.indexOf(`- [How Grill tests its judge](${CANONICAL}): `);
    assert.ok(pagesAt > 0 && lineAt > pagesAt && faqAt > lineAt);
    // Three places in llms.txt name the page: its own line, and the address and the name in the FAQ answer.
    assert.ok(today.llms.slice(faqAt).includes("are at grillyour.ai/how-we-test/ (How Grill tests its judge)."));
  });
});

describe("the site build stops rather than publish a broken /how-we-test/", () => {
  const editPage = (edit) => (dir) => {
    const path = join(dir, "site", "how-we-test.html");
    writeFileSync(path, edit(readFileSync(path, "utf8")));
  };

  it("when the results marker is missing, or is there twice", () => {
    const missing = buildFailure(scratchTree(editPage((html) => html.replace("<!-- RESULTS -->", ""))));
    assert.match(missing ?? "", /site\/how-we-test\.html must include <!-- RESULTS --> once/);
    const twice = buildFailure(scratchTree(editPage((html) => html.replace("<!-- RESULTS -->", "<!-- RESULTS -->\n  <!-- RESULTS -->"))));
    assert.match(twice ?? "", /site\/how-we-test\.html must include <!-- RESULTS --> once/);
  });

  it("when the results file breaks a rule of its shape, and it names where", () => {
    const cases = [
      [(file) => (file.regression.runs[0].by_company[0].company = "openai/some-model"), /regression\.runs\[0\]\.by_company\[0\]\.company: expected one of /],
      [(file) => (file.regression.runs[0].sound.rate = 0.33), /regression\.runs\[0\]\.sound\.rate: unknown key/],
      [(file) => (file.users.note = "one of them is a friend"), /users\.note: unknown key/],
      [(file) => (file.signals.cost_usd = 3), /signals\.cost_usd: dollar amounts are never published in this file/],
      [(file) => (file.four_arm = { status: "draft", arms: [{ arm: "product" }], comparisons: [] }), /four_arm\.arms: must be empty while status is draft/],
      [(file) => (file.account_lookbacks = { status: "counted", as_of: "2026-11-13", cohort: 4, done_14d: 1, done_7d: 1, people: 1 }), /account_lookbacks\.cohort: 4 is under 10/],
    ];
    for (const [change, message] of cases) {
      const file = firstRecorded();
      change(file);
      const failure = buildFailure(scratchTree(withResultsFile(file)));
      assert.match(failure ?? "", message);
      assert.ok(!(failure ?? "").includes("one of them is a friend"), "the error never repeats a string from the file");
    }
    const notJson = buildFailure(scratchTree((dir) => writeFileSync(join(dir, "data", "results.json"), "{")));
    assert.ok(notJson, "a file that is not JSON stops the build");
  });

  it("when any page has lost the footer span the live commit is written into", () => {
    const span = '<span>Made at <a href="https://hold.quest">Hold</a></span>';
    for (const page of ["how-we-test.html", "about.html", "page.html"]) {
      const failure = buildFailure(
        scratchTree((dir) => {
          const path = join(dir, "site", page);
          const html = readFileSync(path, "utf8");
          assert.ok(html.includes(span), `site/${page} has the span to begin with`);
          writeFileSync(path, html.replace(span, "<span>Made at Hold</span>"));
        }),
      );
      assert.ok((failure ?? "").includes(`site/${page} must keep the footer span`), `the build names site/${page}`);
    }
  });

  it("and builds again from an unbroken copy", () => {
    assert.equal(buildFailure(scratchTree()), null);
  });
});

describe("the head of a built page", () => {
  it("escapes the description, so a quote or an ampersand in one cannot cut the attribute short", () => {
    // The build script's own copy is edited here: the committed descriptions hold no such character.
    const dir = scratchTree((tree) => {
      const path = join(tree, "scripts", "build-site.mjs");
      const script = readFileSync(path, "utf8");
      const written = `description: "${DESCRIPTION}",`;
      assert.equal(script.split(written).length - 1, 1, "the page's description is in the build script once");
      writeFileSync(path, script.replace(written, "description: 'Not \"measured\" yet & <b>counts</b>',"));
    });
    const { html } = buildIn(dir);
    const safe = "Not &quot;measured&quot; yet &amp; &lt;b&gt;counts&lt;/b&gt;";
    assert.ok(html.includes(`<meta name="description" content="${safe}">`));
    assert.ok(html.includes(`<meta property="og:description" content="${safe}">`));
    assert.equal((html.match(/<b>counts<\/b>/g) ?? []).length, 0);
    // Every committed description is still written exactly as it was, since none needs escaping.
    assert.ok(today.html.includes(`<meta name="description" content="${DESCRIPTION}">`));
    for (const page of ["about/index.html", "faq/index.html", "check-your-ai/index.html", "index.html"]) {
      const description = today.out(page).match(/<meta name="description" content="([^"]*)">/)?.[1] ?? "";
      assert.ok(description.length > 20 && !/[&<>]/.test(description), `${page} has a plain description`);
    }
  });
});
