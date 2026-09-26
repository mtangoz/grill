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
import { couponId } from "../api/_pro.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
// The page's own address. Vercel also serves it at grill-by-hold.vercel.app; this says which is canonical.
const SITE_URL = "https://grillyour.ai/";
const DESCRIPTION =
  "Get a second opinion before you decide. A different AI finds the weak spots in your plan, with a quick way to check each one. Works with ChatGPT, Claude, Gemini and more.";
// The verdict scale's dot, ink on paper, inverted when the device is dark.
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><style>circle{fill:#1c1b19}" +
      "@media (prefers-color-scheme:dark){circle{fill:#ece7df}}</style><circle cx='16' cy='16' r='9'/></svg>",
  );

// Cookieless page counts for the website only. Not added to site/page.html itself: that file is also
// published as a Claude artifact, and the Grill tool never loads this script.
const ANALYTICS = `<script>
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
</script>
<script defer src="/_vercel/insights/script.js"></script>`;

const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
const headFor = ({ description, url }) => [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="color-scheme" content="light dark">',
  '<meta name="theme-color" content="#f7f4ef" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#161513" media="(prefers-color-scheme: dark)">',
  `<link rel="icon" href="${FAVICON}">`,
  `<meta name="description" content="${description}">`,
  `<link rel="canonical" href="${url}">`,
  `<meta property="og:url" content="${url}">`,
  '<meta property="og:title" content="Grill">',
  `<meta property="og:description" content="${description}">`,
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
const doc = (head, title, body) =>
  `<!doctype html>\n<html lang="en">\n<head>\n${head}\n${title}\n</head>\n<body>${body}\n${ANALYTICS}\n</body>\n</html>\n`;

// The offer is the same switch as checkout: GRILL_PRO_COUPON set means 50% off is on the page.
// Unset strips the attribute even if the source had it, so a redeploy is what ends early access.
let homeBody = pageBody.replace('<main id="top" data-offer>', '<main id="top">');
if (couponId(process.env)) {
  if (!homeBody.includes('<main id="top">')) throw new Error('site/page.html must contain <main id="top">');
  homeBody = homeBody.replace('<main id="top">', '<main id="top" data-offer>');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.html"), doc(headFor({ description: DESCRIPTION, url: SITE_URL }), pageHead, homeBody));

// Other pages (site/terms.html) are a <title> and a body; they borrow the main page's styles.
const style = pageHead.slice(pageHead.indexOf("<style>"));
const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");
const termsTitle = terms.match(/^<title>[^<]*<\/title>/)?.[0];
if (!termsTitle) throw new Error("site/terms.html must open with its <title>");
mkdirSync(join(OUT, "terms"), { recursive: true });
writeFileSync(
  join(OUT, "terms", "index.html"),
  doc(headFor({ description: "Grill Pro terms, in plain words.", url: `${SITE_URL}terms/` }), `${termsTitle}\n${style}`, terms.slice(termsTitle.length)),
);
console.log("built _site/index.html and _site/terms/index.html");
