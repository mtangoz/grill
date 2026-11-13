// /data-flow/ says where a decision goes on each route, who sees it, and what Grill keeps and
// for how long. Every sentence on it is written from the code, so this file checks the page
// against the code: each of the statements the page must make, each number against the
// constant it comes from, and the whole page text, so a sentence cannot be added or dropped
// without this file changing too.
//
// The site is built in a scratch copy of the files the build reads, as in
// scripts/howWeTest.test.mjs, so this file never shares _site with the other test files.
// The helpers below are copied from that file on purpose: importing a test file would run its
// tests twice.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_FLOW_URL,
  JOB_TTL_SECONDS,
  JUDGE_PACKET_MAX,
  JUDGE_PAGE_UNVERIFIED_LINE,
  MAX_SUBJECT_CHARS,
  ONCE_DISCLOSURE as HOSTED_ONCE,
  ONCE_DISCLOSURE_UNVERIFIED as HOSTED_ONCE_UNVERIFIED,
  PENDING_KEEP_DAYS,
  RECORDS_NOTE,
  independenceLine,
  onceDisclosureFor,
} from "./hostedCore.mjs";
import { FEEDBACK_KEEP_DAYS, REASON_MAX } from "./feedbackCore.mjs";
import { IMPACT_PILOT_LAST, impactArm } from "./impactDigest.mjs";
import { CHECK_MAX_CHALLENGES, CHECK_WRITE_UP_BUDGET, JEV_MODEL, JEV_PROVIDER, buildCheckRequest } from "./checkCore.mjs";
import { RUN_PRIVACY_LINE } from "./judgeCore.mjs";
import { CAME_BACK_AFTER_MS, OUTSIDE_APPS } from "./outsideLoopCore.mjs";
import { decisionTitle } from "./reflection.mjs";
import { GUESSED_AUTHOR_LINE, INDEPENDENCE_NOT_VERIFIED, ONCE_DISCLOSURE, ONCE_DISCLOSURE_UNVERIFIED, buildGrillTools } from "../server/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");

const URL_PATH = "data-flow/";
const CANONICAL = `https://grillyour.ai/${URL_PATH}`;
const TITLE = "Where your decision goes | Grill";
const H1 = "Where your decision goes.";
const DESCRIPTION = "Where your decision goes when you grill it, who sees it, and what Grill keeps and for how long, route by route.";
const BLURB = "Route by route: what leaves your assistant when you grill a decision, who sees it, and what Grill keeps and for how long.";
const CTA = '<p class="cta"><a class="button" href="/start/?ref=data-flow">Connect Grill</a></p>';
const PRIVACY_LINE =
  "Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us.";

/** An en dash or an em dash, built from code points so this file holds neither. */
const LONG_DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

const SECTIONS = {
  chat: "Grill in chat",
  installed: "The installed tool",
  paste: "Copy and paste, and the skill",
  judge: "The /judge link",
  others: "Who else is involved",
};

/**
 * Every line a reader sees on the built page, in order, from the heading to the footer. A link
 * is its words. A sentence that is not here is not on the page.
 */
