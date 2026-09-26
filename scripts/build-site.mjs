#!/usr/bin/env node
/**
 * Build the public onboarding site from its one source, site/page.html.
 *
 * site/page.html is a page body (title, styles, markup, script) with no document skeleton, so the
 * same file publishes as a Claude artifact unchanged. This wraps it into a full document with the
 * link-preview tags a shared URL needs, and writes _site/index.html, which Vercel serves.
 *
 *   node scripts/build-site.mjs        # writes _site/index.html
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
// The page's own address. Vercel also serves it at grill-by-hold.vercel.app; this says which is canonical.
const SITE_URL = "https://grillyour.ai/";
const DESCRIPTION =
  "A second opinion on your decisions, from a different AI company than the one you think with. Starts from Claude, ChatGPT, Copilot, Gemini, Grok or Muse.";
// The verdict scale's dot, ink on paper, inverted when the device is dark.
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><style>circle{fill:#1c1b19}" +
      "@media (prefers-color-scheme:dark){circle{fill:#ece7df}}</style><circle cx='16' cy='16' r='9'/></svg>",
  );

const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="color-scheme" content="light dark">',
  '<meta name="theme-color" content="#f7f4ef" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#161513" media="(prefers-color-scheme: dark)">',
  `<link rel="icon" href="${FAVICON}">`,
  `<meta name="description" content="${DESCRIPTION}">`,
  `<link rel="canonical" href="${SITE_URL}">`,
  `<meta property="og:url" content="${SITE_URL}">`,
  '<meta property="og:title" content="Grill">',
  `<meta property="og:description" content="${DESCRIPTION}">`,
  '<meta property="og:type" content="website">',
  '<meta name="twitter:card" content="summary">',
  "<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>",
].join("\n");

// The page opens with its <title>, font links and <style>; those belong in <head>, where link
// previews and search engines read them. Everything after the first </style> is the body.
const cut = page.indexOf("</style>");
if (cut === -1) throw new Error("site/page.html must open with its <title>, links and <style>");
const pageHead = page.slice(0, cut + "</style>".length);
const pageBody = page.slice(cut + "</style>".length);

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "index.html"),
  `<!doctype html>\n<html lang="en">\n<head>\n${head}\n${pageHead}\n</head>\n<body>${pageBody}\n</body>\n</html>\n`,
);
console.log("built _site/index.html");
