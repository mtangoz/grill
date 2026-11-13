// Tests for the four-arm comparison: scripts/fourArmCore.mjs, scripts/eval-four-arm.mjs and
// the draft protocol in evals/four-arm/. node:test and node:assert only. No key and no
// network: every model call here goes to a loopback stand-in that answers by model id.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALARM_RANK_GAP_POINTS,
  ARMS,
  ARM_A_MIN_WORDS,
  ARM_A_REQUEST,
  ARM_IDS,
  ARM_MAX_REQUESTS,
  ASK_WORDS,
  AUDIT_AGREE_FLOOR,
  AUDIT_ALARM_ITEMS,
  AUDIT_ITEMS,
  AUTHOR_FAMILIES,
  BRAND_WORDS,
  BRIEF_NAMED_FLAW_TYPES,
  COMPARISONS,
  DRAFTER_FAMILIES,
  EFFECT_POINTS,
  FLAW_TYPES,
  GAP_SEEN_REASON,
  GAP_SEEN_WORDS,
  ID_UNCONFIRMED,
  LOADED_FLAW_TYPE,
  MIN_ANALYSED_FLAWED,
  NAME_REMOVED,
  NOT_RULED_OUT_REASON,
  NO_SEEDS_LINE,
  OUTCOMES,
  OUTCOME_WORDS,
  PRIMARY_COMPARISON,
  REPORT_LABELS,
  SAME_SCENARIO_OVERLAP,
  SECONDARY_COMPARISONS,
  SEED_CATEGORIES,
  SEED_KEYS,
  SIGN_FLIP_CHANCE_NOTE,
  SPLIT_MISSING_REASON,
  TEMPLATE_PHRASES,
  TWIN_MIN_OVERLAP,
  WRITE_UP_WORDS,
  alarmRanking,
  analysedCases,
  armAMessages,
  armCounts,
  armEnv,
  armValid,
  armsModelIds,
  armsModelsChecksum,
  armsProblems,
  assignAuthors,
  auditSample,
  authorMessages,
  blind,
  buildAlarmPrompt,
  buildCatchPrompt,
  buildFlagPrompt,
  buildItems,
  buildPublicBlock,
  chatRequestBody,
  chatText,
  countWords,
  decideFourArm,
  eligibleGraders,
  factsFromBlock,
  graderCheckPassed,
  graderRequestBody,
  holm,
  judgeArgs,
  judgePromptFingerprint,
  majority,
  medianInt,
  mergeFourArmIntoResultsText,
  namesFound,
  pairTable,
  pairedDiffInterval,
  pairedReadings,
  parseFlagReply,
  parseGradeReply,
  parseOwnerLabels,
  parseSeedsJsonl,
  productChainUntouched,
  publicResult,
  readmeSeedCounts,
  registrationProblems,
  renderReport,
  renderSeedCounts,
  seedCounts,
  seedProblems,
  seedSetProblems,
  seedsChecksum,
  signFlip,
  singleDrafter,
  summarize,
  topLevelValueText,
  usableFloorMet,
  writeUpFloorMet,
  writeUpUsable,
} from "./fourArmCore.mjs";
import { AUTO_ROUTER_MAX_RETRIES, DEFAULT_CHAIN, resolveChain } from "./judgeCore.mjs";
import { FOUR_ARM_IDS, JUDGE_COMPANY_IDS, mcnemarExactP, validateFourArm, validateResults } from "./resultsCore.mjs";
import { HIT_WORD, PRODUCT_SERVES, fixtureArms, startFourArmRouter } from "./fixtures/four-arm-router.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(HERE, "eval-four-arm.mjs");
const README = join(REPO, "evals", "four-arm", "README.md");
const ARMS_FILE = join(REPO, "evals", "four-arm", "arms.json");
const SEEDS_FILE = join(REPO, "evals", "four-arm", "seeds.jsonl");
const CHECKSUM_FILE = join(REPO, "evals", "four-arm", "seeds.sha256");
const COMMITTED_RESULTS = join(REPO, "data", "results.json");
const LONG_DASH = /[\u2012-\u2015\u2212]/;

