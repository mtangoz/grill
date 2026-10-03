/**
 * Where the judge finds its model router key, and the one place that writes it.
 *
 * ORDER. GRILL_API_KEY, then OPENROUTER_API_KEY, then the key file. The first non-empty value
 * wins. An unfilled install-dialog placeholder arrives as literal `${…}` text; that is no key.
 *
 * WHY A KEY FILE. A key kept only in a project's `.env` is lost whenever that file is rewritten
 * (`vercel env pull`, a fresh clone, a new worktree, a tidy-up), and OpenRouter shows a key once,
 * at creation. The places a team keeps the "real" copy, such as a CI secret, are write-only, so
 * nothing can read it back. The key file lives in the user's config directory, outside every
 * repository, so no project tooling touches it:
 *
 *   $GRILL_KEY_FILE, else $XDG_CONFIG_HOME/grill/key, else ~/.config/grill/key
 *
 * `node scripts/judge.mjs --set-key` reads a key from stdin and writes that file with mode 0600
 * in a 0700 directory. The key never goes on a command line, where shell history and `ps` would
 * keep it. Nothing here prints a key: status lines name the source and the last four characters.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The key file's path. Nothing is read or created here. */
export function keyFilePath(env = process.env) {
  if (typeof env.GRILL_KEY_FILE === "string" && env.GRILL_KEY_FILE.trim()) return env.GRILL_KEY_FILE.trim();
  const base = typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME.trim()
    : join(homedir(), ".config");
  return join(base, "grill", "key");
}

function usable(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value && !value.startsWith("${") ? value : "";
}

/**
 * The key and where it came from: `{ key, source }`, with `key` "" and `source` null when there
 * is none. `warning` is set when the key file can be read by other users.
 */
export function resolveApiKey(env = process.env) {
  for (const name of ["GRILL_API_KEY", "OPENROUTER_API_KEY"]) {
    const key = usable(env[name]);
    if (key) return { key, source: name };
  }
  const path = keyFilePath(env);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { key: "", source: null };
  }
  const key = usable(text.split(/\r?\n/).find((line) => line.trim()) ?? "");
  if (!key) return { key: "", source: null };
  let warning = null;
  try {
    if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
      warning = `${path} can be read by other users on this machine. Run: chmod 600 "${path}"`;
    }
  } catch {
    // stat failing right after a read is not worth refusing a run over
  }
  return { key, source: path, warning };
}

/** A key, shown safely: its last four characters only. */
export function maskKey(key) {
  return key.length > 8 ? `…${key.slice(-4)}` : "…";
}

/** Write `key` to the key file: 0600, in a 0700 directory. Returns the path. */
export function saveApiKey(key, env = process.env) {
  const value = usable(key);
  if (!value) throw new Error("no key given");
  if (/\s/.test(value)) throw new Error("a key has no spaces or line breaks; paste only the key");
  const path = keyFilePath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Never write the key into the existing file: if it was readable by others, a reader could
  // catch the new key before a chmod. Create a fresh 0600 file (O_EXCL, so not someone else's)
  // and rename it over the old one. The rename is atomic and gives the key a new inode, so a
  // descriptor opened on the old, loose file never sees it.
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${value}\n`, { mode: 0o600, flag: "wx" });
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return path;
}
