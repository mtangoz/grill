// The onboarding site: one source (site/page.html), published as a Claude artifact as-is and
// on Vercel through scripts/build-site.mjs (every push to main redeploys). These pin what makes both work.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(ROOT, "site/page.html"), "utf8");

describe("site/page.html", () => {
  it("is a body with no document skeleton, so it publishes as an artifact unchanged", () => {
    assert.doesNotMatch(page, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
    assert.match(page.slice(0, 8192), /<title>Grill<\/title>/);
  });

  it("links every setup route the README promises", () => {
    for (const needle of ["releases/latest/download/grill.mcpb", "releases/latest/download/grill-skill.zip", "/plugin install grill@grill", "openrouter.ai/keys", "prompts/grill.md"]) {
      assert.ok(page.includes(needle), `missing ${needle}`);
    }
  });

  it("names every assistant people start from, and pairs Copilot only with a company it can't run", () => {
    for (const name of ["Claude", "ChatGPT", "Copilot", "Gemini", "Grok", "Muse"]) {
      assert.ok(page.includes(`<td>${name}`), `no row for ${name}`);
    }
    assert.match(page, /<td>Copilot<\/td><td>Gemini\b(?![^<]*(Claude|ChatGPT|Grok))/);
  });

  it("is open: the free routes are on the page, and the invite wall is gone", () => {
    assert.doesNotMatch(page, /prerelease|Ask for an invite|Opening to everyone|only-pre|only-public/);
    assert.match(page, /<main id="top">/);
    assert.match(page, /github\.com\/mtangoz\/grill#set-up/);
    const setupAt = page.indexOf('id="setup"');
    const proAt = page.indexOf('id="pro"');
    assert.ok(setupAt > 0 && proAt > setupAt, "the free routes come before Pro");
  });

  it("shows full-price Pro unless the build turns the early-access offer on", () => {
    assert.match(page, /main:not\(\[data-offer\]\) \.offer \{ display: none; \}/);
    assert.match(page, /main\[data-offer\] \.no-offer \{ display: none; \}/);
    assert.doesNotMatch(page, /<main[^>]*\bdata-offer\b/);
    const pro = page.match(/<section id="pro">([\s\S]*?)<\/section>/)?.[1];
    assert.ok(pro, "the Pro section exists");
    assert.match(pro, /Early access: 50% off Pro for life/);
    assert.match(pro, /\$4\.50 a month/);
    assert.match(pro, /\$45 a year/);
    assert.match(pro, /starter-amount">\$0\.50</);
    assert.match(pro, /No card/);
    assert.match(pro, /does not refill/);
    assert.match(pro, /unlimited checks/);
    assert.match(page, /main:not\(\[data-billing="subscription"\]\) \.paywall \{ display: none; \}/);
    assert.doesNotMatch(page, /<main[^>]*\bdata-billing\b/);
    const buy = [...pro.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    assert.deepEqual(buy, [
      "/pro",
      "https://grillyour.ai/checkout?plan=month",
      "https://grillyour.ai/checkout?plan=year",
      "https://grillyour.ai/checkout?plan=month",
      "https://grillyour.ai/checkout?plan=year",
      "/pro",
      "/terms/",
    ]);
  });

  it("says the website counts visits anonymously, and the tool does not", () => {
    const sentence = "This website counts visits anonymously, with no cookies and nothing that identifies you. The Grill tool itself never tracks you.";
    assert.ok(page.includes(sentence));
    assert.ok(readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8").includes(sentence));
    assert.ok(readFileSync(join(ROOT, "README.md"), "utf8").includes(sentence));
  });

  it("defines its colours as tokens for light, dark-by-system and dark-by-choice", () => {
    assert.match(page, /:root \{[\s\S]*--paper:/);
    assert.match(page, /@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme="light"\]\)/);
    assert.match(page, /:root\[data-theme="dark"\]/);
  });
});

describe("the terms page", () => {
  const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");

  it("says what the code does: the allowance, the prices, cancelling and refunds", async () => {
    const { DEFAULT_LIMIT_USD } = await import("../api/_pro.mjs");
    assert.match(terms, new RegExp(`up to \\$${DEFAULT_LIMIT_USD} of AI time a month`));
    assert.match(terms, /\$9 a month or \$90 a year/);
    assert.match(page, /Grill Pro is \$9 a month/);
    assert.match(terms, /cancel anytime/);
    assert.match(terms, /within 30 days of your first payment/);
    assert.match(terms, /\$0\.50 of judge spend/);
    assert.match(terms, /No card/);
    assert.match(terms, /mailto:support@grillyour\.ai/);
    assert.doesNotMatch(terms, /hello@/);
    assert.doesNotMatch(page, /hello@/);
    assert.doesNotMatch(readFileSync(join(ROOT, "README.md"), "utf8"), /hello@/);
    assert.doesNotMatch(readFileSync(join(ROOT, "SECURITY.md"), "utf8"), /hello@/);
    assert.doesNotMatch(readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8"), /hello@/);
    assert.ok(!terms.includes("—"), "no em dashes");
    assert.ok(!page.includes("—"), "no em dashes");
  });
});

describe("the site build", () => {
  it("wraps the page into a full document, with its title and styles in the head", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const html = readFileSync(join(ROOT, "_site/index.html"), "utf8");
    const [head, rest] = html.split("</head>");
    assert.match(html, /^<!doctype html>/);
    assert.match(head, /<title>Grill<\/title>/);
    assert.match(head, /<meta property="og:title" content="Grill">/);
    assert.match(head, /<link rel="canonical" href="https:\/\/grillyour\.ai\/">/);
    assert.match(head, /<meta name="color-scheme" content="light dark">/);
    assert.match(head, /<meta name="theme-color" content="#f7f4ef" media="\(prefers-color-scheme: light\)">/);
    assert.match(head, /<meta name="theme-color" content="#161513" media="\(prefers-color-scheme: dark\)">/);
    assert.match(head, /--paper:/);
    assert.match(rest, /<body>[\s\S]*id="setup"/);
    const terms = readFileSync(join(ROOT, "_site/terms/index.html"), "utf8");
    assert.match(terms, /<title>Grill Pro terms<\/title>/);
    assert.match(terms, /<link rel="canonical" href="https:\/\/grillyour\.ai\/terms\/">/);
    assert.match(terms, /--paper:/, "the terms page borrows the site's styles");
    const snippet = '<script defer src="/_vercel/insights/script.js"></script>';
    assert.ok(html.includes("window.va"), "the home page counts visits");
    assert.ok(html.includes(snippet));
    assert.ok(terms.includes(snippet), "the terms page counts visits");
    assert.ok(!page.includes(snippet), "the artifact source does not count visits");
    assert.ok(!readFileSync(join(ROOT, "site/terms.html"), "utf8").includes(snippet));
    for (const f of ["server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/build-extension.mjs"]) {
      assert.ok(!readFileSync(join(ROOT, f), "utf8").includes("_vercel/insights"), `${f} must not load website analytics`);
    }
  });

  it("the early-access offer is on only when GRILL_PRO_COUPON is set at build time", () => {
    const build = (coupon) => {
      const env = { ...process.env };
      delete env.GRILL_PRO_BILLING;
      if (coupon) env.GRILL_PRO_COUPON = coupon;
      else delete env.GRILL_PRO_COUPON;
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env });
      return readFileSync(join(ROOT, "_site/index.html"), "utf8");
    };
    const off = build("");
    assert.match(off, /<main id="top">/);
    assert.doesNotMatch(off, /<main id="top" data-offer>/);
    const on = build("early50");
    assert.match(on, /<main id="top" data-offer>/);
    // A value that isn't a coupon id is the same as unset: full price, no offer.
    const junk = build("not a coupon");
    assert.doesNotMatch(junk, /<main id="top" data-offer>/);
  });

  it("the paywall is on only when GRILL_PRO_BILLING=subscription at build time", () => {
    const build = (extra) => {
      const env = { ...process.env, ...extra };
      delete env.GRILL_PRO_COUPON;
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env });
      return readFileSync(join(ROOT, "_site/index.html"), "utf8");
    };
    const off = build({ GRILL_PRO_BILLING: "" });
    assert.match(off, /<main id="top">/);
    assert.doesNotMatch(off, /<main[^>]*data-billing/);
    assert.match(off, /starter-amount">\$0\.50</);
    const on = build({ GRILL_PRO_BILLING: "subscription" });
    assert.match(on, /<main id="top" data-billing="subscription">/);
    const ignored = build({ GRILL_PRO_BILLING: "yes" });
    assert.doesNotMatch(ignored, /<main[^>]*data-billing/);
    const custom = build({ GRILL_STARTER_ALLOWANCE_USD: "1.25" });
    assert.match(custom, /starter-amount">\$1\.25</);
  });
});
