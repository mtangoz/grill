// Grill has not measured whether a judge from a different company catches more than the
// same model starting fresh. Until it has, public copy does not claim it. And the judge
// is from a different company only when Grill can tell which AI wrote the plan, so public
// copy does not say "never" or "always" about that either.
//
// This file guards the pages, docs, skills and prompt listed below, and the built
// llms.txt that agents read. In llms.txt it also reads sentence by sentence: one that
// says "different company" has to keep the condition. It reads the built about,
// check-your-ai, contribute, demo and FAQ pages the same way, as HTML and as their
// Markdown twins, and the whole README.
//
// It also holds the wording rules for every public file, the hosted tool strings and the
// judge's notes: the phrases Grill does not write. And it reads every store key the code
// writes, by family, and fails when docs/DATA-LEDGER.md has no row for one.
// It does not read docs/STRATEGY.md yet.
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
const BUILT_PAGES = ["about", "check-your-ai", "contribute", "demo", "faq"];

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
    // About, check-your-ai, contribute and the FAQ still say when the judge is from a different company. The demo does not say it.
    assert.equal(conditional, 8);
  });

  // The opening paragraph, read on its own. The test after it reads the whole README.
  it("the README's opening paragraph does not say different company without the condition", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const opening = readme.split("\n").filter((line) => line.startsWith("Tell the assistant you think with, "));
    assert.equal(opening.length, 1, "the README opens with how to ask for a grill");
    assert.ok(opening[0].includes("It sends the decision as you said it. An outside judge comes back with a short note: one verdict line,"));
    assert.deepEqual(unconditionalIn(opening[0]), []);
  });

  it("every README sentence that says different company keeps the condition", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    // The check reads the promise list and the paste steps too: the two sentences they used to carry are caught.
    assert.deepEqual(unconditionalIn("## What Grill promises\n\nThe judge is a model from a different company.\nGrill uses OpenRouter's Auto Router."), [
      "The judge is a model from a different company.",
    ]);
    assert.deepEqual(unconditionalIn("3. Paste that into an assistant from a **different company**, then paste the answer back."), [
      "Paste that into an assistant from a **different company**, then paste the answer back.",
    ]);
    assert.ok(readme.includes("The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. When it cannot, the verdict says so."));
    assert.deepEqual(unconditionalIn(readme), []);
  });
});

// The wording rules for all public copy. Each phrase is matched in any letter case, across
// line breaks and HTML tags, like the list above.
const WORDING_RULES = [
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
];
// Public copy says "rule" or "promise". Code comments may say what a request-side setting is not.
const PUBLIC_ONLY = ["guarantee"];

/** The phrases from a list found in a text, read as written and with HTML tags removed. */
function ruleBreaks(text, phrases) {
  const raw = flatten(text);
  const plain = flatten(String(text).replace(/<[^>]+>/g, " "));
  return phrases.filter((phrase) => raw.includes(phrase) || plain.includes(phrase));
}

const PUBLIC_FILES = [
  "README.md",
  "LEARNING.md",
  "docs/PRINCIPLES.md",
  "docs/PRIVACY.md",
  "docs/DATA-LEDGER.md",
  "docs/HOSTED.md",
  "docs/ANY-APP.md",
  "docs/PRO.md",
  "docs/WHY.md",
  "docs/UX.md",
  "docs/PRD-lookback-reminders.md",
  "docs/DIRECTORY-SUBMISSIONS.md",
  "prompts/grill.md",
  "manifest.json",
  ".claude-plugin/plugin.json",
  "scripts/build-site.mjs",
];

/** Every page under site/, so a new page is covered the day it is added. */
function sitePages() {
  return readdirSync(join(ROOT, "site"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => `site/${name}`)
    .sort();
}

// The code that writes the hosted tool text, the installed tool text and the judge's notes.
const TOOL_SOURCES = ["scripts/hostedCore.mjs", "scripts/feedbackCore.mjs", "scripts/reflection.mjs", "server/index.mjs", "scripts/judgeCore.mjs", "api/_hosted.mjs"];

/** Every string inside a value: a string itself, or the strings in an array or object, however deep. */
function stringsIn(value, seen = new Set()) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((inner) => stringsIn(inner, seen));
}