const PAGE_TEXT = [
  "Where your decision goes.",
  "What leaves your assistant when you grill a decision, who sees it, and what Grill keeps and for how long. Route by route, written from Grill's code.",
  "Grill in chat",
  "This is Grill connected to the AI you already use, with a Grill account, at grillyour.ai/mcp.",
  "What your assistant sends. Your assistant sends the decision in a Grill tool call. Grill tells it to send the decision as you stated it, with at most a few sentences of context, and not to wait for a second OK. Grill accepts up to 200,000 characters and does not check that the assistant kept to a few sentences.",
  "Not masked on Grill's server. Grill's server gets your decision as your assistant sent it, not masked. Masking is applied to the copy sent on to the model router: email addresses, phone numbers, card and bank numbers, ID numbers, labelled dates of birth, street addresses, postcodes and IP addresses are hidden, and anything that looks like a key, a token or a password stops the run. What Grill keeps is not masked.",
  "The line that starts \"Private:\". The line under each verdict that starts \"Private:\" is about the request to the judge. It does not describe what Grill keeps.",
  "15 minutes, records on or off. Every grill that gets a verdict, records on or off, leaves an encrypted copy of the full decision and the short verdict for 15 minutes, so that a reaction can include it. Grill's operators hold the key. For the same 15 minutes Grill keeps a salted one-way fingerprint of the decision, so that a retry of the same grill is counted once. When records are off, or the judge takes longer than 45 seconds, the result also waits 15 minutes, encrypted with a key that is in the job ID your assistant gets back.",
  "The records question. The first grill on a new account asks once whether to keep records, with one paragraph on where the decision goes. Grill tells your assistant to ask you once before keeping records. Grill's server does not check that it asked. It acts on the yes or no the assistant sends. If the assistant sends a yes or no with its first call, you do not see the question or the paragraph. Until there is an answer, the decision is not sent on and not kept.",
  "If you keep records. Grill saves a draft when the verdict comes back, before you say what you chose. The draft holds the first line of your decision (up to 2,000 characters, so all of it when it is one line), the verdict, the cheap test, the first two challenges, any prediction, goal or guardrail in your words, the app it came from, and the longer versions of the verdict. It is deleted after 14 days if you never state a choice, or when you turn records off or press Delete all. When you state a choice, it becomes your decision record, which stays until you delete it. Records and drafts are encrypted, and Grill's operators could open them.",
  "The Monday email. It is on unless you turn it off. It goes on a Monday when your account saved a decision that week or a look-back came due. It is sent through Resend. It carries your email address, how many of that week's grills changed your call, and for each look-back that came due, the first sentence of that decision with three links to say how it went. To write it, a job opens kept records each Monday. One account in four, fixed by its account ID, is held out and gets no email, to test whether the email helps. Lists of account IDs, of who was sent the email, who was held out and who came back within a week, are kept 180 days. Sending is set to stop after 25 January 2027.",
  "The address that starts the Monday job. The web address that starts the Monday job is public and needs no sign-in. Anyone can call it, and it returns three counts: emails sent, held out and skipped. A second call on the same Monday does not send anyone a second email.",
  "The quality check. Unless you say skip the check, the decision also goes to one fixed model at TypeSafe, called Jev, through OpenRouter, to check the judge's work. It gets the masked decision (the first 60,000 characters), your question, the verdict and the top five challenges. That request carries no zero-retention flag. What Grill relies on instead: TypeSafe is the only provider of that model on OpenRouter, a weekly check flags it if any endpoint serving it is not on OpenRouter's zero-retention list, and Grill reads an answer only if TypeSafe served it. By then the request has gone. In chat there is no account setting that turns it off. You say skip the check, one grill at a time.",
  "A reaction. If you tell your assistant a grill helped or did not, Grill keeps the rating, your one-line reason, the verdict label, the judge model, the time and a one-way hash of your account ID, for 180 days, encrypted with a key Grill's operators hold. The decision is added only if you say yes to sending that grill.",
  "The counters. When a grill on your account first gets a verdict, when you grill again 20 hours or more later, when you first answer the records question, and when you save a choice or a look-back, Grill adds one to a counter. The counters hold whole numbers, each filed under a day (your first grill, your answer, your choice, or the day a look-back falls due) or under the name of the app. They hold no title, text, verdict or account ID. Accounts on Grill's own list of maintainer, test and reviewer addresses are not counted. With few accounts these numbers describe a handful of people, and Grill's operators can tell who.",
  "What goes with the counters. Nobody is counted while that list is not set. No job opens a kept record to make these counts, and deleting a record or the account does not lower one. A counted account has a few marks under its account ID: the time of its first grill with a verdict, a mark once it has been counted as coming back, and the day its first look-back is counted under. They are deleted with the account. A saved decision also holds the time of its first look-back answer and the day its look-back is counted under. The export shows them as lookback_first_at and lookback_counted_day. Two more keys each hold one day: the day counting began, and the last day Grill's server handled one of these events, from any account, while that list was set.",
  "Kept either way. Your account, with your email address. The time, cost and judge model of your last 400 grills. Daily and monthly counts of your use, counts of active people made from one-way hashes, and Grill-wide counts of grills, choices and look-backs. Deleting your account removes your records, drafts, reactions, account and that list of grills. It does not lower any count, and your account ID stays in the Monday email lists until they expire.",
  "Cookies. /start sets no cookie while sign-up is open. While sign-up is invite-only, a link with a source tag sets one cookie holding that tag for 30 days. Signing in sets sign-in cookies.",
  "Which company judges. The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. Grill can tell when it recognises the app you connected from, or when your assistant names its company on the call. A company your assistant names replaces the one Grill recognised. In Cursor, or in an app Grill does not recognise, nobody is ruled out, and the verdict ends with a line that starts \"Independence not verified:\", such as \"Independence not verified: Grill couldn't tell which company's model wrote this, so no company was ruled out.\"",
  "The installed tool",
  "This is Grill in Claude Desktop, in Claude Code, or run with npx, on your own OpenRouter key.",
  "What leaves your computer. Your decision goes from your computer to OpenRouter, masked as above, then to the judge model, and to the quality check unless you switch it off in Grill's settings or say skip the check. Grill's server does not see it, unless you later say yes to sending that grill with a reaction. Grill tells your assistant to send the decision without waiting for a second OK, and it accepts up to 200,000 characters.",
  "Read-only. The installed grill tool is marked read-only, so some apps run it without asking first. A judge model named in Grill's settings is used instead of the router's pick. One from the company Grill rules out is refused.",
  "A reaction. A reaction is a call to Grill's server. It keeps the same things as in chat, for 180 days, with a one-way hash of a random ID for that session in place of an account. The decision is added only if you say yes to sending that grill.",
  "Usage stats. Off unless you turn them on. Then one ping goes to Grill's website after the first grill that works, with no words from the decision.",
  "Which company judges. The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. Grill can tell when GRILL_AUTHOR is set in its settings, when the app gives a name Grill recognises, such as Claude, ChatGPT, Grok or Gemini, or when your assistant names its company on the call. Otherwise it rules out Anthropic only, and the verdict ends with: \"Independence not verified: Grill couldn't tell which AI you're using, so it ruled out Anthropic only. Set GRILL_AUTHOR, or name your assistant's company next time.\"",
  "The version you can install today is 0.1.1, released on 29 September 2026. It differs from what this section describes:",
  "It asks for your OK. It tells your assistant to show you the write-up and to send it only after you approve.",
  "It masks less. It hides email addresses, phone numbers and card numbers only. A key, a token or a password still stops the run.",
  "No reaction and no usage stats. It has no reaction tool and no usage ping, so it sends nothing to Grill's server.",
  "It says less about the judge. Only a company named on the call changes who is ruled out. It does not read GRILL_AUTHOR or the app's name. With no company named, it rules out Anthropic and adds no line about it. An author of none on the call rules out nobody.",
  "Copy and paste, and the skill",
  "No Grill server. Grill's server gets none of your decision. Your assistant writes a prompt with your decision in it. You choose where to paste it, and it goes to that assistant under its own settings.",
  "A link, if you use it. Under 6,000 characters the skill can also give an Open in ChatGPT link. That puts the decision in a web address and in your browser history.",
  "Masking is asked for, not done by code. Your assistant is asked to hide email addresses, phone numbers and card numbers before it gives you the prompt.",
  "Which company judges. The prompt asks the judge to name its maker, and your assistant warns you if it is the same company as your assistant, or if it cannot tell. Nothing stops you pasting it into the same company's assistant.",
  "The skill. In a chat with no Grill tool, the Grill skill uses this route. Where the installed tool is there, it uses the tool, as above. The skill in the 0.1.1 release asks you to approve the write-up before you paste it or before the tool sends it.",
  "The look-back page. It reads records you paste in your browser. It counts how many you pasted, and sends no words.",
  "The /judge link",
  "The decision is in the address. The /judge link is for an assistant that cannot connect Grill. The link carries your decision in its address. Opening it delivers the decision to Grill's server and to the host's request log before you press anything, and it stays in your browser history.",
  "Signing in. If you are not signed in, the address you come back to, with the decision in it, goes to Clerk, the sign-in company. Grill refuses a decision over 4,000 characters and does not pass it on.",
  "The button. The judge runs only when you press the button. From then on it is the same as Grill in chat: the same masking, the same 15-minute copy, and the same records question and draft.",
  "Which company judges. The judge is from a different company than the one that wrote the plan, when Grill can tell which that is. Here it can tell only from the link's from name. With no from name it knows, nobody is ruled out, and the page shows a line above the button that starts \"Independence not verified:\". The verdict carries a line that starts the same way.",
  "Who else is involved",
  "OpenRouter. The model router. It gets the masked decision and your question, on a key Grill holds for your account in chat, or on your own key for the installed tool. On every judge request Grill asks it to use only zero-retention endpoints and not to collect the data. Grill also uses it to make and limit the key for your account, named with a random ID, not your email.",
  "The judge model's provider. Whichever company's model the router picks. It sees the masked decision and your question, under that same request.",
  "TypeSafe. The quality check. It sees the masked decision, your question, the verdict and the top five challenges, with no zero-retention flag on that request.",
  "Clerk. It runs sign-in with an emailed code, and keeps your email and the sign-in events. On the /judge link it can get the address with your decision in it.",
  "Upstash. It stores what Grill keeps. Records, drafts, the 15-minute copy and reactions are encrypted before they reach it. Your account, with your email address, and the counts are not.",
  "Resend. It sends the Monday email, so it sees your address, the week's counts and the first sentence of each decision that came due. It also sends the launch list emails.",
  "Vercel. It hosts this site and Grill's server. Its request log sees each address asked for, including a /judge link with a decision in it. It counts website visits without cookies.",
  "Only in some setups. AgentID, when an agent signs in for a person, tells Grill that person's verified email. PostHog counts website visits too, only if Grill's operators switch it on.",
  "Connect Grill",
  "Open source · Contribute · GitHub · Privacy · About · Contact",
  "Made at Hold",
].join("\n");

