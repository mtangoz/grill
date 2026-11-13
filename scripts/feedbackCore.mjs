/**
 * A reaction to one grill. The 180-day record keeps the rating, the reason, the time,
 * the judge model, the verdict label and a hash of the account. The subject and the
 * layer-1 note are copied in only when the person says yes for this grill.
 * Same cipher as a decision record: AES-256-GCM, key from GRILL_RECORD_KEY.
 * Nothing here opens the network.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const FEEDBACK_TTL_SECONDS = 180 * 24 * 60 * 60;
/** The same time in days. The reply after a reaction says this number, on both routes. */
export const FEEDBACK_KEEP_DAYS = FEEDBACK_TTL_SECONDS / (24 * 60 * 60);
export const FEEDBACK_PREFIX = "grill:hosted:feedback:";
export const FEEDBACK_OF_PREFIX = "grill:hosted:feedbackof:";
export const REACT_PREFIX = "grill:hosted:react:";
export const RATINGS = Object.freeze(["helped", "meh"]);
export const REASON_MAX = 200;
export const SUBJECT_MAX = 200_000;
export const LAYER_MAX = 8_000;
const VERDICT_LABELS = new Set(["solid", "solid if", "shaky", "doesn't hold up", "quick take", "unknown"]);
const MODEL_RE = /^[A-Za-z0-9_.+-]{1,80}\/[A-Za-z0-9_.+:-]{1,80}$/;

/** One sentence on the grill tool. The rules live on grill_feedback. */
export const FEEDBACK_POINTER =
  "When the user reacts to a grill ('meh', 'not useful', 'that helped', 'great'), call grill_feedback.";

/** What the assistant reads before it calls grill_feedback. */
export const FEEDBACK_TOOL_DESCRIPTION =
  "Call when the user reacts to a grill ('meh', 'not useful', 'that helped', 'great'). rating is helped or meh. reason is optional, one line in their words. job_id or record_ref is optional and defaults to the latest grill in this session. Ask once, 'Want to send this grill to Grill so we can improve it?', only when they gave a meh or a reason, and only after the verdict. Pass share_grill true only after they say yes for this grill. Never ask before the verdict. Never ask on a quick or bulk grill unless they reacted first. Show the reply as written. It says what Grill keeps.";

export function hashAccount(id) {
  return createHash("sha256").update(String(id)).digest("hex");
}

/** GRILL_RECORD_KEY, the same 32-byte key that wraps decision records. */
export function feedbackKeyFromEnv(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return null;
  const key = Buffer.from(text, "base64");
  return key.length === 32 ? key : null;
}

export function feedbackKey(id) {
  return `${FEEDBACK_PREFIX}${id}`;
}

export function feedbackOfKey(accountHash) {
  return `${FEEDBACK_OF_PREFIX}${accountHash}`;
}

export function reactionKey(userId, slot) {
  return `${REACT_PREFIX}${userId}:${slot}`;
}

export function oneLineReason(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, REASON_MAX);
}

function modelField(value) {
  const model = String(value ?? "").trim();
  return MODEL_RE.test(model) ? model : "";
}

function verdictField(value) {
  const label = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return VERDICT_LABELS.has(label) ? label : "unknown";
}

