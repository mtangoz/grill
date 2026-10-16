#!/usr/bin/env node
/**
 * Build the public onboarding site. The home page's one source is site/page.html; the other pages
 * (terms, contribute, look-back, privacy) borrow its styles.
 *
 * site/page.html is a page body (title, styles, markup, script) with no document skeleton, so the
 * same file publishes as a Claude artifact unchanged. This wraps it into a full document with the
 * link-preview tags a shared URL needs, and writes _site/index.html, which Vercel serves.
 *
 *   node scripts/build-site.mjs        # writes _site/index.html
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { billingMode, couponId, starterAllowanceUsd } from "../api/_pro.mjs";
import { analyticsSnippet } from "./siteAnalytics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "_site");
// The page's own address. Vercel also serves it at grill-by-hold.vercel.app; this says which is canonical.
const SITE_URL = "https://grillyour.ai/";
const DESCRIPTION =
  "Get a second opinion before you decide. A different AI finds the weak spots in your plan, with a quick way to check each one. Works with ChatGPT, Claude, Gemini and more.";
// The pitchfork mark. Sizes are generated from the owner's logo into site/brand/ and copied to _site/brand/.
// Google's favicon service, which Claude's connector list uses for a custom connector's icon, only
// takes an icon whose size is a multiple of 48px, so the 192px one is declared too.
const ICONS = [
  '<link rel="icon" href="/favicon.ico" sizes="any">',
  '<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/brand/icon-192.png">',
  '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">',
];
const OG_IMAGE = `${SITE_URL}brand/og-image.png`;

// Cookieless page counts for the website only, plus PostHog when GRILL_POSTHOG_KEY is set (see
// scripts/siteAnalytics.mjs). Not added to site/page.html itself: that file is also published as a
// Claude artifact, and the Grill tool never loads this script.
const ANALYTICS = analyticsSnippet(process.env);

// The commit this deploy was built from. Vercel builds the site and the server functions from one
// commit, so this is also the code a Grill account in chat runs. Every footer names it, linked to
// the public source. A local build, or anything that isn't a full commit hash, shows nothing.
const LIVE_COMMIT = /^[0-9a-f]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "") ? process.env.VERCEL_GIT_COMMIT_SHA : "";
const MADE_AT = '<span>Made at <a href="https://hold.quest">Hold</a>';
const withLiveCommit = (body) =>
  LIVE_COMMIT
    ? body.replace(
        MADE_AT,
        `<span>Live commit <a href="https://github.com/mtangoz/grill/commit/${LIVE_COMMIT}">${LIVE_COMMIT.slice(0, 7)}</a> · Made at <a href="https://hold.quest">Hold</a>`,
      )
    : body;

const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
const headFor = ({ description, url }) => [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<meta name="color-scheme" content="light dark">',
  '<meta name="theme-color" content="#f7f4ef" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#161513" media="(prefers-color-scheme: dark)">',
  ...ICONS,
  `<meta name="description" content="${description}">`,
  `<link rel="canonical" href="${url}">`,
  `<meta property="og:url" content="${url}">`,
  '<meta property="og:title" content="Grill">',
  `<meta property="og:description" content="${description}">`,
  '<meta property="og:type" content="website">',
  `<meta property="og:image" content="${OG_IMAGE}">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="Grill: a pitchfork mark and the words A second opinion before you decide.">',
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:image" content="${OG_IMAGE}">`,
  "<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>",
].join("\n");

// The page opens with its <title>, font links and <style>; those belong in <head>, where link
// previews and search engines read them. Everything after the first </style> is the body.
const cut = page.indexOf("</style>");
if (cut === -1) throw new Error("site/page.html must open with its <title>, links and <style>");
const pageHead = page.slice(0, cut + "</style>".length);
const pageBody = page.slice(cut + "</style>".length);
const doc = (head, title, body) =>
  `<!doctype html>\n<html lang="en">\n<head>\n${head}\n${title}\n</head>\n<body>${withLiveCommit(body)}\n${ANALYTICS}\n</body>\n</html>\n`;

// The offer, the paywall and the launch-list form are build-time switches.
// GRILL_PRO_COUPON set means 50% off is on the page. GRILL_PRO_BILLING=subscription shows
// the paid plans. GRILL_PRO_NOTIFY=1 keeps the launch-list form and removes the starter-key
// button. Unset strips those attributes even if the source had them.
function notifyOn(env) {
  const value = typeof env.GRILL_PRO_NOTIFY === "string" ? env.GRILL_PRO_NOTIFY.trim().toLowerCase() : "";
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function stripClass(html, className) {
  const re = new RegExp(`\\n[ \\t]*<(div|p)\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>[\\s\\S]*?<\\/\\1>`);
  const next = html.replace(re, "");
  if (next === html) throw new Error(`site build could not find .${className}`);
  return next;
}

if (!/<main\b[^>]*\bid="top"/.test(pageBody)) throw new Error('site/page.html must contain <main id="top">');
let homeBody = pageBody;
const mainAttrs = ['id="top"'];
if (notifyOn(process.env)) mainAttrs.push("data-notify");
if (couponId(process.env)) mainAttrs.push("data-offer");
if (billingMode(process.env) === "subscription") mainAttrs.push('data-billing="subscription"');
homeBody = homeBody.replace(/<main\b[^>]*>/, `<main ${mainAttrs.join(" ")}>`);
const starterLabel = `$${starterAllowanceUsd(process.env).toFixed(2)}`;
homeBody = homeBody.replace(/(<span class="starter-amount">)[^<]*/, (match, open) => open + starterLabel);
if (notifyOn(process.env)) {
  homeBody = stripClass(homeBody, "starter");
  homeBody = stripClass(homeBody, "accounts-line");
} else {
  homeBody = stripClass(homeBody, "notify");
  homeBody = stripClass(homeBody, "notify-line");
}

