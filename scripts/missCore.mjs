// A miss card: how AI failed at a decision, without the decision.
//
// The rule (LEARNING.md): contribute the miss, never the decision. A card is a few choices plus
// two short texts written with made-up names and numbers. This file checks that, in code:
// `checkMissCard` runs in the browser on grillyour.ai/miss/ (against text the person pastes, which
// never leaves the page) and again on the server (without it). The page inlines this file, so it
// must stay self-contained: no imports, plain functions, `export` only at the start of a line.

export const MISS_FAILURES = Object.freeze([
  "unopened-source",
  "source-says-otherwise",
  "source-off-question",
  "count-without-rate",
  "too-few-events",
  "name-not-content",
  "outcome-window-cut",
  "metric-off-claim",
  "member-as-group",
  "from-memory",
  "summary-drops-caveat",
  "coverage-unstated",
  "question-unanswered",
  "false-review-label",
  "hidden-assumption",
  "missing-failure-mode",
  "simpler-path-ignored",
  "overreach",
  "loaded-framing",
  "other",
]);

export const MISS_FAILURE_LABELS = Object.freeze({
  "unopened-source": "Cited a source nobody opened",
  "source-says-otherwise": "The source doesn't say that",
  "source-off-question": "The source is about a different question",
  "count-without-rate": "Compared counts without a rate",
  "too-few-events": "Called a winner from too few events",
  "name-not-content": "Assumed what something said from its name",
  "outcome-window-cut": "Counted outcomes before they could arrive",
  "metric-off-claim": "The metric didn't measure the claim",
  "member-as-group": "Gave one item's number as the group's",
  "from-memory": "Stated something from memory, not a fresh look",
  "summary-drops-caveat": "The summary dropped a caveat or added a cause",
  "coverage-unstated": "Didn't say how much was actually read",
  "question-unanswered": "Didn't answer what was asked",
  "false-review-label": "Called it reviewed or grilled when it wasn't",
  "hidden-assumption": "Rested on an assumption nobody stated",
  "missing-failure-mode": "Missed an obvious way it could fail",
  "simpler-path-ignored": "Ignored a simpler option",
  overreach: "Claimed more than the evidence showed",
  "loaded-framing": "The question was framed to get one answer",
  other: "Something else",
});

export const MISS_CHOICES = Object.freeze({
  failure: MISS_FAILURES,
  stage: Object.freeze(["research", "draft", "grill", "edit-after-grill", "summary", "send", "not-sure"]),
  caught_by: Object.freeze(["me", "a-colleague", "the-reader", "grill", "a-look-back", "not-caught", "not-sure"]),
  stakes: Object.freeze(["founder-or-board", "customer", "money", "hiring", "personal", "other"]),
  category: Object.freeze(["pricing", "hiring", "fundraising", "product", "timing", "vendor", "operations", "personal", "other"]),
  cost: Object.freeze(["none", "rework", "embarrassment", "wrong-decision", "money-lost", "not-sure"]),
  grill_ran: Object.freeze(["yes", "no", "said-so-but-no", "not-sure"]),
});

export const MISS_QUESTIONS = Object.freeze({
  failure: "What went wrong?",
  stage: "Where did it get in?",
  caught_by: "Who caught it?",
  stakes: "Who was it for?",
  category: "Kind of decision",
  cost: "What did it cost?",
  grill_ran: "Was it grilled?",
});

export const MISS_LABELS = Object.freeze({
  failure: MISS_FAILURE_LABELS,
  stage: { research: "Research", draft: "Writing the draft", grill: "The grill itself", "edit-after-grill": "Edits after the grill", summary: "A short summary of it", send: "When it was sent", "not-sure": "Not sure" },
  caught_by: { me: "Me", "a-colleague": "A colleague", "the-reader": "The person it went to", grill: "Grill", "a-look-back": "A look-back", "not-caught": "Nobody, yet", "not-sure": "Not sure" },
  stakes: { "founder-or-board": "A founder, boss or board", customer: "A customer", money: "Money", hiring: "Hiring", personal: "Personal", other: "Other" },
  category: { pricing: "Pricing", hiring: "Hiring", fundraising: "Fundraising", product: "Product", timing: "Timing", vendor: "Vendor", operations: "Operations", personal: "Personal", other: "Other" },
  cost: { none: "None", rework: "Rework", embarrassment: "Embarrassment", "wrong-decision": "A wrong decision", "money-lost": "Money lost", "not-sure": "Not sure" },
  grill_ran: { yes: "Yes", no: "No", "said-so-but-no": "It was called grilled, but it wasn't", "not-sure": "Not sure" },
});

export const MISS_TEXT_LIMITS = Object.freeze({ check: 300, repro: 1500 });

