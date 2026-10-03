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
    assert.match(page, /<main id="top" data-notify>/);
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
    assert.match(pro, /action="\/notify"/);
    assert.match(pro, /name="via" value="site"/);
    assert.match(pro, /name="leave_blank"/);
    assert.match(pro, /Notify me/);
    assert.match(pro, /Coming later: saved history and look-back reminders/);
    assert.match(page, /main\[data-notify\] \.starter/);
    const buy = [...pro.matchAll(/<a[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    assert.deepEqual(buy, [
      "mailto:support@grillyour.ai",
      "https://github.com/mtangoz/grill/blob/main/docs/PRIVACY.md#the-pro-launch-list",
      "/pro",
      "https://grillyour.ai/checkout?plan=month",
      "https://grillyour.ai/checkout?plan=year",
      "https://grillyour.ai/checkout?plan=month",
      "https://grillyour.ai/checkout?plan=year",
      "/pro",
      "/terms/",
      "/terms/",
    ]);
  });

  it("says Desktop and Claude Code enforce a different company, and the paste routes warn", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const why = readFileSync(join(ROOT, "docs/WHY.md"), "utf8");
    for (const text of [page, readme]) {
      assert.match(text, /Claude Desktop and Claude Code enforce that in code/);
      assert.match(text, /copy-and-paste routes check it and warn you/);
    }
    assert.match(why, /^# Why not just ask your own assistant\?$/m);
  });

  it("says the website counts visits anonymously, and the tool does not", () => {
    const sentence = "This website counts visits anonymously, with no cookies and nothing that identifies you. The Grill tool itself never tracks you.";
    const launch = "If you join the Pro launch list, we keep your email address, and only that, in Resend until Pro launches, and you can unsubscribe with one click.";
    assert.ok(page.includes(sentence));
    assert.ok(page.includes(launch));
    assert.ok(readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8").includes(sentence));
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /docs\/PRIVACY\.md/);
    assert.doesNotMatch(readme, /saving copies/);
  });

  it("keeps the README short enough for a directory listing", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /about a cent or two/);
    assert.match(readme, /docs\/WEEKLY-REVIEW\.md/);
    assert.match(readme, /docs\/PRIVACY\.md/);
    assert.doesNotMatch(readme, /\$9 a month|UPSTASH_|STRIPE_|GRILL_PRO_BILLING|Gmail|Google Calendar|Google Drive|Notion/);
    assert.doesNotMatch(readme, /bet on how many/);
    assert.ok(readFileSync(join(ROOT, "docs/pro-development.md"), "utf8").includes("UPSTASH_REDIS_REST_URL"));
    assert.ok(readFileSync(join(ROOT, "docs/TROUBLESHOOTING.md"), "utf8").includes("Still grilling"));
    assert.ok(readFileSync(join(ROOT, "LEARNING.md"), "utf8").includes("Quality checks on one grill"));
    assert.match(page, /Before you decide/);
    assert.match(page, /id="paste-result"/);
    assert.match(page, /\.button \{[^}]*white-space:\s*nowrap/);
    assert.match(page, /\.report p:not\(\.cta\)/);
    assert.match(page, /grill-record/);
    assert.match(page, /version: 1/);
    assert.match(page, /prediction:/);
    assert.match(page, /Did it come true\?/);
    assert.match(page, /Did the thing that would prove you wrong happen\?/);
    assert.ok(readFileSync(join(ROOT, "docs/DECISION-RECORD.md"), "utf8").includes("version: 1"));
  });

  it("counts reflection use as a number of records and never the words", () => {
    assert.match(page, /reflection_record_shown/);
    assert.match(page, /reflection_record_copied/);
    assert.match(page, /reflection_lookback_started/);
    assert.match(page, /reflection_lookback_completed/);
    assert.match(page, /window\.va\("event", \{ name: name, data: \{ records: count \} \}\)/);
    assert.match(page, /It never includes the words of a decision/);
    assert.doesNotMatch(page, /window\.va\([^)]*(judge-answer|saved-records|what-happened|decision-title)/);
    for (const file of ["server/index.mjs", "scripts/reflection.mjs"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      assert.ok(!source.includes("window.va"), `${file} must not send website analytics`);
      assert.ok(!source.includes("reflection_record_"), `${file} must not name website reflection events`);
    }
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /how many records were pasted/);
    assert.match(privacy, /never include the title, the falsifier, the verdict, or what happened/);
  });

  it("counts install clicks with an allowlisted channel ref, and states the Desktop setup time", () => {
    for (const name of ["download_mcpb", "download_skill", "copy_prompt", "openrouter_key_click"]) {
      assert.match(page, new RegExp(`data-track="${name}"`));
      assert.match(page, new RegExp(`${name}: 1`));
    }
    assert.match(page, /releases\/latest\/download\/grill\.mcpb" data-track="download_mcpb"/);
    assert.match(page, /releases\/latest\/download\/grill-skill\.zip" data-track="download_skill"/);
    assert.match(page, /prompts\/grill\.md" data-track="copy_prompt"/);
    assert.match(page, /href="https:\/\/openrouter\.ai\/keys" data-track="openrouter_key_click"/);
    assert.doesNotMatch(page, /openrouter\.ai\/keys\?/);
    for (const ref of ["smithery", "glama", "mcpservers", "tensorblock", "mcp-registry", "punkpeye", "hn", "reddit", "direct", "share", "openrouter"]) {
      assert.match(page, new RegExp(`\\b${ref}\\b`));
    }
    assert.match(page, /if \(CHANNEL_REFS\[fromUrl\]\) channelRef = fromUrl/);
    assert.match(page, /if \(channelRef\) data\.ref = channelRef/);
    assert.match(page, /window\.va\("event", \{ name: name, data: data \}\)/);
    assert.match(page, /About 2 minutes if you already have an OpenRouter key/);
    assert.match(page, /About 10 minutes if you need to create one \(\$5 credit\)/);
    assert.match(page, /Prefer free first\? Use Any AI above/);
    assert.match(page, /once per check \(about 1 to 2 cents\)/);
    assert.match(page, /The tools can list without a key\. The first grill needs credit/);
    const any = page.indexOf("Any AI (easiest)");
    const desktop = page.indexOf(">Claude Desktop<");
    assert.ok(any > 0 && desktop > any, "Any AI stays the first setup route");
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /click on a download, the paste prompt, or the OpenRouter keys page/);
    assert.match(privacy, /optional channel tag \(`ref`\)/);
    assert.match(page, /optional channel tag \(<code>ref<\/code>\) from a fixed list/);
    assert.match(page, /A missing tag is left off/);
    assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /about 2 minutes with a key, about 10 if you need one/);
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
      delete env.GRILL_PRO_NOTIFY;
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
      if (!Object.hasOwn(extra, "GRILL_PRO_NOTIFY")) delete env.GRILL_PRO_NOTIFY;
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

  it("GRILL_PRO_NOTIFY=1 replaces the starter-key button with the launch-list form", () => {
    const build = (notify) => {
      const env = { ...process.env };
      delete env.GRILL_PRO_COUPON;
      delete env.GRILL_PRO_BILLING;
      if (notify) env.GRILL_PRO_NOTIFY = notify;
      else delete env.GRILL_PRO_NOTIFY;
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env });
      return readFileSync(join(ROOT, "_site/index.html"), "utf8");
    };
    const off = build("");
    assert.match(off, /<main id="top">/);
    assert.match(off, /Get a starter key/);
    assert.doesNotMatch(off, /Notify me/);
    const on = build("1");
    assert.match(on, /<main id="top" data-notify>/);
    assert.match(on, /Notify me/);
    assert.match(on, /action="\/notify"/);
    assert.doesNotMatch(on, /Get a starter key/);
    assert.doesNotMatch(on, /href="\/pro"/);
    assert.match(readFileSync(join(ROOT, "vercel.json"), "utf8"), /GRILL_PRO_NOTIFY=1 node scripts\/build-site\.mjs/);
    const ignored = build("yes-please");
    assert.doesNotMatch(ignored, /<main[^>]*data-notify/);
    assert.match(ignored, /Get a starter key/);
  });
});
