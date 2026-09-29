/**
 * Bake RELEASE_DATE into a built copy of server/index.mjs.
 *
 * The server reads that constant. It does not look up a release, call the network, or write a
 * file. Release and bundle builds call stampReleaseDateFile on the artifact only, never on the
 * checkout. GRILL_RELEASE_DATE overrides the UTC day of the build.
 */
import { readFileSync, writeFileSync } from "node:fs";

const RELEASE_DATE_LINE = /^export const RELEASE_DATE = "[^"]*";$/m;

export function releaseDateForBuild(env = process.env, now = new Date()) {
  const raw = typeof env.GRILL_RELEASE_DATE === "string" ? env.GRILL_RELEASE_DATE.trim() : "";
  return raw || now.toISOString().slice(0, 10);
}

export function stampReleaseDate(source, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`RELEASE_DATE must be YYYY-MM-DD, got ${JSON.stringify(date)}`);
  const [year, month, day] = date.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    throw new Error(`RELEASE_DATE is not a calendar day: ${date}`);
  }
  if (!RELEASE_DATE_LINE.test(source)) throw new Error("RELEASE_DATE constant not found");
  return source.replace(RELEASE_DATE_LINE, `export const RELEASE_DATE = "${date}";`);
}

/** Rewrite RELEASE_DATE in a built file. Leaves the text alone when the date is already that day. */
export function stampReleaseDateFile(path, date = releaseDateForBuild()) {
  const source = readFileSync(path, "utf8");
  const next = stampReleaseDate(source, date);
  if (next !== source) writeFileSync(path, next);
}