mkdirSync(OUT, { recursive: true });
cpSync(join(ROOT, "site/brand"), join(OUT, "brand"), { recursive: true });
cpSync(join(ROOT, "site/brand/favicon.ico"), join(OUT, "favicon.ico"));
writeFileSync(join(OUT, "index.html"), doc(headFor({ description: DESCRIPTION, url: SITE_URL }), pageHead, homeBody));
// Every public page, for the sitemap. Google has to crawl the home page before its favicon service
// knows the icon; until then Claude shows a letter in place of the logo.
const pageUrls = [SITE_URL];

// Other pages are a <title> and a body; they borrow the main page's styles.
const style = pageHead.slice(pageHead.indexOf("<style>"));
function writePage(file, { description, url, outDir }) {
  const source = readFileSync(join(ROOT, "site", file), "utf8");
  const title = source.match(/^<title>[^<]*<\/title>/)?.[0];
  if (!title) throw new Error(`site/${file} must open with its <title>`);
  mkdirSync(join(OUT, outDir), { recursive: true });
  pageUrls.push(url);
  writeFileSync(
    join(OUT, outDir, "index.html"),
    doc(headFor({ description, url }), `${title}\n${style}`, source.slice(title.length)),
  );
}
writePage("terms.html", {
  description: "Grill Pro terms, in plain words.",
  url: `${SITE_URL}terms/`,
  outDir: "terms",
});
writePage("contribute.html", {
  description: "How to improve Grill.",
  url: `${SITE_URL}contribute/`,
  outDir: "contribute",
});
writePage("look-back.html", {
  description: "Turn a judge's answer into a decision record, and look back on how it turned out. Nothing is stored.",
  url: `${SITE_URL}look-back/`,
  outDir: "look-back",
});
writePage("privacy.html", {
  description: "What Grill sends, what it counts, and what it never keeps.",
  url: `${SITE_URL}privacy/`,
  outDir: "privacy",
});
// The miss page is built only when GRILL_MISS=1, the same switch that opens /miss/send. Its fields
// and its in-browser check come from scripts/missCore.mjs, the module the server checks with.
if (process.env.GRILL_MISS === "1") {
  const core = await import("./missCore.mjs");
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fields = Object.entries(core.MISS_CHOICES)
    .map(([key, values]) => {
      const options = values.map((v) => `      <option value="${v}">${esc(core.MISS_LABELS[key][v])}</option>`).join("\n");
      return `    <label for="miss-${key}">${esc(core.MISS_QUESTIONS[key])}</label>\n    <select id="miss-${key}" name="${key}" required>\n      <option value="">Choose one</option>\n${options}\n    </select>`;
    })
    .join("\n");
  const inlined = readFileSync(join(ROOT, "scripts/missCore.mjs"), "utf8").replace(/^export /gm, "");
  const source = readFileSync(join(ROOT, "site/miss.html"), "utf8")
    .replace("<!-- MISS_FIELDS -->", fields)
    .replace("/* MISS_CORE */", () => inlined);
  const title = source.match(/^<title>[^<]*<\/title>/)[0];
  mkdirSync(join(OUT, "miss"), { recursive: true });
  pageUrls.push(`${SITE_URL}miss/`);
  writeFileSync(
    join(OUT, "miss", "index.html"),
    doc(headFor({ description: "Share how AI got a decision wrong, without the decision.", url: `${SITE_URL}miss/` }), `${title}\n${style}`, source.slice(title.length)),
  );
}
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pageUrls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`,
);
console.log(`built _site/index.html and the terms, contribute, look-back and privacy pages${process.env.GRILL_MISS === "1" ? " and _site/miss/index.html" : ""}`);
