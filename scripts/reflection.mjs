/**
 * The reflection at the end of a grill, and the look-back that reads it later.
 *
 * Both run locally. Nothing here opens a network connection, writes a file, or keeps a copy.
 * The judge's report is left as the judge wrote it. This module only appends a section after it,
 * or scores records the user pastes back.
 *
 * A decision log is optional. The weekly review's monthly Count needs one. This does not.
 */
export const REVIEW_DAYS = 14;
/** Writers emit this. Readers accept only this version, so a later version can be added beside it. */
export const RECORD_VERSION = "1";
export const RECORD_FENCE = "grill-record";
/** Fixed write order. `version` is first so a paste can be told apart from any other notes. */
export const RECORD_FIELDS = ["version", "date", "title", "prediction", "verdict", "falsifier", "confidence", "review"];
export const RECORD_KEYS = ["date", "title", "prediction", "verdict", "falsifier", "confidence", "review"];
/** Written after `review`, and only when the line has a value. Absent lines do not change version 1. */
export const OPTIONAL_RECORD_FIELDS = ["goal", "guardrails", "source_app", "proposed_by", "decided", "supersedes", "changed"];

export const BEFORE_YOU_DECIDE_QUESTIONS = [
  "What do you expect to happen, and by when? Write the prediction you will stand behind.",
  "How sure are you now, as a percent? A band is fine. This is your confidence, not the judge.",
  "What would prove you wrong? Name the one result you will treat as decisive.",
];

const LOOK_BACK_LINE = {
  mcp: 'To look back, paste one or more blocks into the grill_look_back tool, or say "grill look back". Nothing is stored.',
  paste: 'To look back, paste one or more blocks back into this chat and say "look back". Nothing is stored.',
  site: "To look back, paste the blocks into the box on this page. They stay in your browser. Nothing is stored.",
  note: "To look back, paste one or more blocks and say what happened. Nothing is stored.",
  account:
    'To look back, say "look back" in this chat, or open the decisions page on your Grill account. Grill keeps this record only because you chose to.',
};

const STORAGE_NOTE = {
  account:
    "These stay in your chat. Grill does not send them to the judge. Grill keeps the decision record only if you chose to, encrypted, and you can export or delete it.",
};

const VERDICT_PLAIN = Object.freeze({
  holds: "solid",
  "holds-with-conditions": "solid if",
  "holds with conditions": "solid if",
  weak: "shaky",
  refuted: "doesn't hold up",
  solid: "solid",
  "solid if": "solid if",
  shaky: "shaky",
  "doesn't hold up": "doesn't hold up",
  "does not hold up": "doesn't hold up",
});

function oneLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function plainVerdict(raw) {
  const key = oneLine(raw).toLowerCase().replace(/\.$/, "");
  return VERDICT_PLAIN[key] || oneLine(raw) || "unknown";
}

export function isoDate(now) {
  const date = now instanceof Date ? now : new Date(now);
  return date.toISOString().slice(0, 10);
}

export function addDays(now, days) {
  const date = new Date(now instanceof Date ? now.getTime() : now);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function clip(text, max = 80) {
  const clean = oneLine(text).replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut).replace(/[,:;.\s]+$/, "");
}

