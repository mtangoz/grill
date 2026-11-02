/**
 * The first 100 people let in are founding members: Grill stays free for them for life.
 * One number per email. Assigning is idempotent. The counter stops at 100.
 * Made-up fixtures only in tests. This does not change Stripe, Clerk, or the allowlist.
 */
import { createHash } from "node:crypto";

export const FOUNDING_CAP = 100;
export const FOUNDING_COUNT_KEY = "grill:hosted:founding:count";

export function foundingEmail(email) {
  const who = String(email || "").trim().toLowerCase();
  if (!who || who.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(who)) return "";
  return who;
}

export function foundingMemberKey(email) {
  const who = foundingEmail(email);
  if (!who) return "";
  return `grill:hosted:founding:member:${createHash("sha256").update(who).digest("hex")}`;
}

export function foundingMemberLine(number) {
  return `Founding member #${number} of 100: Grill is free for you for life.`;
}

export function foundingSpotsLine(assigned) {
  const taken = Math.max(0, Math.min(FOUNDING_CAP, Number(assigned) || 0));
  const left = FOUNDING_CAP - taken;
  if (left <= 0) return "All 100 founding spots are taken.";
  const word = left === 1 ? "spot" : "spots";
  return `First 100 users get Grill free for life, ${left} ${word} left.`;
}

export function foundingEntitled(number) {
  return Number.isInteger(number) && number >= 1 && number <= FOUNDING_CAP;
}

/** A founding member is already at the free-for-life tier, so a paywall does not apply. */
export function foundingSkipsPaywall(number) {
  return foundingEntitled(number);
}

function numberOf(raw) {
  const n = Number(raw);
  return foundingEntitled(n) ? n : null;
}

export async function readFoundingNumber(command, email) {
  const key = foundingMemberKey(email);
  if (!key) return null;
  return numberOf(await command(["GET", key]));
}

export async function readFoundingCount(command) {
  const n = Number(await command(["GET", FOUNDING_COUNT_KEY])) || 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(FOUNDING_CAP, Math.floor(n));
}

/**
 * Give this email the next number, or the number it already has.
 * INCR then SET NX keeps two callers from taking the same spot, and a repeat
 * call does not advance the counter.
 */
export async function assignFoundingMember(command, email) {
  const key = foundingMemberKey(email);
  if (!key) return { ok: false, reason: "bad" };
  const existing = await readFoundingNumber(command, email);
  if (existing) return { ok: true, number: existing, already: true };
  const n = Number(await command(["INCR", FOUNDING_COUNT_KEY]));
  if (!Number.isInteger(n) || n > FOUNDING_CAP) {
    await command(["INCRBY", FOUNDING_COUNT_KEY, "-1"]);
    return { ok: false, reason: "full" };
  }
  const claimed = await command(["SET", key, String(n), "NX"]);
  if (!claimed) {
    await command(["INCRBY", FOUNDING_COUNT_KEY, "-1"]);
    const again = await readFoundingNumber(command, email);
    if (again) return { ok: true, number: again, already: true };
    return { ok: false, reason: "full" };
  }
  return { ok: true, number: n, already: false };
}

function timeOf(value) {
  const n = Date.parse(value || "");
  return Number.isFinite(n) ? n : null;
}

/**
 * People already let in, oldest first. An account's createdAt is when they
 * first signed in. A waitlist approval time is when they were let in before
 * they had an account. Someone with neither time sorts after those with one.
 * Excluded addresses (Tony's own accounts) are not numbered. They are passed
 * in by the operator and are not stored in the repository.
 */
export function foundingBackfillOrder(people, exclude = []) {
  const skip = new Set(exclude.map((email) => foundingEmail(email)).filter(Boolean));
  const byEmail = new Map();
  for (const person of people) {
    const email = foundingEmail(person?.email);
    if (!email || skip.has(email)) continue;
    const at = timeOf(person.at);
    const prior = byEmail.get(email);
    if (!prior) {
      byEmail.set(email, { email, at });
      continue;
    }
    if (at != null && (prior.at == null || at < prior.at)) prior.at = at;
  }
  return [...byEmail.values()].sort((a, b) => {
    if (a.at == null && b.at == null) return a.email.localeCompare(b.email);
    if (a.at == null) return 1;
    if (b.at == null) return -1;
    if (a.at !== b.at) return a.at - b.at;
    return a.email.localeCompare(b.email);
  });
}

export async function backfillFoundingMembers(command, people, exclude = []) {
  const ordered = foundingBackfillOrder(people, exclude);
  const assigned = [];
  for (const person of ordered) {
    const result = await assignFoundingMember(command, person.email);
    assigned.push({ email: person.email, ...result });
  }
  return assigned;
}
