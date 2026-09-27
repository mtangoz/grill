// Decides whether a pull request is low risk enough for GitHub to squash-merge it
// once required checks pass. Pure: no network, no git, no token. The workflow
// passes in the author, labels, and changed-file list from the API.

export const COMMENT_MARKER = "<!-- grill-automerge -->";
const BOT_LOGIN = "github-actions[bot]";

const CONFIG_KEYS = [
  "authors",
  "authorFamilies",
  "maxChangedLines",
  "maxFiles",
  "highChangedLines",
  "grillSkipChangedLines",
  "grillSkipDiffChars",
  "diffCharBudget",
  "blockingLabels",
  "automergeLabel",
  "needsReviewLabel",
  "grillSolidLabel",
  "safePaths",
  "additionsOnly",
  "denyPaths",
  "denySubstrings",
  "denyPageBasenames",
  "highPaths",
  "highSubstrings",
  "highPageBasenames",
];

function expectStringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item === "")) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return [...value];
}

function expectPositiveInt(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function expectLabel(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${name} must be a simple label name`);
  }
  return value;
}

function expectAuthorFamilies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("authorFamilies must be an object");
  const out = {};
  const seen = new Map();
  for (const [login, family] of Object.entries(value)) {
    if (!/^[A-Za-z0-9-]+(\[bot\])?$/.test(login)) throw new Error(`authorFamilies key is not a GitHub login: ${login}`);
    if (typeof family !== "string") throw new Error(`authorFamilies.${login} must be a string`);
    const normalized = family.trim().toLowerCase();
    if (normalized !== "" && !/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
      throw new Error(`authorFamilies.${login} is not a model family`);
    }
    const fold = login.toLowerCase();
    if (seen.has(fold)) throw new Error(`authorFamilies lists ${login} twice`);
    seen.set(fold, login);
    out[login] = normalized;
  }
  return Object.freeze(out);
}

/** Validate `.github/automerge.json`. Throws if the policy file is unusable. */
export function loadConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("automerge config must be an object");
  for (const key of CONFIG_KEYS) {
    if (raw[key] === undefined) throw new Error(`automerge config is missing ${key}`);
  }
  const authors = expectStringArray(raw.authors, "authors");
  if (authors.length === 0) throw new Error("authors must not be empty");
  for (const author of authors) {
    if (!/^[A-Za-z0-9-]+(\[bot\])?$/.test(author)) throw new Error(`author is not a GitHub login: ${author}`);
  }
  const automergeLabel = expectLabel(raw.automergeLabel, "automergeLabel");
  const needsReviewLabel = expectLabel(raw.needsReviewLabel, "needsReviewLabel");
  const grillSolidLabel = expectLabel(raw.grillSolidLabel, "grillSolidLabel");
  const blockingLabels = expectStringArray(raw.blockingLabels, "blockingLabels");
  if (!blockingLabels.some((label) => sameText(label, needsReviewLabel))) {
    throw new Error("needsReviewLabel must be one of blockingLabels, so a shaky grill blocks auto-merge");
  }
  if (blockingLabels.some((label) => sameText(label, grillSolidLabel)) || sameText(grillSolidLabel, automergeLabel)) {
    throw new Error("grillSolidLabel must not block auto-merge and must not be the automerge label");
  }
  const maxChangedLines = expectPositiveInt(raw.maxChangedLines, "maxChangedLines");
  const highChangedLines = expectPositiveInt(raw.highChangedLines, "highChangedLines");
  const grillSkipChangedLines = expectPositiveInt(raw.grillSkipChangedLines, "grillSkipChangedLines");
  if (grillSkipChangedLines <= highChangedLines) {
    throw new Error("grillSkipChangedLines must be greater than highChangedLines");
  }
  const diffCharBudget = expectPositiveInt(raw.diffCharBudget, "diffCharBudget");
  const grillSkipDiffChars = expectPositiveInt(raw.grillSkipDiffChars, "grillSkipDiffChars");
  if (grillSkipDiffChars <= diffCharBudget) {
    throw new Error("grillSkipDiffChars must be greater than diffCharBudget");
  }
  return Object.freeze({
    authors,
    authorFamilies: expectAuthorFamilies(raw.authorFamilies),
    maxChangedLines,
    maxFiles: expectPositiveInt(raw.maxFiles, "maxFiles"),
    highChangedLines,
    grillSkipChangedLines,
    grillSkipDiffChars,
    diffCharBudget,
    blockingLabels,
    automergeLabel,
    needsReviewLabel,
    grillSolidLabel,
    safePaths: expectStringArray(raw.safePaths, "safePaths"),
    additionsOnly: expectStringArray(raw.additionsOnly, "additionsOnly"),
    denyPaths: expectStringArray(raw.denyPaths, "denyPaths"),
    denySubstrings: expectStringArray(raw.denySubstrings, "denySubstrings"),
    denyPageBasenames: expectStringArray(raw.denyPageBasenames, "denyPageBasenames").map((name) => name.toLowerCase()),
    highPaths: expectStringArray(raw.highPaths, "highPaths"),
    highSubstrings: expectStringArray(raw.highSubstrings, "highSubstrings"),
    highPageBasenames: expectStringArray(raw.highPageBasenames, "highPageBasenames").map((name) => name.toLowerCase()),
  });
}

function globToRegExp(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
      continue;
    }
    if (pattern.startsWith("**", i)) {
      re += ".*";
      i += 1;
      continue;
    }
    if (pattern[i] === "*") {
      re += "[^/]*";
      continue;
    }
    const ch = pattern[i];
    re += "\\^$+?.()|{}[]".includes(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${re}$`);
}