// ---------------------------------------------------------------------------
// Building in a scratch copy (copied from scripts/howWeTest.test.mjs).

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
  const dir = mkdtempSync(join(tmpdir(), "grill-data-flow-"));
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

/** Run the copied build. Deploy and feature switches from the shell are left out. */
function buildIn(dir) {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(GRILL_|VERCEL_)/.test(name)) env[name] = value;
  }
  execFileSync(process.execPath, [join(dir, "scripts", "build-site.mjs")], { env, stdio: "pipe" });
  const out = (file) => readFileSync(join(dir, "_site", file), "utf8");
  return { html: out(`${URL_PATH}index.html`), md: out(`${URL_PATH}index.md`), llms: out("llms.txt"), sitemap: out("sitemap.xml"), out };
}

// ---------------------------------------------------------------------------
// Reading a built page (copied from scripts/howWeTest.test.mjs).

const decode = (text) =>
  text
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const mainOf = (html) => {
  const from = html.indexOf('<main id="top"');
  const to = html.indexOf("</main>", from);
  assert.ok(from > 0 && to > from, "the built page has a <main>");
  return html.slice(from, to);
};

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

const fromHeading = (html) => {
  const main = mainOf(html);
  const at = main.indexOf("<h1>");
  assert.ok(at > 0, "the built page has an <h1>");
  return main.slice(at);
};