function clipped(value, max) {
  if (typeof value !== "string" || !value) return "";
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * The record that is stored. `share` must be boolean true or the subject and the
 * layer-1 note are left out, even if the caller passed them. A verdict sentence is
 * not a label, so it is stored as unknown rather than kept.
 */
export function buildFeedbackRecord({ rating, reason, at, model, verdict, accountId, share = false, subject = "", layer1 = "" } = {}) {
  const which = typeof rating === "string" ? rating.trim() : "";
  if (!RATINGS.includes(which)) return { error: "rating" };
  const account = String(accountId ?? "").trim();
  if (!account) return { error: "account" };
  const when = new Date(at);
  const record = {
    rating: which,
    reason: oneLineReason(reason),
    at: Number.isNaN(when.getTime()) ? new Date(0).toISOString() : when.toISOString(),
    model: modelField(model),
    verdict: verdictField(verdict),
    account: hashAccount(account),
  };
  if (share === true) {
    const sent = clipped(subject, SUBJECT_MAX);
    const note = clipped(layer1, LAYER_MAX);
    if (sent) record.subject = sent;
    if (note) record.layer1 = note;
  }
  return { record };
}

export function encryptJson(value, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error("key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64url");
}

export function decryptJson(blob, key) {
  const buf = Buffer.from(String(blob), "base64url");
  if (buf.length < 29) throw new Error("cipher");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8"));
}

/** ISO week, UTC, same numbering as the hosted active-user counts. */
export function isoWeek(ms = Date.now()) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export async function storeFeedback(command, key, record) {
  const id = randomBytes(16).toString("hex");
  await command(["SET", feedbackKey(id), encryptJson(record, key), "EX", String(FEEDBACK_TTL_SECONDS)]);
  await command(["RPUSH", feedbackOfKey(record.account), id]);
  await command(["EXPIRE", feedbackOfKey(record.account), String(FEEDBACK_TTL_SECONDS)]);
  return id;
}

export async function deleteFeedbackForAccount(command, accountId) {
  const hash = hashAccount(accountId);
  const ids = (await command(["LRANGE", feedbackOfKey(hash), "0", "-1"])) || [];
  for (const id of ids) await command(["DEL", feedbackKey(String(id))]);
  await command(["DEL", feedbackOfKey(hash)]);
  const prefix = `${REACT_PREFIX}${accountId}:`;
  let cursor = "0";
  for (let i = 0; i < 100; i += 1) {
    const result = await command(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", "100"]);
    const next = Array.isArray(result) ? String(result[0] ?? "0") : "0";
    const keys = Array.isArray(result?.[1]) ? result[1] : [];
    for (const name of keys) await command(["DEL", String(name)]);
    cursor = next;
    if (cursor === "0") break;
  }
}

export async function readFeedbackRecords(command, key) {
  const rows = [];
  let cursor = "0";
  for (let i = 0; i < 1000; i += 1) {
    const result = await command(["SCAN", cursor, "MATCH", `${FEEDBACK_PREFIX}*`, "COUNT", "100"]);
    const next = Array.isArray(result) ? String(result[0] ?? "0") : "0";
    const keys = Array.isArray(result?.[1]) ? result[1] : [];
    for (const name of keys) {
      if (!/^grill:hosted:feedback:[0-9a-f]{32}$/.test(String(name))) continue;
      const blob = await command(["GET", String(name)]);
      if (typeof blob !== "string" || !blob) continue;
      try {
        rows.push(decryptJson(blob, key));
      } catch {
        // A blob we cannot read is skipped. It is not logged.
      }
    }
    cursor = next;
    if (cursor === "0") break;
  }
  return rows;
}

/** Counts for the weekly review, then JSONL of the grills someone chose to send. */
export function formatFeedbackReport(records) {
  const list = (records || []).slice().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const byRating = { helped: 0, meh: 0 };
  const byModel = new Map();
  const byWeek = new Map();
  for (const row of list) {
    if (row?.rating === "helped" || row?.rating === "meh") byRating[row.rating] += 1;
    const model = row?.model || "unknown";
    byModel.set(model, (byModel.get(model) || 0) + 1);
    const week = isoWeek(Date.parse(row?.at));
    if (!byWeek.has(week)) byWeek.set(week, { helped: 0, meh: 0 });
    if (row?.rating === "helped" || row?.rating === "meh") byWeek.get(week)[row.rating] += 1;
  }
  const lines = [`rating helped: ${byRating.helped}`, `rating meh: ${byRating.meh}`];
  for (const model of [...byModel.keys()].sort()) lines.push(`model ${model}: ${byModel.get(model)}`);
  for (const week of [...byWeek.keys()].sort()) {
    const row = byWeek.get(week);
    lines.push(`week ${week}: helped ${row.helped}, meh ${row.meh}`);
  }
  const opted = list.filter((row) => Object.hasOwn(row, "subject") || Object.hasOwn(row, "layer1"));
  return { lines, jsonl: opted.map((row) => JSON.stringify(row)).join("\n") };
}