/** Case-insensitive glob. `**` crosses directories; a single `*` stays inside one path segment. */
export function matchGlob(pattern, filePath) {
  return globToRegExp(String(pattern).toLowerCase()).test(String(filePath).toLowerCase());
}

function isNormalRelative(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 2000) return false;
  if (filePath.startsWith("/") || filePath.startsWith("\\") || /^[a-zA-Z]:/.test(filePath)) return false;
  if (filePath.includes("\\") || filePath.includes("\0")) return false;
  return filePath.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function lineCount(file) {
  const additions = Number(file?.additions);
  const deletions = Number(file?.deletions);
  if (!Number.isInteger(additions) || !Number.isInteger(deletions) || additions < 0 || deletions < 0) return null;
  return additions + deletions;
}

function substringHit(filePath, config) {
  const lower = filePath.toLowerCase();
  return config.denySubstrings.find((needle) => lower.includes(needle.toLowerCase())) ?? null;
}

function isNamedPage(filePath, basenames) {
  const parts = filePath.split("/");
  const base = parts[parts.length - 1];
  const stem = base.replace(/\.[^.]+$/, "").toLowerCase();
  if (basenames.includes(stem)) return true;
  return parts.slice(0, -1).some((part) => basenames.includes(part.toLowerCase()));
}

/**
 * Why this path cannot be in a low-risk diff, or null when it is safe.
 * Denies run first, so `docs/PRIVACY.md` stays blocked even though `docs/**` is safe.
 * Additions-only patterns run before the general safe list, so an edit under
 * `evals/cases/**` is blocked even though that tree is also listed as safe.
 */
function pathProblem(filePath, status, config) {
  if (!isNormalRelative(filePath)) return `Path ${JSON.stringify(filePath)} is not a normal relative path.`;
  const needle = substringHit(filePath, config);
  if (needle) return `${filePath} is denied because the path contains "${needle}".`;
  for (const pattern of config.denyPaths) {
    if (matchGlob(pattern, filePath)) return `${filePath} is denied because it matches ${pattern}.`;
  }
  if (isNamedPage(filePath, config.denyPageBasenames)) return `${filePath} is denied because it is a terms or privacy page.`;
  for (const pattern of config.additionsOnly) {
    if (matchGlob(pattern, filePath)) {
      if (status !== "added") {
        return `${filePath} is denied because only additions are allowed under ${pattern} (this change is ${status || "unknown"}).`;
      }
      return null;
    }
  }
  for (const pattern of config.safePaths) {
    if (matchGlob(pattern, filePath)) return null;
  }
  return `${filePath} is not on the safe path list.`;
}