const headerOf = (html) => {
  const main = mainOf(html);
  return main.slice(0, main.indexOf("<h1>"));
};

function htmlSection(html, heading) {
  const main = mainOf(html);
  const from = main.indexOf(`<h2>${heading}</h2>`);
  assert.ok(from >= 0, `the page has the section "${heading}"`);
  const rest = main.slice(from + 4);
  const ends = [rest.indexOf("<h2>"), rest.indexOf('<p class="cta">')].filter((at) => at >= 0);
  return main.slice(from, from + 4 + Math.min(...ends));
}

function mdSection(md, heading) {
  const from = md.indexOf(`## ${heading}\n`);
  assert.ok(from >= 0, `the Markdown twin has the section "${heading}"`);
  const rest = md.slice(from + 3);
  const ends = [rest.indexOf("\n## "), rest.indexOf("\n[Connect Grill]")].filter((at) => at >= 0);
  return md.slice(from, from + 3 + Math.min(...ends));
}

const itemsOf = (sectionHtml) => [...sectionHtml.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => decode(match[1]));

const mdText = (md) =>
  md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/^- /gm, "")
    .replace(/[ \t]+/g, " ");

const twinLines = (md) =>
  mdText(md)
    .split("\n")
    .map((line) => line.replace(/^#{1,6} /, "").trim())
    .filter(Boolean)
    .join("\n");

/** One section's words, on the page and in the twin, each flattened to one line. */
const sectionWords = (built, heading) => ({
  page: textOf(htmlSection(built.html, heading)).replace(/\s+/g, " "),
  twin: mdText(mdSection(built.md, heading)).replace(/\s+/g, " "),
});

/** The item of a section that opens with this bold label, as text. */
function item(built, heading, label) {
  const found = itemsOf(htmlSection(built.html, heading)).filter((li) => li.startsWith(`<strong>${label}</strong> `));
  assert.equal(found.length, 1, `"${heading}" has one item "${label}"`);
  return found[0].replace(/<[^>]+>/g, "");
}

/** Assert each sentence is in the section, on the page and in the twin. */
function says(built, heading, ...sentences) {
  const { page, twin } = sectionWords(built, heading);
  for (const sentence of sentences) {
    assert.ok(page.includes(sentence), `"${heading}" on the page says: ${sentence}`);
    assert.ok(twin.includes(sentence), `"${heading}" in the twin says: ${sentence}`);
  }
}

// Words this page must never carry: the plan's list for all public copy, and a few more.
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
  "guarantee",
  "decorrelat",
  "accurate",
];

const STANDS_ALONE = [/\bwhen grill can tell\b/i];
const unconditional = (text) =>
  text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+/))
    .filter((sentence) => /\b(different|another) company\b/i.test(sentence))
    .filter((sentence) => !STANDS_ALONE.some((shape) => shape.test(sentence)));

/** "2027-01-25" as the page writes it. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayWords = (iso) => {
  const [year, month, date] = iso.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
};
/** 200000 as the page writes it. */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