/** A title for the record. Prefer a line the write-up already labels as the decision. */
export function decisionTitle(subject) {
  const lines = String(subject || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const labeled = line.match(/^(?:#{1,6}\s*)?(?:\*\*)?(?:the )?decision(?:\*\*)?\s*:\s*(.+)$/i);
    if (labeled) return clip(labeled[1]);
  }
  return lines.length ? clip(lines[0]) : "this decision";
}

/**
 * The confidence the user already stated. A bare percent is not enough: "raise prices 20%"
 * is a plan, not a confidence. Only an explicit "sure" or a confidence label counts.
 */
export function confidenceFromSubject(subject) {
  const text = String(subject || "");
  const patterns = [
    /confidence\s*[:=]\s*(\d{1,3}\s*%(?:\s*[–-]\s*\d{1,3}\s*%)?|\d{1,3}\s*[–-]\s*\d{1,3}\s*%|0?\.\d+)/i,
    /(\d{1,3}\s*(?:%|percent)(?:\s*[–-]\s*\d{1,3}\s*(?:%|percent))?)\s+sure/i,
    /(?:sure|certain)[^.]{0,24}?(\d{1,3})\s*(?:%|percent)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return confidenceLabel(match[1]);
  }
  return "";
}

/** The prediction the user already wrote. A confidence is not a prediction. Leave it empty rather than invent one. */
export function predictionFromSubject(subject) {
  const text = String(subject || "");
  const labeled = text.match(/^(?:#{1,6}\s*)?(?:\*\*)?prediction(?:\*\*)?\s*:\s*(.+)$/im);
  if (labeled) return clip(labeled[1], 160);
  const expect = text.match(/\bI expect\s+([^\n.]+)/i);
  if (expect) return clip(expect[1], 160);
  return "";
}

function labeledLine(subject, label, max) {
  const pattern = new RegExp(`^(?:#{1,6}\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*:\\s*(.+)$`, "im");
  const match = String(subject || "").match(pattern);
  return match ? clip(match[1], max) : "";
}

/** The goal line the user already wrote. A sentence that merely mentions a goal is not one. */
export function goalFromSubject(subject) {
  return labeledLine(subject, "goal", 240);
}

/** The guardrails line the user already wrote. Leave it empty rather than invent one. */
export function guardrailsFromSubject(subject) {
  return labeledLine(subject, "guardrails", 240);
}

const SOURCE_APPS = [
  ["claude-code", /\bclaude[- ]code\b/i],
  ["copilot", /\bcopilot\b/i],
  ["chatgpt", /\b(?:chatgpt|openai)\b/i],
  ["claude", /\b(?:claude|anthropic)\b/i],
  ["gemini", /\b(?:gemini|google)\b/i],
  ["grok", /\b(?:grokbot|grok|xai)\b/i],
  ["muse", /\b(?:muse|meta)\b/i],
];

/**
 * A short label for the assistant that wrote the record. Empty stays empty.
 * The assistant passes this. The grill server does not.
 */
export function sourceAppLabel(raw) {
  const text = oneLine(raw);
  if (!text) return "";
  for (const [label, pattern] of SOURCE_APPS) {
    if (pattern.test(text)) return label;
  }
  return clip(text, 40);
}

/**
 * Who first proposed the call: `ai` when an assistant recommended it, `me` when the person did.
 * Anything else is left off. Never guessed.
 */
export function proposedByLabel(raw) {
  const text = oneLine(raw).toLowerCase().replace(/[.!]$/, "");
  if (!text) return "";
  if (/^(?:ai|the ai|an ai|assistant|the assistant|ai suggestion|ai recommendation)$/.test(text)) return "ai";
  if (/^(?:me|i|i did|mine|myself|user|the user|human|my own|my call)$/.test(text)) return "me";
  return "";
}

/**
 * A `decided` line is the person's words, plus an optional mark after `|` naming what moved
 * the choice: `after challenge 2` or `after falsifier`. The words are never rewritten.
 */
export function parseDecided(raw) {
  const full = oneLine(raw);
  if (!full) return { text: "", after: "" };
  const words = [];
  let after = "";
  for (const part of full.split(/\s*\|\s*/)) {
    const piece = oneLine(part);
    const mark = piece.replace(/\.$/, "");
    const challenge = mark.match(/^after challenge ([1-9]\d*)$/i);
    if (challenge) {
      if (!after) after = `challenge ${challenge[1]}`;
      continue;
    }
    if (/^after(?: the)? falsifier$/i.test(mark)) {
      if (!after) after = "falsifier";
      continue;
    }
    if (piece) words.push(piece);
  }
  const text = words.join(" | ").trim();
  return text ? { text, after } : { text: "", after: "" };
}

/** The mark a person gave for what moved the choice, as written on the decided line. Empty when none. */
export function afterMark(raw) {
  const text = oneLine(raw).toLowerCase().replace(/^after\s+/, "").replace(/\.$/, "");
  const challenge = text.match(/^(?:challenge\s*)?#?([1-9]\d*)$/);
  if (challenge) return `challenge ${challenge[1]}`;
  if (/^(?:the )?falsifier$/.test(text)) return "falsifier";
  return "";
}

/** The decided line: their words, then ` | after challenge N` when they said a challenge moved it. */
export function decidedLine(words, after = "") {
  const text = parseDecided(words).text;
  if (!text) return "";
  const mark = afterMark(after) || parseDecided(words).after;
  return mark ? `${text} | after ${mark}` : text;
}

function sourceAppFromSubject(subject) {
  return sourceAppLabel(labeledLine(subject, "source_app", 80));
}

export function confidenceLabel(raw) {
  const text = oneLine(raw);
  if (!text) return "";
  const band = text.match(/(\d{1,3})\s*%?\s*[–-]\s*(\d{1,3})\s*%?/);
  if (band) {
    const low = Number(band[1]);
    const high = Number(band[2]);
    if (low <= 100 && high <= 100 && low <= high) return `${low}–${high}%`;
  }
  const percent = text.match(/(\d{1,3})\s*(?:%|percent)/i);
  if (percent && Number(percent[1]) <= 100) return `${Number(percent[1])}%`;
  const unit = text.match(/^(0?\.\d+|1(?:\.0+)?)$/);
  if (unit) {
    const value = Number(unit[1]);
    if (value >= 0 && value <= 1) return `${Math.round(value * 100)}%`;
  }
  const bare = text.match(/^(\d{1,3})$/);
  if (bare && Number(bare[1]) <= 100) return `${Number(bare[1])}%`;
  return text;
}

/** 0–1 for scoring, or null when the record has no number. Bands use the midpoint. */
export function confidenceValue(raw) {
  const label = confidenceLabel(raw);
  if (!label) return null;
  const band = label.match(/(\d{1,3})–(\d{1,3})%/);
  if (band) return (Number(band[1]) + Number(band[2])) / 200;
  const percent = label.match(/(\d{1,3})%/);
  if (percent) return Number(percent[1]) / 100;
  return null;
}

export function verdictFromReport(report) {
  const match = String(report || "").match(/\*\*Verdict:\s*([^*\n]+)\*\*/);
  if (!match) return "";
  return plainVerdict(match[1].split(/[.,]/)[0]);
}

/** The first falsifier in the report. Challenges are already ordered most severe first. */
export function falsifierFromReport(report) {
  const match = String(report || "").match(/\*\*Falsifier:\*\*\s*(.+)/);
  return match ? oneLine(match[1]) : "";
}

/**
 * The portable record. Same text a person copies today and a later store would keep unchanged.
 * Specified in docs/DECISION-RECORD.md.
 */
export function recordBlock(fields) {
  const values = {
    version: RECORD_VERSION,
    date: oneLine(fields.date ?? ""),
    title: oneLine(fields.title ?? ""),
    prediction: oneLine(fields.prediction ?? ""),
    verdict: plainVerdict(fields.verdict),
    falsifier: oneLine(fields.falsifier ?? ""),
    confidence: oneLine(fields.confidence ?? ""),
    review: oneLine(fields.review ?? ""),
  };
  const lines = RECORD_FIELDS.map((key) => `${key}: ${values[key]}`);
  const optional = {
    goal: oneLine(fields.goal ?? ""),
    guardrails: oneLine(fields.guardrails ?? ""),
    source_app: sourceAppLabel(fields.source_app),
    proposed_by: proposedByLabel(fields.proposed_by),
    decided: decidedLine(fields.decided ?? ""),
    supersedes: oneLine(fields.supersedes ?? ""),
    changed: oneLine(fields.changed ?? ""),
  };
  for (const key of OPTIONAL_RECORD_FIELDS) {
    if (optional[key]) lines.push(`${key}: ${optional[key]}`);
  }
  return ["```" + RECORD_FENCE, ...lines, "```"].join("\n");
}

export function reflectionFooter({
  title,
  verdict,
  falsifier,
  confidence = "",
  prediction = "",
  goal = "",
  guardrails = "",
  sourceApp = "",
  date,
  review,
  route = "paste",
  supersedes = "",
  changed = "",
} = {}) {
  const questions = BEFORE_YOU_DECIDE_QUESTIONS.map((question, index) => `${index + 1}. ${question}`).join("\n");
  const close = LOOK_BACK_LINE[route] || LOOK_BACK_LINE.note;
  const storageNote = STORAGE_NOTE[route] || "These stay in your notes. Grill does not store them and does not send them to the judge.";
  const replace = oneLine(supersedes);
  const why = oneLine(changed);
  const keepReplace = Boolean(replace && why);
  return [
    "## Before you decide",
    "",
    storageNote,
    "",
    questions,
    "",
    "The prediction line is what you expect, and by when. Fill it in if it is empty. The falsifier line is the judge's sharpest check. The confidence line is what you said before the verdict, when you said one. Change the confidence if the verdict moved you, and keep the earlier number beside it. A change is a new call. A goal or guardrail line is copied from what you already said. Leave the line off if you did not state one. Do not invent one. A decided line is what you chose, in your own words, including any change you made because of a challenge. Add it only after you say it. Leave it off until then. Do not invent one. If this choice replaced an earlier record, add supersedes as that record's date and title, and changed as evidence, goals, context or reweighed, then your few words. A re-grill where nothing changed is a re-run: leave those lines off. Do not invent them. Do not write a superseded-by line.",
    "",
    recordBlock({
      date,
      title,
      prediction,
      verdict: plainVerdict(verdict),
      falsifier: falsifier || "none named",
      confidence,
      review,
      goal,
      guardrails,
      source_app: sourceApp,
      supersedes: keepReplace ? replace : "",
      changed: keepReplace ? why : "",
    }),
    "",
    "Copy the block above into any notes you keep. Edit the review date if you want a different check-in.",
    close,
    "",
  ].join("\n");
}

/**
 * Append the reflection after a finished judge report. The judge's own text, including the
 * verdict and any "Judge:" line, is not rewritten.
 */
export function appendReflection(report, { subject = "", now = new Date(), route = "mcp", sourceApp = "", supersedes = "", changed = "" } = {}) {
  const body = String(report || "").replace(/\s+$/, "");
  if (!body || body.includes("## Before you decide")) return body ? `${body}\n` : "";
  const footer = reflectionFooter({
    title: decisionTitle(subject),
    verdict: verdictFromReport(body) || "unknown",
    falsifier: falsifierFromReport(body) || "none named",
    confidence: confidenceFromSubject(subject),
    prediction: predictionFromSubject(subject),
    goal: goalFromSubject(subject),
    guardrails: guardrailsFromSubject(subject),
    sourceApp: sourceAppLabel(sourceApp) || sourceAppFromSubject(subject),
    date: isoDate(now),
    review: isoDate(addDays(now, REVIEW_DAYS)),
    route,
    supersedes,
    changed,
  });
  return `${body}\n\n${footer}`;
}

function takeRecord(current) {
  if (!current) return null;
  if (oneLine(current.version) !== RECORD_VERSION) return null;
  if (!oneLine(current.date) || !oneLine(current.title)) return null;
  const record = { version: RECORD_VERSION };
  for (const key of RECORD_KEYS) record[key] = oneLine(current[key] ?? "");
  for (const key of OPTIONAL_RECORD_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
    const value = oneLine(current[key]);
    if (value) record[key] = value;
  }
  return record;
}

const RECORD_LINE = /^(version|date|title|prediction|verdict|falsifier|confidence|review|goal|guardrails|source_app|proposed_by|decided|supersedes|changed)\s*:\s*(.*)$/i;

/**
 * Read version 1 records out of a paste. Field order does not matter. Any other version is
 * skipped whole, so it cannot be scored as if it were version 1. A fence, or the next
 * `version:` line, ends the block in progress.
 */
export function parseRecords(text) {
  const records = [];
  let current = null;
  const finish = () => {
    const done = takeRecord(current);
    if (done) records.push(done);
    current = null;
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === "---") continue;
    if (line.startsWith("```")) {
      finish();
      continue;
    }
    const match = line.match(RECORD_LINE);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === "version") {
      if (current?.version) finish();
      current = { ...(current ?? {}), version: oneLine(match[2]) };
    } else {
      current ??= {};
      current[key] = match[2];
    }
  }
  finish();
  return records;
}

/** Versions present in a paste that this reader will not score. */
export function unsupportedRecordVersions(text) {
  const found = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const match = raw.trim().match(/^version\s*:\s*(\S+)/i);
    if (!match || match[1] === RECORD_VERSION || found.includes(match[1])) continue;
    found.push(match[1]);
  }
  return found;
}

function yn(raw) {
  const text = oneLine(raw).toLowerCase();
  if (!text) return "";
  if (/^(y|yes|true)$/.test(text) || text.startsWith("yes")) return "yes";
  if (/^(n|no|false)$/.test(text) || text.startsWith("no")) return "no";
  if (/not yet|unclear|pending|too soon|unknown/.test(text)) return "not yet";
  return "";
}

function goalAnswer(raw) {
  const text = oneLine(raw).toLowerCase();
  if (!text) return "";
  if (/^(partly|partial|partially)\b/.test(text)) return "partly";
  return yn(raw);
}

/** A goal or guardrail the user actually stated. "not stated" and "none" are declines. */
function statedValue(value) {
  const text = oneLine(value);
  if (!text || /^(not stated|none|none stated|n\/a|na)$/i.test(text)) return "";
  return text;
}

/**
 * A surprise is a few words, plus marks the user wrote. A mark is its own clause after `|`.
 * The words are never compared with a challenge or the falsifier.
 * `still live` means the decision is still open and the surprise bears on it.
 */
function parseSurprise(raw) {
  const full = oneLine(raw);
  if (!full) return { text: "", match: "", live: false };
  const words = [];
  let match = "";
  let live = false;
  for (const part of full.split(/\s*\|\s*/)) {
    const piece = oneLine(part).replace(/\.$/, "");
    const challenge = piece.match(/^matches challenge ([1-9]\d*)$/i);
    if (challenge) {
      if (!match) match = `challenge ${challenge[1]}`;
      continue;
    }
    if (/^matches(?: the)? falsifier$/i.test(piece)) {
      if (!match) match = "falsifier";
      continue;
    }
    if (/^still live$/i.test(piece)) {
      live = true;
      continue;
    }
    if (piece) words.push(piece);
  }
  const text = words.join(" | ").trim();
  if (!text) return { text: "", match: "", live: false };
  return { text, match, live };
}

function takeOutcome(current) {
  if (!current) return null;
  const came = yn(current.came_true);
  const fired = yn(current.falsifier_fired);
  const happened = oneLine(current.happened ?? "");
  const title = oneLine(current.title ?? "");
  const goalMet = goalAnswer(current.goal_met);
  const guardrailsHeld = yn(current.guardrails_held);
  const surprise = parseSurprise(current.surprise);
  if (!title && !came && !fired && !happened && !goalMet && !guardrailsHeld && !surprise.text) return null;
  return {
    title,
    cameTrue: came,
    falsifierFired: fired,
    happened,
    goalMet,
    guardrailsHeld,
    surprise: surprise.text,
    surpriseMatch: surprise.match,
    surpriseLive: surprise.live,
  };
}

const OUTCOME_KEYS = {
  title: "title",
  came_true: "came_true",
  came: "came_true",
  "came true": "came_true",
  prediction: "came_true",
  falsifier_fired: "falsifier_fired",
  "falsifier fired": "falsifier_fired",
  falsifier: "falsifier_fired",
  happened: "happened",
  "what actually happened": "happened",
  surprise: "surprise",
  goal_met: "goal_met",
  "goal met": "goal_met",
  guardrails_held: "guardrails_held",
  "guardrails held": "guardrails_held",
};

/** What the user says came back. One block per decision, titled when there is more than one. */
export function parseOutcomes(text) {
  const outcomes = [];
  let current = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s*/, "");
    if (!line || line.startsWith("```") || line === "---") continue;
    const match = line.match(/^([a-z][a-z _]*?)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = OUTCOME_KEYS[match[1].toLowerCase()];
    if (!key) continue;
    if (key === "title") {
      const done = takeOutcome(current);
      if (done) outcomes.push(done);
      current = { title: match[2] };
    } else {
      current ??= {};
      current[key] = match[2];
    }
  }
  const done = takeOutcome(current);
  if (done) outcomes.push(done);
  return outcomes;
}

function matchOutcome(record, outcomes) {
  const title = record.title.trim().toLowerCase();
  const titled = outcomes.find((item) => item.title && item.title.trim().toLowerCase() === title);
  if (titled) return titled;
  if (outcomes.length === 1 && !outcomes[0].title) return outcomes[0];
  return null;
}

function namedEarlierCall(record) {
  const text = oneLine(record.supersedes);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  return match ? { date: match[1], title: match[2] } : null;
}

function earlierInPaste(record, records) {
  const named = namedEarlierCall(record);
  if (!named) return null;
  return (
    records.find(
      (other) =>
        other !== record &&
        oneLine(other.date) === named.date &&
        oneLine(other.title).toLowerCase() === named.title.toLowerCase(),
    ) || null
  );
}

/** What a revision line says. Empty when the record has neither line. No superseded-by field is ever written. */
function revisionLines(record, records) {
  const lines = [];
  const named = namedEarlierCall(record);
  if (named) {
    const here = earlierInPaste(record, records);
    lines.push(
      here
        ? `This replaced the call of ${named.date}, "${named.title}". That earlier call is in this paste.`
        : `This replaced the call of ${named.date}, "${named.title}". Its outcome isn't scored here.`,
    );
  } else if (oneLine(record.supersedes)) {
    lines.push(`This replaced an earlier call: ${oneLine(record.supersedes)}.`);
  }
  const changed = oneLine(record.changed);
  if (changed) {
    lines.push(`What changed: ${changed}.`);
    if (/^reweighed\b/i.test(changed)) lines.push("Nothing new came in; you weighed it differently.");
  }
  return lines;
}

function pasteEarlierNote(records) {
  const missing = records.some((record) => oneLine(record.supersedes) && !earlierInPaste(record, records));
  return missing ? "If this replaced an earlier record, paste that too to see both." : "";
}

/** One line. No checklist, and no record format. */
export function lookBackPrompt(record) {
  const prediction = oneLine(record?.prediction);
  const confidence = oneLine(record?.confidence);
  if (prediction && confidence) return `You predicted ${prediction} at ${confidence}. What happened?`;
  if (prediction) return `You predicted ${prediction}. What happened?`;
  if (confidence) return `You were ${confidence} sure. What happened?`;
  return "You didn't write a prediction. What happened?";
}

function questionsFor(records) {
  return records.map((record) => lookBackPrompt(record)).join("\n");
}

function askWhatHappened(records) {
  return questionsFor(records);
}

function callReading(record, outcome, records) {
  const verdict = plainVerdict(record.verdict);
  const came = outcome.cameTrue;
  const parts = [`**${record.title}.** Verdict then: ${verdict}.`];
  if (oneLine(record.prediction)) parts.push(`Prediction then: ${record.prediction}.`);
  const { text: decided, after } = parseDecided(statedValue(record.decided));
  if (decided && came === "yes") parts.push(`You chose "${decided}". It came true.`);
  else if (decided && came === "no") parts.push(`You chose "${decided}". It did not come true.`);
  else if (decided) parts.push(`You chose: "${decided}".`);
  if (decided && after) parts.push(`You changed it after ${after}.`);
  for (const line of revisionLines(record, records)) parts.push(line);
  if (came === "not yet" || !came) {
    parts.push(outcome.happened ? `Not scored yet. ${outcome.happened}` : "Not back yet, so this call is not scored.");
    return parts.concat(surpriseTail(outcome)).join(" ");
  }
  const doubt = verdict === "shaky" || verdict === "doesn't hold up";
  const allowed = verdict === "solid" || verdict === "solid if";
  if (came === "yes" && doubt) parts.push("It came true, and the verdict had doubted it. You were righter than the doubt.");
  else if (came === "no" && doubt) parts.push("It did not come true, and the verdict had doubted it. The doubt matched what happened.");
  else if (came === "yes" && allowed) parts.push("It came true, and the verdict had let it stand. The call and the verdict agreed.");
  else if (came === "no" && allowed) parts.push("It did not come true, and the verdict had let it stand. The outcome was harder than the verdict.");
  else parts.push(came === "yes" ? "It came true." : "It did not come true.");

  if (came === "no" && outcome.surprise && outcome.surpriseMatch) parts.push("This was flagged and you went ahead.");
  else if (came === "no" && outcome.surprise) parts.push("The world moved in a way the record didn't foresee.");

  const goal = statedValue(record.goal);
  if (goal && outcome.goalMet === "no" && came === "yes") {
    parts.push("It came true, and the goal was missed: the prediction was right about the wrong target.");
  } else if (goal && outcome.goalMet === "no") parts.push("The goal was missed.");
  else if (goal && outcome.goalMet === "yes") parts.push("The goal was reached.");
  else if (goal && outcome.goalMet === "partly") parts.push("The goal was partly reached.");

  const guardrails = statedValue(record.guardrails);
  if (guardrails && outcome.guardrailsHeld === "no") parts.push("A guardrail broke.");
  else if (guardrails && outcome.guardrailsHeld === "yes") parts.push("The guardrails held.");

  if (outcome.falsifierFired === "yes" && came === "yes") {
    parts.push("You marked it true, and the falsifier fired. Those two disagree. Say which one you mean.");
  } else if (outcome.falsifierFired === "yes") parts.push("The falsifier fired.");
  else if (outcome.falsifierFired === "no") parts.push("The falsifier did not fire.");

  const value = confidenceValue(record.confidence);
  if (value != null && value >= 0.7 && came === "no") parts.push("Confidence was high, and the call missed.");
  if (value != null && value <= 0.4 && came === "yes") parts.push("Confidence was low, and the call came true.");
  if (record.confidence && confidenceValue(record.confidence) == null) parts.push(`Confidence was written as "${record.confidence}", which is not a number, so it is not in the sum.`);
  else if (record.confidence && /–/.test(confidenceLabel(record.confidence))) parts.push("The band is scored at its midpoint.");
  if (outcome.happened) parts.push(`What happened: ${outcome.happened}`);
  return parts.concat(surpriseTail(outcome)).join(" ");
}

function surpriseTail(outcome) {
  if (!outcome.surprise) return [];
  const lines = [`Surprise: ${outcome.surprise}.`];
  if (outcome.surpriseLive) lines.push("Grill the revised plan; the new record will say it replaces this one.");
  return lines;
}

function patternReading(scored) {
  const back = scored.filter((item) => item.cameTrue === "yes" || item.cameTrue === "no");
  if (back.length === 0) return "Nothing has come back as yes or no yet, so there is no pattern to read.";
  const hits = back.filter((item) => item.cameTrue === "yes").length;
  const lines = [`${back.length} call${back.length === 1 ? "" : "s"} back, ${hits} came true.`];
  const numbered = back.filter((item) => confidenceValue(item.record.confidence) != null);
  if (numbered.length) {
    const sum = numbered.reduce((total, item) => total + confidenceValue(item.record.confidence), 0);
    const rate = hits / back.length;
    const mean = sum / numbered.length;
    const tilt = mean - rate;
    const direction =
      Math.abs(tilt) < 0.1
        ? "Your confidence sat near what happened."
        : tilt > 0
          ? "Your confidence ran hot: you were surer than the calls turned out."
          : "Your confidence ran cold: the calls came true more often than your confidence said.";
    lines.push(`Your confidences add up to ${sum.toFixed(1)} of ${numbered.length}. ${direction}`);
  } else {
    lines.push("Confidence was not a number on the calls that came back, so there is no calibration to read.");
  }
  const doubted = back.filter((item) => {
    const verdict = plainVerdict(item.record.verdict);
    return verdict === "shaky" || verdict === "doesn't hold up";
  });
  const stood = back.filter((item) => {
    const verdict = plainVerdict(item.record.verdict);
    return verdict === "solid" || verdict === "solid if";
  });
  if (doubted.length) {
    const missed = doubted.filter((item) => item.cameTrue === "no").length;
    lines.push(`Where the verdict doubted the call, ${missed} of ${doubted.length} missed.`);
  }
  if (stood.length) {
    const held = stood.filter((item) => item.cameTrue === "yes").length;
    lines.push(`Where the verdict let the call stand, ${held} of ${stood.length} came true.`);
  }
  const goalAnswered = back.filter((item) => statedValue(item.record.goal) && ["yes", "no", "partly"].includes(item.goalMet));
  const guardAnswered = back.filter((item) => statedValue(item.record.guardrails) && ["yes", "no"].includes(item.guardrailsHeld));
  const counts = [];
  if (goalAnswered.length) {
    const met = goalAnswered.filter((item) => item.goalMet === "yes").length;
    counts.push(`${met} of ${goalAnswered.length} goals met`);
  }
  if (guardAnswered.length) {
    const held = guardAnswered.filter((item) => item.guardrailsHeld === "yes").length;
    counts.push(`${held} of ${guardAnswered.length} guardrails held`);
  }
  if (counts.length) lines.push(`${counts.join(", ")}.`);
  lines.push(back.length < 4 ? "Fewer than four calls are back. Read the direction, not a score." : "Read the direction, not a score.");
  return lines.join(" ");
}

/**
 * Ask what happened, or score the calls the user already answered.
 * `records` and `happened` are the pasted text. The same input always returns the same text.
 */
export function lookBack({ records = "", happened = "" } = {}) {
  const parsed = parseRecords(records).slice(0, 30);
  const trimmed = parseRecords(records);
  if (!parsed.length) {
    const other = unsupportedRecordVersions(records);
    if (other.length) {
      return [
        "## Look back",
        "",
        `That paste uses record version ${other.join(", ")}. This Grill reads version 1 only. Nothing is stored.`,
        "",
      ].join("\n");
    }
    return [
      "## Look back",
      "",
      "No decision record was in that paste. Nothing is stored either way.",
      "",
      "A record looks like this:",
      "",
      recordBlock({
        date: "2026-09-27",
        title: "The decision, in a few words",
        verdict: "shaky",
        prediction: "what you expected, and by when",
        falsifier: "the cheapest test that would prove it wrong",
        confidence: "70%",
        review: "2026-10-11",
      }),
      "",
      'Paste one or more, then say what happened. Say "look back" again with both.',
      "",
    ].join("\n");
  }

  if (!oneLine(happened)) return askWhatHappened(parsed);

  const outcomes = parseOutcomes(happened);
  const pending = [];
  const scored = [];
  for (const record of parsed) {
    const outcome = matchOutcome(record, outcomes);
    if (!outcome || !outcome.cameTrue) pending.push(record);
    else scored.push({ record, ...outcome });
  }

  if (!scored.length) {
    return ["## Look back", "", "Nothing is stored. Those notes did not say whether each call came true, so nothing was scored.", "", questionsFor(parsed)].join("\n");
  }

  const lines = ["## Look back", "", "Nothing is stored. This reading stays in the chat.", ""];
  if (trimmed.length > parsed.length) lines.push("Only the first 30 records were read.", "");
  for (const item of scored) lines.push(callReading(item.record, item, parsed), "");
  lines.push("## Pattern", "", patternReading(scored), "");
  const note = pasteEarlierNote(parsed);
  if (note) lines.push(note, "");
  if (pending.length) lines.push("Still to answer:", "", questionsFor(pending, parsed));
  return lines.join("\n");
}

/** Rates are compared only when each side has at least this many calls back. Below it, examples only. */
export const MIN_COMPARE = 10;

const PROPOSER_PLAIN = { ai: "AI suggestion", me: "your call" };

/**
 * Where the calls changed, as data. A call changed when its decided line names a challenge or the
 * falsifier, or when it replaced an earlier record. Every example is a call the person made.
 * No counterfactual, no trend, and no rate below MIN_COMPARE on each side.
 */
export function changeSummary({ records = [], outcomes = [] } = {}) {
  const items = records.map((record) => {
    const { text: decided, after } = parseDecided(statedValue(record.decided));
    const outcome = matchOutcome(record, outcomes);
    const came = outcome?.cameTrue === "yes" || outcome?.cameTrue === "no" ? outcome.cameTrue : "";
    return {
      record,
      title: record.title,
      date: record.date,
      decided,
      after,
      supersedes: oneLine(record.supersedes),
      changed: oneLine(record.changed),
      proposedBy: proposedByLabel(record.proposed_by),
      came,
      flagged: came === "no" && Boolean(outcome?.surprise && outcome?.surpriseMatch),
      flaggedBy: outcome?.surpriseMatch || "",
    };
  });
  const replaced = new Set(records.map((record) => earlierInPaste(record, records)).filter(Boolean));
  const withChoice = items.filter((item) => item.decided && !replaced.has(item.record));
  const changed = withChoice.filter((item) => item.after || item.supersedes);
  const kept = withChoice.filter((item) => !item.after && !item.supersedes);
  const byProposer = { ai: 0, me: 0, unmarked: 0 };
  for (const item of changed) byProposer[item.proposedBy || "unmarked"] += 1;
  const back = (list) => list.filter((item) => item.came);
  const hits = (list) => list.filter((item) => item.came === "yes").length;
  const changedBack = back(changed);
  const keptBack = back(kept);
  const comparable = changedBack.length >= MIN_COMPARE && keptBack.length >= MIN_COMPARE;
  return {
    total: items.length,
    noChoice: items.filter((item) => !item.decided && !replaced.has(item.record)).length,
    replaced: replaced.size,
    withChoice: withChoice.length,
    changed: [...changed].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    kept: kept.length,
    keptHeld: hits(keptBack),
    keptBack: keptBack.length,
    flagged: kept.filter((item) => item.flagged),
    byProposer,
    compare: comparable
      ? { changedHits: hits(changedBack), changedBack: changedBack.length, keptHits: hits(keptBack), keptBack: keptBack.length }
      : null,
  };
}

/** One example, before → after → outcome so far, in the person's own words. */
export function changeExample(item) {
  const who = PROPOSER_PLAIN[item.proposedBy];
  const head = who ? `**${item.title}** (${who}).` : `**${item.title}**.`;
  const parts = [head];
  if (item.supersedes) {
    parts.push(`Before: the call of ${item.supersedes}.`);
    parts.push(`After: "${item.decided}"${item.after ? `, after ${item.after}` : ""}.`);
    if (item.changed) parts.push(`What changed: ${item.changed}.`);
  } else {
    parts.push(`Before: "${item.title}", as brought to the grill.`);
    parts.push(`After: "${item.decided}", after ${item.after}.`);
  }
  if (item.came === "yes") parts.push("So far: it came true.");
  else if (item.came === "no") parts.push("So far: it did not come true.");
  else parts.push("So far: not looked back yet.");
  return parts.join(" ");
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The count lines. Counts only, never a rate below MIN_COMPARE on each side, never a trend. */
export function changeCountLines(summary) {
  const lines = [];
  lines.push(
    `${plural(summary.withChoice, "call")} with a choice. ${summary.changed.length} changed after a challenge or a later rethink; ${summary.kept} went ahead as first stated.`,
  );
  const { ai, me, unmarked } = summary.byProposer;
  if (summary.changed.length && ai + me > 0) {
    const parts = [];
    if (ai) parts.push(`${ai} started as AI suggestion${ai === 1 ? "" : "s"}`);
    if (me) parts.push(`${me} as your own call${me === 1 ? "" : "s"}`);
    if (unmarked) parts.push(`${unmarked} not marked`);
    lines.push(`Of the changed calls, ${parts.join(", ")}.`);
  }
  if (summary.keptBack) lines.push(`Of the calls kept as stated, ${summary.keptHeld} of ${summary.keptBack} back so far came true.`);
  if (summary.compare) {
    const c = summary.compare;
    lines.push(`Changed calls came true ${c.changedHits} of ${c.changedBack}; calls kept as stated came true ${c.keptHits} of ${c.keptBack}. This compares calls, not causes.`);
  } else if (summary.changed.length) {
    lines.push(`Fewer than ${MIN_COMPARE} calls on each side are back, so there is no rate to compare. Read the examples.`);
  }
  return lines;
}

/** How many pasted records the changes view reads. The rest of the paste is left out. */
export const CHANGES_PASTE_CAP = 30;

/**
 * "What has Grill done for me?" Read pasted records (and what happened, if given) and show where
 * the calls changed. A paste longer than CHANGES_PASTE_CAP is read from the start, and the text says so.
 * Nothing is stored. The same input always returns the same text.
 */
export function changesView({ records = "", happened = "", limit = 10 } = {}) {
  const all = parseRecords(records);
  const parsed = all.slice(0, CHANGES_PASTE_CAP);
  if (!parsed.length) {
    return ["## What changed", "", "No decision record was in that paste. Nothing is stored either way.", ""].join("\n");
  }
  const summary = changeSummary({ records: parsed, outcomes: oneLine(happened) ? parseOutcomes(happened) : [] });
  const readNote = all.length > parsed.length ? `Read the first ${parsed.length} of ${all.length} pasted records.` : "";
  return changesText(summary, { limit, storedNote: "Nothing is stored. This stays in the chat.", readNote });
}

/** Saved records with their own look-back notes. An untitled note belongs to its own record only. */
export function outcomesForSaved(rows = []) {
  const outcomes = [];
  for (const row of rows) {
    const note = row?.lookback?.happened;
    if (!note || !row.title) continue;
    for (const outcome of parseOutcomes(note)) {
      if (!outcome.title) outcomes.push({ ...outcome, title: row.title });
      else if (outcome.title.trim().toLowerCase() === String(row.title).trim().toLowerCase()) outcomes.push(outcome);
    }
  }
  return outcomes;
}

/** The text of the changes view, from a summary. */
export function changesText(summary, { limit = 10, storedNote = "", readNote = "" } = {}) {
  const lines = ["## What changed", ""];
  if (storedNote) lines.push(storedNote, "");
  if (readNote) lines.push(readNote, "");
  if (!summary.withChoice) {
    lines.push("None of these records says what you chose yet, so there is nothing to show changing. Say your choice after a grill and it is added.", "");
    return lines.join("\n");
  }
  lines.push(changeCountLines(summary).join(" "), "");
  const shown = summary.changed.slice(0, limit);
  for (const item of shown) lines.push(changeExample(item), "");
  if (summary.changed.length > shown.length) lines.push(`${summary.changed.length - shown.length} more changed call${summary.changed.length - shown.length === 1 ? "" : "s"} not shown.`, "");
  if (summary.flagged.length) {
    lines.push("Flagged and you went ahead:", "");
    for (const item of summary.flagged) lines.push(`- **${item.title}**: ${item.flaggedBy} named it, you kept the call, and it did not come true.`);
    lines.push("");
  }
  if (summary.noChoice) lines.push(`${plural(summary.noChoice, "record")} with no choice stated ${summary.noChoice === 1 ? "is" : "are"} not counted.`, "");
  lines.push("These are your calls. Grill argued the other side; you chose.", "");
  return lines.join("\n");
}
