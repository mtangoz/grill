// The directory submission kit: docs/DIRECTORY-SUBMISSIONS.md and docs/directory/test-cases.json.
// Nothing here submits anything. These tests keep the kit true to the product: each test case
// names a real hosted tool with real arguments and quotes the product's own text, and each
// data-handling answer is quoted word for word from the built /data-flow/ page.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSENT_TEXT,
  FEEDBACK_KEPT_TEXT,
  LOOKBACK_SAVED,
  RECORDS_QUESTION,
  hostedTools,
  savedConfirmation,
} from "./hostedCore.mjs";
import { CLOSING_ASK, RUN_PRIVACY_LINE } from "./judgeCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const KIT = read("docs/DIRECTORY-SUBMISSIONS.md");
const CASES = JSON.parse(read("docs/directory/test-cases.json"));
const TOOLS = hostedTools();

// The product text an expected fragment may quote, by the name the cases file gives it.
const SOURCES = {
  RECORDS_QUESTION,
  CLOSING_ASK,
  RUN_PRIVACY_LINE,
  FEEDBACK_KEPT_TEXT,
  LOOKBACK_SAVED,
  savedConfirmation: savedConfirmation("2026-12-01"),
};

/** The arguments of a call fit the tool: every key is in its schema, every required key is there, every enum value is allowed. */
function checkArguments(toolName, args, where) {
  const tool = TOOLS.find((candidate) => candidate.name === toolName);
  assert.ok(tool, `${where}: ${toolName} is not a hosted tool`);
  const properties = tool.inputSchema.properties ?? {};
  for (const [key, value] of Object.entries(args)) {
    assert.ok(key in properties, `${where}: ${toolName} has no argument ${key}`);
    if (properties[key].enum) assert.ok(properties[key].enum.includes(value), `${where}: ${key} ${value} is not one of ${properties[key].enum}`);
    if (properties[key].type === "string") assert.equal(typeof value, "string", `${where}: ${key} is a string`);
    if (properties[key].type === "boolean") assert.equal(typeof value, "boolean", `${where}: ${key} is a boolean`);
  }
  for (const key of tool.inputSchema.required ?? []) assert.ok(key in args, `${where}: ${toolName} needs ${key}`);
}

/** Each expected fragment names its source, and is part of that source's text. */
function checkExpected(list, where) {
  for (const { source, text } of list) {
    assert.ok(source in SOURCES, `${where}: unknown source ${source}`);
    assert.ok(text.length > 0 && SOURCES[source].includes(text), `${where}: ${JSON.stringify(text)} is not in ${source}`);
  }
}

// The built page, from a scratch copy so this test never shares the build folder with another.
const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function builtDataFlow() {
  const dir = mkdtempSync(join(tmpdir(), "grill-submissions-"));
  scratch.push(dir);
  for (const part of ["site", "data", "scripts", "api"]) cpSync(join(ROOT, part), join(dir, part), { recursive: true });
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(GRILL_|VERCEL_)/.test(name)) env[name] = value;
  }
  execFileSync(process.execPath, [join(dir, "scripts", "build-site.mjs")], { env, stdio: "pipe" });
  const html = readFileSync(join(dir, "_site/data-flow/index.html"), "utf8");
  const md = readFileSync(join(dir, "_site/data-flow/index.md"), "utf8");
  return { html, md };
}

/** What a built page says, as one line of plain words. */
function plainText(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

/** The quoted answers under "## Data handling": each block line that starts with "> ". */
function dataHandlingQuotes() {
  const start = KIT.indexOf("## Data handling");
  const end = KIT.indexOf("\n## ", start + 1);
  assert.ok(start > 0 && end > start, "the kit has a Data handling section");
  return KIT.slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("> "))
    .map((line) => line.slice(2).trim());
}