const read = (path) => readFileSync(path, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");

function runCli(args, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}

/** The real environment minus every setting these scripts read, and never the developer's key file. */
function envFor(overrides = {}) {
  const env = { ...process.env };
  for (const name of [
    "GRILL_API_KEY",
    "OPENROUTER_API_KEY",
    "JUDGE_FIXTURE",
    "JUDGE_MODEL",
    "JUDGE_TIMEOUT_MS",
    "JUDGE_OPENROUTER_URL",
    "JUDGE_DECISIONS_URL",
    "JUDGE_CHECK",
    "GRILL_JUDGE_COMMIT",
    "GITHUB_STEP_SUMMARY",
    "GITHUB_SHA",
  ]) {
    delete env[name];
  }
  return { ...env, GRILL_KEY_FILE: join(tmpdir(), "grill-tests-no-key-file", "key"), ...overrides };
}

// == Made-up seeds for these tests. Each ask is its own scenario and carries its id as a reference code. ==
const ASKS = {
  oven: (id) =>
    `We run a small bakery and I am leaning toward buying a second oven this spring. The reference code is ${id}. Sales grew last year and the old oven is full by nine most mornings. A second oven costs about four thousand dollars and I would pay for it from savings. My partner thinks we should wait a season. Please write this up as a decision note of about 200 words that I can share with her.`,
  hire: (id) =>
    `I manage a team of five at a print shop and I want to hire a second designer now. Our reference code is ${id}. Two big clients said they may send more work next quarter, though nothing is signed. The salary would be fifty thousand a year. I would rather hire early than turn work away. Could you draft a write-up of roughly 200 words setting out this choice for the owner?`,
  lease: (id) =>
    `My sister and I are thinking about signing a three year lease on a bigger flat. Use reference code ${id} for this one. The rent is two hundred more each month but we would each get a proper desk. Our current landlord has been slow with repairs all winter. I lean toward signing this week before someone else takes it. Write a 200 words summary of the decision for us to read tonight.`,
  course: (id) =>
    `I am deciding whether to pay for an evening course in bookkeeping that starts next month. Note the reference code ${id} please. It costs nine hundred dollars and runs for twelve weeks. Three friends who took it all found better jobs afterwards, which is why I am keen. I would have to drop my weekend shifts to keep up. Put this into a write-up of about 200 words so I can think it over.`,
  supplier: (id) =>
    `Our cafe buys beans from one roaster and I plan to switch to a cheaper one from the next order. This is reference code ${id}. The new roaster quoted eight dollars a kilo against eleven today. We tried one sample bag and the regulars said nothing either way. Switching saves about three hundred a month at our volume. Give me a 200 words write-up of this plan for my business partner.`,
  event: (id) =>
    `The running club committee wants to move our spring race from the park to the riverside path. For the record this is reference code ${id}. The path is flatter and last year forty people asked for a faster course. The council permit for the park is already paid and cannot be moved. I think the faster course will bring more entries. Please prepare about 200 words that lay out the decision for the committee.`,
  tool: (id) =>
    `I look after the booking software for a small dental practice and want to replace it over the summer. Keep reference code ${id} on this request. The current system is slow on Mondays and the staff complain. A newer product costs less each month and promises a two day switch. I would cancel the old contract first to avoid paying twice. Write up the choice in around 200 words for the practice manager.`,
  price: (id) =>
    `We sell handmade candles online and I have decided to raise every price by a fifth in March. It carries reference code ${id}. Costs for wax went up and two rival shops charge more than we do. Our best customers have never complained about price. I only need help with how to announce it. Draft roughly 200 words on the decision that I can send to my co founder.`,
  job: (id) =>
    `A larger firm offered me a role with more pay and I am going to accept it on Friday. Tag this with reference code ${id}. I have been at my current company for six years and I like my manager. The new team has had three leads in two years. Everyone I asked says a bigger name always helps a career. Set out my decision in about 200 words so I can show a mentor.`,
  move: (id) =>
    `I am planning to move my small pottery studio into a shared workshop across town next month. This note has reference code ${id}. Rent would fall by a third and I would share a kiln with four other makers. My regular students all live near the current studio. I expect most of them to follow me. Summarise this plan in a write-up of 200 words for my accountant.`,
};

function seed(id, scenario, extra = {}) {
  return {
    id,
    kind: "flawed",
    category: "pricing-and-sales",
    user_ask: ASKS[scenario](id),
    question: "Should we go ahead with this plan as it stands?",
    flaw: "The plan counts on a fact that the ask itself says is not settled.",
    flaw_type: "hidden-dependency",
    twin_of: "",
    author_family: "",
    drafter_family: "anthropic",
    split: "frozen",
    ...extra,
  };
}
const twin = (id, scenario, of) => seed(id, scenario, { kind: "sound", flaw: "", flaw_type: "none", twin_of: of });
const loaded = (id, scenario) =>
  seed(id, scenario, { kind: "loaded", flaw: "The question takes the decision as made and asks only how to carry it out.", flaw_type: LOADED_FLAW_TYPE });

/** Thirteen seeds: seven flawed, three sound twins and two loaded in the frozen split, one dev seed. */
function tinySet() {
  return assignAuthors([
    seed("f-oven", "oven"),
    seed("f-hire", "hire"),
    seed("f-lease", "lease"),
    seed("f-course", "course"),
    seed("f-supplier", "supplier"),
    seed("f-event", "event"),
    seed("f-tool", "tool"),
    twin("s-oven", "oven", "f-oven"),
    twin("s-hire", "hire", "f-hire"),
    twin("s-lease", "lease", "f-lease"),
    loaded("l-price", "price"),
    loaded("l-job", "job"),
    seed("d-move", "move", { split: "dev" }),
  ]);
}
const toJsonl = (seeds) => `${seeds.map((row) => JSON.stringify(row)).join("\n")}\n`;

/** What the README's Registered line still lacks, given a registered arms file: the date, the commit, the seed checksum and every model id. */
function registeredLineMisses(line, config) {
  const reg = config?.registered ?? {};
  return [reg.date, reg.commit, reg.seeds_sha256, ...armsModelIds(config)].filter((part) => typeof part !== "string" || !String(line).includes(part));
}

// == Seeds ========================================================================
describe("seed validation", () => {
  it("accepts a flawed seed, its sound twin and a loaded seed", () => {
    assert.deepEqual(seedProblems(seed("f-oven", "oven")), []);
    assert.deepEqual(seedProblems(twin("s-oven", "oven", "f-oven")), []);
    assert.deepEqual(seedProblems(loaded("l-price", "price")), []);
    assert.deepEqual(seedProblems(seed("f-hire", "hire", { author_family: "openai", drafter_family: "owner", split: "dev" })), []);
    const { seeds, problems } = parseSeedsJsonl(toJsonl(tinySet()));
    assert.equal(seeds.length, 13);
    assert.deepEqual(problems, []);
  });

  it("has exactly the eleven fields, about ten categories and about twelve flaw types", () => {
    assert.deepEqual(SEED_KEYS, ["id", "kind", "category", "user_ask", "question", "flaw", "flaw_type", "twin_of", "author_family", "drafter_family", "split"]);
    assert.equal(SEED_CATEGORIES.length, 10);
    assert.equal(FLAW_TYPES.length, 12);
    for (const type of ["arithmetic", "base-rate-ignored", "survivorship", "sunk-cost", "dropped-requirement", "hidden-dependency", "timeline-conflict", "confounded-evidence", "small-sample", "selection", "contradicts-own-goal", "irreversible-no-trial"]) {
      assert.ok(FLAW_TYPES.includes(type), type);
    }
    // No flaw type borrows the product's own words. Grill's brief and report say "cheap test"; a type named for it would lean the flaw sentences toward the arms that carry the brief.
    for (const type of FLAW_TYPES) assert.doesNotMatch(type, /cheap|test|flip/, type);
    assert.ok(DRAFTER_FAMILIES.includes("anthropic") && DRAFTER_FAMILIES.includes("owner"));
    assert.ok(!DRAFTER_FAMILIES.includes("other"));
  });

  it("rejects an unknown field, a missing field and a value that is not text", () => {
    assert.match(seedProblems({ ...seed("f-oven", "oven"), note: "x" }).join("\n"), /unexpected field: note/);
    const { flaw, ...rest } = seed("f-oven", "oven");
    assert.equal(typeof flaw, "string");
    assert.match(seedProblems(rest).join("\n"), /missing field: flaw/);
    assert.match(seedProblems({ ...seed("f-oven", "oven"), twin_of: null }).join("\n"), /not a string: twin_of/);
    assert.deepEqual(seedProblems([]), ["the seed is not a JSON object"]);
    assert.deepEqual(seedProblems(null), ["the seed is not a JSON object"]);
  });

  it("rejects values outside the fixed lists", () => {
    const bad = (extra) => seedProblems(seed("f-oven", "oven", extra)).join("\n");
    assert.match(bad({ id: "Not_Kebab" }), /id must be kebab-case/);
    assert.match(bad({ kind: "tricky" }), /kind must be one of/);
    assert.match(bad({ category: "space-travel" }), /category must be one of/);
    assert.match(bad({ split: "holdout" }), /split must be one of/);
    assert.match(bad({ flaw_type: "vibes" }), /a flawed seed has a flaw_type from/);
    assert.match(bad({ flaw_type: "none" }), /a flawed seed has a flaw_type from/);
    assert.match(bad({ flaw_type: LOADED_FLAW_TYPE }), /a flawed seed has a flaw_type from/);
    assert.match(bad({ drafter_family: "" }), /drafter_family must be one of/);
    assert.match(bad({ drafter_family: "other" }), /drafter_family must be one of/);
    assert.match(bad({ author_family: "google" }), /author_family must be empty or one of anthropic, openai/);
  });

  it("holds each kind to its own rules for flaw, flaw_type and twin_of", () => {
    assert.match(seedProblems(twin("s-oven", "oven", "")).join("\n"), /names the flawed seed it corrects/);
    assert.match(seedProblems(twin("s-oven", "oven", "s-oven")).join("\n"), /cannot be the seed's own id/);
    assert.match(seedProblems({ ...twin("s-oven", "oven", "f-oven"), flaw: "It has one after all, which is not allowed." }).join("\n"), /a sound seed has an empty flaw/);
    assert.match(seedProblems({ ...twin("s-oven", "oven", "f-oven"), flaw_type: "arithmetic" }).join("\n"), /a sound seed has flaw_type "none"/);
    assert.match(seedProblems(seed("f-oven", "oven", { twin_of: "f-hire" })).join("\n"), /a flawed seed has an empty twin_of/);
    assert.match(seedProblems(seed("f-oven", "oven", { flaw: "" })).join("\n"), /flaw must be one sentence/);
    assert.match(seedProblems({ ...loaded("l-price", "price"), flaw_type: "arithmetic" }).join("\n"), /a loaded seed has flaw_type "loaded-question"/);
  });

  it("holds the ask to 60 to 220 words with a request for about 200 words, and the question to one line", () => {
    assert.deepEqual(ASK_WORDS, { min: 60, max: 220 });
    const bad = (extra) => seedProblems(seed("f-oven", "oven", extra)).join("\n");
    assert.match(bad({ user_ask: "Should I buy the oven? Write about 200 words." }), /user_ask must be 60 to 220 words \(it has 9\)/);
    assert.match(bad({ user_ask: `${ASKS.oven("f-oven")} ${"more ".repeat(160)}` }), /user_ask must be 60 to 220 words/);
    assert.match(bad({ user_ask: ASKS.oven("f-oven").replace("about 200 words", "a few lines") }), /must ask for a write-up of about 200 words/);
    assert.match(bad({ question: "Buy the oven" }), /question must end with a question mark/);
    assert.match(bad({ question: "Should we\nbuy the oven now?" }), /question must be one line/);
    assert.match(bad({ question: "Buy?" }), /question must be 4 to 40 words/);
  });

  it("rejects an email address, a web address, a phone number and any long dash", () => {
    const withText = (text) => seedProblems(seed("f-oven", "oven", { user_ask: `${ASKS.oven("f-oven")} ${text}` })).join("\n");
    assert.match(withText("Reach me at pat.lee@bakery.example for more."), /looks like an email address/);
    assert.match(withText("The quote is on https://ovens.example/quote today."), /looks like a web address/);
    assert.match(withText("See www.second-oven-shop.net for the model."), /looks like a web address/);
    assert.match(withText("The seller is at ovenbarn.com and ships free."), /looks like a web address/);
    assert.match(withText("Call the seller on 415-555-0134 to check."), /looks like a phone number/);
    assert.match(withText("Call the seller on (415) 555-0134 to check."), /looks like a phone number/);
    assert.match(withText("Call the seller on +44 20 7946 0958 to check."), /looks like a phone number/);
    assert.match(withText("The oven \u2014 the big one \u2014 is on sale."), /em dash or an en dash/);
    assert.match(withText("It runs 9\u201317 each day."), /em dash or an en dash/);
    assert.match(seedProblems(seed("f-oven", "oven", { question: "Should we buy \u2014 or wait a season?" })).join("\n"), /question has an em dash/);
    // Money, dates and plain counts are not mistaken for any of those.
    assert.deepEqual(seedProblems(seed("f-oven", "oven", { user_ask: `${ASKS.oven("f-oven")} We took 1,250,000 in 2025 and 38 percent more by 2026-03-31, about 4.5 times the 2019 figure.` })), []);
  });

  it("rejects an AI company or model name, and Grill's own template phrases", () => {
    const withText = (text) => seedProblems(seed("f-oven", "oven", { user_ask: `${ASKS.oven("f-oven")} ${text}` })).join("\n");
    assert.match(withText("ChatGPT said it was fine."), /names an AI company or model \(chatgpt\)/);
    assert.match(withText("I asked Claude and Gemini too."), /names an AI company or model/);
    assert.match(withText("Prediction, offered at 70% confidence: it pays back."), /phrase from Grill's own write-up template/);
    assert.match(withText("The strongest case against is the cost."), /phrase from Grill's own write-up template/);
  });

  it("rejects Grill's own phrases and report labels in the ask, the question and the flaw alike", () => {
    assert.deepEqual(TEMPLATE_PHRASES, ["prediction, offered at", "the strongest case against"]);
    assert.deepEqual(REPORT_LABELS, ["cheap test", "what would flip the call"]);
    const bad = (extra) => seedProblems(seed("f-oven", "oven", extra)).join("\n");
    assert.match(bad({ flaw: "The switch cannot be undone and the plan names no cheap test to run before it." }), /flaw uses a label Grill prints in its own report \("cheap test"\)/);
    assert.match(bad({ question: "What would flip the call on buying the second oven now?" }), /question uses a label Grill prints in its own report \("what would flip the call"\)/);
    assert.match(bad({ user_ask: `${ASKS.oven("f-oven")} Nobody has named a Cheap  Test for it.` }), /user_ask uses a label Grill prints in its own report \("cheap test"\)/);
    assert.match(bad({ flaw: "No cheap-test is named before the money is spent on the second oven." }), /flaw uses a label Grill prints in its own report/, "a hyphen in place of the space is the same label");
    assert.match(bad({ flaw: "The strongest case against is the cost, which the plan leaves out of its sums." }), /flaw uses a phrase from Grill's own write-up template \("the strongest case against"\)/);
    assert.match(bad({ question: "Is the prediction, offered at seven in ten, a fair one?" }), /question uses a phrase from Grill's own write-up template \("prediction, offered at"\)/);
    // The same words apart are ordinary words.
    assert.deepEqual(seedProblems(seed("f-oven", "oven", { flaw: "The plan picks the cheapest oven and never says how it would test the claim that sales keep growing." })), []);
  });

  it("finds problems that only show across the set: repeated ids, broken twins, a reused scenario", () => {
    const set = tinySet();
    assert.deepEqual(seedSetProblems(set), []);
    assert.match(seedSetProblems([...set, set[0]]).join("\n"), /f-oven: the same id is used twice/);
    assert.match(seedSetProblems(set.filter((row) => row.id !== "f-oven")).join("\n"), /s-oven: twin_of names f-oven, which is not in this file/);
    const wrongKind = set.map((row) => (row.id === "s-oven" ? { ...row, twin_of: "l-price" } : row));
    assert.match(seedSetProblems(wrongKind).join("\n"), /twin_of must name a flawed seed, and l-price is loaded/);
    const otherSplit = set.map((row) => (row.id === "s-oven" ? { ...row, split: "dev" } : row));
    assert.match(seedSetProblems(otherSplit).join("\n"), /a twin is in the same split/);
    const second = [...set, { ...twin("s-oven-two", "oven", "f-oven"), author_family: set.find((row) => row.id === "f-oven").author_family }];
    assert.match(seedSetProblems(second).join("\n"), /f-oven already has a twin \(s-oven\)/);
    const copy = [...set, { ...seed("f-oven-again", "oven"), author_family: "openai" }];
    assert.match(seedSetProblems(copy).join("\n"), /read as the same scenario/);
  });

  it("tells a twin written in other words how much wording it has to share", () => {
    assert.equal(TWIN_MIN_OVERLAP, 0.2);
    assert.equal(SAME_SCENARIO_OVERLAP, 0.5);
    const set = tinySet();
    const reworded =
      "Our bakery has one oven and it is full by nine most mornings, so I want a second one this spring. Call this reference code s-oven. It would cost about four thousand dollars, paid from savings, and sales have grown for a year. My partner would rather wait one more season before we spend it. Please set the choice out in about 200 words so that she and I can read it together.";
    const apart = set.map((row) => (row.id === "s-oven" ? { ...row, user_ask: reworded } : row));
    assert.deepEqual(seedProblems(apart.find((row) => row.id === "s-oven")), []);
    assert.match(seedSetProblems(apart).join("\n"), /s-oven: a twin tells the same situation as f-oven with the flaw taken out, and these two asks share too little: under a fifth of their wording\. Copy the flawed ask and change only what takes the flaw out\./);
  });

  it("wants author families on every seed or on none, balanced, with a twin following its sibling", () => {
    const set = tinySet();
    const half = set.map((row, i) => (i === 0 ? { ...row, author_family: "" } : row));
    assert.match(seedSetProblems(half).join("\n"), /author_family is set on 12 of 13 seeds/);
    assert.deepEqual(seedSetProblems(set.map((row) => ({ ...row, author_family: "" }))), [], "a draft batch has none, and that is allowed");
    const sibling = set.find((row) => row.id === "f-oven").author_family;
    const other = sibling === "anthropic" ? "openai" : "anthropic";
    const split = set.map((row) => (row.id === "s-oven" ? { ...row, author_family: other } : row));
    assert.match(seedSetProblems(split).join("\n"), /s-oven: a twin has the author family of the seed it corrects/);
    const lopsided = set.map((row) => (row.kind === "sound" || row.kind === "flawed" ? { ...row, author_family: "anthropic" } : row));
    assert.match(seedSetProblems(lopsided).join("\n"), /frozen flawed seeds are not balanced between author families \(anthropic 7, openai 0\)/);
  });

  it("names the line of a row that is not JSON, and still checks the rest", () => {
    const text = `${JSON.stringify(seed("f-oven", "oven"))}\n{not json}\n\n${JSON.stringify(seed("f-hire", "hire", { kind: "odd" }))}\n`;
    const { seeds, problems } = parseSeedsJsonl(text);
    assert.equal(seeds.length, 2);
    assert.ok(problems.includes("line 2: not JSON"));
    assert.ok(problems.some((line) => line.startsWith("line 4 (f-hire): kind must be one of")));
  });
});

describe("author assignment, counts and the checksum", () => {
  it("alternates families within each split and kind, and gives a twin its sibling's family", () => {
    const set = tinySet();
    const count = (kind, family, split = "frozen") => set.filter((row) => row.kind === kind && row.split === split && row.author_family === family).length;
    assert.equal(Math.abs(count("flawed", "anthropic") - count("flawed", "openai")), 1, "seven flawed seeds split four and three");
    assert.equal(count("loaded", "anthropic"), 1);
    assert.equal(count("loaded", "openai"), 1);
    for (const row of set.filter((r) => r.kind === "sound")) {
      assert.equal(row.author_family, set.find((r) => r.id === row.twin_of).author_family, row.id);
    }
    assert.ok(set.every((row) => AUTHOR_FAMILIES.includes(row.author_family)));
  });

  it("gives the same answer whatever order the seeds arrive in, and does not change its input", () => {
    const plain = tinySet().map((row) => ({ ...row, author_family: "" }));
    const frozen = JSON.stringify(plain);
    const forward = assignAuthors(plain);
    const backward = assignAuthors([...plain].reverse());
    assert.equal(JSON.stringify(plain), frozen);
    for (const row of forward) assert.equal(backward.find((r) => r.id === row.id).author_family, row.author_family, row.id);
  });

  it("counts by kind, category, flaw type and split, and renders the lines the README carries", () => {
    const set = tinySet();
    const counts = seedCounts(set);
    assert.equal(counts.total, 13);
    assert.deepEqual(counts.by_kind, { flawed: 8, sound: 3, loaded: 2 });
    assert.deepEqual(counts.by_split, { frozen: 12, dev: 1 });
    assert.deepEqual(counts.by_category, { "pricing-and-sales": 13 });
    assert.deepEqual(counts.by_flaw_type, { "hidden-dependency": 8, none: 3, "loaded-question": 2 });
    assert.deepEqual(counts.frozen, { total: 12, flawed: 7, sound: 3, loaded: 2 });
    assert.equal(
      renderSeedCounts(set),
      [
        "Frozen split: 7 flawed, 3 sound twins, 2 loaded (12 in all).",
        "Dev split: 1 flawed, 0 sound twins, 0 loaded (1 in all).",
        "Frozen seeds by drafter: anthropic 12.",
        "Single-drafter set: yes.",
      ].join("\n"),
    );
  });

  it("calls a set single-drafter until half the frozen seeds come from another family or a person", () => {
    const set = tinySet();
    const frozen = set.filter((row) => row.split === "frozen");
    assert.equal(singleDrafter(set), true);
    const withOwner = (n) => set.map((row) => (frozen.indexOf(row) > -1 && frozen.indexOf(row) < n ? { ...row, drafter_family: "owner" } : row));
    assert.equal(singleDrafter(withOwner(5)), true, "5 of 12 is under half");
    assert.equal(singleDrafter(withOwner(6)), false, "6 of 12 is half");
    const mixed = set.map((row) => (frozen.indexOf(row) > -1 && frozen.indexOf(row) < 6 ? { ...row, drafter_family: frozen.indexOf(row) < 3 ? "google" : "openai" } : row));
    assert.equal(singleDrafter(mixed), false);
    assert.equal(singleDrafter([]), true, "no frozen seeds restores nothing");
    assert.equal(singleDrafter(set.map((row) => (row.split === "dev" ? { ...row, drafter_family: "owner" } : row))), true, "the dev split does not count");
  });

  it("covers the frozen split and nothing else, author family included", () => {
    const set = tinySet();
    const sum = seedsChecksum(set);
    assert.match(sum, /^[0-9a-f]{64}$/);
    assert.equal(seedsChecksum([...set].reverse()), sum, "order does not matter");
    assert.equal(seedsChecksum(set.map((row) => (row.split === "dev" ? { ...row, question: "Is the dev seed part of it?" } : row))), sum);
    assert.notEqual(seedsChecksum(set.map((row) => (row.id === "f-oven" ? { ...row, question: "Should we buy it this spring?" } : row))), sum);
    assert.notEqual(seedsChecksum(set.map((row) => (row.id === "l-job" ? { ...row, author_family: row.author_family === "openai" ? "anthropic" : "openai" } : row))), sum);
  });
});

// == The committed protocol files =================================================
describe("evals/four-arm: the draft protocol and its files", () => {
  const readme = read(README);

  it("carries a status line that agrees with arms.json and data/results.json", () => {
    const status = JSON.parse(read(ARMS_FILE)).status;
    const lines = readme.split("\n").filter((line) => line.trim());
    assert.match(lines[0], /^# Four-arm comparison/);
    assert.ok(lines[1].startsWith(`Status: ${status}.`), `the README says "${lines[1]}" and arms.json says ${status}`);
    assert.match(lines[2], /^Registered: /);
    assert.match(lines[3], /^Measured: /);
    assert.equal(JSON.parse(read(COMMITTED_RESULTS)).four_arm.status, status, "data/results.json four_arm.status");
    assert.doesNotMatch(readme, LONG_DASH);
    if (status === "draft") {
      assert.match(lines[0], /draft protocol/i);
      assert.equal(lines[2].startsWith("Registered: not yet."), true);
      assert.equal(lines[3], "Measured: not yet.");
      assert.doesNotMatch(readme, /pre-?regist/i, "it is not called a pre-registration until it is registered");
      assert.equal(existsSync(CHECKSUM_FILE), false, "a seed checksum is committed at registration, not before");
    } else {
      assert.deepEqual(registeredLineMisses(lines[2], JSON.parse(read(ARMS_FILE))), [], "the Registered line gives the date, the commit, the seed checksum and every model id");
      assert.equal(lines[3] === "Measured: not yet.", status === "registered");
      const { seeds } = parseSeedsJsonl(read(SEEDS_FILE));
      assert.deepEqual(registrationProblems(JSON.parse(read(ARMS_FILE)), { seeds, checksumOnFile: read(CHECKSUM_FILE) }), [], "a registered protocol has confirmed ids and a matching checksum");
    }
  });

  it("the Registered line has to carry the date, the commit, the seed checksum and every model id", () => {
    const config = fixtureArms({ seeds_sha256: "a".repeat(64) });
    const ids = armsModelIds(config);
    assert.equal(ids.length, 9);
    const line = `Registered: 2026-01-05, commit abc1234, seed checksum ${"a".repeat(64)}, model ids ${ids.join(", ")}.`;
    assert.deepEqual(registeredLineMisses(line, config), []);
    assert.deepEqual(registeredLineMisses(line.replace(`${ids[1]}, `, ""), config), [ids[1]], "one id left off the line");
    assert.deepEqual(registeredLineMisses("Registered: 2026-01-05, commit abc1234.", config), ["a".repeat(64), ...ids]);
    // While the protocol is a draft, the line says what it will carry. Once registered, the status test holds it to that.
    if (JSON.parse(read(ARMS_FILE)).status === "draft") {
      assert.match(readme.split("\n").filter((row) => row.trim())[2], /the date, the commit, the seed checksum and the model ids/);
    }
  });

  it("states every fixed number of the harness", () => {
    assert.ok(readme.includes(`fewer than ${MIN_ANALYSED_FLAWED} flawed cases`));
    assert.ok(readme.includes(`${AUDIT_AGREE_FLOOR} of ${AUDIT_ITEMS}`));
    assert.ok(readme.includes(`no difference of ${EFFECT_POINTS} points or more was found`));
    assert.ok(readme.includes(`${ALARM_RANK_GAP_POINTS} points or more`));
    assert.ok(readme.includes(`"${ARM_A_REQUEST}"`));
    assert.ok(readme.includes(`${WRITE_UP_WORDS.min} to ${WRITE_UP_WORDS.max} words`));
    assert.ok(readme.includes(`${ARM_MAX_REQUESTS} requests`));
    assert.ok(readme.includes(`${AUDIT_ALARM_ITEMS} of the ${AUDIT_ITEMS}`));
    assert.ok(readme.includes("9 in 10"), "the usable floor");
    assert.ok(readme.includes(`at least ${ARM_A_MIN_WORDS} words`));
    assert.ok(readme.includes("two-sided 0.05"));
    assert.match(readme, /## Cost\n\nAbout twenty-five to forty-five US dollars/, "the cost is a range, in words, in this file only");
    assert.doesNotMatch(readme, /\$\s?\d/, "no dollar figure");
  });

  it("names the primary comparison and each secondary test in the harness's own words", () => {
    assert.ok(readme.includes(PRIMARY_COMPARISON.name));
    assert.match(readme, /not "the cross-company increment"/);
    assert.match(readme, /whatever the router serves/);
    for (const test of SECONDARY_COMPARISONS) assert.ok(readme.includes(test.name), test.id);
    assert.match(readme, /Holm/);
    for (const outcome of ["too-few-cases", "d-better", "no-difference-of-15-found", "d-worse"]) assert.ok(readme.includes(OUTCOME_WORDS[outcome]), outcome);
    assert.match(readme, /never "no difference"/);
    assert.match(readme, /judge quality floor/);
    assert.match(readme, /not worse than C/);
  });

  it("covers every section the protocol needs", () => {
    for (const phrase of [
      "single-drafter set",
      "sign flip",
      "author family",
      "drafter family",
      "Not measured",
      "data/results.json",
      "whichever way",
      "Loaded cases",
      "visible in the write-up alone",
      "Deviations",
      "None yet.",
      "## What the owner does",
      "placeholder",
      "word count",
      "objections",
      "usable",
      "cannot fully blind",
    ]) {
      assert.ok(readme.includes(phrase), phrase);
    }
    const owner = readme.slice(readme.indexOf("## What the owner does"));
    for (const step of [/Read a sample of the seeds/i, /another drafter/i, /Confirm the model ids/i, /Register/i, /Run/i]) assert.match(owner, step);
  });

  it("lists the seed fields, the categories and the flaw types the validator uses", () => {
    for (const key of SEED_KEYS) assert.ok(readme.includes(`| \`${key}\` |`), key);
    for (const category of SEED_CATEGORIES) assert.ok(readme.includes(`\`${category}\``), category);
    for (const type of [...FLAW_TYPES, LOADED_FLAW_TYPE, "none"]) assert.ok(readme.includes(`\`${type}\``), type);
    for (const family of [...AUTHOR_FAMILIES, "owner", "person"]) assert.ok(readme.includes(`\`${family}\``), family);
    assert.ok(readme.includes(`${ASK_WORDS.min} to ${ASK_WORDS.max} words`));
    assert.ok(readme.includes("4 to 40 words"));
    assert.ok(readme.includes("6 to 60 words"));
  });

  it("gives a seed writer every rule the validator holds, so nobody has to read the code", () => {
    const section = readme.slice(readme.indexOf("### The seed file"), readme.indexOf("## Who writes each case"));
    for (const family of DRAFTER_FAMILIES) assert.ok(section.includes(`\`${family}\``), `drafter_family ${family}`);
    assert.doesNotMatch(section, /and so on/, "the drafter list is given whole");
    assert.match(section, /\| `id` \|[^\n]*80 characters at most/);
    assert.match(section, /at least a fifth of the wording shared/);
    assert.match(section, /half of their wording or more/);
    for (const phrase of [...TEMPLATE_PHRASES, ...REPORT_LABELS]) assert.ok(section.includes(`"${phrase}"`), phrase);
    assert.match(section, /use invented names/i);
    assert.match(section, /`question` and `flaw` are each one line\./);
    assert.match(section, /`ovenbarn\.com` counts as a web address/);
    assert.match(section, /the minus sign character included/);
    assert.doesNotMatch(readme, /irreversible-no-cheap-test/);
    // The list of refused words is the validator's own list, and every word and example the README gives is in fact refused.
    const refused = (text) => seedProblems(seed("f-oven", "oven", { user_ask: `${ASKS.oven("f-oven")} We order through ${text} now.` })).join("\n");
    const listed = /The refused words are:\n\n([^\n]+)\.\n/.exec(section)[1].split(", ");
    assert.deepEqual(listed, BRAND_WORDS.map((word) => word.replace("\\s?", "")));
    for (const word of listed) assert.match(refused(word), /names an AI company or model/, word);
    for (const name of ["Amazon", "Google", "Microsoft", "Nvidia", "Copilot", "Gemini", "Mistral", "Cohere", "Llama"]) {
      assert.ok(section.includes(name), name);
      assert.match(refused(name), /names an AI company or model/, name);
    }
    for (const also of ["open ai", "chat gpt", "Meta", "o4-mini", "stepfun/step-3", "GEMINI 4 Pro"]) assert.match(refused(also), /names an AI company or model/, also);
    assert.equal(refused("a meta point and a Googled answer"), "", "a part of a longer word, or meta in small letters, is not a name");
  });

  it("says what a frozen run is held to at every step", () => {
    assert.ok(readme.includes(`The result line then reads "${GAP_SEEN_WORDS}".`));
    assert.match(readme, /If the gap seen is 15 points or more and the test is still not under 0\.05, the report says a gap of that size was seen and could not be told from chance\. It does not say none was found\./);
    assert.match(readme, /With no key, a dev step prints "SKIPPED: no arm ran" and stops with no score\. A frozen step with no key is Not measured, with or without `--require-key`\./);
    assert.match(readme, /the author step says so, and the run, score and report steps each say it again/);
    assert.match(readme, /`models_sha256` \(the model ids fingerprint that `preflight` prints\)/);
    assert.match(readme, /`report` checks the registration and the seeds again, and stops if either changed after the run\./);
    assert.match(readme, /the reply for arm A, and the judge's whole result for arms B, C and D/);
  });

  it("says what the result line needs that the public block does not carry", () => {
    const published = readme.slice(readme.indexOf("## What is published"), readme.indexOf("## The model ids are placeholders"));
    assert.match(published, /The result line cannot be worked out from the public block alone\. A sign flip shows only in the split by author family, and that split is not in the block\./);
    assert.match(published, /gives no result to a caller that does not pass the split, and no page may print a result line from the pooled counts\./);
    assert.match(published, /Its `report\.json` holds the result and D minus B for each author family under `public_result`, as one id and whole numbers\./);
    assert.match(published, /Before a frozen run is merged, the block needs two more fields: the result, as one id from a fixed list, and D minus B for each author family, as whole numbers\./);
    const rule = readme.slice(readme.indexOf("## The decision rule"), readme.indexOf("## Secondary analyses"));
    assert.match(rule, /^3\. If there is a sign flip between the two author families, there is no pooled headline\. See "Splits"\. If D minus B is missing for either family, the sign cannot be checked and the result is Not measured\.$/m);
    const notMeasured = readme.slice(readme.indexOf("## What Not measured means"), readme.indexOf("## What is published"));
    assert.ok(notMeasured.includes(`- ${MIN_ANALYSED_FLAWED} or more flawed cases were analysed, and D minus B is missing for either author family.`));
    // The block cannot show the two families apart, so the protocol does not say it does.
    assert.doesNotMatch(readme, /the two families are reported apart/);
    assert.match(readme, /the run's report shows the two families apart, and no sentence about quality follows\./);
  });

  it("puts the 95% interval beside the null wording, and says how it is worked out", () => {
    assert.ok(
      readme.includes(
        "A smaller one could be there and this run could not see it. The report gives the 95% interval for D minus B. When that interval reaches 15 points, the report says a difference of 15 points was not ruled out.",
      ),
    );
    assert.ok(readme.includes(`the report says ${NOT_RULED_OUT_REASON}.`), "the README uses the report's own words");
    assert.match(readme, /A difference of 15 points can be missed too: with 120 cases, a true one of that size is not found about 11 to 24 times in 100\./);
    assert.match(readme, /with 120, a paired test finds a true difference of 15 points about 76 to 89 times in 100\./, "the figure it is the other side of");
    // Both figures, worked out exactly: how often the paired test comes out under 0.05 with D ahead, when B catches
    // 70 in 100 and D 85 in 100, at the two ends the README names.
    const logChoose = (n, k) => {
      let sum = 0;
      for (let i = 1; i <= k; i += 1) sum += Math.log(n - k + i) - Math.log(i);
      return sum;
    };
    const chanceOf = (n, k, p) => Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
    const found = (n, shareB, shareD, together) => {
      const both = shareB * shareD + together * Math.sqrt(shareB * (1 - shareB) * shareD * (1 - shareD));
      const onlyD = shareD - both;
      const apart = onlyD + (shareB - both);
      let total = 0;
      for (let m = 1; m <= n; m += 1) {
        const pm = chanceOf(n, m, apart);
        if (pm < 1e-12) continue;
        for (let k = Math.floor(m / 2) + 1; k <= m; k += 1) if (mcnemarExactP(k, m - k) < 0.05) total += pm * chanceOf(m, k, onlyD / apart);
      }
      return total;
    };
    const low = found(120, 0.7, 0.85, 0);
    const high = found(120, 0.7, 0.85, 0.3);
    assert.ok(low > 0.75 && low < 0.77, `arms that miss unrelated cases: ${low}`);
    assert.ok(high > 0.88 && high < 0.895, `arms that find the same cases hard: ${high}`);
    assert.match(readme, /The interval is the gap, plus and minus 1\.96 times the square root of \(b \+ c - \(b - c\) squared \/ n\), divided by n\./);
    // The README's recipe, followed by hand, is the harness's own interval.
    const [b, c, n] = [25, 14, 120];
    const gap = (b - c) / n;
    const half = (1.96 * Math.sqrt(b + c - (b - c) ** 2 / n)) / n;
    const got = pairedDiffInterval(b, c, n);
    assert.ok(Math.abs(got.low - (gap - half) * 100) < 0.001 && Math.abs(got.high - (gap + half) * 100) < 0.001);
  });

  it("says which planted flaws Grill's brief names, and where that shows", () => {
    assert.deepEqual(BRIEF_NAMED_FLAW_TYPES, ["contradicts-own-goal", "dropped-requirement", "small-sample", "irreversible-no-trial"]);
    for (const type of BRIEF_NAMED_FLAW_TYPES) assert.ok(FLAW_TYPES.includes(type), `${type} is a flaw type a seed can have`);
    const splits = readme.slice(readme.indexOf("## Splits"), readme.indexOf("## The single-drafter rule"));
    const sentence = /Four types sit close to what Grill's brief asks for by name: ([^.]+)\./.exec(splits);
    assert.notEqual(sentence, null, "the Splits section names the four types in one sentence");
    for (const type of BRIEF_NAMED_FLAW_TYPES) assert.ok(sentence[1].includes(`\`${type}\``), `${type} is in that sentence`);
    assert.equal(sentence[1].split("`").length - 1, 2 * BRIEF_NAMED_FLAW_TYPES.length, "those four and no other");
    assert.ok(
      splits.includes(
        `D against A and B against A are also shown by flaw type. ${sentence[0]} On those, arms B, C and D carry the brief and arm A does not. D against B is not touched by this.`,
      ),
    );
    const limits = readme.slice(readme.indexOf("## Limits"), readme.indexOf("## Deviations from the registered protocol"));
    assert.ok(limits.includes("- Some planted flaws are ones Grill's brief names. See Splits."));
  });

  it("keeps to the wording rules for public copy", () => {
    for (const phrase of [
      "guarantee",
      "blind spot",
      "shares your",
      "correlated with",
      "biased one",
      "measurably better",
      "commercial interest",
      "does not answer to the same company",
      "never comes from",
      "always from a different company",
      "decorrelated",
      "Tony approved",
      "owner decided",
    ]) {
      assert.ok(!readme.toLowerCase().includes(phrase.toLowerCase()), phrase);
    }
  });

  it("says seeds are not written yet, or states the seed file's own counts", (t) => {
    const stated = readmeSeedCounts(readme);
    assert.notEqual(stated, null, "the README keeps its two seed-count markers");
    if (!existsSync(SEEDS_FILE)) {
      assert.equal(stated, NO_SEEDS_LINE);
      t.skip("evals/four-arm/seeds.jsonl does not exist yet, so there are no counts to compare. The README says so.");
      return;
    }
    const { seeds } = parseSeedsJsonl(read(SEEDS_FILE));
    assert.equal(stated, renderSeedCounts(seeds), "run validate-seeds and paste its README lines between the markers");
  });

  it("the seed file, once it exists, passes every check", (t) => {
    if (!existsSync(SEEDS_FILE)) {
      t.skip("evals/four-arm/seeds.jsonl does not exist yet: nothing to check.");
      return;
    }
    const { seeds, problems } = parseSeedsJsonl(read(SEEDS_FILE));
    assert.deepEqual(problems, [], "schema, twin links, author balance and no reused scenario");
    assert.ok(seeds.length > 0);
    assert.ok(seeds.every((row) => row.drafter_family !== ""), "every seed records who drafted it");
  });

  it("checks the seed checksum only when evals/four-arm/seeds.sha256 exists", (t) => {
    if (!existsSync(CHECKSUM_FILE)) {
      t.skip("evals/four-arm/seeds.sha256 does not exist: the set is a draft until the owner registers it.");
      return;
    }
    assert.ok(existsSync(SEEDS_FILE), "a checksum with no seed file");
    const { seeds } = parseSeedsJsonl(read(SEEDS_FILE));
    assert.equal(read(CHECKSUM_FILE).trim().split(/\s+/)[0], seedsChecksum(seeds), "the frozen seeds changed after they were registered");
  });

  it("arms.json is a valid draft: every id waits for the owner, and no grader is from an author family", () => {
    const config = JSON.parse(read(ARMS_FILE));
    assert.deepEqual(armsProblems(config), []);
    if (config.status === "draft") {
      assert.equal(config.registered, null);
      for (const family of AUTHOR_FAMILIES) {
        assert.equal(config.families[family].author_model_status, ID_UNCONFIRMED);
        assert.equal(config.families[family].stronger_model_status, ID_UNCONFIRMED);
      }
      for (const grader of config.graders) assert.equal(grader.status, ID_UNCONFIRMED);
      assert.match(registrationProblems(config, { seeds: tinySet(), checksumOnFile: "" }).join("\n"), /status is "draft"/);
    }
    assert.equal(armsModelIds(config).length, 4 + config.graders.length);
    assert.ok(config.graders.length >= 4);
    assert.doesNotMatch(read(ARMS_FILE), LONG_DASH);
  });
});

describe("arms file checks", () => {
  it("accepts the test arms and names what is wrong with a bad one", () => {
    assert.deepEqual(armsProblems(fixtureArms()), []);
    const edit = (fn) => {
      const config = fixtureArms();
      fn(config);
      return armsProblems(config).join("\n");
    };
    assert.match(edit((c) => (c.families.anthropic.author_model = "openai/example-author")), /families\.anthropic\.author_model must be a model from anthropic/);
    assert.match(edit((c) => (c.families.openai.stronger_model = c.families.openai.author_model)), /the stronger model must differ/);
    assert.match(edit((c) => (c.families.openai.author_model_status = "sure")), /author_model_status must be "owner to confirm" or "confirmed"/);
    assert.match(edit((c) => delete c.families.openai), /families must be exactly: anthropic, openai/);
    assert.match(edit((c) => (c.graders[0].model = "openai/example-grader")), /is from an author family \(openai\)/);
    assert.match(edit((c) => (c.graders[1].model = "google/another-grader")), /a second grader from google/);
    assert.match(edit((c) => (c.graders = c.graders.slice(0, 3))), /graders must list at least 4 models/);
    assert.match(edit((c) => (c.status = "running")), /status must be one of draft, registered, measured/);
    assert.match(edit((c) => (c.registered = null)), /registered must hold date, commit, seeds_sha256, judge_prompt_sha256, models_sha256 once status is registered/);
    assert.match(edit((c) => (c.registered.judge_prompt_sha256 = "abc")), /registered\.judge_prompt_sha256 must be 64 hex characters/);
    assert.match(edit((c) => delete c.registered.models_sha256), /registered\.models_sha256 must be 64 hex characters/);
    assert.match(edit((c) => (c.registered.models = "all of them")), /registered: unexpected key models/);
    assert.match(edit((c) => (c.judge_model = "openai/example")), /unexpected key: judge_model/);
    assert.match(armsProblems({ ...fixtureArms({ status: "draft" }), registered: { date: "2026-01-05" } }).join("\n"), /registered must be null while status is draft/);
  });

  it("registration needs confirmed ids, a registered status and a checksum that matches three ways", () => {
    const seeds = tinySet();
    const sum = seedsChecksum(seeds);
    assert.deepEqual(registrationProblems(fixtureArms({ seeds_sha256: sum }), { seeds, checksumOnFile: `${sum}\n` }), []);
    assert.match(registrationProblems(fixtureArms({ seeds_sha256: sum }), { seeds, checksumOnFile: "" }).join("\n"), /seeds\.sha256 does not exist/);
    assert.match(registrationProblems(fixtureArms({ seeds_sha256: sum }), { seeds, checksumOnFile: "f".repeat(64) }).join("\n"), /do not match seeds\.sha256/);
    assert.match(registrationProblems(fixtureArms({ seeds_sha256: "f".repeat(64) }), { seeds, checksumOnFile: sum }).join("\n"), /do not match registered\.seeds_sha256/);
    const unconfirmed = fixtureArms({ seeds_sha256: sum });
    unconfirmed.graders[2].status = ID_UNCONFIRMED;
    unconfirmed.families.openai.stronger_model_status = ID_UNCONFIRMED;
    assert.match(registrationProblems(unconfirmed, { seeds, checksumOnFile: sum }).join("\n"), /still marked "owner to confirm": families\.openai\.stronger_model, graders\[2\]/);
  });

  it("registration fixes the model ids: an author, a stronger model or a grader swapped afterwards is a problem", () => {
    const seeds = tinySet();
    const sum = seedsChecksum(seeds);
    const registered = () => fixtureArms({ seeds_sha256: sum });
    assert.equal(armsModelsChecksum(registered()), sha(armsModelIds(registered()).join("\n")), "the fingerprint is the ids, one per line, in the order the file lists them");
    assert.equal(registered().registered.models_sha256, armsModelsChecksum(registered()));
    const after = (change) => {
      const config = registered();
      change(config);
      return registrationProblems(config, { seeds, checksumOnFile: sum });
    };
    assert.deepEqual(after(() => {}), []);
    const changed = /^a model id in arms\.json changed after registration$/m;
    assert.match(after((c) => (c.families.openai.author_model = "openai/another-author")).join("\n"), changed);
    assert.match(after((c) => (c.families.anthropic.stronger_model = "anthropic/another-stronger")).join("\n"), changed);
    assert.match(after((c) => (c.graders[4].model = "qwen/example-grader")).join("\n"), changed);
    assert.match(after((c) => c.graders.reverse()).join("\n"), changed, "the order the graders are asked in is part of what was registered");
    assert.match(after((c) => c.graders.push({ model: "qwen/example-grader", status: "confirmed" })).join("\n"), changed);
    // All three at once, the swap an independent check made: nothing else in the file notices it.
    const swapped = after((c) => {
      c.families.openai.author_model = "openai/another-author";
      c.families.anthropic.stronger_model = "anthropic/another-stronger";
      c.graders[4].model = "qwen/example-grader";
    });
    assert.deepEqual(swapped, ["a model id in arms.json changed after registration"]);
  });
});

// == What each arm is sent ========================================================
describe("arm message shapes", () => {
  const row = { ...seed("f-oven", "oven"), author_family: "openai" };
  const config = fixtureArms();

  it("the author step sends the person's ask and nothing else", () => {
    assert.deepEqual(authorMessages(row), [{ role: "user", content: row.user_ask }]);
  });

  it("arm A continues the same chat: the ask, the write-up as the model's own turn, then the question and the request", () => {
    assert.equal(ARM_A_REQUEST, "Argue the other side.");
    assert.deepEqual(armAMessages(row, "THE WRITE-UP"), [
      { role: "user", content: row.user_ask },
      { role: "assistant", content: "THE WRITE-UP" },
      { role: "user", content: `${row.question}\n\nArgue the other side.` },
    ]);
  });

  it("the chat request has no system prompt, no tools and no temperature, and asks for zero retention", () => {
    const body = chatRequestBody({ model: "openai/example-author", messages: armAMessages(row, "W") });
    assert.deepEqual(Object.keys(body).sort(), ["messages", "model", "provider", "usage"]);
    assert.deepEqual(body.provider, { zdr: true, data_collection: "deny" });
    assert.ok(body.messages.every((m) => m.role !== "system"));
    assert.throws(() => chatRequestBody({ messages: [] }), /model id is required/);
  });

  it("arms B, C and D run judge.mjs with the same arguments: the question and the author's family", () => {
    assert.deepEqual(judgeArgs(row), ["--json", "--question", row.question, "--author", "openai"]);
    assert.throws(() => judgeArgs(seed("f-oven", "oven")), /has no author family/);
  });

  it("arm B and arm C set JUDGE_MODEL in the child only, and arm D leaves it unset", () => {
    const base = { PATH: "/bin", JUDGE_MODEL: "x/should-not-leak", JUDGE_FIXTURE: "/tmp/f.json", JUDGE_CHECK: "1", GRILL_JUDGE_COMMIT: "1", OPENROUTER_API_KEY: "k" };
    const frozen = JSON.stringify(base);
    const b = armEnv("B", config, "openai", base);
    const c = armEnv("C", config, "anthropic", base);
    const d = armEnv("D", config, "openai", base);
    assert.equal(b.JUDGE_MODEL, "openai/example-author");
    assert.equal(c.JUDGE_MODEL, "anthropic/example-stronger");
    assert.equal("JUDGE_MODEL" in d, false, "the product path names no model");
    for (const env of [b, c, d]) {
      assert.equal(env.PATH, "/bin");
      assert.equal(env.OPENROUTER_API_KEY, "k");
      for (const gone of ["JUDGE_FIXTURE", "JUDGE_CHECK", "GRILL_JUDGE_COMMIT"]) assert.equal(gone in env, false, gone);
    }
    assert.equal(JSON.stringify(base), frozen, "the caller's environment is not touched");
    assert.throws(() => armEnv("A", config, "openai", base), /does not run through judge\.mjs/);
    assert.throws(() => armEnv("D", config, "google", base), /unknown author family/);
  });

  it("an arm's answer counts only when it came from where the arm says", () => {
    assert.equal(armValid("A", { servedModel: "openai/example-author" }, "openai").valid, true);
    assert.equal(armValid("B", { servedModel: "anthropic/example-author" }, "openai").valid, false);
    assert.equal(armValid("C", { servedModel: "" }, "openai").valid, false);
    assert.equal(armValid("D", { servedModel: "google/example-judge", decorrelated: true }, "openai").valid, true);
    assert.equal(armValid("D", { servedModel: "openai/example-author", decorrelated: false }, "openai").valid, false);
    assert.equal(armValid("D", { servedModel: "google/example-judge", decorrelated: false }, "openai").valid, false);
    assert.equal(armValid("D", { servedModel: "claude-example", decorrelated: true }, "anthropic").valid, false, "a bare Claude slug is still Anthropic");
  });

  it("every arm gets the same number of requests, and that number is the product's own", () => {
    assert.equal(ARM_MAX_REQUESTS, 1 + AUTO_ROUTER_MAX_RETRIES);
    assert.equal(ARM_MAX_REQUESTS, 3);
  });

  it("reads a chat reply as text, and knows a usable write-up by its length", () => {
    assert.equal(chatText({ choices: [{ message: { content: "  hello  " } }] }), "hello");
    assert.equal(chatText({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] }), "ab");
    assert.equal(chatText({ choices: [{ message: {} }] }), "");
    assert.equal(chatText(null), "");
    assert.equal(writeUpUsable("word ".repeat(WRITE_UP_WORDS.min - 1)), false);
    assert.equal(writeUpUsable("word ".repeat(WRITE_UP_WORDS.min)), true);
    assert.equal(writeUpUsable("word ".repeat(WRITE_UP_WORDS.max + 1)), false);
  });
});

// == The product judge is not touched =============================================
describe("the product judge chain is untouched", () => {
  const product = JSON.parse(read(join(REPO, "package.json"))).files.filter((file) => file.endsWith(".mjs"));
  const hashes = () => Object.fromEntries(product.map((file) => [file, sha(read(join(REPO, file)))]));

  it("the default chain is still only the Auto Router", () => {
    assert.equal(DEFAULT_CHAIN, "openrouter/auto");
    assert.deepEqual(resolveChain(undefined).chain, ["openrouter/auto"]);
    assert.equal(resolveChain(undefined).source, "default");
    assert.equal(productChainUntouched(), true);
    assert.match(judgePromptFingerprint(), /^[0-9a-f]{64}$/);
  });

  it("importing the harness changes no product file and leaves JUDGE_MODEL alone", () => {
    assert.ok(product.includes("scripts/judge.mjs") && product.includes("scripts/judgeCore.mjs") && product.includes("server/index.mjs"));
    const before = hashes();
    const script = [
      'const core = await import("./scripts/fourArmCore.mjs");',
      'await import("./scripts/fixtures/four-arm-router.mjs");',
      'const judge = await import("./scripts/judgeCore.mjs");',
      'core.armEnv("B", { families: { openai: { author_model: "openai/example-author" } } }, "openai", process.env);',
      "process.stdout.write(JSON.stringify({ chain: judge.DEFAULT_CHAIN, model: process.env.JUDGE_MODEL ?? null }));",
    ].join("\n");
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: REPO, env: envFor(), encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { chain: "openrouter/auto", model: null });
    assert.deepEqual(hashes(), before);
  });

  it("the harness is not shipped, and it names no model id of its own", () => {
    for (const file of ["package.json", "scripts/build-extension.mjs", "Dockerfile"]) {
      assert.doesNotMatch(read(join(REPO, file)), /fourArm|four-arm/, file);
    }
    const vendors = JUDGE_COMPANY_IDS.filter((id) => id !== "other").join("|");
    const slug = new RegExp(`(?:${vendors})/[a-z0-9]`, "i");
    for (const file of ["scripts/fourArmCore.mjs", "scripts/eval-four-arm.mjs"]) {
      const source = read(join(REPO, file));
      assert.doesNotMatch(source, slug, `${file} holds a model id; ids belong in evals/four-arm/arms.json`);
      assert.doesNotMatch(source, LONG_DASH, file);
      assert.doesNotMatch(source, /\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf)\(|withResolvers|fs\.glob|Object\.groupBy|\.toSorted\(/, `${file} must run on Node 20`);
      for (const spec of source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)) {
        assert.match(spec[1], /^(node:|\.\/)/, `${file} imports ${spec[1]}`);
      }
    }
    const core = read(join(REPO, "scripts/fourArmCore.mjs"));
    assert.doesNotMatch(core, /\bfetch\s*\(|node:fs|node:child_process|process\.env|Date\.now|new Date\(|Math\.random/, "the core is pure");
    for (const file of ["scripts/fourArm.test.mjs", "scripts/fixtures/four-arm-router.mjs", "evals/four-arm/README.md", "evals/four-arm/arms.json"]) {
      assert.doesNotMatch(read(join(REPO, file)), /[\u2013\u2014]/, file);
    }
  });
});

// == Blinding =====================================================================
describe("blinding", () => {
  const SERVED = [
    "google/gemini-4-carbon",
    "openai/gpt-6.1-terra",
    "openai/gpt-6.1-sol",
    "deepseek/deepseek-v4.1-flash-1017",
    "minimax/minimax-m3.1-flash",
    "moonshotai/kimi-k3.1-pro",
    "qwen/qwen3.8-27b",
    "x-ai/grok-4.7",
    "meta-llama/llama-4-maverick",
    "mistralai/mistral-large-4-0",
    "~anthropic/claude-example-latest",
    "openrouter/auto",
    "typesafe/jev-1.13",
  ];
  const leaks = (text) => {
    const lower = text.toLowerCase();
    const words = ["anthropic", "claude", "openai", "chatgpt", "gpt", "google", "gemini", "deepseek", "moonshot", "kimi", "minimax", "qwen", "grok", "llama", "mistral", "cohere", "perplexity", "nvidia", "microsoft", "amazon", "openrouter", "typesafe", "jev", "x-ai", "z-ai"];
    return words.filter((word) => new RegExp(`(?<![a-z])${word.replace(/[-]/g, "\\-")}(?![a-z])`).test(lower));
  };

  it("removes every vendor id on the fixed list and every model id the repo has seen served", () => {
    const committed = armsModelIds(JSON.parse(read(ARMS_FILE)));
    const ids = [...SERVED, ...committed, ...armsModelIds(fixtureArms()), PRODUCT_SERVES];
    for (const id of ids) {
      const out = blind(`The answer was served by ${id} today, and ${id.split("/")[1]} agreed.`);
      assert.deepEqual(leaks(out), [], `${id} -> ${out}`);
      assert.deepEqual(namesFound(out), [], `${id} -> ${out}`);
      assert.ok(out.includes(NAME_REMOVED));
    }
    for (const vendor of JUDGE_COMPANY_IDS.filter((id) => id !== "other")) {
      const out = blind(`A model from ${vendor} wrote this, says ${vendor}/some-model-1.`);
      assert.ok(!out.toLowerCase().includes(vendor), `${vendor} -> ${out}`);
      assert.deepEqual(namesFound(out), []);
    }
  });

  it("removes names as people write them, with their tier and version", () => {
    for (const text of [
      "As Claude, made by Anthropic, I disagree.",
      "I am ChatGPT, a model trained by OpenAI.",
      "Claude Sonnet 5.5 would say the same.",
      "GPT 6.1 Terra and gpt-6.1-sol both miss it.",
      "Gemini 4 Carbon from Google DeepMind is harsher.",
      "DeepSeek, Kimi from Moonshot AI, MiniMax and Qwen all agree.",
      "Grok by xAI, Llama by Meta, Mistral Large and Copilot from Microsoft.",
      "claude-fable-5-2 and o4-mini were not asked.",
      "Routed by OpenRouter's Auto Router and checked by TypeSafe Jev.",
    ]) {
      const out = blind(text);
      assert.deepEqual(leaks(out), [], `${text} -> ${out}`);
      assert.deepEqual(namesFound(out), [], `${text} -> ${out}`);
    }
    assert.equal(blind("As Claude, made by Anthropic, I disagree."), `As ${NAME_REMOVED}, made by ${NAME_REMOVED}, I disagree.`);
    assert.equal(blind("Claude Sonnet 5.5 would say the same."), `${NAME_REMOVED} would say the same.`);
  });

  it("drops Grill's run note and nothing else, and leaves ordinary words alone", () => {
    const note = "The plan is weak.\n\nModels: openai/gpt-6.1-sol (judge) \u00b7 took 48s\nPrivate: sent only to zero-data-retention endpoints, with keys blocked and common personally identifiable information masked first.";
    assert.equal(blind(note), "The plan is weak.");
    const prose = "Cost: the plan leaves out delivery.\nPrivate: the owner has not told the staff.\nA meta point: the plan is, in the main, a claim about demand. The sonnet and the opus are on the shelf.";
    assert.equal(blind(prose), prose);
    assert.deepEqual(namesFound(prose), []);
    assert.deepEqual(namesFound(tinySet().map((row) => `${row.user_ask} ${row.question} ${row.flaw}`).join(" ")), []);
  });

  it("the grader prompts carry the blinded text, the one question, and no arm or model", () => {
    const parts = { writeUp: "The plan by Claude.", question: "Should we go?", flaw: "The sums are wrong.", critique: "As ChatGPT I object: the sums are wrong." };
    const catchPrompt = buildCatchPrompt(parts);
    const alarmPrompt = buildAlarmPrompt(parts);
    const flagPrompt = buildFlagPrompt(parts);
    for (const prompt of [catchPrompt, alarmPrompt, flagPrompt]) {
      assert.deepEqual(namesFound(prompt), []);
      assert.doesNotMatch(prompt, /\barm [A-D]\b|same-chat|fresh-brief|stronger-same-lab/i);
    }
    assert.match(catchPrompt, /THE KNOWN PROBLEM\nThe sums are wrong\./);
    assert.match(catchPrompt, /Does the critique point out the known problem\?/);
    assert.doesNotMatch(alarmPrompt, /KNOWN PROBLEM|sound/i, "the grader is not told the plan is sound");
    assert.match(alarmPrompt, /not to go ahead with the plan as written\?/);
    assert.match(flagPrompt, /\(visible\)/);
    assert.match(flagPrompt, /\(flagged\)/);
    const body = graderRequestBody({ model: "google/example-grader", prompt: catchPrompt });
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.provider, { zdr: true, data_collection: "deny" });
    assert.equal(body.messages[0].role, "system");
    assert.match(body.messages[0].content, /not told who or what wrote the critique/);
  });
});

// == Graders ======================================================================
describe("grader replies, votes and who may grade", () => {
  it("reads a yes or no and a count, in or out of a code fence, and nothing else", () => {
    assert.deepEqual(parseGradeReply('{"answer":"yes","objections":3}'), { answer: "yes", objections: 3 });
    assert.deepEqual(parseGradeReply('```json\n{"answer":"No","objections":0}\n```'), { answer: "no", objections: 0 });
    assert.deepEqual(parseGradeReply('Sure. {"answer":true,"objections":"many"}'), { answer: "yes", objections: null });
    assert.equal(parseGradeReply('{"answer":"maybe","objections":2}'), null);
    assert.equal(parseGradeReply("yes"), null);
    assert.equal(parseGradeReply(""), null);
    assert.deepEqual(parseFlagReply('{"visible":"yes","flagged":"no"}'), { visible: "yes", flagged: "no" });
    assert.equal(parseFlagReply('{"visible":"yes"}'), null);
  });

  it("takes a strict majority of at least two votes, and the middle count", () => {
    assert.equal(majority(["yes", "yes", "no"]), "yes");
    assert.equal(majority(["no", null, "no"]), "no");
    assert.equal(majority(["yes", "no"]), null);
    assert.equal(majority(["yes", null, null]), null);
    assert.equal(majority([]), null);
    assert.equal(medianInt([3, 1, 2]), 2);
    assert.equal(medianInt([4, 1]), 1);
    assert.equal(medianInt([]), null);
  });

  it("leaves out a grader from the author's company or from the company that served the product arm", () => {
    const config = fixtureArms();
    assert.equal(eligibleGraders(config, { authorFamily: "openai" }).length, 5);
    assert.deepEqual(eligibleGraders(config, { authorFamily: "anthropic", servedCompany: "google" }), [
      "deepseek/example-grader",
      "mistralai/example-grader",
      "minimax/example-grader",
      "moonshotai/example-grader",
    ]);
    config.graders.push({ model: "openai/example-grader", status: "confirmed" });
    assert.ok(!eligibleGraders(config, { authorFamily: "openai" }).includes("openai/example-grader"));
  });

  it("the grader check passes at 34 of 40, fails at 33, and passes on the owner's own labels", () => {
    assert.equal(graderCheckPassed({ agree: 34, of: 40, labels_by: "graders" }), true);
    assert.equal(graderCheckPassed({ agree: 33, of: 40, labels_by: "graders" }), false);
    assert.equal(graderCheckPassed({ agree: 30, of: 30, labels_by: "graders" }), false, "fewer than 40 items is not the check");
    assert.equal(graderCheckPassed({ agree: 10, of: 40, labels_by: "owner" }), true);
    assert.equal(graderCheckPassed(null), false);
    assert.equal(graderCheckPassed({ agree: 41, of: 40, labels_by: "graders" }), false);
  });

  it("picks the owner's sample the same way every time, leaning toward sound twins", () => {
    const graded = [];
    for (let i = 0; i < 30; i += 1) for (const arm of ARMS) graded.push({ id: `f-${i}`, arm, kind: "flawed" });
    for (let i = 0; i < 10; i += 1) for (const arm of ARMS) graded.push({ id: `s-${i}`, arm, kind: "sound" });
    const sample = auditSample(graded, "key");
    assert.equal(sample.length, AUDIT_ITEMS);
    assert.equal(sample.filter((item) => item.kind === "sound").length, AUDIT_ALARM_ITEMS);
    assert.deepEqual(auditSample([...graded].reverse(), "key").map((i) => `${i.id} ${i.arm}`).sort(), sample.map((i) => `${i.id} ${i.arm}`).sort());
    assert.notDeepEqual(auditSample(graded, "another key"), sample);
    assert.equal(auditSample(graded.slice(0, 12), "key").length, 12, "a small run offers what it has");
    assert.equal(auditSample(graded.filter((item) => item.kind === "sound"), "key").length, 40, "all sound when that is all there is");
    assert.deepEqual([...parseOwnerLabels("1: yes\n2. No\n 3) yes \nnote: skip\n4: maybe\n").entries()], [[1, "yes"], [2, "no"], [3, "yes"]]);
  });
});

// == Counting and the public block ================================================
describe("counting", () => {
  const cases = [
    { id: "f1", kind: "flawed", author_family: "anthropic", drafter_family: "anthropic", visible: "yes" },
    { id: "f2", kind: "flawed", author_family: "openai", drafter_family: "anthropic", visible: "yes" },
    { id: "f3", kind: "flawed", author_family: "anthropic", drafter_family: "owner", visible: "no" },
    { id: "s1", kind: "sound", author_family: "anthropic", drafter_family: "anthropic", visible: null },
    { id: "l1", kind: "loaded", author_family: "openai", drafter_family: "anthropic", visible: null },
  ];
  const item = (id, arm, label, usable = true) => ({ id, arm, usable, label, words: 100, objections: 2, served_company: arm === "D" ? "google" : null });
  const items = [
    item("f1", "A", "no"), item("f1", "B", "no"), item("f1", "C", "yes"), item("f1", "D", "yes"),
    item("f2", "A", "yes"), item("f2", "B", "yes"), item("f2", "C", null, false), item("f2", "D", "no"),
    item("f3", "A", "no"), item("f3", "B", null), item("f3", "C", "yes"), item("f3", "D", "yes"),
    item("s1", "A", "yes"), item("s1", "B", "no"), item("s1", "C", "no"), item("s1", "D", "yes"),
    item("l1", "A", "no"), item("l1", "B", "no"), item("l1", "C", "no"),
  ];

  it("counts an unusable answer as a miss, and an answer nobody could label as unusable", () => {
    assert.deepEqual(armCounts("B", cases, items), { flawed: 3, caught: 1, usable_flawed: 2, caught_usable: 1, sound: 1, alarms: 0, loaded: 1, usable_loaded: 1, caught_loaded: 0, unusable: 1 });
    assert.deepEqual(armCounts("C", cases, items), { flawed: 3, caught: 2, usable_flawed: 2, caught_usable: 2, sound: 1, alarms: 0, loaded: 1, usable_loaded: 1, caught_loaded: 0, unusable: 1 });
    assert.equal(armCounts("D", cases, items).unusable, 1, "a case with no row for an arm is unusable for that arm");
    assert.equal(armCounts("D", cases, items).alarms, 1);
  });

  it("builds the paired table both ways", () => {
    assert.deepEqual(pairTable("D", "B", cases, items), {
      both: 0, first_only: 2, second_only: 1, neither: 0,
      usable_both: 0, usable_first_only: 1, usable_second_only: 1, usable_neither: 0,
    });
    assert.deepEqual(pairTable("D", "C", cases, items), {
      both: 2, first_only: 0, second_only: 0, neither: 1,
      usable_both: 2, usable_first_only: 0, usable_second_only: 0, usable_neither: 0,
    });
  });

  it("emits a block that the results validator accepts, with integers and fixed ids only", () => {
    const block = buildPublicBlock({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: true });
    validateFourArm(JSON.parse(JSON.stringify(block)));
    assert.deepEqual(block.cases, { flawed: 3, sound: 1, loaded: 1 });
    assert.deepEqual(block.arms.map((arm) => arm.arm), FOUR_ARM_IDS);
    assert.deepEqual(block.arms[3], { arm: "product", caught: 2, flawed: 3, caught_usable: 2, usable_flawed: 3, alarms: 1, sound: 1, unusable: 1 });
    assert.deepEqual(block.comparisons.map((pair) => `${pair.first} ${pair.second}`), COMPARISONS.map((pair) => `${ARM_IDS[pair.first]} ${ARM_IDS[pair.second]}`));
    assert.equal(block.comparisons[0].first, "product");
    assert.equal(block.comparisons[0].second, "fresh-brief");
    const text = JSON.stringify(block);
    assert.doesNotMatch(text, /\d\.\d/, "no rates, no p values");
    assert.doesNotMatch(text, /google|openai|anthropic|usd|cost/i);
    assert.throws(() => buildPublicBlock({ cases, items, date: "soon", commit: "abc1234", single_drafter: true }), /four_arm\.date/);
    assert.throws(() => buildPublicBlock({ cases, items, date: "2026-12-01", commit: "", single_drafter: true }), /four_arm\.commit/);
  });

  it("decides which cases are analysed before any arm runs", () => {
    const seeds = tinySet();
    const writeUps = seeds.map((row) => ({ id: row.id, usable: true, visible: "yes", flagged: "no" }));
    writeUps.find((row) => row.id === "f-tool").flagged = "yes";
    writeUps.find((row) => row.id === "f-course").usable = false;
    writeUps.find((row) => row.id === "s-lease").flagged = "yes";
    writeUps.find((row) => row.id === "f-oven").visible = "no";
    const { cases: analysed, dropped } = analysedCases(seeds, writeUps, "frozen");
    assert.deepEqual(dropped, { "no usable write-up": 1, "the author already flagged the flaw": 1 });
    assert.equal(analysed.length, 10);
    assert.ok(analysed.some((c) => c.id === "s-lease"), "the flag applies to flawed cases only");
    assert.equal(analysed.find((c) => c.id === "f-oven").visible, "no");
    assert.equal(analysed.find((c) => c.id === "s-oven").visible, null);
    assert.equal(analysedCases(seeds, [], "frozen").cases.length, 0);
    assert.equal(analysedCases(seeds, writeUps, "dev").cases.length, 1);
  });

  it("keeps each case's flaw type when the analysed cases are decided", () => {
    const seeds = tinySet().map((row) => (row.id === "f-oven" ? { ...row, flaw_type: "small-sample" } : row));
    const writeUps = seeds.map((row) => ({ id: row.id, usable: true, visible: "yes", flagged: "no" }));
    const { cases: analysed } = analysedCases(seeds, writeUps, "frozen");
    assert.equal(analysed.find((c) => c.id === "f-oven").flaw_type, "small-sample");
    assert.equal(analysed.find((c) => c.id === "f-hire").flaw_type, "hidden-dependency");
    assert.equal(analysed.find((c) => c.id === "s-oven").flaw_type, "none");
    assert.equal(analysed.find((c) => c.id === "l-job").flaw_type, LOADED_FLAW_TYPE);
    assert.ok(analysed.every((c) => typeof c.flaw_type === "string" && c.flaw_type !== ""));
  });

  it("lets the owner's labels replace the graders' when the owner labelled everything", () => {
    const answers = [{ id: "f1", arm: "A", usable: true, words: 50, served_company: null }];
    const grades = [{ id: "f1", arm: "A", label: "no", objections: 4 }];
    assert.equal(buildItems(cases.slice(0, 1), answers, grades)[0].label, "no");
    assert.equal(buildItems(cases.slice(0, 1), answers, grades, new Map([["f1 A", "yes"]]))[0].label, "yes");
    assert.equal(buildItems(cases.slice(0, 1), answers, grades, new Map())[0].label, null);
    assert.equal(buildItems(cases.slice(0, 1), answers, grades).length, 4, "one item per arm, answered or not");
  });
});

// == Statistics and the decision rule =============================================
describe("Holm correction", () => {
  it("matches a hand-computed example", () => {
    // Sorted: 0.005, 0.01, 0.03, 0.04. Times 4, 3, 2, 1: 0.02, 0.03, 0.06, 0.04. Never going down: 0.02, 0.03, 0.06, 0.06.
    const adjusted = holm([0.01, 0.04, 0.03, 0.005]);
    const expected = [0.03, 0.06, 0.06, 0.02];
    adjusted.forEach((p, i) => assert.ok(Math.abs(p - expected[i]) < 1e-12, `${i}: ${p}`));
  });

  it("caps at 1, keeps ties together, and refuses a value that is not a p value", () => {
    assert.deepEqual(holm([0.6, 0.7]), [1, 1]);
    assert.deepEqual(holm([0.02, 0.02]), [0.04, 0.04]);
    assert.deepEqual(holm([0.2]), [0.2]);
    assert.deepEqual(holm([]), []);
    assert.throws(() => holm([0.1, 1.2]), RangeError);
    assert.throws(() => holm([Number.NaN]), RangeError);
    assert.throws(() => holm("0.1"), RangeError);
  });
});

describe("the decision rule", () => {
  const cells = (both, firstOnly, secondOnly, neither, usable = null) => ({
    both,
    first_only: firstOnly,
    second_only: secondOnly,
    neither,
    usable_both: usable ? usable[0] : both,
    usable_first_only: usable ? usable[1] : firstOnly,
    usable_second_only: usable ? usable[2] : secondOnly,
    usable_neither: usable ? usable[3] : neither,
  });
  const facts = (over = {}) => ({
    analysed_flawed: 120,
    write_up_floor_met: true,
    usable_floor_met: true,
    audit: { agree: 36, of: 40, labels_by: "graders" },
    primary: cells(70, 25, 8, 17),
    product_vs_stronger: cells(80, 15, 10, 15),
    by_author: [
      { family: "anthropic", first_only: 13, second_only: 4 },
      { family: "openai", first_only: 12, second_only: 4 },
    ],
    single_drafter: false,
    ...over,
  });

  it("uses the plan's words for each outcome", () => {
    assert.deepEqual(OUTCOMES, ["not-measured", "too-few-cases", "no-pooled-headline", "d-better", "no-difference-of-15-found", "d-worse"]);
    assert.equal(OUTCOME_WORDS["d-better"], "D better");
    assert.equal(OUTCOME_WORDS["d-worse"], "D worse");
    assert.equal(OUTCOME_WORDS["no-difference-of-15-found"], "no difference of 15 points or more was found");
    assert.equal(OUTCOME_WORDS["too-few-cases"], "too few cases to test");
    assert.equal(OUTCOME_WORDS["not-measured"], "Not measured");
    assert.equal(MIN_ANALYSED_FLAWED, 110);
  });

  it("D better: D caught more than B under 0.05 both ways of counting", () => {
    assert.ok(mcnemarExactP(25, 8) < 0.05);
    const d = decideFourArm(facts());
    assert.equal(d.outcome, "d-better");
    assert.equal(d.words, "D better");
    assert.equal(d.counts_agree, true);
    assert.equal(d.d_not_worse_than_c, true);
    assert.equal(d.quality_sentence_allowed, true);
    assert.equal(d.changes, "may-propose-quality-sentence");
    assert.ok(d.p.misses < 0.05 && d.p.usable < 0.05);
  });

  it("D better still allows no public quality sentence when D is worse than C", () => {
    const d = decideFourArm(facts({ product_vs_stronger: cells(80, 9, 12, 19) }));
    assert.equal(d.outcome, "d-better");
    assert.equal(d.d_not_worse_than_c, false);
    assert.equal(d.quality_sentence_allowed, false);
    assert.deepEqual(d.reasons, ["D is worse than C"]);
    assert.equal(d.changes, "none");
    // Worse on usable answers only is enough to block it. Level with C is not worse.
    assert.equal(decideFourArm(facts({ product_vs_stronger: cells(80, 12, 10, 18, [78, 9, 10, 18]) })).quality_sentence_allowed, false);
    assert.equal(decideFourArm(facts({ product_vs_stronger: cells(80, 10, 10, 20) })).quality_sentence_allowed, true);
  });

  it("a single-drafter set can never restore a quality claim", () => {
    const d = decideFourArm(facts({ single_drafter: true }));
    assert.equal(d.outcome, "d-better");
    assert.equal(d.quality_sentence_allowed, false);
    assert.deepEqual(d.reasons, ["single-drafter set"]);
    assert.equal(decideFourArm(facts({ single_drafter: true, primary: cells(70, 8, 25, 17) })).outcome, "d-worse", "it can still remove one");
  });

  it("D worse: B caught more than D, which sends work to a judge quality floor", () => {
    const d = decideFourArm(facts({ primary: cells(70, 8, 25, 17), by_author: [{ family: "anthropic", first_only: 4, second_only: 13 }, { family: "openai", first_only: 4, second_only: 12 }] }));
    assert.equal(d.outcome, "d-worse");
    assert.equal(d.quality_sentence_allowed, false);
    assert.equal(d.changes, "no-quality-sentence-and-judge-quality-floor");
  });

  it("the middle branch says no difference of 15 points or more was found", () => {
    assert.ok(mcnemarExactP(14, 12) > 0.05);
    const d = decideFourArm(facts({ primary: cells(80, 14, 12, 14), by_author: [{ family: "anthropic", first_only: 7, second_only: 6 }, { family: "openai", first_only: 7, second_only: 6 }] }));
    assert.equal(d.outcome, "no-difference-of-15-found");
    assert.equal(d.words, "no difference of 15 points or more was found");
    assert.equal(d.quality_sentence_allowed, false);
    assert.equal(d.changes, "no-quality-sentence");
    assert.deepEqual(d.reasons, []);
  });

  it("claims no direction when the two ways of counting disagree", () => {
    const d = decideFourArm(facts({ primary: cells(70, 25, 8, 17, [66, 12, 8, 14]) }));
    assert.ok(mcnemarExactP(12, 8) > 0.05);
    assert.equal(d.outcome, "no-difference-of-15-found");
    assert.equal(d.counts_agree, false);
    assert.match(d.reasons.join(" "), /two ways of counting disagree/);
    assert.equal(d.quality_sentence_allowed, false);
  });

  it("does not say none was found when a gap of 15 points or more was seen and the test could not tell it from chance", () => {
    assert.equal(GAP_SEEN_WORDS, "a gap of 15 points or more was seen, and no direction is claimed");
    assert.equal(GAP_SEEN_REASON, "a gap of 15 points or more was seen, and the test could not tell it from chance");
    // 120 flawed cases. Only D caught 48, only B caught 30: 18 cases is exactly 15.0 points, and the exact test gives about 0.054.
    const p = mcnemarExactP(48, 30);
    assert.ok(p > 0.05 && p < 0.06, String(p));
    const even = (first, second) => [{ family: "anthropic", first_only: first / 2, second_only: second / 2 }, { family: "openai", first_only: first / 2, second_only: second / 2 }];
    const d = decideFourArm(facts({ primary: cells(20, 48, 30, 22), by_author: even(48, 30) }));
    assert.equal(d.outcome, "no-difference-of-15-found", "the branch, and what it changes, stay the same");
    assert.equal(d.gap_seen, true);
    assert.equal(d.words, GAP_SEEN_WORDS);
    assert.doesNotMatch(d.words, /no difference/);
    assert.deepEqual(d.reasons, [GAP_SEEN_REASON]);
    assert.equal(d.counts_agree, true);
    assert.equal(d.quality_sentence_allowed, false);
    assert.equal(d.changes, "no-quality-sentence");

    // One case fewer for D is 14.2 points, and the plain words stand.
    assert.ok(mcnemarExactP(47, 30) > 0.05);
    const under = decideFourArm(facts({ primary: cells(20, 47, 30, 23), by_author: [{ family: "anthropic", first_only: 24, second_only: 15 }, { family: "openai", first_only: 23, second_only: 15 }] }));
    assert.equal(under.outcome, "no-difference-of-15-found");
    assert.equal(under.gap_seen, false);
    assert.equal(under.words, "no difference of 15 points or more was found");
    // The plain words stand, and beside them the report says what they do not rule out: the interval runs from +0.1 to +28.3.
    assert.equal(under.fifteen_not_ruled_out, true);
    assert.deepEqual(under.reasons, [NOT_RULED_OUT_REASON]);

    // The same holds when B is ahead, and when the gap shows only on usable answers.
    const behind = decideFourArm(facts({ primary: cells(20, 30, 48, 22), by_author: even(30, 48) }));
    assert.equal(behind.outcome, "no-difference-of-15-found");
    assert.equal(behind.words, GAP_SEEN_WORDS);
    assert.ok(mcnemarExactP(40, 24) > 0.05);
    const usableOnly = decideFourArm(facts({ primary: cells(20, 40, 30, 30, [20, 40, 24, 16]), by_author: even(40, 30) }));
    assert.equal(usableOnly.words, GAP_SEEN_WORDS, "16 points on the 100 cases both arms answered");
    assert.deepEqual(usableOnly.reasons, [GAP_SEEN_REASON]);

    // The two ways of counting disagree and one of them shows the gap: still not "none was found".
    assert.ok(mcnemarExactP(30, 8) < 0.05 && mcnemarExactP(12, 8) > 0.05);
    const split = decideFourArm(facts({ primary: cells(60, 30, 8, 22, [60, 12, 8, 20]), by_author: even(30, 8) }));
    assert.equal(split.outcome, "no-difference-of-15-found");
    assert.equal(split.counts_agree, false);
    assert.equal(split.words, GAP_SEEN_WORDS);
    assert.deepEqual(split.reasons, ["the two ways of counting disagree, so no direction is claimed"]);

    // A direction that holds both ways is still a direction, whatever the size of the gap.
    assert.equal(decideFourArm(facts()).words, "D better");
  });

  it("prints the 48 to 30 table without the words 'no difference'", () => {
    const cases = [];
    const items = [];
    const add = (n, hits, prefix) => {
      for (let i = 0; i < n; i += 1) {
        const id = `${prefix}-${i}`;
        cases.push({ id, kind: "flawed", author_family: AUTHOR_FAMILIES[i % 2], drafter_family: "owner", visible: "yes" });
        for (const arm of ARMS) items.push({ id, arm, usable: true, label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
      }
    };
    add(20, ["A", "B", "C", "D"], "all");
    add(48, ["C", "D"], "product-only");
    add(30, ["A", "B"], "fresh-only");
    add(22, [], "none");
    const report = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true });
    assert.equal(report.decision.outcome, "no-difference-of-15-found");
    const text = renderReport(report);
    assert.match(text, /^## Result: a gap of 15 points or more was seen, and no direction is claimed$/m);
    assert.match(text, /^Why: a gap of 15 points or more was seen, and the test could not tell it from chance\.$/m);
    assert.ok(text.includes("48 to 30 (+15.0 points, p 0.054)"), "the row that shows the gap");
    assert.doesNotMatch(text, /no difference of 15 points or more was found/, "the page must not say none was found beside a row that shows one");
    assert.match(text, /A public sentence about quality is not allowed on this result\./);
  });

  it("under 110 analysed flawed cases the result is too few cases to test, and changes no claim", () => {
    const d = decideFourArm(facts({ analysed_flawed: 109 }));
    assert.equal(d.outcome, "too-few-cases");
    assert.equal(d.words, "too few cases to test");
    assert.equal(d.changes, "none");
    assert.equal(d.quality_sentence_allowed, false);
    assert.equal(decideFourArm(facts({ analysed_flawed: 110 })).outcome, "d-better");
    assert.equal(decideFourArm(facts({ analysed_flawed: 0 })).outcome, "too-few-cases");
  });

  it("a sign flip between the two author families voids the pooled headline", () => {
    const flipped = [{ family: "anthropic", first_only: 22, second_only: 2 }, { family: "openai", first_only: 3, second_only: 6 }];
    assert.equal(signFlip(flipped), true);
    assert.equal(signFlip([{ first_only: 5, second_only: 5 }, { first_only: 3, second_only: 6 }]), false, "level in one family is not a flip");
    assert.equal(signFlip([]), false);
    const d = decideFourArm(facts({ by_author: flipped }));
    assert.equal(d.outcome, "no-pooled-headline");
    assert.equal(d.sign_flip, true);
    assert.equal(d.quality_sentence_allowed, false);
    assert.equal(d.changes, "no-quality-sentence");
  });

  it("says how often a sign flip happens by chance, and the figures hold", () => {
    assert.equal(SIGN_FLIP_CHANCE_NOTE, "With no true difference this happens about 4 times in 10 by chance. It is not a finding that the families differ.");
    const readme = read(README);
    const splits = readme.slice(readme.indexOf("## Splits"), readme.indexOf("## The single-drafter rule"));
    const stated =
      "A sign flip is common by chance. With about 60 flawed cases in each family and no true difference, the two families land on opposite sides about 4 times in 10. With a true difference of 10 points it is about 1 time in 10. So a sign flip is not a finding that the two families differ. It means only that this run gives no pooled headline.";
    assert.ok(splits.includes(stated), "the Splits section gives the base rate");
    assert.ok(splits.indexOf("A sign flip is when") < splits.indexOf(stated), "straight after what a sign flip is");
    assert.ok(splits.indexOf("A sign flip is when") > -1);

    // The exact chance that D minus B is above zero in one family and below zero in the other, by a walk over
    // the cases of one family: each case is caught by D only, by B only, or by both or neither. `together` is how
    // far the two arms find the same cases hard, the two ends the README's own figures use.
    const chance = (perFamily, shareB, shareD, together) => {
      const both = shareB * shareD + together * Math.sqrt(shareB * (1 - shareB) * shareD * (1 - shareD));
      const steps = [[1, shareD - both], [-1, shareB - both], [0, 1 - (shareD - both) - (shareB - both)]];
      let walk = new Map([[0, 1]]);
      for (let i = 0; i < perFamily; i += 1) {
        const next = new Map();
        for (const [gap, p] of walk) for (const [step, q] of steps) next.set(gap + step, (next.get(gap + step) ?? 0) + p * q);
        walk = next;
      }
      let ahead = 0;
      let behind = 0;
      for (const [gap, p] of walk) {
        if (gap > 0) ahead += p;
        else if (gap < 0) behind += p;
      }
      return 2 * ahead * behind;
    };
    for (const together of [0, 0.3]) {
      const none = chance(60, 0.7, 0.7, together);
      const ten = chance(60, 0.7, 0.8, together);
      const fifteen = chance(60, 0.7, 0.85, together);
      assert.ok(none > 0.38 && none < 0.45, `no true difference: ${none}`);
      assert.ok(ten > 0.08 && ten < 0.16, `a true difference of 10 points: ${ten}`);
      assert.ok(fifteen < 0.05, `a true difference of 15 points: ${fifteen}`);
    }
  });

  it("prints the chance of a sign flip under the result it voids, and beside the split", () => {
    const cases = [];
    const items = [];
    const add = (n, hits, prefix, family) => {
      for (let i = 0; i < n; i += 1) {
        const id = `${prefix}-${family}-${i}`;
        cases.push({ id, kind: "flawed", flaw_type: "arithmetic", author_family: family, drafter_family: "owner", visible: "yes" });
        for (const arm of ARMS) items.push({ id, arm, usable: true, label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
      }
    };
    // Pooled: 25 to 8, which alone reads D better. By family: 22 to 2, and 3 to 6.
    add(35, ["A", "B", "C", "D"], "all", "anthropic");
    add(22, ["C", "D"], "product-only", "anthropic");
    add(2, ["A", "B"], "fresh-only", "anthropic");
    add(9, [], "none", "anthropic");
    add(35, ["A", "B", "C", "D"], "all", "openai");
    add(3, ["C", "D"], "product-only", "openai");
    add(6, ["A", "B"], "fresh-only", "openai");
    add(8, [], "none", "openai");
    const given = { date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true };
    const report = summarize({ cases, items, ...given });
    assert.deepEqual([report.primary.misses.first_only, report.primary.misses.second_only], [25, 8]);
    assert.equal(report.decision.outcome, "no-pooled-headline");
    const text = renderReport(report);
    assert.match(text, /^## Result: no pooled headline: D minus B has opposite signs in the two author families$/m);
    assert.ok(
      text.includes(`The sign flips between the two author families, so there is no pooled headline. ${SIGN_FLIP_CHANCE_NOTE}`),
      "the line under the split by author family carries the base rate",
    );
    const top = text.slice(text.indexOf("## Result"), text.indexOf("## Catch on flawed cases"));
    assert.ok(top.includes(SIGN_FLIP_CHANCE_NOTE), "and it is said straight under the result line, where a reader looks first");
    assert.equal(text.split(SIGN_FLIP_CHANCE_NOTE).length - 1, 2);
    assert.match(top, /A public sentence about quality is not allowed on this result\./);
    assert.doesNotMatch(top, /D minus B: /, "no pooled gap is put under a result that voids the pooled headline");

    // With no sign flip the note is not printed at all.
    const level = summarize({ cases: cases.map((c) => ({ ...c, author_family: AUTHOR_FAMILIES[Number(c.id.split("-").pop()) % 2] })), items, ...given });
    assert.equal(level.decision.outcome, "d-better");
    assert.equal(renderReport(level).includes(SIGN_FLIP_CHANCE_NOTE), false);
    assert.ok(renderReport(level).includes("D minus B: +14.2 points, 95% interval +5.1 to +23.2 points, with unusable answers counted as misses."), "a direction carries its interval too");
  });

  it("gives a 95% interval for the gap between two paired arms, in points", () => {
    const near = (got, want) => assert.ok(Math.abs(got - want) < 0.0001, `${got} is not ${want}`);
    // 25 v 14 of 120. The gap is 11 of 120, 9.17 points. Half the width is 1.96 x sqrt(39 - 121/120) / 120, 10.07 points.
    near(pairedDiffInterval(25, 14, 120).low, -0.9006);
    near(pairedDiffInterval(25, 14, 120).high, 19.2339);
    // 15 v 12 of 120. The gap is 2.5 points and half the width is 8.48 points.
    near(pairedDiffInterval(15, 12, 120).low, -5.9751);
    near(pairedDiffInterval(15, 12, 120).high, 10.9751);
    // The other way round is the mirror image.
    near(pairedDiffInterval(14, 25, 120).low, -19.2339);
    near(pairedDiffInterval(14, 25, 120).high, 0.9006);
    near(pairedDiffInterval(48, 30, 120).low, 0.8269);
    near(pairedDiffInterval(48, 30, 120).high, 29.1731);
    assert.deepEqual(pairedDiffInterval(0, 0, 0), { low: -100, high: 100 }, "with no cases, nothing is ruled out");
    assert.deepEqual(pairedDiffInterval(2, 0, 2), { low: 100, high: 100 });
    assert.equal(pairedDiffInterval(1, 0, 2).high, 100, "never past 100 points");
    assert.equal(pairedDiffInterval(0, 1, 2).low, -100);
    const none = pairedDiffInterval(0, 0, 120);
    assert.ok(none.low === 0 && none.high === 0);
    for (const bad of [[1.5, 0, 10], [-1, 0, 10], [1, "2", 10], [6, 5, 10], [1, 1, Number.NaN]]) assert.throws(() => pairedDiffInterval(...bad), RangeError, JSON.stringify(bad));

    // Both ways of counting carry their own interval.
    const both = pairedReadings(cells(60, 25, 14, 21, [50, 15, 12, 21]));
    near(both.misses.low, -0.9006);
    near(both.misses.high, 19.2339);
    assert.equal(both.usable.n, 98);
    assert.deepEqual({ low: both.usable.low, high: both.usable.high }, pairedDiffInterval(15, 12, 98));
    assert.ok(both.usable.high > 10.9751, "fewer cases, a wider interval");
  });

  it("says a difference of 15 points was not ruled out when the interval for D minus B reaches it", () => {
    assert.equal(NOT_RULED_OUT_REASON, "a difference of 15 points was not ruled out");
    const split = (first, second) => [
      { family: "anthropic", first_only: Math.ceil(first / 2), second_only: Math.ceil(second / 2) },
      { family: "openai", first_only: Math.floor(first / 2), second_only: Math.floor(second / 2) },
    ];
    // 25 v 14 of 120: p 0.108, a gap of 9.2 points, and an interval from -0.9 to +19.2.
    assert.ok(mcnemarExactP(25, 14) > 0.1);
    const open = decideFourArm(facts({ primary: cells(60, 25, 14, 21), by_author: split(25, 14) }));
    assert.equal(open.outcome, "no-difference-of-15-found");
    assert.equal(open.words, "no difference of 15 points or more was found");
    assert.equal(open.gap_seen, false);
    assert.equal(open.fifteen_not_ruled_out, true);
    assert.deepEqual(open.reasons, [NOT_RULED_OUT_REASON]);
    assert.equal(open.quality_sentence_allowed, false);
    assert.equal(open.changes, "no-quality-sentence");

    // 15 v 12 of 120: the interval runs from -6.0 to +11.0, so 15 points is outside it.
    const shut = decideFourArm(facts({ primary: cells(70, 15, 12, 23), by_author: split(15, 12) }));
    assert.equal(shut.outcome, "no-difference-of-15-found");
    assert.equal(shut.fifteen_not_ruled_out, false);
    assert.deepEqual(shut.reasons, []);

    // The same in the other direction, with B ahead.
    const behind = decideFourArm(facts({ primary: cells(60, 14, 25, 21), by_author: split(14, 25) }));
    assert.equal(behind.outcome, "no-difference-of-15-found");
    assert.equal(behind.fifteen_not_ruled_out, true);
    assert.deepEqual(behind.reasons, [NOT_RULED_OUT_REASON]);

    // Either way of counting is enough. On the 80 cases both arms answered, 15 v 8 runs to +20.
    assert.ok(pairedDiffInterval(15, 8, 80).high > 15 && mcnemarExactP(15, 8) > 0.05);
    const usableOnly = decideFourArm(facts({ primary: cells(70, 15, 12, 23, [40, 15, 8, 17]), by_author: split(15, 12) }));
    assert.equal(usableOnly.gap_seen, false);
    assert.equal(usableOnly.fifteen_not_ruled_out, true);
    assert.deepEqual(usableOnly.reasons, [NOT_RULED_OUT_REASON]);

    // When a gap of 15 points was seen, the result line already says so, and the reason is not said twice.
    const seen = decideFourArm(facts({ primary: cells(20, 48, 30, 22), by_author: split(48, 30) }));
    assert.equal(seen.words, GAP_SEEN_WORDS);
    assert.equal(seen.fifteen_not_ruled_out, true);
    assert.deepEqual(seen.reasons, [GAP_SEEN_REASON]);

    // On a direction it is a fact and not a reason: the reasons there say why no quality sentence is allowed.
    const better = decideFourArm(facts());
    assert.equal(better.outcome, "d-better");
    assert.equal(better.fifteen_not_ruled_out, true, "25 v 8 of 120 runs from +5.1 to +23.2");
    assert.deepEqual(better.reasons, []);
    assert.equal(better.quality_sentence_allowed, true);

    // No interval is read where no test is read.
    assert.equal(decideFourArm(facts({ analysed_flawed: 50 })).fifteen_not_ruled_out, null);
    assert.equal(decideFourArm(facts({ usable_floor_met: false })).fifteen_not_ruled_out, null);
    assert.equal(decideFourArm(null).fifteen_not_ruled_out, null);
  });

  it("prints the 95% interval beside every paired test, and under the null wording", () => {
    const cases = [];
    const items = [];
    const add = (n, hits, prefix) => {
      for (let i = 0; i < n; i += 1) {
        const id = `${prefix}-${i}`;
        cases.push({ id, kind: "flawed", flaw_type: "arithmetic", author_family: AUTHOR_FAMILIES[i % 2], drafter_family: "owner", visible: "yes" });
        for (const arm of ARMS) items.push({ id, arm, usable: true, label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
      }
    };
    add(60, ["A", "B", "C", "D"], "all");
    add(25, ["C", "D"], "product-only");
    add(14, ["A", "B"], "fresh-only");
    add(21, [], "none");
    const report = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true });
    assert.equal(report.decision.outcome, "no-difference-of-15-found");
    assert.equal(report.decision.fifteen_not_ruled_out, true);
    assert.ok(Math.abs(report.primary.misses.low + 0.9006) < 0.0001 && Math.abs(report.primary.misses.high - 19.2339) < 0.0001);
    const text = renderReport(report);
    assert.match(text, /^## Result: no difference of 15 points or more was found$/m);
    assert.match(text, /^Why: a difference of 15 points was not ruled out\.$/m);
    const top = text.slice(text.indexOf("## Result"), text.indexOf("## Catch on flawed cases"));
    assert.ok(
      top.includes("D minus B: +9.2 points, 95% interval -0.9 to +19.2 points, with unusable answers counted as misses. On usable answers only: +9.2 points, 95% interval -0.9 to +19.2 points."),
      top,
    );
    assert.ok(text.includes("25 to 14 (+9.2 points, p 0.108), 95% interval -0.9 to +19.2 points"), "the primary row");
    const rows = text.split("\n").filter((line) => /^\| [A-D] against [A-D]: /.test(line));
    assert.equal(rows.length, 5, "the primary test and the four secondary ones");
    for (const line of rows) assert.equal((line.match(/95% interval [+-]?\d+\.\d to [+-]?\d+\.\d points/g) ?? []).length, 2, line);
    assert.ok(text.includes("0 to 0 (0.0 points, p 1.000), 95% interval 0.0 to 0.0 points"), "D against C: no sign on a zero");
    assert.match(text, /The 95% interval is for the gap between the two arms, in points\./);
  });

  it("is not measured when too few answers are usable or the grader check was not passed", () => {
    for (const over of [{ usable_floor_met: false }, { audit: null }, { audit: { agree: 33, of: 40, labels_by: "graders" } }]) {
      const d = decideFourArm(facts(over));
      assert.equal(d.outcome, "not-measured");
      assert.equal(d.words, "Not measured");
      assert.equal(d.quality_sentence_allowed, false);
      assert.equal(d.p, null, "no test is read on a run that was not measured");
    }
    assert.equal(decideFourArm(facts({ audit: { agree: 20, of: 40, labels_by: "owner" } })).outcome, "d-better", "the owner's labels decide");
    assert.equal(decideFourArm(null).outcome, "not-measured");
    assert.equal(decideFourArm(facts({ usable_floor_met: false, analysed_flawed: 5 })).outcome, "not-measured", "not measured comes before too few cases");
  });

  it("is not measured when too few write-ups were usable, whatever the arms did afterwards", () => {
    for (const value of [false, undefined, null, "yes", 1]) {
      const d = decideFourArm(facts({ write_up_floor_met: value }));
      assert.equal(d.outcome, "not-measured", String(value));
      assert.deepEqual(d.reasons, ["too few usable write-ups"]);
      assert.equal(d.p, null);
      assert.equal(d.quality_sentence_allowed, false);
    }
    const { write_up_floor_met: dropped, ...without } = facts();
    assert.equal(dropped, true);
    assert.equal(decideFourArm(without).outcome, "not-measured", "a caller that never checked the write-ups gets no result");
    assert.equal(decideFourArm(facts({ write_up_floor_met: false, analysed_flawed: 120 })).outcome, "not-measured", "120 analysed cases do not rescue it");
  });

  it("holds the write-up floor: nine in ten of a split's seeds need a usable write-up", () => {
    const seeds = tinySet();
    const rows = (short = []) => seeds.map((row) => ({ id: row.id, usable: !short.includes(row.id) }));
    assert.deepEqual(writeUpFloorMet(seeds, rows(), "frozen"), { usable: 12, of: 12, met: true });
    assert.deepEqual(writeUpFloorMet(seeds, rows(["f-oven"]), "frozen"), { usable: 11, of: 12, met: true }, "11 of 12 is over 9 in 10");
    assert.deepEqual(writeUpFloorMet(seeds, rows(["f-oven", "s-hire"]), "frozen"), { usable: 10, of: 12, met: false }, "10 of 12 is under it");
    assert.deepEqual(writeUpFloorMet(seeds, rows(["f-course", "s-lease", "l-job"]), "frozen"), { usable: 9, of: 12, met: false });
    assert.deepEqual(writeUpFloorMet(seeds, [], "frozen"), { usable: 0, of: 12, met: false });
    assert.deepEqual(writeUpFloorMet(seeds, rows(), "dev"), { usable: 1, of: 1, met: true }, "each split is held to its own seeds");
    assert.deepEqual(writeUpFloorMet(seeds, [...rows(["f-oven", "s-hire"]), { id: "f-hire", usable: true }, { id: "f-hire", usable: true }], "frozen"), { usable: 10, of: 12, met: false }, "a row written twice counts once");
    assert.deepEqual(writeUpFloorMet(seeds, rows().map((row) => ({ ...row, usable: "yes" })), "frozen"), { usable: 0, of: 12, met: false });
    assert.deepEqual(writeUpFloorMet([], [], "frozen"), { usable: 0, of: 0, met: false }, "no seeds is not a pass");
    // Ten of ten at exactly nine in ten.
    const ten = seeds.filter((row) => row.split === "frozen").slice(0, 10);
    assert.equal(writeUpFloorMet(ten, ten.map((row, i) => ({ id: row.id, usable: i > 0 })), "frozen").met, true, "9 of 10 meets the floor");
  });

  it("needs every arm usable on at least 9 in 10 flawed cases", () => {
    const arm = (id, usable) => ({ arm: id, flawed: 120, usable_flawed: usable });
    assert.equal(usableFloorMet(FOUR_ARM_IDS.map((id) => arm(id, 108))), true);
    assert.equal(usableFloorMet(FOUR_ARM_IDS.map((id, i) => arm(id, i === 2 ? 107 : 120))), false);
    assert.equal(usableFloorMet(FOUR_ARM_IDS.slice(0, 3).map((id) => arm(id, 120))), false, "a missing arm is not usable");
    assert.equal(usableFloorMet([]), false);
  });

  it("reads its facts from a public block, whichever way round a pair is listed", () => {
    const block = {
      cases: { flawed: 120, sound: 40, loaded: 20 },
      arms: FOUR_ARM_IDS.map((id) => ({ arm: id, flawed: 120, usable_flawed: 118 })),
      comparisons: [
        { first: "fresh-brief", second: "product", ...cells(70, 8, 25, 17) },
        { first: "product", second: "stronger-same-lab", ...cells(80, 15, 10, 15) },
      ],
      single_drafter: false,
    };
    const byAuthor = [
      { family: "anthropic", first_only: 13, second_only: 4 },
      { family: "openai", first_only: 12, second_only: 4 },
    ];
    const got = factsFromBlock(block, { by_author: byAuthor, audit: { agree: 40, of: 40, labels_by: "graders" }, write_up_floor_met: true });
    assert.equal(got.primary.first_only, 25, "the product's cell, though the block lists it second");
    assert.equal(got.primary.second_only, 8);
    assert.equal(got.analysed_flawed, 120);
    assert.equal(got.usable_floor_met, true);
    assert.equal(got.write_up_floor_met, true);
    assert.deepEqual(got.by_author, byAuthor);
    assert.equal(decideFourArm(got).outcome, "d-better");
    // The write-up floor is not in the public block. A caller that does not pass it gets no result.
    const unchecked = factsFromBlock(block, { by_author: byAuthor, audit: { agree: 40, of: 40, labels_by: "graders" } });
    assert.equal(unchecked.write_up_floor_met, false);
    assert.equal(decideFourArm(unchecked).outcome, "not-measured");
    assert.deepEqual(decideFourArm(unchecked).reasons, ["too few usable write-ups"]);
  });

  it("the public block alone gives no result: the split by author family is not in it", () => {
    const block = {
      cases: { flawed: 120, sound: 40, loaded: 20 },
      arms: FOUR_ARM_IDS.map((id) => ({ arm: id, flawed: 120, usable_flawed: 118 })),
      comparisons: [
        { first: "product", second: "fresh-brief", ...cells(70, 25, 8, 17) },
        { first: "product", second: "stronger-same-lab", ...cells(80, 15, 10, 15) },
      ],
      single_drafter: false,
    };
    const checked = { audit: { agree: 40, of: 40, labels_by: "graders" }, write_up_floor_met: true };
    // Everything a page could read from the block, and the two checks it would have to be told. Still no result.
    const alone = factsFromBlock(block, checked);
    assert.deepEqual(alone.by_author, []);
    const d = decideFourArm(alone);
    assert.equal(d.outcome, "not-measured");
    assert.deepEqual(d.reasons, [SPLIT_MISSING_REASON]);
    assert.equal(d.quality_sentence_allowed, false);
    // These pooled counts hide a sign flip. Only the split shows it.
    const flipped = [{ family: "anthropic", first_only: 22, second_only: 2 }, { family: "openai", first_only: 3, second_only: 6 }];
    assert.equal(decideFourArm(factsFromBlock(block, { ...checked, by_author: flipped })).outcome, "no-pooled-headline");
    assert.equal(decideFourArm(factsFromBlock(block)).outcome, "not-measured");
  });

  it("a caller that never passed the split by author family gets no result", () => {
    assert.equal(SPLIT_MISSING_REASON, "the split by author family is missing");
    const { by_author: split, ...without } = facts();
    assert.equal(split.length, 2);
    assert.equal(decideFourArm(facts()).outcome, "d-better", "with the split, these counts are D better");
    const noResult = (given, why) => {
      const d = decideFourArm(given);
      assert.equal(d.outcome, "not-measured", why);
      assert.equal(d.words, "Not measured", why);
      assert.deepEqual(d.reasons, [SPLIT_MISSING_REASON], why);
      assert.equal(d.sign_flip, null, why);
      assert.equal(d.p, null, why);
      assert.equal(d.quality_sentence_allowed, false, why);
      assert.equal(d.changes, "none", why);
    };
    noResult(without, "left out");
    noResult(facts({ by_author: [] }), "an empty list");
    noResult(facts({ by_author: null }), "null");
    noResult(facts({ by_author: "anthropic openai" }), "text");
    noResult(facts({ by_author: [split[0]] }), "one family only");
    noResult(facts({ by_author: [split[1], split[1]] }), "the same family twice");
    noResult(facts({ by_author: [split[0], { ...split[1], family: "google" }] }), "a family that writes no case");
    noResult(facts({ by_author: [split[0], null] }), "a row that is not a row");
    noResult(facts({ by_author: [split[0], { family: "openai", first_only: 12 }] }), "a cell left out");
    noResult(facts({ by_author: [split[0], { family: "openai", first_only: 12.5, second_only: 4 }] }), "not a whole number");
    noResult(facts({ by_author: [split[0], { family: "openai", first_only: "12", second_only: 4 }] }), "a number written as text");
    noResult(facts({ by_author: [split[0], { family: "openai", first_only: -1, second_only: 4 }] }), "under zero");
    // A family where the two arms caught the same cases is there, with zeros. That is not a missing split.
    assert.equal(decideFourArm(facts({ by_author: [{ family: "anthropic", first_only: 25, second_only: 8 }, { family: "openai", first_only: 0, second_only: 0 }] })).outcome, "d-better");
    // Too few cases is still said first. It changes no claim either way.
    assert.equal(decideFourArm({ ...without, analysed_flawed: 109 }).outcome, "too-few-cases");
    // The floors still come before it.
    assert.deepEqual(decideFourArm({ ...without, usable_floor_met: false }).reasons, ["too few usable answers"]);
  });

  it("120 flawed cases from one author family alone are no result, and the report says why", () => {
    const cases = [];
    const items = [];
    const add = (n, hits, prefix) => {
      for (let i = 0; i < n; i += 1) {
        const id = `${prefix}-${i}`;
        cases.push({ id, kind: "flawed", flaw_type: "arithmetic", author_family: "anthropic", drafter_family: "owner", visible: "yes" });
        for (const arm of ARMS) items.push({ id, arm, usable: true, label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
      }
    };
    add(60, ["A", "B", "C", "D"], "all");
    add(30, ["C", "D"], "product-only");
    add(8, ["A", "B"], "fresh-only");
    add(22, [], "none");
    const report = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true });
    assert.deepEqual([report.primary.misses.first_only, report.primary.misses.second_only], [30, 8]);
    assert.ok(report.primary.misses.p < 0.001, "the pooled counts alone would read D better");
    assert.deepEqual(report.splits.by_author.map((row) => row.key), ["anthropic"]);
    assert.equal(report.decision.outcome, "not-measured");
    assert.deepEqual(report.decision.reasons, [SPLIT_MISSING_REASON]);
    assert.match(renderReport(report), /## Result: Not measured\n\nWhy: the split by author family is missing\.\nNothing here is a result\. No counts are published\./);
  });

  it("carries the result and the split by author family in whole numbers, enough for a page to reach the same result", () => {
    const cases = [];
    const items = [];
    const add = (n, hits, prefix, family) => {
      for (let i = 0; i < n; i += 1) {
        const id = `${prefix}-${family}-${i}`;
        cases.push({ id, kind: "flawed", flaw_type: "arithmetic", author_family: family, drafter_family: "owner", visible: "yes" });
        for (const arm of ARMS) items.push({ id, arm, usable: !(arm === "B" && prefix === "product-only" && i === 0), label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
      }
    };
    const fill = (flip) => {
      cases.length = 0;
      items.length = 0;
      add(35, ["A", "B", "C", "D"], "all", "anthropic");
      add(flip ? 22 : 13, ["C", "D"], "product-only", "anthropic");
      add(flip ? 2 : 4, ["A", "B"], "fresh-only", "anthropic");
      add(flip ? 1 : 8, [], "none", "anthropic");
      add(35, ["A", "B", "C", "D"], "all", "openai");
      add(flip ? 3 : 12, ["C", "D"], "product-only", "openai");
      add(flip ? 6 : 4, ["A", "B"], "fresh-only", "openai");
      add(flip ? 16 : 9, [], "none", "openai");
    };
    const audit = { agree: 38, of: 40, labels_by: "graders" };
    for (const [flip, outcome] of [[false, "d-better"], [true, "no-pooled-headline"]]) {
      fill(flip);
      const report = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit, write_up_floor_met: true });
      assert.equal(report.public_block.cases.flawed, 120);
      assert.deepEqual([report.primary.misses.first_only, report.primary.misses.second_only], [25, 8], "the pooled counts are the same both times");
      assert.equal(report.decision.outcome, outcome);
      assert.deepEqual(report.public_result, publicResult(report.decision, report.splits.by_author));
      assert.equal(report.public_result.outcome, outcome);
      assert.ok(OUTCOMES.includes(report.public_result.outcome));
      assert.deepEqual(
        report.public_result.by_author,
        flip
          ? [
              { family: "anthropic", first_only: 22, second_only: 2, usable_first_only: 21, usable_second_only: 2 },
              { family: "openai", first_only: 3, second_only: 6, usable_first_only: 2, usable_second_only: 6 },
            ]
          : [
              { family: "anthropic", first_only: 13, second_only: 4, usable_first_only: 12, usable_second_only: 4 },
              { family: "openai", first_only: 12, second_only: 4, usable_first_only: 11, usable_second_only: 4 },
            ],
      );
      assert.doesNotMatch(JSON.stringify(report.public_result), /\d\.\d/, "whole numbers and ids only");
      // A page that has the block and these two fields reaches the harness's own result. The block alone does not.
      const told = { audit, write_up_floor_met: true };
      assert.equal(decideFourArm(factsFromBlock(report.public_block, { ...told, by_author: report.public_result.by_author })).outcome, outcome);
      assert.equal(decideFourArm(factsFromBlock(report.public_block, told)).outcome, "not-measured");
    }
  });

  it("ranks arms on alarm only at 30 points or more, and never ranks arm A", () => {
    const arms = [
      { arm: "same-chat", alarms: 40, sound: 40 },
      { arm: "fresh-brief", alarms: 16, sound: 40 },
      { arm: "stronger-same-lab", alarms: 12, sound: 40 },
      { arm: "product", alarms: 4, sound: 40 },
    ];
    const pairs = alarmRanking(arms);
    assert.deepEqual(pairs.map((pair) => `${pair.first}${pair.second}`), ["DB", "DC", "CB"]);
    assert.equal(pairs[0].ranked, true, "40% against 10% is 30 points");
    assert.equal(pairs[0].lower_alarm, "D");
    assert.equal(pairs[1].ranked, false, "30% against 10% is 20 points");
    assert.equal(pairs[1].lower_alarm, null);
    assert.equal(pairs[2].ranked, false);
    assert.equal(alarmRanking([{ arm: "product", alarms: 0, sound: 0 }])[0].gap_points, null);
    assert.equal(ALARM_RANK_GAP_POINTS, 30);
  });
});

// == Writing into the results file ================================================
describe("merging the block into data/results.json", () => {
  const text = read(COMMITTED_RESULTS);
  const cases = [{ id: "f1", kind: "flawed", author_family: "openai", drafter_family: "anthropic", visible: "yes" }];
  const items = ARMS.map((arm) => ({ id: "f1", arm, usable: true, label: arm === "D" ? "yes" : "no", words: 10, objections: 1 }));
  // Dates are taken from the committed file, so these tests do not start failing when it is next updated.
  const today = JSON.parse(text).updated;
  const yearFrom = (date, add) => `${Number(date.slice(0, 4)) + add}-01-15`;
  const block = (date = today) => buildPublicBlock({ cases, items, date, commit: "abc1234", single_drafter: true });

  it("replaces four_arm, leaves every other byte alone, and validates the whole new text", () => {
    const next = mergeFourArmIntoResultsText(text, block());
    const before = JSON.parse(text);
    const after = validateResults(JSON.parse(next));
    assert.deepEqual(after.four_arm, block());
    for (const key of Object.keys(before)) {
      if (key === "four_arm") continue;
      assert.deepEqual(after[key], before[key], key);
      assert.equal(topLevelValueText(next, key), topLevelValueText(text, key), `${key} is byte for byte as it was`);
    }
    assert.equal(topLevelValueText(next, "four_arm"), JSON.stringify(block(), null, 2).replace(/\n/g, "\n  "));
    const start = text.indexOf(topLevelValueText(text, "four_arm"));
    assert.equal(next.slice(0, start), text.slice(0, start), "everything above the block is byte for byte the same");
    assert.equal(next.length - topLevelValueText(next, "four_arm").length, text.length - topLevelValueText(text, "four_arm").length, "nothing else grew or shrank");
    assert.equal(topLevelValueText(text, "no_such_key"), null);
  });

  it("moves `updated` forward when the block is dated later, and never back", () => {
    const later = JSON.parse(mergeFourArmIntoResultsText(text, block(yearFrom(today, 1))));
    assert.equal(later.updated, yearFrom(today, 1));
    assert.equal(JSON.parse(mergeFourArmIntoResultsText(text, block(today))).updated, today);
    assert.equal(JSON.parse(mergeFourArmIntoResultsText(text, block(yearFrom(today, -1)))).updated, today);
  });

  it("refuses a block the validator would refuse, and a file with no four_arm key", () => {
    assert.throws(() => mergeFourArmIntoResultsText(text, { ...block(), rate: 0.5 }), /four_arm\.rate/);
    assert.throws(() => mergeFourArmIntoResultsText(text, { ...block(), note: "D wins" }), /four_arm\.note/);
    assert.throws(() => mergeFourArmIntoResultsText('{"version":1}', block()), /no top-level "four_arm"/);
    assert.throws(() => mergeFourArmIntoResultsText(text.replace('"version": 1', '"version": 2'), block()), /version/);
    assert.throws(() => mergeFourArmIntoResultsText({}, block()), /read as text/);
  });

  it("can put the draft back", () => {
    const measured = mergeFourArmIntoResultsText(text, block());
    const draft = mergeFourArmIntoResultsText(measured, { status: "draft", arms: [], comparisons: [] });
    assert.deepEqual(JSON.parse(draft).four_arm, { status: "draft", arms: [], comparisons: [] });
  });
});

// == The CLI with no key ==========================================================
describe("eval-four-arm.mjs with no key", () => {
  it("prints SKIPPED and exits 0 without a score, for each step that would call a model", async () => {
    const out = mkdtempSync(join(tmpdir(), "four-arm-skip-"));
    for (const step of ["author", "run", "score"]) {
      const { code, stdout } = await runCli([step, "--out", out], envFor());
      assert.equal(code, 0, step);
      assert.match(stdout, /^SKIPPED: no arm ran$/m, step);
      assert.doesNotMatch(stdout, /Not measured|\d+ of \d+|%/, step);
    }
    assert.equal(existsSync(join(out, "meta.json")), false, "a skipped step writes nothing");
    rmSync(out, { recursive: true, force: true });
  });

  it("with --require-key, exits 2 and says nothing was measured", async () => {
    const out = mkdtempSync(join(tmpdir(), "four-arm-require-"));
    const summary = join(out, "summary.md");
    for (const step of ["author", "run", "score"]) {
      const { code, stdout } = await runCli([step, "--require-key", "--out", out, "--split", "frozen"], envFor({ GITHUB_STEP_SUMMARY: summary }));
      assert.equal(code, 2, step);
      assert.match(stdout, /SKIPPED: no arm ran/, step);
      assert.match(stdout, /::error::Not measured: no router key, so no arm reached a model\./, step);
      assert.doesNotMatch(stdout, /\d+ of \d+|%/, step);
    }
    assert.match(read(summary), /\*\*Not measured: no router key, so no arm reached a model\.\*\* No score is reported\./);
    assert.equal(existsSync(join(out, "writeups.jsonl")), false);
    rmSync(out, { recursive: true, force: true });
  });

  it("on the frozen split, no key is Not measured with or without --require-key: a frozen step never ends green on a skip", async () => {
    const out = mkdtempSync(join(tmpdir(), "four-arm-frozen-nokey-"));
    for (const step of ["author", "run", "score"]) {
      const { code, stdout } = await runCli([step, "--split", "frozen", "--out", out], envFor());
      assert.equal(code, 2, `${step} --split frozen with no key and no --require-key`);
      assert.match(stdout, /::error::Not measured: no router key, so no arm reached a model\./, step);
      assert.match(stdout, /No score is reported and no results file was changed\./, step);
      assert.doesNotMatch(stdout, /\d+ of \d+|%/, step);
    }
    assert.equal(existsSync(join(out, "meta.json")), false);
    // The dev split keeps its skip, and steps that call no model are not held to a key.
    assert.equal((await runCli(["author", "--split", "dev", "--out", out], envFor())).code, 0);
    assert.equal((await runCli(["preflight", "--split", "frozen", "--out", out], envFor())).code, 0, "preflight calls no model");
    rmSync(out, { recursive: true, force: true });
  });

  it("refuses an endpoint override that is not loopback, before anything is sent", async () => {
    const { code, stderr } = await runCli(["author"], envFor({ OPENROUTER_API_KEY: "test-key", JUDGE_OPENROUTER_URL: "https://collector.example/v1" }));
    assert.equal(code, 1);
    assert.match(stderr, /JUDGE_OPENROUTER_URL must point at loopback/);
  });

  it("preflight calls no model and says what a run would use", async () => {
    const { code, stdout } = await runCli(["preflight"], envFor());
    assert.equal(code, 0, stdout);
    assert.match(stdout, /No model is called\./);
    assert.match(stdout, /Product judge chain: openrouter\/auto \(untouched\)\./);
    assert.match(stdout, /Router key: none\. A dev step will skip\. A frozen step will be Not measured\./);
    assert.match(stdout, /node scripts\/upstream-check\.mjs/);
    assert.ok(stdout.includes(`Model ids fingerprint: ${armsModelsChecksum(JSON.parse(read(ARMS_FILE)))}`), "the value registration records as models_sha256");
    const draft = JSON.parse(read(ARMS_FILE)).status === "draft";
    if (draft) assert.match(stdout, /placeholders until confirmed/);
  });

  it("with no subcommand, or one it does not know, exits 1", async () => {
    assert.equal((await runCli([], envFor())).code, 1);
    const unknown = await runCli(["measure-everything"], envFor());
    assert.equal(unknown.code, 1);
    assert.match(unknown.stderr, /unknown subcommand/);
    assert.equal((await runCli(["--help"], envFor())).code, 0);
  });
});

describe("eval-four-arm.mjs validate-seeds and assign-authors", () => {
  const dir = mkdtempSync(join(tmpdir(), "four-arm-seeds-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("prints counts by kind, category, flaw type and split, the checksum and the README lines", async () => {
    const file = join(dir, "good.jsonl");
    writeFileSync(file, toJsonl(tinySet()));
    const { code, stdout } = await runCli(["validate-seeds", file], envFor());
    assert.equal(code, 0, stdout);
    assert.match(stdout, /^Seeds: 13$/m);
    assert.match(stdout, /^By kind: flawed 8, sound 3, loaded 2$/m);
    assert.match(stdout, /^By split: frozen 12, dev 1$/m);
    assert.match(stdout, /^By category: pricing-and-sales 13$/m);
    assert.match(stdout, /^By flaw type: hidden-dependency 8, none 3, loaded-question 2$/m);
    assert.match(stdout, /^By drafter family: anthropic 13$/m);
    assert.match(stdout, /^By author family: anthropic 8, openai 5$/m);
    assert.match(stdout, /^Frozen by kind and author family: flawed anthropic 4 and openai 3; sound anthropic 2 and openai 1; loaded anthropic 1 and openai 1$/m);
    assert.ok(stdout.includes(`Frozen checksum: ${seedsChecksum(tinySet())}`));
    assert.ok(stdout.includes(renderSeedCounts(tinySet())));
    assert.match(stdout, /^Problems: none$/m);
    const only = await runCli(["validate-seeds", file, "--print-checksum"], envFor());
    assert.equal(only.stdout.trim(), seedsChecksum(tinySet()));
  });

  it("lists every problem and exits 1", async () => {
    const file = join(dir, "bad.jsonl");
    const rows = tinySet();
    rows[0] = { ...rows[0], kind: "odd", extra: "x" };
    rows[1] = { ...rows[1], user_ask: `${rows[1].user_ask} Mail pat@print-shop.example today.` };
    writeFileSync(file, `${toJsonl(rows)}{broken\n`);
    const { code, stdout } = await runCli(["validate-seeds", file], envFor());
    assert.equal(code, 1);
    assert.match(stdout, /^Problems: \d+$/m);
    assert.match(stdout, /- line 1 \(f-oven\): unexpected field: extra/);
    assert.match(stdout, /- line 1 \(f-oven\): kind must be one of/);
    assert.match(stdout, /- line 2 \(f-hire\): user_ask has what looks like an email address/);
    assert.match(stdout, /- line 14: not JSON/);
    assert.match(stdout, /^By kind: /m, "the counts are still printed");
    assert.doesNotMatch(stdout, /pat@print-shop/, "the address itself is not repeated");
    const none = await runCli(["validate-seeds", file, "--print-checksum"], envFor());
    assert.equal(none.code, 1, "no checksum for a file with problems");
  });

  it("assign-authors fills every seed and the result validates", async () => {
    const file = join(dir, "draft.jsonl");
    writeFileSync(file, toJsonl(tinySet().map((row) => ({ ...row, author_family: "" }))));
    const printed = await runCli(["assign-authors", file], envFor());
    assert.equal(printed.code, 0, printed.stderr);
    assert.equal(printed.stdout, toJsonl(tinySet()));
    assert.match(read(file), /"author_family":""/, "without --write the file is left alone");
    const written = await runCli(["assign-authors", file, "--write"], envFor());
    assert.equal(written.code, 0, written.stderr);
    assert.equal(read(file), toJsonl(tinySet()));
  });
});

// == A full run against the loopback stand-in =====================================
describe("a full loopback run of a tiny set", () => {
  const dir = mkdtempSync(join(tmpdir(), "four-arm-run-"));
  const seeds = tinySet();
  const sum = seedsChecksum(seeds);
  const arms = fixtureArms({ seeds_sha256: sum, judge_prompt_sha256: judgePromptFingerprint() });
  const paths = { seeds: join(dir, "seeds.jsonl"), arms: join(dir, "arms.json"), checksum: join(dir, "seeds.sha256"), out: join(dir, "out"), results: join(dir, "results.json") };
  const common = ["--split", "frozen", "--seeds", paths.seeds, "--arms", paths.arms, "--checksum", paths.checksum, "--out", paths.out, "--backoff-ms", "0"];
  const stamp = ["--date", "2026-12-01", "--commit", "abc1234"];
  const script = {
    "f-oven": { writeUp: "hidden", C: "hit", D: "hit" },
    "f-hire": { A: "hit", D: "hit" },
    "f-lease": { B: "hit", C: "hit", D: "hit" },
    "f-course": {},
    "f-supplier": { A: "hit", B: "hit", C: "hit" },
    "f-event": { A: "hit", B: "hit", C: "hit", D: "hit" },
    "f-tool": { writeUp: "flagged" },
    "s-oven": { A: "hit", B: "hit" },
    "s-hire": { A: "hit", D: "hit" },
    "s-lease": { A: "hit" },
    "l-price": { D: "hit" },
    "l-job": {},
  };
  const productHashes = () => ["scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/checkCore.mjs", "server/index.mjs", "data/results.json"].map((file) => sha(read(join(REPO, file))));
  let router;
  let env;
  let steps;
  let hashesBefore;

  before(async () => {
    hashesBefore = productHashes();
    writeFileSync(paths.seeds, toJsonl(seeds));
    writeFileSync(paths.arms, JSON.stringify(arms, null, 2));
    writeFileSync(paths.checksum, `${sum}\n`);
    writeFileSync(paths.results, read(COMMITTED_RESULTS));
    // One grader talks nonsense, so the harness has to ask the next one on the list.
    router = await startFourArmRouter({ arms, script, graders: { "mistralai/example-grader": "garbage" } });
    // JUDGE_MODEL is set in the caller on purpose: no child may inherit it.
    env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", JUDGE_MODEL: "openai/should-never-be-asked", ...router.env });
    steps = {};
    steps.author = await runCli(["author", ...common, ...stamp, "--concurrency", "4"], env);
    steps.run = await runCli(["run", ...common, ...stamp, "--concurrency", "4"], env);
    steps.score = await runCli(["score", ...common, ...stamp, "--concurrency", "4"], env);
  });
  after(async () => {
    await router?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const jsonl = (name) => read(join(paths.out, name)).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const familyOf = (id) => seeds.find((row) => row.id === id).author_family;
  const ownerReplies = (flip = 0) => {
    const path = join(dir, `replies-${flip}.txt`);
    const lines = jsonl("audit-map.jsonl").map((row, i) => `${row.n}: ${i < flip ? (row.graders === "yes" ? "no" : "yes") : row.graders}`);
    writeFileSync(path, `${lines.join("\n")}\n`);
    return path;
  };

  it("the author model writes each frozen write-up once, and two flags are set before any arm runs", () => {
    assert.equal(steps.author.code, 0, steps.author.stderr);
    assert.match(steps.author.stdout, /Write-ups: 12 of 12 usable\./);
    assert.match(steps.author.stdout, /Analysed cases: 6 flawed, 3 sound twins, 2 loaded\./);
    assert.match(steps.author.stdout, /Left out by rule: no usable write-up 0, the author already flagged the flaw 1\./);
    assert.equal(router.calls.author.length, 12, "the dev seed is not part of a frozen run");
    for (const call of router.calls.author) {
      assert.equal(call.body.model, arms.families[familyOf(call.ref)].author_model);
      assert.deepEqual(call.body.messages, [{ role: "user", content: seeds.find((row) => row.id === call.ref).user_ask }]);
      assert.equal("tools" in call.body, false);
      assert.deepEqual(call.body.provider, { zdr: true, data_collection: "deny" });
    }
    const writeUps = jsonl("writeups.jsonl");
    assert.equal(writeUps.find((row) => row.id === "f-oven").visible, "no");
    assert.equal(writeUps.find((row) => row.id === "f-tool").flagged, "yes");
    assert.equal(writeUps.find((row) => row.id === "f-event").visible, "yes");
    assert.equal(writeUps.find((row) => row.id === "s-oven").visible, null, "only flawed cases are flagged");
    for (const row of writeUps) assert.equal(row.sha256, sha(row.write_up));
  });

  it("drives all four arms: A in the same chat, B and C pinned in the child, D on the product path", () => {
    assert.equal(steps.run.code, 0, steps.run.stderr);
    for (const arm of ARMS) assert.match(steps.run.stdout, new RegExp(`Arm ${arm} \\(.*\\): 6 of 6 flawed cases got a usable answer\\.`));
    assert.equal(router.calls.unknown.length, 0, "nothing asked for a model the run does not name, the caller's JUDGE_MODEL included");
    assert.equal(router.calls.armA.length, 11);
    const writeUps = jsonl("writeups.jsonl");
    for (const call of router.calls.armA) {
      const row = seeds.find((r) => r.id === call.ref);
      assert.equal(call.body.model, arms.families[row.author_family].author_model);
      assert.deepEqual(call.body.messages, armAMessages(row, writeUps.find((w) => w.id === row.id).write_up));
      assert.equal(call.body.messages[2].content.endsWith("\n\nArgue the other side."), true);
      assert.equal("tools" in call.body, false);
      assert.equal("temperature" in call.body, false);
    }
    const byArm = (arm) => router.calls.judge.filter((call) => call.arm === arm);
    for (const arm of ["B", "C", "D"]) assert.equal(byArm(arm).length, 11, arm);
    assert.ok(!router.calls.judge.some((call) => call.ref === "f-tool"), "a case left out by rule is never sent to an arm");
    for (const call of byArm("B")) {
      assert.equal(call.body.model, arms.families[familyOf(call.ref)].author_model);
      assert.equal("plugins" in call.body, false);
    }
    for (const call of byArm("C")) assert.equal(call.body.model, arms.families[familyOf(call.ref)].stronger_model);
    for (const call of byArm("D")) {
      assert.equal(call.body.model, "openrouter/auto");
      const expected = familyOf(call.ref) === "anthropic" ? ["anthropic/*", "*/claude-*"] : ["openai/*"];
      assert.deepEqual(call.body.plugins, [{ id: "auto-router", excluded_models: expected }], "only the author's company is left out");
    }
    for (const call of router.calls.judge) {
      assert.equal(call.body.tools[0].function.name, "report_challenge", "every judge arm gets Grill's brief");
      assert.deepEqual(call.body.provider, { zdr: true, data_collection: "deny" });
      assert.equal(call.body.messages[1].content.includes(seeds.find((row) => row.id === call.ref).user_ask), false, "arms B, C and D see the write-up, not the ask");
    }
    const answers = jsonl("answers.jsonl");
    assert.equal(answers.length, 44);
    assert.ok(answers.every((row) => row.usable && row.requests === 1));
    assert.ok(answers.filter((row) => row.arm === "D").every((row) => row.served_company === "google"));
  });

  it("keeps what each arm returned as it came back: the reply for arm A, the judge's own result for B, C and D", () => {
    const answers = jsonl("answers.jsonl");
    for (const row of answers.filter((r) => r.arm === "A")) {
      assert.equal(row.judge, null, "arm A does not run the judge");
      assert.match(row.raw, /^As Claude, made by Anthropic, and not ChatGPT, I will argue the other side/);
      assert.notEqual(row.raw, row.critique);
    }
    const judged = answers.filter((r) => r.arm !== "A");
    assert.equal(judged.length, 33);
    for (const row of judged) {
      const id = `${row.id} ${row.arm}`;
      assert.ok(row.judge !== null && typeof row.judge === "object", `${id}: the judge's result is kept`);
      assert.equal(row.judge.verdict, row.verdict, id);
      assert.equal(row.judge.servedModel, row.served_model, id);
      assert.equal(row.judge.challenges.length, row.challenges, id);
      for (const field of ["verdictReason", "steelman", "counterSteelman", "strongestObjection"]) assert.ok(typeof row.judge[field] === "string" && row.judge[field].length > 0, `${id} ${field}`);
      for (const field of ["challenges", "rejected", "notes", "factsNeeded", "requestedChain"]) assert.ok(Array.isArray(row.judge[field]), `${id} ${field}`);
      assert.ok("grounding" in row.judge && "degraded" in row.judge && "decorrelated" in row.judge, id);
      assert.equal(row.judge.declaredAuthor, familyOf(row.id), id);
      assert.equal(row.judge.challenges[0].falsifier, "Check the first week against the plan before spending more.", `${id}: the challenge as the judge wrote it`);
    }
    const product = judged.filter((row) => row.arm === "D");
    assert.ok(product.every((row) => row.judge.servedModel === PRODUCT_SERVES && row.judge.decorrelated === true && row.judge.requestedChain[0] === "openrouter/auto"));
    assert.ok(product.every((row) => !row.critique.includes(PRODUCT_SERVES)), "the graded text stays blinded");
    assert.doesNotMatch(read(join(paths.out, "answers.jsonl")), /test-key-loopback-only/, "the key is in no row");
  });

  it("graders see blinded text only: no arm, no model, no vendor", () => {
    assert.equal(steps.score.code, 0, steps.score.stderr);
    assert.match(steps.score.stdout, /Graded: 44 of 44 usable answers\./);
    const gradeCalls = router.calls.grader.filter((call) => !String(call.body.messages[1].content).includes('"visible"'));
    assert.ok(gradeCalls.length >= 44 * 3);
    const ids = [...armsModelIds(arms), PRODUCT_SERVES, "openrouter/auto"];
    for (const call of router.calls.grader) {
      const text = call.body.messages.map((m) => m.content).join("\n");
      assert.deepEqual(namesFound(text), [], "a name reached a grader");
      for (const id of ids) assert.equal(text.includes(id), false, id);
      assert.doesNotMatch(text, /\barm [A-D]\b|same-chat|fresh-brief|stronger-same-lab/i);
      assert.equal(text.includes(ARM_A_REQUEST), false, "the request that marks arm A is not shown");
      assert.equal(call.body.temperature, 0);
    }
    for (const call of gradeCalls) assert.notEqual(call.model, "google/example-grader", "the company that served the product arm does not grade");
    const armAText = gradeCalls.map((call) => call.body.messages[1].content).find((text) => text.includes("I will argue the other side"));
    assert.ok(armAText.includes(`As ${NAME_REMOVED}, made by ${NAME_REMOVED}, and not ${NAME_REMOVED}, I will argue`), "the names arm A wrote were taken out");
    const asked = new Set(gradeCalls.map((call) => call.model));
    assert.deepEqual([...asked].sort(), ["deepseek/example-grader", "minimax/example-grader", "mistralai/example-grader", "moonshotai/example-grader"]);
    const grades = jsonl("grades.jsonl");
    assert.ok(grades.every((row) => row.label === "yes" || row.label === "no"));
    assert.ok(grades.every((row) => row.votes.filter((vote) => vote.answer !== null).length === 3), "three votes each, the nonsense grader replaced");
    assert.equal(grades.find((row) => row.id === "f-event" && row.arm === "D").label, "yes");
    assert.equal(grades.find((row) => row.id === "f-course" && row.arm === "D").label, "no");
    assert.equal(grades.find((row) => row.id === "s-oven" && row.arm === "B").question, "alarm");
    const sheet = read(join(paths.out, "audit-sheet.md"));
    assert.deepEqual(namesFound(sheet), []);
    assert.doesNotMatch(sheet, /\barm [A-D]\b/i);
    assert.equal(jsonl("audit-map.jsonl").filter((row) => row.sample).length, 40);
  });

  it("is not measured until the owner has checked the graders, and not when they fall under 34 of 40", async () => {
    const unchecked = await runCli(["report", ...common, "--results", paths.results], env);
    assert.equal(unchecked.code, 2);
    assert.match(unchecked.stdout, /::error::Not measured: the grader check has not been done\./);
    assert.doesNotMatch(unchecked.stdout, /Public block|Catch on flawed cases|p 0\./);
    const low = await runCli(["report", ...common, "--owner-labels", ownerReplies(7), "--results", paths.results], env);
    assert.equal(low.code, 2);
    assert.match(low.stdout, /::error::Not measured: the graders matched the owner on 33 of 40 blinded items, under the floor of 34 of 40/);
    assert.equal(read(paths.results), read(COMMITTED_RESULTS), "no results file was changed");
    assert.equal(existsSync(join(paths.out, "public-block.json")), false);
  });

  it("yields a public block that validates, with the counts the arms earned", async () => {
    const report = await runCli(["report", ...common, "--owner-labels", ownerReplies(6), "--results", paths.results], env);
    assert.equal(report.code, 0, report.stdout + report.stderr);
    assert.match(report.stdout, /REHEARSAL, not a measurement: this run used a loopback endpoint/);
    assert.match(report.stdout, /## Result: too few cases to test/);
    assert.match(report.stdout, /Fewer than 110 flawed cases were analysed\. This changes no claim\./);
    assert.match(report.stdout, /A public sentence about quality is not allowed on this result\./);
    assert.match(report.stdout, /The graders matched the owner on 34 of 40 blinded items\./);
    assert.match(report.stdout, /Single-drafter set/);
    assert.match(report.stdout, /Left out by rule before any arm ran: no usable write-up 0, the author already flagged the flaw 1\./);
    assert.match(report.stdout, /- not visible in the write-up\. Flawed cases: 1\. Only the first arm caught: 1\. Only the second arm caught: 0\./);
    assert.match(report.stdout, /shown, not compared: this arm is told to argue/);

    const block = JSON.parse(read(join(paths.out, "public-block.json")));
    validateFourArm(block);
    assert.ok(report.stdout.includes(JSON.stringify(block, null, 2)), "the block is printed");
    assert.deepEqual(block, {
      status: "measured",
      date: "2026-12-01",
      commit: "abc1234",
      cases: { flawed: 6, sound: 3, loaded: 2 },
      arms: [
        { arm: "same-chat", caught: 3, flawed: 6, caught_usable: 3, usable_flawed: 6, alarms: 3, sound: 3, unusable: 0 },
        { arm: "fresh-brief", caught: 3, flawed: 6, caught_usable: 3, usable_flawed: 6, alarms: 1, sound: 3, unusable: 0 },
        { arm: "stronger-same-lab", caught: 4, flawed: 6, caught_usable: 4, usable_flawed: 6, alarms: 0, sound: 3, unusable: 0 },
        { arm: "product", caught: 4, flawed: 6, caught_usable: 4, usable_flawed: 6, alarms: 1, sound: 3, unusable: 0 },
      ],
      comparisons: [
        { first: "product", second: "fresh-brief", both: 2, first_only: 2, second_only: 1, neither: 1, usable_both: 2, usable_first_only: 2, usable_second_only: 1, usable_neither: 1 },
        { first: "product", second: "same-chat", both: 2, first_only: 2, second_only: 1, neither: 1, usable_both: 2, usable_first_only: 2, usable_second_only: 1, usable_neither: 1 },
        { first: "product", second: "stronger-same-lab", both: 3, first_only: 1, second_only: 1, neither: 1, usable_both: 3, usable_first_only: 1, usable_second_only: 1, usable_neither: 1 },
        { first: "fresh-brief", second: "same-chat", both: 2, first_only: 1, second_only: 1, neither: 2, usable_both: 2, usable_first_only: 1, usable_second_only: 1, usable_neither: 2 },
        { first: "stronger-same-lab", second: "fresh-brief", both: 3, first_only: 1, second_only: 0, neither: 2, usable_both: 3, usable_first_only: 1, usable_second_only: 0, usable_neither: 2 },
      ],
      single_drafter: true,
    });

    const merged = validateResults(JSON.parse(read(paths.results)));
    const committed = JSON.parse(read(COMMITTED_RESULTS));
    assert.deepEqual(merged.four_arm, block);
    assert.equal(merged.updated, committed.updated > "2026-12-01" ? committed.updated : "2026-12-01", "updated moves forward to the run's date, never back");
    for (const key of Object.keys(committed)) if (key !== "four_arm" && key !== "updated") assert.deepEqual(merged[key], committed[key], key);

    const full = JSON.parse(read(join(paths.out, "report.json")));
    assert.equal(full.decision.outcome, "too-few-cases");
    assert.equal(full.secondary.length, 4);
    assert.ok(full.secondary.every((test) => typeof test.p_holm === "number" && test.p_holm >= test.misses.p));
    assert.deepEqual(full.product_served_by, { google: 11 });
    assert.equal(full.arms.find((arm) => arm.arm === "A").median_objections, 1);
    assert.ok(full.arms.every((arm) => Number.isInteger(arm.median_words) && arm.median_words > 20));
    assert.deepEqual(full.splits.by_author.map((row) => row.key), ["anthropic", "openai"]);
  });

  it("a rehearsal is never written into the committed data/results.json", async () => {
    const before = read(COMMITTED_RESULTS);
    const report = await runCli(["report", ...common, "--owner-labels", ownerReplies(0), "--results", COMMITTED_RESULTS], env);
    const after = read(COMMITTED_RESULTS);
    // If the guard ever breaks, put the committed file back before failing, so the tree is not left dirty.
    if (after !== before) writeFileSync(COMMITTED_RESULTS, before);
    assert.equal(after, before, "the committed results file was written by a rehearsal");
    assert.equal(report.code, 1);
    assert.match(report.stderr, /this run is a rehearsal \(a loopback endpoint.*\)\. It is never written into data\/results\.json\./);
  });

  it("the owner's labels decide when the owner labelled every item", async () => {
    const again = await runCli(["score", ...common, "--resume", "--audit-all"], env);
    assert.equal(again.code, 0, again.stderr);
    const key = jsonl("audit-map.jsonl");
    assert.equal(key.length, 44);
    assert.equal(key.filter((row) => row.sample).length, 40);
    // The owner disagrees with the graders on ten of the forty, and says nobody caught anything.
    const path = join(dir, "replies-owner.txt");
    writeFileSync(path, `${key.map((row) => `${row.n}: no`).join("\n")}\n`);
    const report = await runCli(["report", ...common, "--owner-labels", path], env);
    assert.equal(report.code, 0, report.stdout);
    assert.match(report.stdout, /Every item was labelled by the owner, and those labels are the ones counted\./);
    const block = JSON.parse(read(join(paths.out, "public-block.json")));
    assert.ok(block.arms.every((arm) => arm.caught === 0 && arm.alarms === 0 && arm.usable_flawed === 6));
  });

  it("stops when a saved write-up was edited after it was written", async () => {
    const path = join(paths.out, "writeups.jsonl");
    const original = read(path);
    writeFileSync(path, original.replace("Write-up for reference code f-event.", "Write-up for reference code f-event, improved."));
    const edited = await runCli(["run", ...common, "--resume"], env);
    writeFileSync(path, original);
    assert.equal(edited.code, 1);
    assert.match(edited.stderr, /1 saved write-up\(s\) no longer match their checksum \(f-event\)\. A write-up is never edited\./);
  });

  it("refuses to run the arms twice, and the frozen split refuses a changed seed set", async () => {
    const twice = await runCli(["run", ...common], env);
    assert.equal(twice.code, 1);
    assert.match(twice.stderr, /arm answers already exist.*The frozen split is run once\./);
    const changed = join(dir, "changed.jsonl");
    writeFileSync(changed, toJsonl(seeds.map((row) => (row.id === "f-oven" ? { ...row, question: "Should we buy the oven after all?" } : row))));
    const refused = await runCli(["run", ...common.map((arg) => (arg === paths.seeds ? changed : arg)), "--resume"], env);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /not registered: the frozen seeds do not match seeds\.sha256/);
  });

  // A copy of the finished run's folder, with no report in it yet, so a test can change one thing and report on it.
  const copyOut = (name) => {
    const out = join(dir, name);
    mkdirSync(out);
    for (const file of ["meta.json", "writeups.jsonl", "answers.jsonl", "grades.jsonl", "audit-map.jsonl"]) writeFileSync(join(out, file), read(join(paths.out, file)));
    return out;
  };
  const argsWith = (swap) => common.map((arg) => swap[arg] ?? arg);
  const freshResults = (name) => {
    const path = join(dir, name);
    writeFileSync(path, read(COMMITTED_RESULTS));
    return path;
  };

  it("the report holds the write-up floor itself: answers and grades on file do not make up for three write-ups in twelve that were too short", async () => {
    const out = copyOut("out-short-writeups");
    const results = freshResults("results-short-writeups.json");
    const rows = jsonl("writeups.jsonl").map((row) => (["f-course", "s-lease", "l-job"].includes(row.id) ? { ...row, usable: false, words: 9, write_up: "", sha256: "", note: "the write-up has 9 words" } : row));
    writeFileSync(join(out, "writeups.jsonl"), toJsonl(rows));
    const report = await runCli(["report", ...argsWith({ [paths.out]: out }), "--owner-labels", ownerReplies(0), "--results", results], env);
    assert.equal(report.code, 2, report.stdout + report.stderr);
    assert.match(report.stdout, /::error::Not measured: only 9 of 12 write-ups are usable\./);
    assert.match(report.stdout, /No score is reported and no results file was changed\./);
    assert.doesNotMatch(report.stdout, /## Result|Public block|Catch on flawed cases|p 0\./);
    assert.equal(existsSync(join(out, "public-block.json")), false);
    assert.equal(existsSync(join(out, "report.json")), false);
    assert.equal(read(results), read(COMMITTED_RESULTS), "the results file is byte for byte as it was");
  });

  it("the report refuses seeds that changed after the run, and an arms file that is not registered", async () => {
    const out = copyOut("out-changed-seeds");
    const results = freshResults("results-changed-seeds.json");
    const labels = ownerReplies(0);
    const nothingWritten = (step) => {
      assert.equal(existsSync(join(out, "public-block.json")), false, `${step}: no block`);
      assert.equal(read(results), read(COMMITTED_RESULTS), `${step}: the results file is as it was`);
    };

    // One seed relabelled after the run, the registered checksum left alone.
    const relabelled = seeds.map((row) => (row.id === "f-oven" ? { ...row, drafter_family: "owner" } : row));
    const changed = join(dir, "relabelled.jsonl");
    writeFileSync(changed, toJsonl(relabelled));
    const first = await runCli(["report", ...argsWith({ [paths.out]: out, [paths.seeds]: changed }), "--owner-labels", labels, "--results", results], env);
    assert.equal(first.code, 1, first.stdout);
    assert.match(first.stderr, /not registered: the frozen seeds do not match seeds\.sha256; the set is frozen at registration/);
    nothingWritten("relabelled");

    // Every seed relabelled and the registration rewritten to match: the run's own record still has the seeds it ran on.
    const allOwner = seeds.map((row) => ({ ...row, drafter_family: "owner" }));
    assert.equal(singleDrafter(allOwner), false, "this is the switch a relabel would flip");
    const again = { seeds: join(dir, "all-owner.jsonl"), arms: join(dir, "arms-again.json"), checksum: join(dir, "again.sha256") };
    writeFileSync(again.seeds, toJsonl(allOwner));
    writeFileSync(again.arms, JSON.stringify(fixtureArms({ seeds_sha256: seedsChecksum(allOwner), judge_prompt_sha256: judgePromptFingerprint() })));
    writeFileSync(again.checksum, `${seedsChecksum(allOwner)}\n`);
    const reRegistered = argsWith({ [paths.out]: out, [paths.seeds]: again.seeds, [paths.arms]: again.arms, [paths.checksum]: again.checksum });
    const second = await runCli(["report", ...reRegistered, "--owner-labels", labels, "--results", results], env);
    assert.equal(second.code, 1, second.stdout);
    assert.match(second.stderr, /the frozen seeds changed after the run\. The set is frozen at registration\./);
    nothingWritten("registered again");
    // The score step may not launder the change into the run's record either.
    const rescored = await runCli(["score", ...reRegistered, "--resume"], env);
    assert.equal(rescored.code, 1, rescored.stdout);
    assert.match(rescored.stderr, /the frozen seeds changed after the arms ran\. The set is frozen at registration\./);
    assert.equal(JSON.parse(read(join(out, "meta.json"))).seeds_sha256, sum, "the record of what the run used is untouched");

    // A draft arms file, with the ids still waiting for the owner.
    const draft = fixtureArms({ status: "draft" });
    draft.graders[0].status = ID_UNCONFIRMED;
    const draftArms = join(dir, "arms-draft.json");
    writeFileSync(draftArms, JSON.stringify(draft));
    const third = await runCli(["report", ...argsWith({ [paths.out]: out, [paths.arms]: draftArms }), "--owner-labels", labels, "--results", results], env);
    assert.equal(third.code, 1, third.stdout);
    assert.match(third.stderr, /not registered: arms\.json status is "draft"; a frozen run needs "registered"/);
    assert.match(third.stderr, /the frozen split runs only after the protocol is registered/);
    nothingWritten("draft arms");

    // With the run's own record of its seeds gone, there is nothing to check the seeds against.
    const metaText = read(join(out, "meta.json"));
    rmSync(join(out, "meta.json"));
    const noRecord = await runCli(["report", ...reRegistered, "--owner-labels", labels, "--results", results], env);
    writeFileSync(join(out, "meta.json"), metaText);
    assert.equal(noRecord.code, 1, noRecord.stdout);
    assert.match(noRecord.stderr, /meta\.json has no record of the seeds this run used/);
    nothingWritten("no record of the seeds");

    // Unchanged seeds and the registered arms still report, with no deviation to list.
    const fine = await runCli(["report", ...argsWith({ [paths.out]: out }), "--owner-labels", labels, "--results", results], env);
    assert.equal(fine.code, 0, fine.stdout + fine.stderr);
    assert.equal(JSON.parse(read(join(out, "public-block.json"))).single_drafter, true);
    assert.doesNotMatch(fine.stdout, /Deviations from the registered protocol/);
    const steps = JSON.parse(read(join(out, "meta.json"))).steps;
    for (const step of ["author", "run", "score"]) assert.equal(steps[step].models_sha256, armsModelsChecksum(arms), `${step} recorded the ids it ran on`);

    // A grader swapped after the run and the arms file registered again: the report goes ahead and lists the deviation itself.
    const swapped = fixtureArms({ seeds_sha256: sum, judge_prompt_sha256: judgePromptFingerprint() });
    swapped.graders[4].model = "qwen/example-grader";
    const swappedArms = join(dir, "arms-swapped.json");
    writeFileSync(swappedArms, JSON.stringify(swapped));
    const notRegistered = await runCli(["report", ...argsWith({ [paths.out]: out, [paths.arms]: swappedArms }), "--owner-labels", labels], env);
    assert.equal(notRegistered.code, 1, notRegistered.stdout);
    assert.match(notRegistered.stderr, /not registered: a model id in arms\.json changed after registration/);
    swapped.registered.models_sha256 = armsModelsChecksum(swapped);
    writeFileSync(swappedArms, JSON.stringify(swapped));
    const listed = await runCli(["report", ...argsWith({ [paths.out]: out, [paths.arms]: swappedArms }), "--owner-labels", labels], env);
    assert.equal(listed.code, 0, listed.stdout + listed.stderr);
    assert.match(listed.stdout, /Deviations from the registered protocol: the model ids at a step of the run were not the ones registered now\./);
  });

  it("writes D against A and B against A by flaw type into report.json and the printed report", async () => {
    const out = copyOut("out-flaw-types");
    const report = await runCli(["report", ...argsWith({ [paths.out]: out }), "--owner-labels", ownerReplies(0)], env);
    assert.equal(report.code, 0, report.stdout + report.stderr);
    const full = JSON.parse(read(join(out, "report.json")));
    const pair = (id) => JSON.parse(read(join(out, "public-block.json"))).comparisons.find((row) => `${row.first}-vs-${row.second}` === id);
    const cellsOf = ({ first, second, ...cells }) => cells;
    // Every flawed seed of the tiny set has one flaw type, so each split is one row, and it is the pooled table.
    assert.deepEqual(full.splits.by_flaw_type.product_vs_same_chat, [{ key: "hidden-dependency", cases: 6, ...cellsOf(pair("product-vs-same-chat")) }]);
    assert.deepEqual(full.splits.by_flaw_type.fresh_brief_vs_same_chat, [{ key: "hidden-dependency", cases: 6, ...cellsOf(pair("fresh-brief-vs-same-chat")) }]);
    assert.deepEqual(full.splits.by_brief_named.product_vs_same_chat.map((row) => [row.key, row.cases]), [["other flaw types", 6]]);
    // The result and D minus B for each author family, in the form the public block could take them.
    assert.equal(full.public_result.outcome, "too-few-cases");
    assert.deepEqual(full.public_result.by_author.map((row) => row.family), ["anthropic", "openai"]);
    assert.deepEqual(
      full.public_result.by_author.reduce((sum, row) => [sum[0] + row.first_only, sum[1] + row.second_only], [0, 0]),
      [pair("product-vs-fresh-brief").first_only, pair("product-vs-fresh-brief").second_only],
      "the two families add up to the pooled cells",
    );
    assert.match(report.stdout, /^## D against A by flaw type \(shown, not tested\)$/m);
    assert.match(report.stdout, /^## B against A by flaw type \(shown, not tested\)$/m);
    assert.match(report.stdout, /- hidden-dependency\. Flawed cases: 6\. Only the first arm caught: 2\. Only the second arm caught: 1\./);
    assert.ok(report.stdout.includes("2 to 1 (+16.7 points, p 1.000), 95% interval -38.3 to +71.7 points"), "the interval is printed on a real run too");
  });

  it("leaves the product judge and the committed results as they were", () => {
    assert.deepEqual(productHashes(), hashesBefore);
  });
});

describe("a frozen run needs a registered protocol", () => {
  it("stops before any model is called while the arms file is a draft", async () => {
    const dir = mkdtempSync(join(tmpdir(), "four-arm-draft-"));
    const seeds = tinySet();
    const draft = fixtureArms({ status: "draft" });
    writeFileSync(join(dir, "seeds.jsonl"), toJsonl(seeds));
    writeFileSync(join(dir, "arms.json"), JSON.stringify(draft));
    const router = await startFourArmRouter({ arms: draft });
    const env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...router.env });
    const args = ["--seeds", join(dir, "seeds.jsonl"), "--arms", join(dir, "arms.json"), "--checksum", join(dir, "seeds.sha256"), "--out", join(dir, "out")];
    const frozen = await runCli(["author", "--split", "frozen", ...args], env);
    await router.close();
    assert.equal(frozen.code, 1);
    assert.match(frozen.stderr, /not registered: arms\.json status is "draft"; a frozen run needs "registered"/);
    assert.match(frozen.stderr, /not registered: evals\/four-arm\/seeds\.sha256 does not exist/);
    assert.match(frozen.stderr, /the frozen split runs only after the protocol is registered/);
    assert.equal(router.calls.author.length + router.calls.grader.length + router.calls.judge.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("stops before any model is called when a model id was swapped after registration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "four-arm-swapped-"));
    const seeds = tinySet();
    const sum = seedsChecksum(seeds);
    const swapped = fixtureArms({ seeds_sha256: sum });
    swapped.families.openai.author_model = "openai/another-author";
    writeFileSync(join(dir, "seeds.jsonl"), toJsonl(seeds));
    writeFileSync(join(dir, "arms.json"), JSON.stringify(swapped));
    writeFileSync(join(dir, "seeds.sha256"), `${sum}\n`);
    const router = await startFourArmRouter({ arms: swapped });
    const env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...router.env });
    const args = ["--split", "frozen", "--seeds", join(dir, "seeds.jsonl"), "--arms", join(dir, "arms.json"), "--checksum", join(dir, "seeds.sha256"), "--out", join(dir, "out")];
    const frozen = await runCli(["author", ...args], env);
    const preflight = await runCli(["preflight", ...args], env);
    await router.close();
    assert.equal(frozen.code, 1, frozen.stdout);
    assert.match(frozen.stderr, /not registered: a model id in arms\.json changed after registration/);
    assert.equal(router.calls.author.length + router.calls.grader.length + router.calls.judge.length + router.calls.unknown.length, 0);
    assert.match(preflight.stdout, /Registration: not complete\. The frozen split will not run until:\n- a model id in arms\.json changed after registration/);
    assert.ok(preflight.stdout.includes(`Model ids fingerprint: ${armsModelsChecksum(swapped)}`));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Not measured", () => {
  const setup = async (options) => {
    const dir = mkdtempSync(join(tmpdir(), "four-arm-mute-"));
    const seeds = assignAuthors([seed("f-oven", "oven"), seed("f-hire", "hire"), twin("s-oven", "oven", "f-oven"), seed("d-move", "move", { split: "dev" })]);
    const sum = seedsChecksum(seeds);
    const arms = fixtureArms({ seeds_sha256: sum });
    writeFileSync(join(dir, "seeds.jsonl"), toJsonl(seeds));
    writeFileSync(join(dir, "arms.json"), JSON.stringify(arms));
    writeFileSync(join(dir, "seeds.sha256"), sum);
    writeFileSync(join(dir, "results.json"), read(COMMITTED_RESULTS));
    const router = await startFourArmRouter({ arms, ...options });
    const env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...router.env });
    const args = ["--split", "frozen", "--seeds", join(dir, "seeds.jsonl"), "--arms", join(dir, "arms.json"), "--checksum", join(dir, "seeds.sha256"), "--out", join(dir, "out"), "--backoff-ms", "0", "--commit", "abc1234"];
    return { dir, router, env, args, results: join(dir, "results.json") };
  };

  it("when the stand-in answers nothing at all: exit 2, no score, no block, no results change", async () => {
    const { dir, router, env, args, results } = await setup({ mute: { author: true, arms: true, graders: true } });
    const author = await runCli(["author", ...args], env);
    assert.equal(author.code, 2);
    assert.match(author.stdout, /Write-ups: 0 of 3 usable\./);
    assert.match(author.stdout, /::error::Not measured: only 0 of 3 write-ups are usable\./);
    assert.equal(router.calls.author.length, 3 * ARM_MAX_REQUESTS, "each write-up was asked for three times and no more");
    const run = await runCli(["run", ...args], env);
    assert.equal(run.code, 2);
    assert.match(run.stdout, /::error::Not measured: only 0 of 3 write-ups are usable\./);
    assert.equal(router.calls.armA.length + router.calls.judge.length, 0, "no arm is asked once the write-ups are under the floor");
    const report = await runCli(["report", ...args, "--results", results], env);
    await router.close();
    assert.equal(report.code, 2);
    assert.match(report.stdout, /::error::Not measured: only 0 of 3 write-ups are usable\./);
    assert.match(report.stdout, /No score is reported and no results file was changed\./);
    assert.doesNotMatch(report.stdout, /Public block|p 0\.|%/);
    assert.equal(read(results), read(COMMITTED_RESULTS));
    assert.equal(existsSync(join(dir, "out", "public-block.json")), false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("when the write-ups arrive but the arms answer nothing: the same, with each arm held to three requests", async () => {
    const { dir, router, env, args, results } = await setup({ mute: { arms: true } });
    const author = await runCli(["author", ...args], env);
    assert.equal(author.code, 0, author.stderr);
    const run = await runCli(["run", ...args, "--concurrency", "3"], env);
    assert.equal(run.code, 2);
    assert.match(run.stdout, /Arm A \(.*\): 0 of 2 flawed cases got a usable answer\./);
    assert.match(run.stdout, /::error::Not measured: arm A gave a usable answer on only 0 of 2 flawed cases\./);
    const count = (arm) => router.calls.judge.filter((call) => call.arm === arm && call.ref === "f-oven").length;
    assert.equal(router.calls.armA.filter((call) => call.ref === "f-oven").length, ARM_MAX_REQUESTS);
    assert.equal(count("B"), ARM_MAX_REQUESTS);
    assert.equal(count("C"), ARM_MAX_REQUESTS);
    assert.equal(count("D"), ARM_MAX_REQUESTS, "the product made its own three requests inside one run");
    const answers = read(join(dir, "out", "answers.jsonl")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(answers.length, 12);
    assert.ok(answers.every((row) => row.usable === false && row.critique === ""));
    // What came back is kept even when it is not an answer: the judge's own note says why there is no verdict.
    assert.ok(answers.filter((row) => row.arm === "A").every((row) => row.judge === null && row.raw === ""));
    for (const row of answers.filter((r) => r.arm !== "A")) {
      assert.equal(row.judge.verdict, null, `${row.id} ${row.arm}`);
      assert.ok(row.judge.degraded.some((line) => /the judge returned no tool call/.test(line)), `${row.id} ${row.arm}: the note on why there is no verdict`);
    }
    assert.ok(answers.filter((row) => row.arm === "D").every((row) => row.requests === 1));
    const score = await runCli(["score", ...args], env);
    assert.equal(score.code, 0, score.stderr);
    assert.match(score.stdout, /Graded: 0 of 0 usable answers\./);
    const report = await runCli(["report", ...args, "--results", results], env);
    await router.close();
    assert.equal(report.code, 2);
    assert.match(report.stdout, /::error::Not measured: /);
    assert.doesNotMatch(report.stdout, /Public block|Catch on flawed cases/);
    assert.equal(read(results), read(COMMITTED_RESULTS));
    rmSync(dir, { recursive: true, force: true });
  });

  it("three of twelve write-ups too short: the author, run, score and report steps are each Not measured, and no arm is asked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "four-arm-floor-"));
    const seeds = tinySet();
    const sum = seedsChecksum(seeds);
    const arms = fixtureArms({ seeds_sha256: sum, judge_prompt_sha256: judgePromptFingerprint() });
    const results = join(dir, "results.json");
    const labels = join(dir, "labels.txt");
    writeFileSync(join(dir, "seeds.jsonl"), toJsonl(seeds));
    writeFileSync(join(dir, "arms.json"), JSON.stringify(arms));
    writeFileSync(join(dir, "seeds.sha256"), `${sum}\n`);
    writeFileSync(results, read(COMMITTED_RESULTS));
    writeFileSync(labels, "1: yes\n2: no\n");
    const short = { writeUp: "short" };
    const router = await startFourArmRouter({ arms, script: { "f-course": short, "s-lease": short, "l-job": short, "f-event": { A: "hit", B: "hit", C: "hit", D: "hit" } } });
    const env = envFor({ OPENROUTER_API_KEY: "test-key-loopback-only", ...router.env });
    const out = join(dir, "out");
    const args = ["--split", "frozen", "--seeds", join(dir, "seeds.jsonl"), "--arms", join(dir, "arms.json"), "--checksum", join(dir, "seeds.sha256"), "--out", out, "--backoff-ms", "0", "--commit", "abc1234"];
    // The four commands of the README's "How to run it" block, one after another, as a shell without `set -e` would run them.
    const author = await runCli(["author", ...args, "--concurrency", "4"], env);
    const gradersAfterAuthor = router.calls.grader.length;
    const run = await runCli(["run", ...args], env);
    const armCalls = router.calls.armA.length + router.calls.judge.length;
    const score = await runCli(["score", ...args], env);
    const gradersAfterScore = router.calls.grader.length;
    const report = await runCli(["report", ...args, "--owner-labels", labels, "--results", results], env);
    await router.close();

    const floor = /::error::Not measured: only 9 of 12 write-ups are usable\./;
    assert.equal(author.code, 2);
    assert.match(author.stdout, /Write-ups: 9 of 12 usable\./);
    assert.match(author.stdout, floor);
    assert.equal(run.code, 2, `run went on after the author step said Not measured: ${run.stdout}`);
    assert.match(run.stdout, floor);
    assert.equal(armCalls, 0, "no arm was asked: not arm A, not the judge");
    assert.equal(existsSync(join(out, "answers.jsonl")), false);
    assert.equal(score.code, 2, score.stdout + score.stderr);
    assert.match(score.stdout, floor);
    assert.equal(gradersAfterScore, gradersAfterAuthor, "no grader was asked");
    assert.equal(report.code, 2, report.stdout + report.stderr);
    assert.match(report.stdout, floor);
    assert.match(report.stdout, /No score is reported and no results file was changed\./);
    assert.doesNotMatch(report.stdout, /## Result|Public block|Catch on flawed cases/);
    assert.equal(existsSync(join(out, "public-block.json")), false);
    assert.equal(read(results), read(COMMITTED_RESULTS), "the results file is byte for byte as it was");
    rmSync(dir, { recursive: true, force: true });
  });

  it("a run with flawed cases left from one author family only is Not measured, whatever the pooled counts say", async () => {
    const dir = mkdtempSync(join(tmpdir(), "four-arm-one-family-"));
    // 222 made-up flawed seeds, each ask its own string of plain words, so 111 fall to each author family.
    const words = "amber basket candle drift ember garden harbor island jacket kettle lantern meadow needle orchard pebble quarry ribbon saddle timber umbrella valley willow yonder anchor bramble cinder dapple elm thistle hollow".split(" ");
    const ask = (i) => {
      let x = i * 7919 + 13;
      const picked = [];
      for (let k = 0; k < 70; k += 1) {
        x = (x * 1103515245 + 12345) % 2147483648;
        picked.push(words[Math.floor(x / 65536) % words.length]);
      }
      return `Plan number ${i} for our shop goes like this. ${picked.join(" ")}. Please write about 200 words on it.`;
    };
    const many = assignAuthors(
      Array.from({ length: 222 }, (_, i) => ({ ...seed(`f-many-${i}`, "oven"), user_ask: ask(i), category: SEED_CATEGORIES[i % SEED_CATEGORIES.length], flaw_type: FLAW_TYPES[i % FLAW_TYPES.length] })),
    );
    assert.deepEqual(parseSeedsJsonl(toJsonl(many)).problems, []);
    const sum = seedsChecksum(many);
    const out = join(dir, "out");
    const results = join(dir, "results.json");
    const labels = join(dir, "labels.txt");
    mkdirSync(out);
    writeFileSync(join(dir, "seeds.jsonl"), toJsonl(many));
    writeFileSync(join(dir, "arms.json"), JSON.stringify(fixtureArms({ seeds_sha256: sum, judge_prompt_sha256: judgePromptFingerprint() })));
    writeFileSync(join(dir, "seeds.sha256"), `${sum}\n`);
    writeFileSync(results, read(COMMITTED_RESULTS));
    // The run folder as the steps would have left it. Every write-up is usable, and every one from one family
    // already points its flaw out, so those cases are left out by rule and 111 flawed cases from the other remain.
    const kept = many.filter((row) => row.author_family === "openai");
    assert.equal(kept.length, 111);
    assert.ok(kept.length >= MIN_ANALYSED_FLAWED);
    // The product caught 60 of them and the fresh-context arm 30 of the same 60: pooled, 30 to 0.
    const grades = kept.flatMap((row, i) => ARMS.map((arm) => ({ id: row.id, arm, label: i < (arm === "C" || arm === "D" ? 60 : 30) ? "yes" : "no", objections: 2 })));
    writeFileSync(join(out, "meta.json"), JSON.stringify({ split: "frozen", rehearsal: [], seeds_sha256: sum, steps: {} }));
    writeFileSync(join(out, "writeups.jsonl"), toJsonl(many.map((row) => ({ id: row.id, usable: true, visible: "yes", flagged: row.author_family === "anthropic" ? "yes" : "no" }))));
    writeFileSync(join(out, "answers.jsonl"), toJsonl(kept.flatMap((row) => ARMS.map((arm) => ({ id: row.id, arm, usable: true, words: 120, served_company: arm === "D" ? "google" : null })))));
    writeFileSync(join(out, "grades.jsonl"), toJsonl(grades));
    writeFileSync(join(out, "audit-map.jsonl"), toJsonl(grades.slice(0, 40).map((row, n) => ({ n: n + 1, id: row.id, arm: row.arm, sample: true, graders: row.label }))));
    writeFileSync(labels, grades.slice(0, 40).map((row, n) => `${n + 1}: ${row.label}`).join("\n"));
    assert.ok(mcnemarExactP(30, 0) < 0.001, "the pooled counts alone would read D better");

    const args = ["--split", "frozen", "--seeds", join(dir, "seeds.jsonl"), "--arms", join(dir, "arms.json"), "--checksum", join(dir, "seeds.sha256"), "--out", out, "--date", "2026-12-01", "--commit", "abc1234"];
    const report = await runCli(["report", ...args, "--owner-labels", labels, "--results", results], envFor());
    assert.equal(report.code, 2, report.stdout + report.stderr);
    assert.match(report.stdout, /\| D: the product as shipped \| 111 \| 111 \| 111 \| 0 \|/, "the answers were all there and all graded");
    assert.match(
      report.stdout,
      /::error::Not measured: the split by author family is missing\. Flawed cases were analysed for: openai\. D minus B is needed for each of anthropic and openai, so a sign flip can be checked\./,
    );
    assert.match(report.stdout, /No score is reported and no results file was changed\./);
    assert.doesNotMatch(report.stdout, /## Result|Public block|Catch on flawed cases|D better|p 0\./);
    assert.equal(existsSync(join(out, "public-block.json")), false);
    assert.equal(existsSync(join(out, "report.json")), false);
    assert.equal(read(results), read(COMMITTED_RESULTS), "the results file is byte for byte as it was");
    rmSync(dir, { recursive: true, force: true });
  });

  it("a report before the arms have run is Not measured: no arm answers", async () => {
    const { dir, router, env, args, results } = await setup({});
    const author = await runCli(["author", ...args], env);
    const report = await runCli(["report", ...args, "--results", results], env);
    await router.close();
    assert.equal(author.code, 0, author.stderr);
    assert.equal(report.code, 2);
    assert.match(report.stdout, /::error::Not measured: no arm answers were found\. Run the arms first\./);
    assert.equal(read(results), read(COMMITTED_RESULTS));
    rmSync(dir, { recursive: true, force: true });
  });

  it("a product answer served by the author's own company is not a usable answer", async () => {
    const { dir, router, env, args } = await setup({ script: { "f-oven": { D: "own-company" }, "f-hire": { D: "hit" } } });
    assert.equal((await runCli(["author", ...args], env)).code, 0);
    const run = await runCli(["run", ...args], env);
    await router.close();
    assert.equal(run.code, 2, "one of two flawed cases is under the floor");
    const answers = read(join(dir, "out", "answers.jsonl")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const own = answers.find((row) => row.id === "f-oven" && row.arm === "D");
    assert.equal(own.usable, false);
    assert.match(own.note, /judge\.mjs exited 1/);
    assert.equal(answers.find((row) => row.id === "f-hire" && row.arm === "D").usable, true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a dev run is a rehearsal: it shows the plumbing and no result", async () => {
    const { dir, router, env, args } = await setup({ script: { "d-move": { D: "hit" } } });
    const dev = args.map((arg) => (arg === "frozen" ? "dev" : arg));
    for (const step of ["author", "run", "score"]) assert.equal((await runCli([step, ...dev], env)).code, 0, step);
    const report = await runCli(["report", ...dev, "--results", join(dir, "results.json")], env);
    await router.close();
    assert.equal(report.code, 0, report.stdout);
    assert.match(report.stdout, /REHEARSAL, not a measurement: this run used the dev split, a loopback endpoint/);
    assert.match(report.stdout, /Dev rehearsal: the dev split checks the plumbing\. It produces no result and no public block\./);
    assert.match(report.stdout, /\| D: the product as shipped \| 1 \| 1 \| 1 \| 0 \|/);
    assert.doesNotMatch(report.stdout, /Public block|## Result/);
    assert.equal(read(join(dir, "results.json")), read(COMMITTED_RESULTS));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the full report on a set large enough to test", () => {
  it("reads D better only when every condition holds, and prints what it found", () => {
    const cases = [];
    const items = [];
    const add = (n, hits, prefix, family) => {
      for (let i = 0; i < n; i += 1) {
        const id = `${prefix}-${family}-${i}`;
        cases.push({ id, kind: "flawed", author_family: family, drafter_family: i % 2 ? "anthropic" : "owner", visible: "yes" });
        for (const arm of ARMS) items.push({ id, arm, usable: true, label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
      }
    };
    for (const family of AUTHOR_FAMILIES) {
      add(30, ["A", "B", "C", "D"], "all", family);
      add(15, ["C", "D"], "strong", family);
      add(4, ["B"], "fresh", family);
      add(11, [], "none", family);
    }
    for (let i = 0; i < 40; i += 1) {
      const id = `sound-${i}`;
      cases.push({ id, kind: "sound", author_family: AUTHOR_FAMILIES[i % 2], drafter_family: "owner", visible: null });
      for (const arm of ARMS) items.push({ id, arm, usable: true, label: arm === "A" || (arm === "B" && i < 16) || (arm === "D" && i < 4) ? "yes" : "no", words: 90, objections: 2 });
    }
    const report = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true });
    assert.equal(report.public_block.cases.flawed, 120);
    assert.equal(report.decision.outcome, "d-better");
    assert.equal(report.decision.quality_sentence_allowed, true);
    assert.deepEqual([report.primary.misses.first_only, report.primary.misses.second_only], [30, 8]);
    assert.ok(report.primary.misses.p < 0.001);
    assert.equal(report.secondary.find((test) => test.id === "product-vs-stronger-same-lab").misses.p, 1, "D and C caught the same cases");
    assert.equal(report.alarm.find((pair) => pair.first === "D" && pair.second === "B").ranked, true);
    assert.equal(report.splits.by_drafter.length, 2);
    const single = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: true, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true });
    assert.equal(single.decision.quality_sentence_allowed, false);
    const noFloor = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" } });
    assert.equal(noFloor.decision.outcome, "not-measured", "the same counts are no result when the write-up floor was not checked or not met");
    assert.deepEqual(noFloor.decision.reasons, ["too few usable write-ups"]);
    assert.match(renderReport(noFloor), /## Result: Not measured\n\nWhy: too few usable write-ups\.\nNothing here is a result\. No counts are published\./);
    validateFourArm(JSON.parse(JSON.stringify(report.public_block)));
    assert.equal(countWords("one two  three"), 3);
  });
});

describe("D against A and B against A by flaw type", () => {
  const cases = [];
  const items = [];
  const add = (n, type, hits) => {
    for (let i = 0; i < n; i += 1) {
      const id = `${type ?? "untyped"}-${hits.join("") || "none"}-${i}`;
      cases.push({ id, kind: "flawed", ...(type ? { flaw_type: type } : {}), author_family: AUTHOR_FAMILIES[i % 2], drafter_family: "owner", visible: "yes" });
      for (const arm of ARMS) items.push({ id, arm, usable: !(arm === "A" && type === "sunk-cost" && i === 0), label: hits.includes(arm) ? "yes" : "no", words: 120, objections: 3, served_company: arm === "D" ? "google" : null });
    }
  };
  // On the two types close to the brief, the arms that carry the brief catch what arm A misses.
  add(3, "small-sample", ["B", "C", "D"]);
  add(2, "contradicts-own-goal", ["A", "B", "C", "D"]);
  add(1, "contradicts-own-goal", ["D"]);
  // On the others they are level.
  add(1, "arithmetic", ["D"]);
  add(1, "arithmetic", ["A"]);
  add(2, "arithmetic", []);
  add(2, "sunk-cost", ["A", "B"]);
  // A case row written before the flaw type was kept.
  add(1, null, ["A", "D"]);
  const report = summarize({ cases, items, date: "2026-12-01", commit: "abc1234", single_drafter: false, audit: { agree: 38, of: 40, labels_by: "graders" }, write_up_floor_met: true });
  const brief = (row) => [row.key, row.cases, row.both, row.first_only, row.second_only, row.neither];

  it("splits both comparisons by flaw type, one row per type, in the type's own name", () => {
    assert.deepEqual(report.splits.by_flaw_type.product_vs_same_chat.map(brief), [
      ["arithmetic", 4, 0, 1, 1, 2],
      ["contradicts-own-goal", 3, 2, 1, 0, 0],
      ["not recorded", 1, 1, 0, 0, 0],
      ["small-sample", 3, 0, 3, 0, 0],
      ["sunk-cost", 2, 0, 0, 1, 1],
    ]);
    assert.deepEqual(report.splits.by_flaw_type.fresh_brief_vs_same_chat.map(brief), [
      ["arithmetic", 4, 0, 0, 1, 3],
      ["contradicts-own-goal", 3, 2, 0, 0, 1],
      ["not recorded", 1, 0, 0, 1, 0],
      ["small-sample", 3, 0, 3, 0, 0],
      ["sunk-cost", 2, 1, 1, 0, 0],
    ]);
    // Arm A gave no usable answer on one sunk-cost case. That is a miss for arm A, and the usable-only cells leave the case out.
    const sunk = report.splits.by_flaw_type.fresh_brief_vs_same_chat.find((row) => row.key === "sunk-cost");
    assert.deepEqual([sunk.usable_both, sunk.usable_first_only, sunk.usable_second_only, sunk.usable_neither], [1, 0, 0, 0]);
  });

  it("adds the four types close to the brief together, and the other types together", () => {
    assert.deepEqual(report.splits.by_brief_named.product_vs_same_chat.map(brief), [
      ["close to what the brief names", 6, 2, 4, 0, 0],
      ["not recorded", 1, 1, 0, 0, 0],
      ["other flaw types", 6, 0, 1, 2, 3],
    ]);
    assert.deepEqual(report.splits.by_brief_named.fresh_brief_vs_same_chat.map(brief), [
      ["close to what the brief names", 6, 2, 3, 0, 1],
      ["not recorded", 1, 0, 0, 1, 0],
      ["other flaw types", 6, 1, 1, 1, 3],
    ]);
    // Every analysed flawed case is in exactly one row of each split.
    for (const split of [report.splits.by_flaw_type, report.splits.by_brief_named]) {
      for (const rows of [split.product_vs_same_chat, split.fresh_brief_vs_same_chat]) assert.equal(rows.reduce((sum, row) => sum + row.cases, 0), cases.length);
    }
  });

  it("prints both splits, marks the four types, and runs no test on them", () => {
    assert.equal(report.decision.outcome, "too-few-cases");
    const text = renderReport(report);
    const section = (title, next) => text.slice(text.indexOf(title), text.indexOf(next));
    const dA = section("## D against A by flaw type (shown, not tested)", "## B against A by flaw type (shown, not tested)");
    const bA = section("## B against A by flaw type (shown, not tested)", "## Which companies served the product arm");
    for (const part of [dA, bA]) {
      assert.ok(part.length > 0);
      assert.ok(
        part.includes(`Four flaw types sit close to what Grill's brief asks for by name: ${BRIEF_NAMED_FLAW_TYPES.join(", ")}. On those, arms B, C and D carry the brief and arm A does not.`),
        part,
      );
      assert.doesNotMatch(part, /p \d|95% interval/, "shown, not tested");
      assert.match(part, /^- small-sample \(close to what the brief names\)\. Flawed cases: 3\. Only the first arm caught: 3\. Only the second arm caught: 0\. On usable answers only: 3 and 0\.$/m);
      assert.match(part, /^- arithmetic\. Flawed cases: 4\./m);
      assert.match(part, /^- not recorded\. Flawed cases: 1\./m);
    }
    assert.match(dA, /^- The four types close to what the brief names, together\. Flawed cases: 6\. Only the first arm caught: 4\. Only the second arm caught: 0\. On usable answers only: 4 and 0\.$/m);
    assert.match(dA, /^- The other flaw types, together\. Flawed cases: 6\. Only the first arm caught: 1\. Only the second arm caught: 2\. On usable answers only: 1 and 2\.$/m);
    assert.match(bA, /^- The four types close to what the brief names, together\. Flawed cases: 6\. Only the first arm caught: 3\. Only the second arm caught: 0\./m);
    assert.ok(dA.indexOf("together.") < dA.indexOf("- arithmetic."), "the two sums come first, then each type");
  });
});