describe("the wording rules, in every public file, the tool text and the judge's notes", () => {
  it("the check catches each phrase, in any case, across a line break or a tag", () => {
    assert.equal(WORDING_RULES.length, 14);
    for (const phrase of [...WORDING_RULES, ...PUBLIC_ONLY]) {
      assert.deepEqual(ruleBreaks(`So ${phrase.toUpperCase()} here.`, [phrase]), [phrase]);
      assert.deepEqual(ruleBreaks(`So ${phrase.replace(" ", "\n")} here.`, [phrase]), [phrase]);
    }
    assert.deepEqual(ruleBreaks("<li>If you say no, <em>nothing is kept</em>.</li>", WORDING_RULES), ["if you say no, nothing is kept", "nothing is kept"]);
    assert.deepEqual(ruleBreaks("If you say no, no record is kept. The 15-minute copy is kept either way.", WORDING_RULES), []);
  });

  it("no public page, doc, listing or skill uses a phrase the wording rules ban", () => {
    const files = [...PUBLIC_FILES, ...sitePages(), ...skillFiles()];
    assert.ok(files.includes("site/privacy.html") && files.includes("site/data-flow.html") && files.includes("skills/grill/SKILL.md"));
    const hits = [];
    for (const file of files) {
      for (const phrase of ruleBreaks(readFileSync(join(ROOT, file), "utf8"), [...WORDING_RULES, ...PUBLIC_ONLY])) hits.push(`${file}: "${phrase}"`);
    }
    assert.deepEqual(hits, []);
  });

  it("no tool string or judge note uses one either, in the source or as the tools are built", async () => {
    const hits = [];
    for (const file of TOOL_SOURCES) {
      for (const phrase of ruleBreaks(readFileSync(join(ROOT, file), "utf8"), WORDING_RULES)) hits.push(`${file}: "${phrase}"`);
    }
    const hosted = await import("./hostedCore.mjs");
    const installed = await import("../server/index.mjs");
    const judge = await import("./judgeCore.mjs");
    const built = [
      ...stringsIn(hosted.hostedTools()),
      ...[true, false].flatMap((checkOn) => [true, false].flatMap((authorGuessed) => stringsIn(installed.buildGrillTools({ checkOn, authorGuessed })))),
      ...[hosted, installed, judge].flatMap((module) => Object.values(module).filter((value) => typeof value === "string" || Array.isArray(value)).flatMap((value) => stringsIn(value))),
    ];
    assert.ok(built.length > 100, `only ${built.length} strings read`);
    assert.ok(built.includes(judge.RUN_PRIVACY_LINE), "the run note's privacy line is read");
    assert.ok(built.includes(hosted.RECORDS_NOTE), "the paragraph under the records question is read");
    for (const text of built) {
      for (const phrase of ruleBreaks(text, WORDING_RULES)) hits.push(`built string: "${phrase}" in ${JSON.stringify(text.slice(0, 80))}`);
    }
    assert.deepEqual(hits, []);
  });
});

// Every file that writes a store key. scripts/outsideLoopCore.mjs holds the outside counters' prefix.
const KEY_SOURCES = [
  ...readdirSync(join(ROOT, "api"))
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => `api/${name}`),
  "scripts/hostedCore.mjs",
  "scripts/impactDigest.mjs",
  "scripts/feedbackCore.mjs",
  "scripts/outsideLoopCore.mjs",
  "scripts/weeklyMetricsCore.mjs",
];

/**
 * The family of a key literal: its first three parts (grill:hosted:record), or two when the
 * third is not written out (grill:acct, or grill:metric before a name the code fills in).
 * The launch-list counts by source (notify_confirmed_via_tool) are one family.
 */
function keyFamily(literal) {
  const parts = literal.split(":");
  const family = parts[2] ? parts.slice(0, 3).join(":") : parts.slice(0, 2).join(":");
  return family.replace(/_via_.*$/, "");
}