describe("the directory test cases", () => {
  it("are five prompts that call a Grill tool and three that do not", () => {
    assert.equal(CASES.positive.length, 5);
    assert.equal(CASES.negative.length, 3);
    assert.equal(CASES.connector, "https://grillyour.ai/mcp");
    const ids = [...CASES.positive, ...CASES.negative].map((testCase) => testCase.id);
    assert.equal(new Set(ids).size, ids.length, "each case has its own id");
    for (const testCase of CASES.negative) {
      assert.equal(testCase.tool, null, `${testCase.id} calls no tool`);
      assert.equal("arguments" in testCase, false, `${testCase.id} has no arguments`);
    }
  });

  it("name real hosted tools with arguments those tools take, and together use all five", () => {
    for (const testCase of CASES.positive) {
      checkArguments(testCase.tool, testCase.arguments, testCase.id);
      if (testCase.then_tool) checkArguments(testCase.then_tool, testCase.then_arguments, `${testCase.id} (then)`);
    }
    const used = new Set(CASES.positive.map((testCase) => testCase.tool));
    assert.deepEqual([...used].sort(), TOOLS.map((tool) => tool.name).sort());
  });

  it("quote the product's own text for what the reviewer sees", () => {
    for (const testCase of CASES.positive) {
      checkExpected(testCase.expected, testCase.id);
      if (testCase.then_expected) checkExpected(testCase.then_expected, `${testCase.id} (then)`);
    }
    // The first grill on a new account returns the records question, the first line of the consent reply.
    assert.equal(CASES.positive[0].expected[0].text, CONSENT_TEXT.split("\n")[0]);
    assert.ok(savedConfirmation("2026-12-01").startsWith("Saved."));
  });

  it("are the same prompts in the kit's table", () => {
    for (const testCase of [...CASES.positive, ...CASES.negative]) {
      assert.ok(KIT.includes(`| ${testCase.prompt} |`), `the kit's table has no row for ${testCase.id}`);
      if (testCase.tool) assert.ok(KIT.includes(`| \`${testCase.tool}\``), `the kit's table does not name ${testCase.tool}`);
    }
  });
});

describe("the directory kit", () => {
  it("says to submit the hosted connector, not the plugin, and that nothing has been submitted", () => {
    assert.ok(KIT.includes("Submit the hosted connector, not the plugin."));
    assert.ok(KIT.includes("Nothing here has been submitted."));
    assert.ok(KIT.includes("Nothing in this repository files for you."));
  });

  it("lists public pages that exist, and the remote the registry entry names", () => {
    for (const page of ["privacy", "terms", "support", "start", "data-flow"]) {
      assert.ok(KIT.includes(`https://grillyour.ai/${page}/`), `the kit lists /${page}/`);
      assert.ok(existsSync(join(ROOT, "site", `${page}.html`)), `site/${page}.html exists`);
    }
    const server = JSON.parse(read("server.json"));
    assert.deepEqual(
      server.remotes.map((remote) => remote.url),
      ["https://grillyour.ai/mcp"],
    );
    assert.ok(KIT.includes(server.description), "the registry step quotes the description it asks the owner to change");
    assert.ok(existsSync(join(ROOT, "site/brand/icon-512.png")));
    for (const script of ["scripts/check-sign-in.mjs", "scripts/mcpSignInLive.mjs", "scripts/platformPolicy.test.mjs", "scripts/toolCopy.test.mjs"]) {
      assert.ok(KIT.includes(script), `the kit runs ${script}`);
      assert.ok(existsSync(join(ROOT, script)), `${script} exists`);
    }
  });

  it("keeps the company condition in every listing sentence that names one", () => {
    const start = KIT.indexOf("## Listing copy");
    const end = KIT.indexOf("\n## ", start + 1);
    const listing = KIT.slice(start, end);
    const sentences = listing
      .split(/\n+/)
      .flatMap((line) => line.split(/(?<=[.?!])\s+/))
      .filter((sentence) => /\b(different|another) company\b/i.test(sentence));
    assert.ok(sentences.length >= 1, "the listing says when the judge is from a different company");
    for (const sentence of sentences) assert.match(sentence, /when Grill can tell/i, sentence);
    assert.match(listing, /has not been measured yet/);
    assert.doesNotMatch(listing, /more accurate|catches what|blind spot/i);
  });

  it("names the scope-guard sentence as a review risk, in the words the hosted tool uses today", () => {
    const grill = TOOLS.find((tool) => tool.name === "grill");
    const scopeGuard = "After a grill, don't start doing the decision (no code changes, no PRs, no product questions) unless the person separately asks.";
    assert.ok(grill.description.includes(scopeGuard), "the hosted grill description still carries the scope guard");
    assert.ok(KIT.includes(`Known review risk, the scope guard. The hosted grill description tells the assistant: "${scopeGuard}"`));
    const noAdditions = "Do not add a fact list, a confidence question, or a record. Do not add a disclaimer to Grill's text.";
    assert.ok(grill.description.includes(noAdditions));
    assert.ok(KIT.includes(`"${noAdditions}"`));
  });

  it("quotes each data-handling answer word for word from the built /data-flow/ page", () => {
    const quotes = dataHandlingQuotes();
    assert.ok(quotes.length >= 15, `only ${quotes.length} answers found`);
    const { html, md } = builtDataFlow();
    const page = plainText(html);
    const twin = md.replace(/\*\*/g, "").replace(/\s+/g, " ");
    for (const quote of quotes) {
      assert.ok(page.includes(quote), `not on the built /data-flow/ page: ${quote}`);
      assert.ok(twin.includes(quote), `not in the /data-flow/ Markdown twin: ${quote}`);
    }
  });
});