// Words that are capitalised for grammar, not because they name someone.
const COMMON_CAPS = new Set(
  (
    "I A An The This That These Those It Its We Our You Your They Their He She His Her Me My Us " +
    "And But Or If So Not No Yes Is Are Was Were Be Do Did Does Has Have Had Can Could Will Would Should " +
    "In On At To For From Of By With As About After Before Between Into Over Under Per Then Than When Where Why How What Who Which " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August " +
    "September October November December Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Q1 Q2 Q3 Q4 " +
    "AI CEO CFO CTO COO CHRO HR OK Email LinkedIn Slack Google Microsoft"
  ).split(" "),
);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+/i;
const DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|co|uk|dev|app|xyz|info|biz|us|de|fr|ca|au|me|so|gg|tv)\b/i;
const PHONE = /(?:\+?\d[\s().-]?){9,}\d/;
const HANDLE = /(^|\s)@[A-Za-z0-9_]{2,}/;
const TOKEN = /\b(?:sk-[A-Za-z0-9_-]{10,}|[A-Za-z0-9_-]{32,})\b/;

function words(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^a-z0-9%]+/)
    .filter(Boolean);
}

function numbersOf(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(/\d[\d,.]*\d|\d/g)) {
    const digits = m[0].replace(/[,.]/g, "");
    if (digits.length >= 3) out.add(digits);
  }
  return out;
}

function namesOf(text) {
  const raw = String(text || "");
  // Words written in lower case somewhere are ordinary words, capitalised only by a sentence start.
  const lowerSeen = new Set((raw.match(/\b[a-z][a-z’'-]{2,}\b/g) || []).map((w) => w.replace(/[’']s$/, "")));
  const out = new Set();
  for (const m of raw.matchAll(/\b[A-Z][A-Za-z’'-]{2,}\b/g)) {
    const name = m[0].replace(/[’']s$/, "");
    if (COMMON_CAPS.has(name) || lowerSeen.has(name.toLowerCase())) continue;
    out.add(name);
  }
  return out;
}

function sharedRun(cardText, original, size = 4) {
  const src = words(original);
  if (src.length < size) return "";
  const grams = new Set();
  for (let i = 0; i + size <= src.length; i += 1) grams.add(src.slice(i, i + size).join(" "));
  const mine = words(cardText);
  for (let i = 0; i + size <= mine.length; i += 1) {
    const gram = mine.slice(i, i + size).join(" ");
    if (grams.has(gram)) return gram;
  }
  return "";
}

/** The card's fields, picked and trimmed. Unknown fields are dropped, never kept. */
export function normaliseMissCard(input = {}) {
  const get = (key) => (typeof input?.[key] === "string" ? input[key].trim() : "");
  const card = {};
  for (const key of Object.keys(MISS_CHOICES)) card[key] = get(key);
  card.check = get("check").replace(/\s+/g, " ");
  card.repro = get("repro").replace(/[ \t]+/g, " ");
  return card;
}

/**
 * Is this card safe to send? Returns { ok, problems: [{ field, reason }] }.
 *
 * Always: every choice is from its list, the texts are within their limits, and neither text holds
 * an email, a link or web address, a phone number, an @handle, or a key-shaped token.
 * With `original` (the real material, which stays on the page): neither text shares a run of four
 * words with it, any number of three or more digits from it, or a capitalised name from it.
 * Errs toward blocking: a false block costs a rewrite; a missed one sends someone's decision.
 */
export function checkMissCard(input, { original = "" } = {}) {
  const card = normaliseMissCard(input);
  const problems = [];
  const flag = (field, reason) => problems.push({ field, reason });

  for (const [key, allowed] of Object.entries(MISS_CHOICES)) {
    if (!allowed.includes(card[key])) flag(key, "Pick one of the choices.");
  }
  if (card.check.length < 10) flag("check", "Say in a sentence what would have caught it.");
  if (card.repro.length < 40) flag("repro", "Write a short made-up example with the same mistake.");
  for (const [key, limit] of Object.entries(MISS_TEXT_LIMITS)) {
    if (card[key].length > limit) flag(key, `Keep it under ${limit} characters.`);
  }

  for (const key of ["check", "repro"]) {
    const text = card[key];
    if (EMAIL.test(text)) flag(key, "Remove the email address.");
    if (URL_LIKE.test(text) || DOMAIN.test(text)) flag(key, "Remove the link or web address.");
    if (PHONE.test(text)) flag(key, "Remove the phone number.");
    if (HANDLE.test(text)) flag(key, "Remove the @handle.");
    if (TOKEN.test(text)) flag(key, "Remove the key or long code.");
    if (!original) continue;
    const run = sharedRun(text, original);
    if (run) flag(key, `These words come from your real text: "${run}". Rewrite it in made-up words.`);
    const real = numbersOf(original);
    const same = [...numbersOf(text)].filter((n) => real.has(n));
    if (same.length) flag(key, `These numbers come from your real text: ${same.join(", ")}. Use made-up numbers.`);
    const names = namesOf(original);
    const named = [...new Set((text.match(/\b[A-Z][A-Za-z’'-]{2,}\b/g) || []).map((n) => n.replace(/[’']s$/, "")))].filter((n) =>
      names.has(n),
    );
    if (named.length) flag(key, `These names come from your real text: ${named.join(", ")}. Use made-up names.`);
  }
  return { ok: problems.length === 0, problems };
}