/** Every key family in the code, from each quoted or template literal that starts with grill: */
function keyFamilies() {
  const found = new Set();
  for (const file of KEY_SOURCES) {
    for (const match of readFileSync(join(ROOT, file), "utf8").matchAll(/[`"']grill:[A-Za-z0-9_:.-]*/g)) found.add(keyFamily(match[0].slice(1)));
  }
  return [...found].sort();
}

// Each key family, and the row of docs/DATA-LEDGER.md that says what it holds.
const FAMILY_ROWS = {
  "grill:hosted:acct": "Verified email",
  "grill:hosted:email": "Verified email",
  "grill:hosted:person": "Account links",
  "grill:hosted:ident": "Account links",
  "grill:hosted:idents": "Account links",
  "grill:hosted:owner": "Owner email, for an AgentID sign-in",
  "grill:hosted:disclosed": "Disclosure flag",
  "grill:hosted:job": "The layers the chat can show",
  "grill:hosted:pending": "Draft, if you chose to keep records",
  "grill:hosted:pendings": "Draft, if you chose to keep records",
  "grill:hosted:record": "Decision record",
  "grill:hosted:records": "Decision record",
  "grill:hosted:rkey": "Decision record",
  "grill:hosted:share": "Shared verdict",
  "grill:hosted:shareof": "Shared verdict",
  "grill:hosted:calfeed": "Calendar link",
  "grill:hosted:calof": "Calendar link",
  "grill:hosted:reminded": "Look-back reminder mark",
  "grill:hosted:impact-sent": "Weekly impact email",
  "grill:hosted:spendlog": "Spend of that key",
  "grill:hosted:capspend": "Monthly spend counters for the caps",
  "grill:hosted:invite": "Invite-code redemption",
  "grill:hosted:running": "Running-job counter and daily check count",
  "grill:hosted:day": "Running-job counter and daily check count",
  "grill:hosted:checks": "Monthly check count",
  "grill:hosted:run": "Same-run lock",
  "grill:hosted:counted": "Same-run lock",
  "grill:hosted:active": "Active-user counts",
  "grill:hosted:outside": "Outside-count marks",
  "grill:hosted:waitlist": "Waitlist",
  "grill:hosted:founding": "Founding member number",
  "grill:hosted:react": "Latest grill, so a reaction can name it",
  "grill:hosted:feedback": "Reaction to a grill",
  "grill:hosted:feedbackof": "Reaction to a grill",
  "grill:hosted:feedbackrate": "Reaction rate limit",
  "grill:metric:outside": "Outside-use counters",
  "grill:metric:start_views": "`/start` source",
  "grill:metric:start_ref": "`/start` source",
  "grill:metric:paid_intent_pricing": "Paid-intent counts",
  "grill:metric:paid_intent_checkout": "Paid-intent counts",
  "grill:metric:paid_intent_notify": "Paid-intent counts",
  "grill:metric:free_to_paid": "Checkout linked to an account",
  "grill:checkout:linked": "Checkout linked to an account",
  "grill:metric:waitlist_signup": "Waitlist",
  "grill:metric:funnel_grills": "The look-back funnel",
  "grill:metric:funnel_choices": "The look-back funnel",
  "grill:metric:funnel_lookbacks_set": "The look-back funnel",
  "grill:metric:funnel_lookbacks_done": "The look-back funnel",
  "grill:metric:impact_email_lookbacks": "The impact-email pilot",
  "grill:metric:impact_email_unsubscribes": "The impact-email pilot",
  "grill:exp:weekly-email": "The weekly email test",
  "grill:miss:queue": "Miss cards",
  "grill:miss:count": "Miss cards",
  "grill:acct": "Pro account store",
  "grill:email": "Pro account store",
  "grill:stripe": "Pro account store",
  "grill:nonce": "Pro account store",
  "grill:metric": "Pro account store",
  "grill:notify:cool": "Pro launch list",
  "grill:notify:sent": "Pro launch list",
  "grill:notify:counted": "Pro launch list",
  "grill:metric:notify_confirmed": "Pro launch list",
  "grill:ping:id": "Install pings",
  "grill:ping:n": "Install pings",
  "grill:ping:rate": "Install pings",
  "grill:ping:unique": "Install pings",
};

describe("every store key the code writes has a row in the data ledger", () => {
  it("reads key families the way the code writes them", () => {
    assert.equal(keyFamily("grill:hosted:record:"), "grill:hosted:record");
    assert.equal(keyFamily("grill:hosted:invite:stored:count"), "grill:hosted:invite");
    assert.equal(keyFamily("grill:acct:"), "grill:acct");
    assert.equal(keyFamily("grill:metric:"), "grill:metric");
    assert.equal(keyFamily("grill:metric:notify_confirmed_via_tool"), "grill:metric:notify_confirmed");
    assert.equal(keyFamily("grill:metric:outside:"), "grill:metric:outside");
    const families = keyFamilies();
    // The two families the outside counters added are found, one of them only in scripts/outsideLoopCore.mjs.
    assert.ok(families.includes("grill:metric:outside") && families.includes("grill:hosted:outside"), families.join(" "));
    assert.ok(families.length > 50, `only ${families.length} families found`);
  });

  it("maps every family to a ledger row, and fails on one it has not mapped", () => {
    const families = keyFamilies();
    assert.deepEqual(families.filter((family) => !(family in FAMILY_ROWS)), [], "a key family the ledger map does not name");
    assert.deepEqual(Object.keys(FAMILY_ROWS).filter((family) => !families.includes(family)).sort(), [], "a mapped family the code no longer writes");
    const ledger = readFileSync(join(ROOT, "docs/DATA-LEDGER.md"), "utf8");
    const lines = ledger.split("\n");
    for (const [family, row] of Object.entries(FAMILY_ROWS)) {
      assert.ok(ledger.includes(`| \`${family}\` | ${row} |`), `the ledger's key list has no line for ${family}`);
      const titled = lines.some((line) => !line.startsWith("| `grill:") && (line.startsWith(`| ${row}`) || line.startsWith(`- ${row}`) || line.startsWith(`## ${row}`)));
      assert.ok(titled, `the ledger has no row called ${row}`);
    }
  });
});
