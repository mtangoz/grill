#!/usr/bin/env node
/**
 * Build the public onboarding site from its one source, site/page.html.
 *
 * site/page.html is a page body (title, styles, markup, script) with no document skeleton, so the
 * same file publishes as a Claude artifact unchanged. This wraps it into a full document with the
 * link-preview tags a shared URL needs, and writes _site/index.html for GitHub Pages.
 *
 *   node scripts/build-site.mjs        # writes _site/index.html
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
const DESCRIPTION =
  "A second opinion on your decisions, from an AI that isn't Claude. Set up Grill in Claude chat in two minutes.";

const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  `<meta name="description" content="${DESCRIPTION}">`,
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