let built;
before(() => {
  built = buildIn(scratchTree());
});
after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("the /data-flow page", () => {
  it("is a script-free prose page in the shared chrome", () => {
    const source = read("site/data-flow.html");
    const about = read("site/about.html");
    assert.ok(source.startsWith(`<title>${TITLE}</title>\n`));
    assert.doesNotMatch(source, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script|<table|<dl[\s>]|onclick=|javascript:/i);
    assert.equal((source.match(/<h1>/g) ?? []).length, 1);
    assert.ok(source.includes(`<h1>${H1}</h1>`));
    const header = (html) => html.slice(html.indexOf('<main id="top" class="prose">'), html.indexOf("  <h1>"));
    const footer = (html) => html.slice(html.indexOf('  <div class="footer">'));
    assert.ok(header(about).includes('<nav aria-label="Sections">') && footer(about).includes("Made at"), "the about page still has both");
    assert.equal(header(source), header(about));
    assert.equal(footer(source), footer(about));
    const classes = new Set([...source.matchAll(/class="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/)));
    assert.deepEqual([...classes].sort(), ["button", "cta", "footer", "lede", "mark", "note", "prose", "steps", "top"]);
    assert.doesNotMatch(source, LONG_DASH);
  });

  it("builds to /data-flow/ with a Markdown twin that says what the page says, in the sitemap and llms.txt", () => {
    assert.match(built.html, new RegExp(`<title>${TITLE.replace(/[|]/g, "\\|")}</title>`));
    assert.ok(built.html.includes(`<link rel="canonical" href="${CANONICAL}">`));
    assert.ok(built.html.includes(`<meta property="og:title" content="${TITLE}">`));
    assert.ok(built.html.includes(`<meta name="description" content="${DESCRIPTION}">`));
    assert.ok(DESCRIPTION.length < 160, `the description is ${DESCRIPTION.length} characters`);
    assert.ok(built.sitemap.includes(`<loc>${CANONICAL}</loc>`));
    assert.deepEqual(
      built.llms.split("\n").filter((line) => line.includes(`](${CANONICAL})`)),
      [`- [Where your decision goes](${CANONICAL}): ${BLURB}`],
    );
    assert.ok(built.md.startsWith(`# ${H1}\n`));
    assert.doesNotMatch(mainOf(built.html), /<script|<style|<table/i);
    const pageHeadings = [...mainOf(built.html).matchAll(/<h2>([^<]*)<\/h2>/g)].map((match) => decode(match[1]));
    assert.deepEqual(pageHeadings, Object.values(SECTIONS));
    assert.deepEqual([...built.md.matchAll(/^## (.*)$/gm)].map((match) => match[1]), pageHeadings);
    // The address the records note and the once-only line point at is this page's.
    assert.equal(DATA_FLOW_URL, CANONICAL);
  });

  it("says these lines and no others, on the page and in its Markdown twin", () => {
    assert.equal(textOf(fromHeading(built.html)), PAGE_TEXT);
    assert.equal(twinLines(built.md), PAGE_TEXT);
    assert.equal(headerOf(built.html), headerOf(built.out("about/index.html")));
  });

  it("ends with exactly one call to action, tagged for this page", () => {
    const main = mainOf(built.html);
    assert.equal(main.split(CTA).length - 1, 1);
    assert.equal((main.match(/class="cta"/g) ?? []).length, 1);
    assert.equal((main.match(/class="button"/g) ?? []).length, 1);
    assert.match(main, new RegExp(`${CTA.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\s*<div class="footer">`), "nothing follows the button but the footer");
    assert.ok(built.md.includes("\n[Connect Grill](https://grillyour.ai/start/?ref=data-flow)\n"));
    assert.equal((built.md.match(/\?ref=data-flow/g) ?? []).length, 1);
    assert.ok(read("scripts/weeklyMetricsCore.mjs").includes('"data-flow"'), "the weekly report reads this page's label");
  });

  it("has no long dash and none of the words Grill does not say, and every different-company sentence keeps its condition", () => {
    const line = built.llms.split("\n").find((l) => l.includes(`](${CANONICAL})`));
    for (const [where, raw] of [["the page", textOf(mainOf(built.html))], ["the twin", mdText(built.md)], ["the llms.txt line", line], ["the description", DESCRIPTION]]) {
      const text = raw.toLowerCase().replace(/\s+/g, " ");
      for (const phrase of NEVER) assert.ok(!text.includes(phrase), `${where} says "${phrase}"`);
      assert.doesNotMatch(raw, LONG_DASH, `${where} has a long dash`);
      assert.deepEqual(unconditional(raw), [], `${where} says different company without the condition`);
    }
    // The check itself catches the plain claim.
    assert.deepEqual(unconditional("The judge is from a different company. Then stop."), ["The judge is from a different company."]);
  });
});

describe("the statements /data-flow/ must make", () => {
  it("1: Grill's server gets the decision unmasked, masking is for the copy sent on, and what Grill keeps is not masked", () => {
    says(
      built,
      SECTIONS.chat,
      "Grill's server gets your decision as your assistant sent it, not masked.",
      "Masking is applied to the copy sent on to the model router:",
      "What Grill keeps is not masked.",
    );
    // The code: the draft title is the raw first line, while the judge masks what it sends.
    assert.equal(decisionTitle("Email me at someone@example.com about it"), "Email me at someone@example.com about it");
    assert.match(read("scripts/judge.mjs"), /const subjectRaw = outgoing\(subjectParts\.join\("\\n\\n"\), "subject"\);/);
    assert.match(read("api/_hosted.mjs"), /title: decisionTitle\(subject\),/);
  });

  it("2: the line that starts Private: is about the request to the judge, not about what Grill keeps", () => {
    says(built, SECTIONS.chat, 'The line under each verdict that starts "Private:" is about the request to the judge. It does not describe what Grill keeps.');
    assert.ok(RUN_PRIVACY_LINE.startsWith("Private: "));
  });

  it("3: every grill with a verdict, records on or off, leaves a 15-minute encrypted copy under a key the operators hold", () => {
    says(
      built,
      SECTIONS.chat,
      "Every grill that gets a verdict, records on or off, leaves an encrypted copy of the full decision and the short verdict for 15 minutes, so that a reaction can include it. Grill's operators hold the key.",
    );
    assert.equal(JOB_TTL_SECONDS, 15 * 60);
    const hosted = read("api/_hosted.mjs");
    const remember = hosted.slice(hosted.indexOf("async function rememberGrill("), hosted.indexOf("async function storeJobResult("));
    assert.match(remember, /keyFromEnv\(deps\.env, "GRILL_RECORD_KEY"\)/);
    assert.match(remember, /String\(JOB_TTL_SECONDS\)/);
    assert.match(hosted, /grill: \{\n\s+subject,\n/);
  });

  it("4: with records on, a draft is saved before the choice, says what it holds, and is deleted after 14 days, on records off and on Delete all", () => {
    says(
      built,
      SECTIONS.chat,
      "Grill saves a draft when the verdict comes back, before you say what you chose.",
      "The draft holds the first line of your decision (up to 2,000 characters, so all of it when it is one line), the verdict, the cheap test, the first two challenges, any prediction, goal or guardrail in your words, the app it came from, and the longer versions of the verdict.",
      `It is deleted after ${PENDING_KEEP_DAYS} days if you never state a choice, or when you turn records off or press Delete all.`,
    );
    assert.equal(PENDING_KEEP_DAYS, 14);
    assert.equal(decisionTitle("x".repeat(3000)).length <= 2000, true);
    assert.equal(decisionTitle("y".repeat(2000)), "y".repeat(2000));
    assert.match(read("api/_hosted.mjs"), /challenges: challenges\.slice\(0, 2\)/);
  });

  it("5: Grill tells the assistant to ask once, and its server does not check that it asked", () => {
    says(
      built,
      SECTIONS.chat,
      "Grill tells your assistant to ask you once before keeping records. Grill's server does not check that it asked. It acts on the yes or no the assistant sends.",
      "If the assistant sends a yes or no with its first call, you do not see the question or the paragraph.",
    );
    const hosted = read("api/_hosted.mjs");
    assert.match(hosted, /if \(account\.records !== "keep" && account\.records !== "off" && typeof keepArg !== "boolean"\) \{\n\s+return toolText\(CONSENT_TEXT\);/);
    assert.ok(RECORDS_NOTE.endsWith(CANONICAL), "the paragraph under the question links this page");
  });

  it("6: the Monday email, on unless turned off, through Resend, what it carries, the job that opens records, the holdout, the 180-day lists and the stop date", () => {
    says(
      built,
      SECTIONS.chat,
      "It is on unless you turn it off.",
      "It is sent through Resend.",
      "It carries your email address, how many of that week's grills changed your call, and for each look-back that came due, the first sentence of that decision with three links to say how it went.",
      "To write it, a job opens kept records each Monday.",
      "One account in four, fixed by its account ID, is held out and gets no email, to test whether the email helps.",
      "Lists of account IDs, of who was sent the email, who was held out and who came back within a week, are kept 180 days.",
      `Sending is set to stop after ${dayWords(IMPACT_PILOT_LAST)}.`,
    );
    assert.equal(dayWords(IMPACT_PILOT_LAST), "25 January 2027");
    // One in four, from the code: the split is the account ID's hash, modulo 4.
    const digest = read("scripts/impactDigest.mjs");
    assert.match(digest, /return byte % 4 === 0 \? "holdout" : "send";/);
    let held = 0;
    for (let i = 0; i < 4000; i += 1) if (impactArm(`g_${i}`) === "holdout") held += 1;
    assert.ok(held > 850 && held < 1150, `${held} of 4000 held out`);
    // 180 days on every list of account IDs.
    const hosted = read("api/_hosted.mjs");
    assert.equal((hosted.match(/\["EXPIRE", key, String\(180 \* 24 \* 60 \* 60\)\]/g) ?? []).length, 2);
    assert.match(hosted, /await sendResendEmail\(deps\.env, deps\.fetch, \{/);
    assert.match(hosted, /const rows = await loadRecords\(account, deps\);/);
    assert.match(digest, /lines\.push\(`Look-back due: \$\{item\.label\}`\);/);
    assert.match(digest, /return account\.impactEmail !== false;/);
  });

  it("7: the quality check goes to one fixed TypeSafe model unless skipped, with no zero-retention flag, and says what Grill relies on", () => {
    says(
      built,
      SECTIONS.chat,
      "Unless you say skip the check, the decision also goes to one fixed model at TypeSafe, called Jev, through OpenRouter, to check the judge's work.",
      `It gets the masked decision (the first ${grouped(CHECK_WRITE_UP_BUDGET)} characters), your question, the verdict and the top five challenges.`,
      "That request carries no zero-retention flag.",
      "What Grill relies on instead: TypeSafe is the only provider of that model on OpenRouter, a weekly check flags it if any endpoint serving it is not on OpenRouter's zero-retention list, and Grill reads an answer only if TypeSafe served it.",
    );
    assert.equal(CHECK_MAX_CHALLENGES, 5);
    assert.equal(JEV_PROVIDER, "TypeSafe");
    assert.ok(JEV_MODEL.startsWith("typesafe/"));
    const body = buildCheckRequest({ subject: "s", question: "q", result: { verdict: "holds", challenges: [] } });
    assert.deepEqual(Object.keys(body).sort(), ["model", "questions", "state"], "no provider field, so no zero-retention flag");
    assert.match(read("api/_hosted.mjs"), /check: args\.quality_check !== false,/);
  });

  it("8: the address that starts the Monday job is public and returns three counts", () => {
    says(built, SECTIONS.chat, "The web address that starts the Monday job is public and needs no sign-in. Anyone can call it, and it returns three counts: emails sent, held out and skipped.");
    assert.match(read("api/_hosted.mjs"), /return \{ sent, held, skipped, week: week\.key \};/);
    assert.match(read("api/hosted.js"), /if \(r === "digest"\) return \["digest", handleImpactDigest\];/);
  });

  it("9: Grill accepts up to 200,000 characters and does not check that the assistant kept to a few sentences", () => {
    says(built, SECTIONS.chat, `Grill accepts up to ${grouped(MAX_SUBJECT_CHARS)} characters and does not check that the assistant kept to a few sentences.`);
    says(built, SECTIONS.installed, `it accepts up to ${grouped(MAX_SUBJECT_CHARS)} characters.`);
    assert.equal(MAX_SUBJECT_CHARS, 200_000);
    assert.match(read("server/index.mjs"), /^const MAX_SUBJECT_CHARS = 200_000;$/m);
  });

  it("10: a reaction keeps its fields for 180 days, and on the installed tool it is a call to Grill's server", () => {
    says(
      built,
      SECTIONS.chat,
      `If you tell your assistant a grill helped or did not, Grill keeps the rating, your one-line reason, the verdict label, the judge model, the time and a one-way hash of your account ID, for ${FEEDBACK_KEEP_DAYS} days, encrypted with a key Grill's operators hold.`,
      "The decision is added only if you say yes to sending that grill.",
    );
    says(built, SECTIONS.installed, `A reaction is a call to Grill's server. It keeps the same things as in chat, for ${FEEDBACK_KEEP_DAYS} days`);
    assert.equal(FEEDBACK_KEEP_DAYS, 180);
    assert.ok(REASON_MAX > 0);
    assert.match(read("scripts/usageStats.mjs"), /https:\/\/grillyour\.ai\/api\/feedback/);
  });

  it("11: the installed grill tool is marked read-only, and a judge model in settings replaces the router's pick", () => {
    says(
      built,
      SECTIONS.installed,
      "The installed grill tool is marked read-only, so some apps run it without asking first. A judge model named in Grill's settings is used instead of the router's pick.",
    );
    for (const authorGuessed of [false, true]) {
      const [grill] = buildGrillTools({ checkOn: true, authorGuessed });
      assert.equal(grill.name, "grill");
      assert.equal(grill.annotations.readOnlyHint, true);
    }
    assert.match(read("server/index.mjs"), /if \(model\) env\.JUDGE_MODEL = model;/);
  });

  it("12: /start sets no cookie while sign-up is open, and signing in sets sign-in cookies", () => {
    says(built, SECTIONS.chat, "/start sets no cookie while sign-up is open.", "a link with a source tag sets one cookie holding that tag for 30 days.", "Signing in sets sign-in cookies.");
    const start = read("api/_start.mjs");
    assert.match(start, /if \(ref && !openSignup\(deps\.env \?\? \{\}\)\) headers\["Set-Cookie"\] = refCookie\(ref, request\);/);
    assert.match(start, /^const REF_MAX_AGE = 30 \* 24 \* 60 \* 60;$/m);
  });

  it("13: the counters, worded as the ledger words them, and what goes with them", () => {
    says(
      built,
      SECTIONS.chat,
      "When a grill on your account first gets a verdict, when you grill again 20 hours or more later, when you first answer the records question, and when you save a choice or a look-back, Grill adds one to a counter.",
      "They hold no title, text, verdict or account ID. Accounts on Grill's own list of maintainer, test and reviewer addresses are not counted. With few accounts these numbers describe a handful of people, and Grill's operators can tell who.",
      "Nobody is counted while that list is not set.",
      "The export shows them as lookback_first_at and lookback_counted_day.",
      "Two more keys each hold one day: the day counting began, and the last day Grill's server handled one of these events, from any account, while that list was set.",
    );
    assert.equal(CAME_BACK_AFTER_MS, 20 * 60 * 60 * 1000);
    assert.ok(OUTSIDE_APPS.length > 0);
    const hosted = read("api/_hosted.mjs");
    assert.match(hosted, /lookback_first_at: row\.lookbackFirstAt \|\| "",/);
    assert.match(hosted, /lookback_counted_day: row\.lookbackDueDay \|\| "",/);
  });

  it("14: who else is involved, and what each sees", () => {
    const names = ["OpenRouter.", "The judge model's provider.", "TypeSafe.", "Clerk.", "Upstash.", "Resend.", "Vercel."];
    for (const name of names) assert.ok(item(built, SECTIONS.others, name).length > name.length + 20, `${name} says what it sees`);
    says(built, SECTIONS.others, "On every judge request Grill asks it to use only zero-retention endpoints and not to collect the data.");
    assert.match(read("scripts/judge.mjs"), /body\.provider = \{ zdr: true, data_collection: "deny" \};/);
  });

  it("15: which company judges, route by route, in the conditional form, with what an unverified run says", () => {
    const rule = "The judge is from a different company than the one that wrote the plan, when Grill can tell which that is.";
    for (const heading of [SECTIONS.chat, SECTIONS.installed, SECTIONS.judge]) {
      assert.ok(item(built, heading, "Which company judges.").includes(rule), heading);
    }
    // The lines quoted are the ones the code prints.
    says(built, SECTIONS.chat, `"${independenceLine({ author: "none", sourceApp: "cursor" })}"`);
    says(built, SECTIONS.installed, `"${GUESSED_AUTHOR_LINE}"`);
    assert.ok(JUDGE_PAGE_UNVERIFIED_LINE.startsWith(INDEPENDENCE_NOT_VERIFIED));
    says(built, SECTIONS.judge, `the page shows a line above the button that starts "${INDEPENDENCE_NOT_VERIFIED}".`);
    says(built, SECTIONS.paste, "The prompt asks the judge to name its maker, and your assistant warns you if it is the same company as your assistant, or if it cannot tell.");
    assert.ok(JUDGE_PACKET_MAX === 4000);
    says(built, SECTIONS.judge, `Grill refuses a decision over ${grouped(JUDGE_PACKET_MAX)} characters and does not pass it on.`);
  });
});

describe("the once-only line and the links that point at /data-flow/", () => {
  it("points the once-only line at /data-flow/ in all four places, and keeps the unverified form built from it", () => {
    for (const line of [ONCE_DISCLOSURE, HOSTED_ONCE]) {
      assert.ok(line.endsWith(` ${CANONICAL}`), line);
      assert.ok(line.includes(" from a different company"), "the derivation has the words to remove");
    }
    assert.equal(ONCE_DISCLOSURE, HOSTED_ONCE, "same words on both servers");
    for (const line of [ONCE_DISCLOSURE_UNVERIFIED, HOSTED_ONCE_UNVERIFIED]) {
      assert.equal(line, `This goes to an outside judge, and the router does not keep it. ${CANONICAL}`);
    }
    assert.notEqual(onceDisclosureFor("none"), onceDisclosureFor("openai"));
    assert.ok(read("skills/grill/SKILL.md").includes(`and the router does not keep it. ${CANONICAL}`));
    assert.ok(read("prompts/grill.md").includes(`what you paste goes to that assistant, under its own settings. ${CANONICAL} Do not repeat`));
    for (const file of ["server/index.mjs", "scripts/hostedCore.mjs", "skills/grill/SKILL.md", "prompts/grill.md"]) {
      assert.doesNotMatch(read(file), /grillyour\.ai\/#privacy/, `${file} still points at the old anchor`);
    }
  });

  it("is linked once from the privacy page, the about page and the README", () => {
    const sentence = 'Where your decision goes on each route, and what is kept and for how long, is on <a href="/data-flow/">Where your decision goes</a>.';
    for (const file of ["site/privacy.html", "site/about.html"]) {
      const source = read(file);
      assert.equal(source.split(sentence).length - 1, 1, file);
      assert.equal((source.match(/data-flow/g) ?? []).length, 1, `${file} names the page once`);
    }
    const readme = read("README.md");
    const readmeLink = "Where your decision goes on each route, and what is kept and for how long: [grillyour.ai/data-flow](https://grillyour.ai/data-flow/).";
    assert.equal(readme.split(readmeLink).length - 1, 1);
    assert.equal((readme.match(/data-flow/g) ?? []).length, 2, "the link's words and its address, once");
  });

  it("gives the home page's privacy line the anchor the old link named, and leaves both privacy lines as they were", () => {
    const page = read("site/page.html");
    assert.ok(page.includes(`<p class="privacy" id="privacy"><a href="/terms">${PRIVACY_LINE}</a></p>`));
    assert.equal((page.match(/id="privacy"/g) ?? []).length, 1);
    assert.equal(
      RUN_PRIVACY_LINE,
      "Private: sent only to zero-data-retention endpoints, with keys blocked and common personally identifiable information masked first.",
    );
  });
});