function sameText(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Model family passed to `judge.mjs --author` for this login.
 * An empty string means omit `--author`, which keeps the default Auto Router
 * exclusion (Anthropic). Unknown logins also get the default.
 */
export function authorFamily(author, config) {
  const login = typeof author === "string" ? author : "";
  const match = Object.keys(config.authorFamilies).find((key) => sameText(key, login));
  return match === undefined ? "" : config.authorFamilies[match];
}

/** Why this path is high risk, or null. Independent of the low-risk denylist. */
function highPathMessage(filePath, config) {
  if (!isNormalRelative(filePath)) return null;
  const lower = filePath.toLowerCase();
  const needle = config.highSubstrings.find((item) => lower.includes(item.toLowerCase()));
  if (needle) return `${filePath} is high risk because the path contains "${needle}".`;
  for (const pattern of config.highPaths) {
    if (matchGlob(pattern, filePath)) return `${filePath} is high risk because it matches ${pattern}.`;
  }
  if (isNamedPage(filePath, config.highPageBasenames)) return `${filePath} is high risk because it is a terms or privacy page.`;
  return null;
}

/**
 * @param {{draft: boolean, author: string, labels: string[], files: Array<{path: string, previousPath?: string|null, status: string, additions: number, deletions: number}>}} pr
 * @param {ReturnType<typeof loadConfig>} config
 */
export function classify(pr, config) {
  const failures = [];
  const author = typeof pr?.author === "string" ? pr.author : "";
  if (pr?.draft !== false) failures.push({ rule: "draft", message: "It is a draft." });
  if (!author || !config.authors.some((allowed) => sameText(allowed, author))) {
    failures.push({
      rule: "author",
      message: author ? `Author ${author} is not allowlisted.` : "Author is missing.",
    });
  }
  const labels = Array.isArray(pr?.labels) ? pr.labels.map((label) => String(label)) : null;
  if (!labels) {
    failures.push({ rule: "labels", message: "Labels are missing, so this pull request is not treated as low risk." });
  } else {
    for (const blocked of config.blockingLabels) {
      if (labels.some((label) => sameText(label, blocked))) {
        failures.push({ rule: "label", message: `It has the ${blocked} label.` });
      }
    }
  }

  const files = Array.isArray(pr?.files) ? pr.files : null;
  let changedLines = 0;
  const paths = [];
  const highReasons = [];
  let lineCountKnown = false;
  if (!files) {
    failures.push({ rule: "files", message: "The changed-file list is missing, so this pull request is not treated as low risk." });
  } else {
    if (files.length > config.maxFiles) {
      failures.push({
        rule: "size-files",
        message: `It changes ${files.length} files, above the ${config.maxFiles} file cap.`,
      });
    }
    let missingLineCount = false;
    for (const file of files) {
      if (typeof file?.path === "string") paths.push(file.path);
      const lines = lineCount(file);
      if (lines === null) missingLineCount = true;
      else changedLines += lines;
      const status = typeof file?.status === "string" ? file.status : "";
      const touched = [];
      if (typeof file?.path === "string") touched.push(file.path);
      if (typeof file?.previousPath === "string" && file.previousPath) touched.push(file.previousPath);
      if (touched.length === 0) touched.push(file?.path);
      for (const filePath of touched) {
        const problem = pathProblem(filePath, status, config);
        if (problem) failures.push({ rule: "path", message: problem });
        const high = highPathMessage(filePath, config);
        if (high) highReasons.push({ rule: "high-path", message: high });
      }
    }
    if (missingLineCount) {
      failures.push({ rule: "size-lines", message: "A changed file is missing a line count, so the diff is over the cap." });
    } else {
      lineCountKnown = true;
      if (changedLines > config.maxChangedLines) {
        failures.push({
          rule: "size-lines",
          message: `It changes ${changedLines} lines, above the ${config.maxChangedLines} line cap.`,
        });
      }
      if (changedLines > config.highChangedLines) {
        highReasons.push({
          rule: "high-size",
          message: `It changes ${changedLines} lines, above the ${config.highChangedLines} line high-risk mark.`,
        });
      }
    }
  }

  const tier = highReasons.length > 0 ? "high" : failures.length === 0 ? "low" : "medium";
  return {
    lowRisk: tier === "low",
    tier,
    failures,
    highReasons,
    enormous: lineCountKnown && changedLines > config.grillSkipChangedLines,
    author,
    authorFamily: authorFamily(author, config),
    files: files ? files.length : 0,
    changedLines: files ? changedLines : 0,
    paths,
  };
}

function countPhrase(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The one status comment. Starts with COMMENT_MARKER so a later run can update it. */
export function commentBody(result) {
  if (result.lowRisk) {
    const size = `${countPhrase(result.files, "file", "files")} and ${countPhrase(result.changedLines, "changed line", "changed lines")}`;
    const where = result.paths.length ? `all on the safe list (${result.paths.join(", ")})` : "no files changed";
    return [
      COMMENT_MARKER,
      `Auto-merge is on. This pull request is low risk: ${result.author} is allowlisted, it is not a draft, it has no do-not-merge or needs-review label, and the diff is ${size}, ${where}. GitHub will squash-merge it after the required checks pass.`,
      "Add the do-not-merge label to stop it, or needs-review to ask for a review.",
    ].join("\n\n");
  }
  const reasons = result.failures.length > 0 ? result.failures : (result.highReasons ?? []);
  const shown = reasons.slice(0, 30).map((failure) => `- ${failure.message}`);
  const extra = reasons.length - shown.length;
  if (extra > 0) shown.push(`- and ${extra} more.`);
  return [
    COMMENT_MARKER,
    "Auto-merge is off. This pull request is not low risk:",
    shown.join("\n"),
    "The automerge label is removed and GitHub auto-merge is disabled.",
  ].join("\n\n");
}

/** What the workflow should enforce. Risky pull requests always disarm auto-merge. */
export function actionsFor(result) {
  return {
    addLabel: result.lowRisk,
    removeLabel: !result.lowRisk,
    enableAutoMerge: result.lowRisk,
    disableAutoMerge: !result.lowRisk,
    commentBody: commentBody(result),
  };
}

/**
 * Keep a single bot comment. Identical text is left alone so a re-run does not notify again.
 * @param {Array<{id: number, body: string, userLogin: string}>} comments
 */
export function commentPlan(comments, body, botLogin = BOT_LOGIN, marker = COMMENT_MARKER) {
  const matches = [];
  for (const comment of comments ?? []) {
    if (!comment || typeof comment.body !== "string" || comment.userLogin !== botLogin) continue;
    if (!comment.body.includes(marker)) continue;
    matches.push(comment);
  }
  if (matches.length === 0) return { create: body, updateId: null, deleteIds: [] };
  const [keep, ...dupes] = matches;
  return {
    create: null,
    updateId: keep.body === body ? null : keep.id,
    deleteIds: dupes.map((comment) => comment.id),
  };
}
