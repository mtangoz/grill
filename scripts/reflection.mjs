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
export const RECORD_KEYS = ["date", "title", "verdict", "falsifier", "confidence", "review"];

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

function clip(text) {
  const clean = oneLine(text).replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "");
  if (clean.length <= 80) return clean;
  const cut = clean.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).replace(/[,:;.\s]+$/, "");
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

export function recordBlock(fields) {
  const lines = RECORD_KEYS.map((key) => `${key}: ${oneLine(fields[key] ?? "")}`);
  return ["```text", ...lines, "```"].join("\n");
}

export function reflectionFooter({
  title,
  verdict,
  falsifier,
  confidence = "",
  date,
  review,
  route = "paste",
} = {}) {
  const questions = BEFORE_YOU_DECIDE_QUESTIONS.map((question, index) => `${index + 1}. ${question}`).join("\n");
  const close = LOOK_BACK_LINE[route] || LOOK_BACK_LINE.note;
  return [
    "## Before you decide",
    "",
    "These stay in your notes. Grill does not store them and does not send them to the judge.",
    "",
    questions,
    "",
    "The falsifier line is the judge's sharpest check. The confidence line is what you said before the verdict, when you said one. Change the confidence if the verdict moved you, and keep the earlier number beside it. A change is a new call.",
    "",
    recordBlock({
      date,
      title,
      verdict: plainVerdict(verdict),
      falsifier: falsifier || "none named",
      confidence,
      review,
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
export function appendReflection(report, { subject = "", now = new Date(), route = "mcp" } = {}) {
  const body = String(report || "").replace(/\s+$/, "");
  if (!body || body.includes("## Before you decide")) return body ? `${body}\n` : "";
  const footer = reflectionFooter({
    title: decisionTitle(subject),
    verdict: verdictFromReport(body) || "unknown",
    falsifier: falsifierFromReport(body) || "none named",
    confidence: confidenceFromSubject(subject),
    date: isoDate(now),
    review: isoDate(addDays(now, REVIEW_DAYS)),
    route,
  });
  return `${body}\n\n${footer}`;
}

function takeRecord(current) {
  if (!current?.date || !current?.title) return null;
  const record = {};
  for (const key of RECORD_KEYS) record[key] = oneLine(current[key] ?? "");
  return record;
}

/** Pull compact decision records out of a paste. Fences and blank lines are ignored. */
export function parseRecords(text) {
  const records = [];
  let current = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("```") || line === "---") continue;
    const match = line.match(/^(date|title|verdict|falsifier|confidence|review)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === "date") {
      const done = takeRecord(current);
      if (done) records.push(done);
      current = { date: match[2] };
    } else if (current) {
      current[key] = match[2];
    }
  }
  const done = takeRecord(current);
  if (done) records.push(done);
  return records;
}

function yn(raw) {
  const text = oneLine(raw).toLowerCase();
  if (!text) return "";
  if (/^(y|yes|true)$/.test(text) || text.startsWith("yes")) return "yes";
  if (/^(n|no|false)$/.test(text) || text.startsWith("no")) return "no";
  if (/not yet|unclear|pending|too soon|unknown/.test(text)) return "not yet";
  return "";
}

function takeOutcome(current) {
  if (!current) return null;
  const came = yn(current.came_true);
  const fired = yn(current.falsifier_fired);
  const happened = oneLine(current.happened ?? "");
  const title = oneLine(current.title ?? "");
  if (!title && !came && !fired && !happened) return null;
  return { title, cameTrue: came, falsifierFired: fired, happened };
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

function questionsFor(records) {
  const lines = [];
  for (const record of records) {
    const confidence = record.confidence ? ` Confidence then: ${record.confidence}.` : " Confidence was not written down.";
    lines.push(
      `### ${record.title}`,
      "",
      `Verdict then: ${plainVerdict(record.verdict)}.${confidence} Review date: ${record.review || "not set"}.`,
      `Falsifier: ${record.falsifier || "none named"}.`,
      "- Did the prediction come true: yes, no, or not yet?",
      "- Did that falsifier fire: yes, no, or not yet?",
      "- What actually happened, in one sentence?",
      "",
    );
  }
  lines.push("Reply in this shape, one block per decision:", "");
  lines.push("```text");
  lines.push(`title: ${records[0].title}`);
  lines.push("came_true: no");
  lines.push("falsifier_fired: yes");
  lines.push("happened: one sentence on what actually happened");
  lines.push("```", "");
  return lines.join("\n");
}

function askWhatHappened(records) {
  return [
    "## Look back",
    "",
    "Nothing is stored. For each decision, say what actually happened. Then paste the answers the same way.",
    "",
    questionsFor(records),
  ].join("\n");
}

function callReading(record, outcome) {
  const verdict = plainVerdict(record.verdict);
  const came = outcome.cameTrue;
  const parts = [`**${record.title}.** Verdict then: ${verdict}.`];
  if (came === "not yet" || !came) {
    parts.push(outcome.happened ? `Not scored yet. ${outcome.happened}` : "Not back yet, so this call is not scored.");
    return parts.join(" ");
  }
  const doubt = verdict === "shaky" || verdict === "doesn't hold up";
  const allowed = verdict === "solid" || verdict === "solid if";
  if (came === "yes" && doubt) parts.push("It came true, and the verdict had doubted it. You were righter than the doubt.");
  else if (came === "no" && doubt) parts.push("It did not come true, and the verdict had doubted it. The doubt matched what happened.");
  else if (came === "yes" && allowed) parts.push("It came true, and the verdict had let it stand. The call and the verdict agreed.");
  else if (came === "no" && allowed) parts.push("It did not come true, and the verdict had let it stand. The outcome was harder than the verdict.");
  else parts.push(came === "yes" ? "It came true." : "It did not come true.");

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
  return parts.join(" ");
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
  for (const item of scored) lines.push(callReading(item.record, item), "");
  lines.push("## Pattern", "", patternReading(scored), "");
  if (pending.length) lines.push("Still to answer:", "", questionsFor(pending));
  return lines.join("\n");
}
