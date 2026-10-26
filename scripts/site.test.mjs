// The onboarding site: one source (site/page.html), published as a Claude artifact as-is and
// on Vercel through scripts/build-site.mjs (every push to main redeploys). These pin what makes both work.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsSnippet } from "./siteAnalytics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
// The home page stays short. The paste-and-look-back tool and the full privacy text have their own pages.
const lookBack = readFileSync(join(ROOT, "site/look-back.html"), "utf8");
const privacyPage = readFileSync(join(ROOT, "site/privacy.html"), "utf8");

describe("site/page.html", () => {
  it("is a body with no document skeleton, so it publishes as an artifact unchanged", () => {
    assert.doesNotMatch(page, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
    assert.match(page.slice(0, 8192), /<title>Grill: grill your AI before you send it to your boss<\/title>/);
  });

  it("links every setup route the README promises", () => {
    for (const needle of ["releases/latest/download/grill.mcpb", "releases/latest/download/grill-skill.zip", "/plugin install grill@grill", "openrouter.ai/keys", "prompts/grill.md"]) {
      assert.ok(page.includes(needle), `missing ${needle}`);
    }
  });

  it("shows Meta AI (Muse) connector setup, with a public URL and client ID to copy", () => {
    assert.match(page, /<summary>Meta AI \(Muse\)<span>connector<\/span><\/summary>/);
    assert.match(page, /Muse → Settings → Connectors → Add custom connector/);
    assert.match(page, /id="muse-url"[^>]*value="https:\/\/grillyour\.ai\/mcp"/);
    assert.match(page, /id="muse-client"[^>]*value="RNdHSHmWCRJO40vd"/);
    assert.match(page, /data-copy="muse-url"/);
    assert.match(page, /data-copy="muse-client"/);
    assert.match(page, /Same for everyone\. No secret\./);
    assert.match(page, /Tap Add, then sign in with the email your invite went to, every time\. We email you a code; check spam/);
    assert.match(page, /button\[data-copy\]/);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /### Meta AI \(Muse\)/);
    assert.match(readme, /https:\/\/grillyour\.ai\/mcp/);
    assert.match(readme, /RNdHSHmWCRJO40vd/);
    assert.match(readme, /Same for everyone\. No secret\./);
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

  it("leads with the tagline, then the choice staying with the person", () => {
    assert.match(page, /^<title>Grill: grill your AI before you send it to your boss<\/title>/);
    assert.match(page, /<h1>Grill your AI before you send it to your boss\.<\/h1>/);
    assert.doesNotMatch(page, /<h1>Get a second opinion before you decide\.<\/h1>/);
    assert.match(page, /<p class="lede">Hear the strongest case against your plan, then decide for yourself\.<\/p>/);
    const line3 = readFileSync(join(ROOT, "README.md"), "utf8").split("\n")[2];
    assert.equal(line3, "**Hear the strongest case against your plan, then decide for yourself.**");
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme.split("\n")[0], /Grill: grill your AI before you send it to your boss/);
    assert.match(readme, /https:\/\/grillyour\.ai\/demo\//);
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

  it("says the website counts visits anonymously, and the tool's usage ping is opt-in", () => {
    const visits = "This website counts visits anonymously, with no cookies and nothing that identifies you.";
    const tool = "The installed tool can optionally send one anonymous usage ping to this site after the first successful grill, if you turn that on at install; off by default; never again; never decision words.";
    const launch = "If you join the Pro launch list, we keep your email address, and only that, in Resend until Pro launches, and you can unsubscribe with one click.";
    assert.ok(privacyPage.includes(visits));
    assert.ok(privacyPage.includes(tool));
    assert.ok(privacyPage.includes(launch));
    assert.match(page, /<a href="\/privacy\/">Privacy<\/a>/, "the home page links the privacy page");
    assert.match(page, /<a href="\/privacy\/">Nothing kept unless you choose<\/a>/);
    assert.match(page, /The free tool has no account and keeps none of your decisions/);
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.ok(privacy.includes(visits));
    assert.match(privacy, /does not track you unless you turn on optional anonymous usage stats/);
    assert.match(privacy, /No ads\. No selling your data\. No training on your decisions\. Grill is paid for by subscriptions only\./);
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
    assert.match(lookBack, /Before you decide/);
    assert.match(lookBack, /id="paste-result"/);
    assert.match(page, /\.button \{[^}]*white-space:\s*nowrap/);
    assert.match(page, /\.report p:not\(\.cta\)/, "the look-back page borrows the home page's report styles");
    assert.match(lookBack, /grill-record/);
    assert.match(lookBack, /version: 1/);
    assert.match(lookBack, /prediction:/);
    assert.match(lookBack, /Did it come true\?/);
    assert.match(lookBack, /Did the thing that would prove you wrong happen\?/);
    assert.match(page, /href="\/look-back\/"/, "the home page links the look-back page");
    assert.ok(readFileSync(join(ROOT, "docs/DECISION-RECORD.md"), "utf8").includes("version: 1"));
  });

  it("counts reflection use as a number of records and never the words", () => {
    assert.match(lookBack, /reflection_record_shown/);
    assert.match(lookBack, /reflection_record_copied/);
    assert.match(lookBack, /reflection_lookback_started/);
    assert.match(lookBack, /reflection_lookback_completed/);
    assert.match(lookBack, /window\.grillTrack\(name, \{ records: count \}\)/);
    assert.match(privacyPage, /It never includes the words of a decision/);
    assert.match(lookBack, /Did anything happen you didn['\u2019]t expect\?/);
    for (const text of [page, lookBack]) {
      assert.doesNotMatch(text, /window\.(va|grillTrack)\([^)]*(judge-answer|saved-records|what-happened|decision-title|surprise)/);
      assert.doesNotMatch(text, /track\([^)]*surprise/);
    }
    assert.doesNotMatch(page, /reflection_/, "the home page has no reflection events");
    for (const file of ["server/index.mjs", "scripts/reflection.mjs"]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      assert.ok(!source.includes("window.va"), `${file} must not send website analytics`);
      assert.ok(!source.includes("grillTrack") && !/posthog/i.test(source), `${file} must not send website analytics`);
      assert.ok(!source.includes("reflection_record_"), `${file} must not name website reflection events`);
    }
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /how many records were pasted/);
    assert.match(privacy, /never include the title, the falsifier, the verdict, what happened, or a surprise/);
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
    assert.match(page, /window\.grillTrack\(name, data\)/);
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
    assert.match(privacyPage, /optional channel tag \(<code>ref<\/code>\) from a fixed list/);
    assert.match(privacyPage, /A missing tag is left off/);
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
    assert.ok(!lookBack.includes("—"), "no em dashes");
    assert.ok(!privacyPage.includes("—"), "no em dashes");
  });
});

describe("the contribute page", () => {
  const contribute = readFileSync(join(ROOT, "site/contribute.html"), "utf8");

  it("is linked from the home header and footer", () => {
    assert.match(page, /<a href="\/contribute\/">Contribute<\/a>/);
    const footer = page.match(/<div class="footer">[\s\S]*?<\/div>/)?.[0] || "";
    assert.match(footer, /href="\/contribute\/"/);
    assert.match(readFileSync(join(ROOT, "site/terms.html"), "utf8"), /href="\/contribute\/"/);
  });

  it("says why help matters, the three ways, and how a change is reviewed", () => {
    assert.match(contribute, /<title>Contribute to Grill<\/title>/);
    assert.match(contribute, /one model, from a different company/);
    assert.match(contribute, /No ads\. No selling your data\. No training on your decisions\. Grill is paid for by subscriptions only\./);
    assert.match(contribute, /issues\/new\?template=idea\.yml/);
    assert.match(contribute, /label%3A%22good\+first\+issue%22/);
    assert.match(contribute, /prompts\/grill\.md/);
    assert.match(contribute, /blob\/main\/CONTRIBUTING\.md/);
    assert.match(contribute, /src="\/brand\/favicon-32\.png"/);
    assert.match(contribute, /won’t be merged/);
    assert.ok(!contribute.includes("—"), "no em dashes");
    assert.doesNotMatch(contribute, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
  });

  it("matches CONTRIBUTING.md on setup, tests, and the two rules that do not move", () => {
    const contributing = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8");
    assert.match(contributing, /Node\.js/);
    assert.match(contributing, /node --test scripts\/\*\.test\.mjs/);
    assert.match(contributing, /npm test/);
    assert.match(contributing, /docs\/PR-AUTOMATION\.md/);
    assert.match(contributing, /No ads\. No selling your data\. No training on your decisions\. Grill is paid for by subscriptions only\./);
    assert.match(contributing, /different company than the assistant/);
    assert.match(contributing, /will not be merged/);
    assert.match(contributing, /template=idea\.yml/);
    assert.match(contributing, /template=bug\.yml/);
    assert.match(contributing, /https:\/\/grillyour\.ai\/contribute\//);
    for (const name of ["idea.yml", "bug.yml"]) {
      const form = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE", name), "utf8");
      assert.match(form, /^name: /m);
      assert.match(form, /Don't include a real decision|Don't paste a key/);
    }
  });
});

describe("the site build", () => {
  it("wraps the page into a full document, with its title and styles in the head", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const html = readFileSync(join(ROOT, "_site/index.html"), "utf8");
    const [head, rest] = html.split("</head>");
    assert.match(html, /^<!doctype html>/);
    assert.match(head, /<title>Grill: grill your AI before you send it to your boss<\/title>/);
    assert.match(head, /<meta property="og:title" content="Grill: grill your AI before you send it to your boss">/);
    assert.match(head, /<meta name="description" content="Grill your AI before you send it to your boss\. Get a second opinion before you decide/);
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
    const contribute = readFileSync(join(ROOT, "_site/contribute/index.html"), "utf8");
    assert.match(contribute, /<title>Contribute to Grill<\/title>/);
    assert.match(contribute, /<link rel="canonical" href="https:\/\/grillyour\.ai\/contribute\/">/);
    assert.match(contribute, /How to improve Grill\./);
    assert.match(contribute, /--paper:/, "the contribute page borrows the site's styles");
    assert.match(contribute, /src="\/brand\/favicon-32\.png"/);
    for (const [dir, title] of [["look-back", "Look back on a decision"], ["privacy", "Grill privacy"]]) {
      const built = readFileSync(join(ROOT, `_site/${dir}/index.html`), "utf8");
      assert.match(built, new RegExp(`<title>${title}</title>`));
      assert.match(built, new RegExp(`<link rel="canonical" href="https://grillyour\\.ai/${dir}/">`));
      assert.match(built, /--paper:/, `the ${dir} page borrows the site's styles`);
      assert.ok(built.includes('<script defer src="/_vercel/insights/script.js"></script>'), `the ${dir} page counts visits`);
    }
    const snippet = '<script defer src="/_vercel/insights/script.js"></script>';
    assert.ok(html.includes("window.va"), "the home page counts visits");
    assert.ok(html.includes(snippet));
    assert.ok(terms.includes(snippet), "the terms page counts visits");
    assert.ok(contribute.includes(snippet), "the contribute page counts visits");
    assert.ok(!page.includes(snippet), "the artifact source does not count visits");
    assert.ok(!readFileSync(join(ROOT, "site/terms.html"), "utf8").includes(snippet));
    assert.ok(!readFileSync(join(ROOT, "site/contribute.html"), "utf8").includes(snippet));
    for (const f of ["server/index.mjs", "scripts/judge.mjs", "scripts/judgeCore.mjs", "scripts/build-extension.mjs"]) {
      assert.ok(!readFileSync(join(ROOT, f), "utf8").includes("_vercel/insights"), `${f} must not load website analytics`);
    }
  });

  it("gives Google's favicon service an icon it accepts, and a way to find every page", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const head = readFileSync(join(ROOT, "_site/index.html"), "utf8").split("</head>")[0];
    assert.match(head, /<link rel="icon" type="image\/png" sizes="192x192" href="\/brand\/icon-192\.png">/);
    assert.ok(existsSync(join(ROOT, "_site/brand/icon-192.png")));
    assert.ok(existsSync(join(ROOT, "_site/favicon.ico")));
    const robots = readFileSync(join(ROOT, "_site/robots.txt"), "utf8");
    assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
    assert.match(robots, /Sitemap: https:\/\/grillyour\.ai\/sitemap\.xml/);
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    for (const path of ["", "terms/", "contribute/", "look-back/", "privacy/", "demo/"]) {
      assert.ok(sitemap.includes(`<loc>https://grillyour.ai/${path}</loc>`), `sitemap lists /${path}`);
    }
  });

  // /llms.txt is the llmstxt.org file agents fetch. It has to name the same public pages as the
  // sitemap, or a new page can ship in one and not the other.
  it("writes llms.txt from the same pages as the sitemap", () => {
    const build = (extra = {}) => {
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env: { ...process.env, ...extra } });
      return {
        llms: readFileSync(join(ROOT, "_site/llms.txt"), "utf8"),
        sitemap: readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8"),
      };
    };
    const check = ({ llms, sitemap }) => {
      assert.match(llms, /^# Grill\n/);
      assert.match(
        llms,
        /^> Grill your AI before you send it to your boss\. An outside judge, a model from a different company, gives the strongest case against a decision\.\n/m,
      );
      assert.match(llms, /https:\/\/grillyour\.ai\/mcp/);
      assert.match(llms, /Grill in chat is invite-only for now/);
      assert.match(llms, /\[GitHub\]\(https:\/\/github\.com\/mtangoz\/grill\): \S/);
      const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      for (const path of ["", "start/", "privacy/", "terms/", "look-back/", "contribute/", "demo/"]) {
        assert.ok(locs.includes(`https://grillyour.ai/${path}`), `sitemap lists /${path}`);
      }
      for (const url of locs) {
        const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        assert.match(llms, new RegExp(`\\[[^\\]]+\\]\\(${escaped}\\): \\S`), `llms.txt links ${url}`);
      }
      // The privacy link keeps that page's own limit. Chat keeps a record only when you choose.
      assert.match(llms, /https:\/\/grillyour\.ai\/privacy\/\): [^\n]*keeps only what you choose/);
    };
    check(build());
    const withMiss = build({ GRILL_MISS: "1" });
    check(withMiss);
    assert.match(withMiss.llms, /https:\/\/grillyour\.ai\/miss\//);
  });

  // Search engines read one schema.org block. It restates the homepage and adds no offer,
  // rating, or review. ProductivityApplication is the closer schema.org category: Grill is a
  // tool for challenging a plan before you act, not a business system. The block is data.
  // Every other <script> has to be one the build already emitted.
  it("publishes one SoftwareApplication JSON-LD block and no other script", () => {
    const OWN_SCRIPTS = { "index.html": 1, "look-back/index.html": 1, "miss/index.html": 1 };
    const build = (extra = {}) => {
      const env = { ...process.env, ...extra };
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env });
      const pages = readdirSync(join(ROOT, "_site"), { recursive: true })
        .map((name) => join(ROOT, "_site", String(name)))
        .filter((path) => path.endsWith(".html"))
        .map((path) => [relative(join(ROOT, "_site"), path), readFileSync(path, "utf8")]);
      return { env, pages };
    };
    const ldBlocks = (html) => {
      const found = [];
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(match[1])) found.push(match[2]);
      }
      return found;
    };
    const check = ({ env, pages }) => {
      assert.ok(pages.some(([rel]) => rel === "index.html"));
      let parsed = null;
      for (const [rel, html] of pages) {
        const blocks = ldBlocks(html);
        if (rel === "index.html") {
          assert.equal(blocks.length, 1, "the homepage has exactly one application/ld+json block");
          parsed = JSON.parse(blocks[0]);
        } else {
          assert.equal(blocks.length, 0, `${rel} has a JSON-LD block`);
        }
        let rest = html.replace(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, "");
        const snippet = analyticsSnippet(env);
        assert.ok(rest.includes(snippet), `${rel} is missing the analytics snippet`);
        rest = rest.replace(snippet, "");
        const leftover = rest.match(/<script\b/gi)?.length ?? 0;
        assert.equal(leftover, OWN_SCRIPTS[rel] ?? 0, `${rel} has an unexpected script`);
      }
      assert.equal(parsed["@context"], "https://schema.org");
      assert.equal(parsed["@type"], "SoftwareApplication");
      assert.equal(parsed.name, "Grill");
      assert.equal(parsed.url, "https://grillyour.ai/");
      assert.equal(parsed.applicationCategory, "ProductivityApplication");
      assert.equal(parsed.operatingSystem, "Any");
      assert.deepEqual(parsed.sameAs, ["https://github.com/mtangoz/grill"]);
      const home = pages.find(([rel]) => rel === "index.html")[1];
      const meta = home.match(/<meta name="description" content="([^"]*)">/)?.[1]
        ?.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      assert.equal(parsed.description, meta);
      const forbidden = ["offers", "aggregateRating", "review"];
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        for (const key of Object.keys(node)) {
          assert.equal(forbidden.includes(key), false, key);
          walk(node[key]);
        }
      };
      walk(parsed);
    };
    check(build());
    check(build({ GRILL_MISS: "1" }));
  });

  // Agents that fetch /llms.txt need to know when Grill is the right tool. The bullets
  // have to be sentences already on the homepage, /demo, or /start.
  it("says when to use Grill before the page list", () => {
    const invite = "Invited testers connect Grill to the AI they use at https://grillyour.ai/mcp. Grill in chat is invite-only for now.";
    const build = (extra = {}) => {
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env: { ...process.env, ...extra } });
      return readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    };
    const check = (llms) => {
      assert.equal(llms.split(invite).length - 1, 1);
      assert.equal(llms.split("## When to use Grill").length - 1, 1);
      const whenAt = llms.indexOf("## When to use Grill\n");
      const pagesAt = llms.indexOf("## Pages\n");
      assert.ok(whenAt > llms.indexOf(invite), "the invite-only line stays above the new section");
      assert.ok(pagesAt > whenAt, "## When to use Grill comes before ## Pages");
      const section = llms.slice(whenAt, pagesAt).trimEnd();
      const bullets = section.split("\n").filter((line) => line.startsWith("- "));
      assert.ok(bullets.length >= 3 && bullets.length <= 5, `expected 3 to 5 bullets, got ${bullets.length}`);
      assert.ok(bullets.every((line) => /^- \S/.test(line)));
      const strip = (html) => {
        const meta = html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? "";
        const text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ");
        return `${meta} ${text}`.replace(/\s+([.?!,])/g, "$1").replace(/\s+/g, " ");
      };
      const copy = [
        readFileSync(join(ROOT, "_site/index.html"), "utf8"),
        readFileSync(join(ROOT, "_site/demo/index.html"), "utf8"),
        readFileSync(join(ROOT, "_site/start/index.html"), "utf8"),
      ].map(strip).join("\n");
      for (const bullet of bullets) {
        for (const sentence of bullet.slice(2).split(/(?<=[.?!])\s+/)) {
          assert.ok(copy.includes(sentence), `not on the homepage, /demo, or /start: ${sentence}`);
        }
      }
    };
    check(build());
    check(build({ GRILL_MISS: "1" }));
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

  it("names the live commit in every public page footer when the deploy provides one, and nothing otherwise", () => {
    const pages = ["index.html", "terms/index.html", "contribute/index.html", "look-back/index.html", "privacy/index.html", "about/index.html", "contact/index.html", "miss/index.html"];
    const build = (sha) => {
      const env = { ...process.env, GRILL_MISS: "1" };
      if (sha === undefined) delete env.VERCEL_GIT_COMMIT_SHA;
      else env.VERCEL_GIT_COMMIT_SHA = sha;
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env });
      return pages.map((p) => [p, readFileSync(join(ROOT, "_site", p), "utf8")]);
    };
    const sha = "0123456789abcdef0123456789abcdef01234567";
    for (const [p, html] of build(sha)) {
      assert.ok(
        html.includes(`<span>Live commit <a href="https://github.com/mtangoz/grill/commit/${sha}">0123456</a> · Made at <a href="https://hold.quest">Hold</a>`),
        `${p} names the live commit`,
      );
    }
    // A local build, a short hash, or anything else that isn't a full commit adds nothing.
    for (const value of [undefined, "", "0123456", `${sha}"><script>`, "not-a-commit"]) {
      for (const [p, html] of build(value)) {
        assert.doesNotMatch(html, /Live commit/, `${p} with ${JSON.stringify(value)}`);
        assert.match(html, /<span>Made at <a href="https:\/\/hold\.quest">Hold<\/a>/, `${p} keeps its footer`);
      }
    }
    assert.doesNotMatch(page, /Live commit/, "the artifact source never carries a commit");
  });

  // A chat preview reads og:title, and X reads twitter:title. Both have to be the page's own
  // <title>, so a shared /demo/ or /start/ link is not labelled just "Grill".
  it("sets og:title and twitter:title to each page's own title", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], {
      stdio: "pipe",
      env: { ...process.env, GRILL_MISS: "1" },
    });
    const pages = readdirSync(join(ROOT, "_site"), { recursive: true })
      .map((name) => join(ROOT, "_site", String(name)))
      .filter((path) => path.endsWith(".html"));
    assert.ok(pages.some((path) => path.endsWith(join("miss", "index.html"))), "the miss page is built");
    let titled = 0;
    for (const path of pages) {
      const html = readFileSync(path, "utf8");
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
      if (title === undefined) continue;
      titled += 1;
      const og = html.match(/<meta property="og:title" content="([^"]*)">/)?.[1];
      const twitter = html.match(/<meta name="twitter:title" content="([^"]*)">/)?.[1];
      assert.equal(og, title, `${path} og:title`);
      assert.equal(twitter, title, `${path} twitter:title`);
    }
    assert.ok(titled >= 8, "home, the other public pages, and /miss/ each have a title");
    const demo = readFileSync(join(ROOT, "_site/demo/index.html"), "utf8");
    assert.match(demo, /<meta property="og:title" content="See a grill before you set one up">/);
    const start = readFileSync(join(ROOT, "_site/start/index.html"), "utf8");
    assert.match(start, /<meta property="og:title" content="Start using Grill">/);
  });

  // A shared link's preview is the image. It stays 1200x630, and the alt text is the
  // tagline a person reads on that image, on every page the build emits.
  it("shares a 1200x630 image whose alt includes the tagline", () => {
    const png = readFileSync(join(ROOT, "site/brand/og-image.png"));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);

    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], {
      stdio: "pipe",
      env: { ...process.env, GRILL_MISS: "1" },
    });
    const pages = readdirSync(join(ROOT, "_site"), { recursive: true })
      .map((name) => join(ROOT, "_site", String(name)))
      .filter((path) => path.endsWith(".html"));
    assert.ok(pages.length >= 8, "home and the other public pages are built");
    for (const path of pages) {
      const html = readFileSync(path, "utf8");
      const alt = html.match(/<meta property="og:image:alt" content="([^"]*)">/)?.[1];
      assert.ok(alt, `${path} has og:image:alt`);
      assert.ok(
        alt.includes("Grill your AI before you send it to your boss"),
        `${path} alt is ${alt}`,
      );
      assert.match(html, /<meta property="og:image:width" content="1200">/);
      assert.match(html, /<meta property="og:image:height" content="630">/);
      assert.match(html, /<meta property="og:image" content="https:\/\/grillyour\.ai\/brand\/og-image\.png">/);
    }
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

// /start has one job: connect Grill in chat to the AI an invitee uses. One section per AI,
// under Claude.ai. No script: the address and steps are plain text a person can select and copy.
// Every section says to use the same email each time.
describe("the /start page", () => {
  const startPath = join(ROOT, "site/start.html");
  const SAME_EMAIL = /the same email each time/i;
  const INVITE_EMAIL = /the email your invite went to, every time/i;
  const section = (html, id) => {
    const marker = `<h2 id="${id}">`;
    const from = html.indexOf(marker);
    assert.ok(from > 0, id);
    const after = html.slice(from);
    const next = after.slice(marker.length).search(/<h2\b/);
    return next === -1 ? after : after.slice(0, marker.length + next);
  };

  it("exists, opens with its title, and uses no script or copy buttons", () => {
    assert.ok(existsSync(startPath), "site/start.html exists");
    const start = readFileSync(startPath, "utf8");
    assert.match(start, /^<title>Start using Grill<\/title>/);
    assert.doesNotMatch(start, /<script/i);
    assert.doesNotMatch(start, /data-copy|<button/i);
  });

  it("gives Claude.ai connector steps with the URL as selectable text", () => {
    const start = readFileSync(startPath, "utf8");
    const claude = section(start, "claude");
    assert.match(claude, /<h2 id="claude">Claude\.ai<\/h2>/);
    assert.match(claude, /Customize → Connectors → Add custom connector/);
    assert.match(claude, /<input id="connector-url" type="text" readonly value="https:\/\/grillyour\.ai\/mcp"/);
    assert.match(claude, /<code>https:\/\/grillyour\.ai\/mcp<\/code>/);
    assert.match(claude, SAME_EMAIL);
    assert.match(claude, INVITE_EMAIL);
    assert.match(claude, /check spam/i);
    assert.doesNotMatch(claude, /Google/);
    assert.match(claude, /Grill this:/);
    const steps = claude.match(/<li>/g) ?? [];
    assert.ok(steps.length >= 3 && steps.length <= 5, `Claude.ai has 3 to 5 steps, got ${steps.length}`);
  });

  it("gives ChatGPT the verified web steps for a paid plan", () => {
    const chatgpt = section(readFileSync(startPath, "utf8"), "chatgpt");
    assert.match(chatgpt, /<h2 id="chatgpt">ChatGPT<\/h2>/);
    assert.match(chatgpt, /Verified working/);
    assert.match(chatgpt, /paid plan/i);
    assert.match(chatgpt, /Plugins/);
    assert.match(chatgpt, /plus button/i);
    assert.match(chatgpt, /Add custom MCP server/);
    assert.match(chatgpt, /name it Grill|Name it Grill|name Grill/i);
    assert.match(chatgpt, /<code>https:\/\/grillyour\.ai\/mcp<\/code>/);
    assert.match(chatgpt, /OAuth/);
    assert.match(chatgpt, /I understand and want to continue/);
    assert.match(chatgpt, /Create/);
    assert.match(chatgpt, /Install/);
    assert.match(chatgpt, SAME_EMAIL);
    assert.match(chatgpt, INVITE_EMAIL);
    assert.match(chatgpt, /check spam/i);
  });

  it("gives Grok Bot the verified one-line setup", () => {
    const grok = section(readFileSync(startPath, "utf8"), "grok");
    assert.match(grok, /<h2 id="grok">Grok Bot<\/h2>/);
    assert.match(grok, /Verified working/);
    assert.match(grok, /Add this MCP server: https:\/\/grillyour\.ai\/mcp/);
    assert.match(grok, /sign in when asked/i);
    assert.match(grok, SAME_EMAIL);
    assert.match(grok, INVITE_EMAIL);
  });

  it("marks Gemini as should work, with the limits, and still gives the steps", () => {
    const gemini = section(readFileSync(startPath, "utf8"), "gemini");
    assert.match(gemini, /<h2 id="gemini">Gemini<\/h2>/);
    assert.match(gemini, /Should work, testing now/);
    assert.match(gemini, /US only/);
    assert.match(gemini, /personal Google account/);
    assert.match(gemini, /Keep Activity on/);
    assert.match(gemini, /gemini\.google\.com/);
    assert.match(gemini, /Settings/);
    assert.match(gemini, /Connected Apps/);
    assert.match(gemini, /Add a custom app/);
    assert.match(gemini, /<code>https:\/\/grillyour\.ai\/mcp<\/code>/);
    assert.match(gemini, /Next/);
    assert.match(gemini, /sign in/i);
    assert.match(gemini, SAME_EMAIL);
    assert.match(gemini, INVITE_EMAIL);
  });

  it("leaves only Meta AI coming soon, with no setup steps", () => {
    const start = readFileSync(startPath, "utf8");
    const soon = section(start, "soon");
    assert.match(soon, /<h2 id="soon">Meta AI<\/h2>/);
    assert.match(soon, /Coming soon/);
    assert.doesNotMatch(soon, /ChatGPT|Grok|Gemini/);
    assert.doesNotMatch(soon, /<li>|RNdHSHmWCRJO40vd/);
    assert.match(soon, SAME_EMAIL);
    assert.match(soon, INVITE_EMAIL);
    const order = ["claude", "chatgpt", "grok", "gemini", "soon"];
    let at = -1;
    for (const id of order) {
      const i = start.indexOf(`id="${id}"`);
      assert.ok(i > at, `${id} is out of order`);
      at = i;
    }
  });

  it("builds to /start/ with the site's styles and is in the sitemap", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const built = readFileSync(join(ROOT, "_site/start/index.html"), "utf8");
    assert.match(built, /<title>Start using Grill<\/title>/);
    assert.match(built, /<link rel="canonical" href="https:\/\/grillyour\.ai\/start\/">/);
    assert.match(built, /--paper:/);
    assert.match(built, /<h2 id="chatgpt">ChatGPT<\/h2>/);
    assert.doesNotMatch(readFileSync(startPath, "utf8"), /<script/i);
    assert.match(readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8"), /https:\/\/grillyour\.ai\/start\//);
  });

  it("the home page setup copy points invitees at every AI, and the README and hosted guide match", () => {
    const setup = page.slice(page.indexOf('id="setup"'), page.indexOf('class="routes"'));
    assert.match(setup, /<a href="\/start\/">/);
    assert.match(setup, /Claude\.ai/);
    assert.match(setup, /ChatGPT/);
    assert.match(setup, /Grok Bot/);
    assert.match(setup, /Gemini/);
    assert.match(setup, /Meta AI/);
    assert.match(setup, /verified working/i);
    assert.match(setup, /Should work, testing now/);
    assert.match(setup, /US only/);
    assert.match(setup, /personal Google account/);
    assert.match(setup, /Keep Activity on/);
    assert.match(setup, /coming soon/i);
    assert.match(setup, SAME_EMAIL);
    assert.match(setup, INVITE_EMAIL);
    assert.doesNotMatch(setup, /in two minutes/);

    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const chat = readme.slice(readme.indexOf("### Grill in chat"), readme.indexOf("###", readme.indexOf("### Grill in chat") + 4));
    assert.match(chat, /https:\/\/grillyour\.ai\/start\//);
    assert.match(chat, /ChatGPT/);
    assert.match(chat, /paid plan/);
    assert.match(chat, /Add custom MCP server/);
    assert.match(chat, /OAuth/);
    assert.match(chat, /I understand and want to continue/);
    assert.match(chat, /Grok Bot/);
    assert.match(chat, /Add this MCP server: https:\/\/grillyour\.ai\/mcp/);
    assert.match(chat, /Gemini/);
    assert.match(chat, /Should work, testing now/);
    assert.match(chat, /Keep Activity on/);
    assert.match(chat, /Meta AI/);
    assert.match(chat, /coming soon/i);
    assert.match(chat, SAME_EMAIL);
    assert.match(chat, INVITE_EMAIL);
    assert.doesNotMatch(readme, /### Inside Claude\.ai/);
    assert.doesNotMatch(readme, /not live yet\. When Grill turns it on/);

    const hosted = readFileSync(join(ROOT, "docs/HOSTED.md"), "utf8");
    assert.match(hosted, /https:\/\/grillyour\.ai\/start\//);
    assert.match(hosted, /GET \/\.well-known\/oauth-protected-resource\/mcp`? serves the same metadata as the root path/);
    const person = hosted.slice(hosted.indexOf("## What a person does"), hosted.indexOf("## ", hosted.indexOf("## What a person does") + 3));
    assert.match(person, SAME_EMAIL);
    assert.match(person, INVITE_EMAIL);
    assert.match(person, /ChatGPT/);
    assert.match(person, /Grok Bot/);
    assert.match(person, /coming soon/i);
  });

  it("links to the privacy page", () => {
    const start = readFileSync(startPath, "utf8");
    assert.match(start, /href="\/privacy\/"/);
    assert.match(start, /Your decisions stay private\. See <a href="\/privacy\/">Privacy<\/a>\./);
  });
});

describe("the privacy page", () => {
  it("states the four promises", () => {
    const blockEnd = privacyPage.indexOf("<h2>Your decisions</h2>");
    const block = privacyPage.slice(0, blockEnd);
    assert.match(block, /<h2>Our four promises<\/h2>/);
    for (const line of [
      "<strong>Your decisions are never public.</strong> We never publish a decision, and we never tie one to your name in public. Not in examples, case studies, marketing or anywhere else.",
      "<strong>No ads.</strong> Grill shows no ads and has no advertising partners.",
      "<strong>We never sell your data.</strong> Not your decisions, your email or your usage. Not to anyone.",
      "<strong>We never train AI on your decisions.</strong> Grill improves by practising on made-up examples. The AI services that judge your decision are asked, on every request, not to keep it or collect it (zero data retention).",
    ]) {
      assert.ok(block.includes(line), line);
    }
    const keys = "Only you see your records on the site. Grill's maintainers hold the encryption keys, so they could technically decrypt records you chose to keep. They don't read them, and they never publish them.";
    assert.ok(privacyPage.includes(keys), "encryption-keys line");
    assert.match(privacyPage, /<h2>Using Grill in chat \(the connector\)<\/h2>/);
    assert.match(privacyPage, /The free tool has no account and keeps nothing\. Grill in chat keeps only what you choose, encrypted, and you can delete it\./);
    assert.match(privacyPage, /We don't keep what you decide unless you choose to keep decision records \(Grill in chat\) or saved report copies \(Pro\), and you can delete them\./);
  });
});

// /demo lets a visitor see the grill format on three made-up everyday decisions
// before they connect anything. The verdicts are illustrative. Nothing here is a saved record.
describe("the /demo page", () => {
  const demoPath = join(ROOT, "site/demo.html");
  const VERDICTS = ["solid", "solid, if\u2026", "shaky", "doesn\u2019t hold up"];
  const closing = "Say \u2018more\u2019, \u2018options\u2019, or your call.";

  it("is three made-up chats, with a visible label and no script", () => {
    assert.ok(existsSync(demoPath), "site/demo.html exists");
    const demo = readFileSync(demoPath, "utf8");
    const contribute = readFileSync(join(ROOT, "site/contribute.html"), "utf8");
    const nav = (html) => html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0];
    const footer = (html) => html.match(/<div class="footer">[\s\S]*?<\/div>/)?.[0];
    assert.equal(nav(demo), nav(contribute));
    assert.equal(footer(demo), footer(contribute));
    assert.match(demo, /^<title>See a grill before you set one up<\/title>/);
    assert.equal((demo.match(/<h1>/g) ?? []).length, 1);
    assert.match(demo, /<h1>See a grill before you set one up\.<\/h1>/);
    assert.equal((demo.match(/class="lede"/g) ?? []).length, 1);
    assert.doesNotMatch(demo, /<script/i);
    assert.doesNotMatch(demo, /onclick=|javascript:/i);

    const label = "made-up decisions and illustrative verdicts, written to show the format, not real users\u2019 decisions and not saved records";
    const labelAt = demo.toLowerCase().indexOf(label);
    const h1 = demo.indexOf("<h1>");
    const firstChat = demo.indexOf('class="chat"');
    assert.ok(labelAt > h1 && labelAt < firstChat, "the made-up label sits near the top, before the examples");
    assert.doesNotMatch(demo, /<!--[\s\S]*made-up decisions/);

    const chats = [...demo.matchAll(/<div class="chat"[\s\S]*?<\/div>/g)].map((match) => match[0]);
    assert.equal(chats.length, 3);
    const seen = [];
    for (const chat of chats) {
      assert.match(chat, /class="you"[\s\S]*Grill this:/);
      assert.match(chat, /I\u2019m \d+% sure/);
      assert.match(chat, /class="grill"/);
      assert.match(chat, /<strong>[^<]+<\/strong>/);
      assert.match(chat, /Cheap test:/);
      assert.ok(chat.includes(closing), "each example ends with the homepage follow-up line");
      const verdict = chat.match(/<strong>([^<]+)<\/strong>/)[1].replace(/\.$/, "").trim().toLowerCase();
      assert.ok(VERDICTS.includes(verdict), `verdict ${verdict} is one of the four`);
      seen.push(verdict);
      const brief = chat.match(/class="grill">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const words = brief.split(" ").filter(Boolean);
      assert.ok(words.length > 0 && words.length <= 50, `brief is ${words.length} words: ${brief}`);
    }
    assert.equal(new Set(seen).size, 3, `three different verdicts, got ${seen.join(", ")}`);

    const details = [...demo.matchAll(/<details>[\s\S]*?<\/details>/g)].map((match) => match[0]);
    assert.equal(details.length, 3);
    for (const block of details) {
      assert.match(block, /<summary>more<\/summary>/);
      const text = block.replace(/<summary>more<\/summary>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.ok(sentences.length >= 2 && sentences.length <= 3, text);
      assert.match(text, /strongest case against/i);
      assert.match(text, /your call/i);
    }
    assert.doesNotMatch(demo, /\b(boss|coworker|workplace|office|sprint|standup|ticket|company|team)\b/i);

    const lastDetails = demo.lastIndexOf("</details>");
    const cta = demo.indexOf('class="cta"');
    const foot = demo.indexOf('class="footer"');
    assert.ok(lastDetails < cta && cta < foot, "the call to action follows the examples");
    assert.match(demo, /<a class="button" href="\/#setup">Get started<\/a>/);
    assert.match(demo, /<a href="\/start\/">[^<]*invited testers[^<]*<\/a>/i);
  });

  it("builds to /demo/ and lands in the sitemap and llms.txt", () => {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { encoding: "utf8" });
    assert.match(out, /privacy and demo pages/);
    const built = readFileSync(join(ROOT, "_site/demo/index.html"), "utf8");
    assert.match(built, /<link rel="canonical" href="https:\/\/grillyour\.ai\/demo\/">/);
    assert.match(built, /--paper:/, "the demo page borrows the site's styles");
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    assert.ok(sitemap.includes("<loc>https://grillyour.ai/demo/</loc>"));
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    assert.match(llms, /\[Demo\]\(https:\/\/grillyour\.ai\/demo\/\): Three made-up decisions, and what Grill said about each\./);
  });

  it("the home page links /demo/ once, right after the example", () => {
    const links = page.match(/href="\/demo\/"/g) ?? [];
    assert.equal(links.length, 1);
    assert.match(page, /<a href="\/demo\/">See three more examples<\/a>/);
    const scale = page.indexOf('class="scale"');
    const link = page.indexOf('href="/demo/"');
    const how = page.indexOf('id="how"');
    assert.ok(scale > 0 && scale < link && link < how, "the demo link follows the example and scale, before How it works");
  });
});

// /about and /contact are trust pages. Assistants look for them before trusting the site.
// They are built like privacy and terms: the shared template, no script of their own.
// Accept: text/markdown is only negotiated for / and for 404s (5d84194), not for these pages.
describe("the about and contact pages", () => {
  const visibleText = (html) => {
    const body = html.split(/<body[^>]*>/i)[1]?.split(/<\/body>/i)[0] ?? html;
    return body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  };
  // A street number plus a street type, a PO Box, or a UK postcode.
  const POSTAL_ADDRESS = /\b(?:P\.?\s*O\.?\s*Box|Post Office Box)\b|\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd\.|Lane|Ln\.|Drive|Dr\.|Court|Ct\.|Way|Place|Pl\.|Terrace|Square|Crescent)\b|\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/;
  const LEGAL_ENTITY = /\b(?:Ltd|LLC|Inc)\b/;

  function builtPage(dir) {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const builtPath = join(ROOT, "_site", dir, "index.html");
    assert.ok(existsSync(builtPath), `_site/${dir}/index.html exists`);
    const built = readFileSync(builtPath, "utf8");
    const sourcePath = join(ROOT, "site", `${dir}.html`);
    assert.ok(existsSync(sourcePath), `site/${dir}.html exists`);
    const source = readFileSync(sourcePath, "utf8");
    return { built, source };
  }

  function assertTrustPage(dir, { title, canonical, description }) {
    const { built, source } = builtPage(dir);
    const text = visibleText(built);
    assert.ok(text.length >= 500, `${dir} visible text is ${text.length} characters`);
    assert.match(built, /support@grillyour\.ai/);
    assert.match(built, /made by Hold/);
    assert.match(built, /href="\/privacy\/"/);
    assert.doesNotMatch(source, /<script\b/i, `${dir} source has a script`);
    assert.doesNotMatch(built, /application\/ld\+json/i, `${dir} has a JSON-LD block`);
    const snippet = analyticsSnippet(process.env);
    const rest = built.replace(snippet, "");
    assert.equal(rest.match(/<script\b/gi)?.length ?? 0, 0, `${dir} has a script besides the shared analytics snippet`);
    assert.doesNotMatch(source, LEGAL_ENTITY);
    assert.doesNotMatch(built, LEGAL_ENTITY);
    assert.doesNotMatch(source, POSTAL_ADDRESS);
    assert.doesNotMatch(built, POSTAL_ADDRESS);
    assert.ok(!source.includes("—"), `${dir} source has an em dash`);
    assert.match(built, new RegExp(`<title>${title}</title>`));
    assert.match(built, new RegExp(`<link rel="canonical" href="${canonical}">`));
    assert.match(built, new RegExp(`<meta property="og:url" content="${canonical}">`));
    assert.match(built, new RegExp(`<meta property="og:title" content="${title}">`));
    assert.match(built, new RegExp(`<meta name="twitter:title" content="${title}">`));
    assert.match(built, new RegExp(`<meta name="description" content="${description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    assert.match(built, new RegExp(`<meta property="og:description" content="${description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    assert.match(built, /--paper:/, `${dir} borrows the site styles`);
    assert.match(source, /<span>Made at <a href="https:\/\/hold\.quest">Hold<\/a>/);
    return { built, source, text };
  }

  it("builds /about/ with the trust lines and no script of its own", () => {
    const { source, text } = assertTrustPage("about", {
      title: "About Grill",
      canonical: "https://grillyour.ai/about/",
      description: "Hear the strongest case against your plan, then decide for yourself. Grill is made by Hold.",
    });
    assert.match(text, /Hear the strongest case against your plan, then decide for yourself\./);
    assert.match(text, /Get a second opinion before you decide\./);
    assert.match(text, /A model from another company gives a verdict and one cheap test\./);
    assert.match(text, /An AI from a different company argues the other side; you decide; later you look back and see how your judgement did\./);
    assert.match(text, /The verdict never becomes the decision\./);
    assert.match(text, /Grill in chat is invite-only for now\./);
    assert.match(text, /Your decisions are never public\./);
    assert.match(text, /We never publish a decision, and we never tie one to your name in public\./);
    assert.match(source, /href="\/terms\/"/);
    assert.match(source, /href="\/demo\/"/);
    assert.match(source, /href="https:\/\/github\.com\/mtangoz\/grill"/);
    assert.doesNotMatch(text, /\b\d{2,}\s+(?:users|people|customers)\b/i);
    assert.doesNotMatch(text, /\b(?:rating|ratings|stars)\b/i);
  });

  it("builds /contact/ with a way to reach Grill and a warning about public issues", () => {
    const { source, text } = assertTrustPage("contact", {
      title: "Contact Grill",
      canonical: "https://grillyour.ai/contact/",
      description: "Write to support@grillyour.ai for your account, sign-in, privacy, or deleting your data.",
    });
    assert.match(text, /for anything: your account, sign-in, privacy, or deleting your data/);
    assert.match(source, /href="https:\/\/github\.com\/mtangoz\/grill\/issues"/);
    assert.match(source, /href="https:\/\/github\.com\/mtangoz\/grill\/blob\/main\/SECURITY\.md"/);
    assert.match(text, /Never paste decision content into a public issue\./);
    assert.match(text, /Don’t paste a real decision\. Issues are public\./);
    assert.match(text, /Please don't open a public issue\./);
    assert.doesNotMatch(text, /within \d+|response time|we(?:'|\u2019)ll (?:reply|get back|respond)/i);
    assert.doesNotMatch(text, /\b(?:phone|call us|tel:)\b/i);
    assert.doesNotMatch(source, /href="tel:/i);
  });

  it("lists both pages in the sitemap and in llms.txt, and the privacy and terms notes link them", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    assert.ok(sitemap.includes("<loc>https://grillyour.ai/about/</loc>"));
    assert.ok(sitemap.includes("<loc>https://grillyour.ai/contact/</loc>"));
    const pagesAt = llms.indexOf("## Pages\n");
    assert.ok(pagesAt > 0, "llms.txt has a Pages list");
    const pages = llms.slice(pagesAt);
    assert.match(pages, /\[About\]\(https:\/\/grillyour\.ai\/about\/\): \S/);
    assert.match(pages, /\[Contact\]\(https:\/\/grillyour\.ai\/contact\/\): \S/);
    for (const file of ["site/privacy.html", "site/terms.html"]) {
      const html = readFileSync(join(ROOT, file), "utf8");
      assert.match(html, /href="\/about\/"/, `${file} links /about/`);
      assert.match(html, /href="\/contact\/"/, `${file} links /contact/`);
    }
  });
});

// Agents that send Accept: text/markdown need a markdown body. Vercel checks the filesystem
// before `rewrites`, so a rewrite of `/` never runs: index.html is already the answer, and a
// rewrite cannot keep a 404 status. `routes` are checked first, and an `error` route can
// attach a body to a real 404. The existing rewrites stay as they are.
describe("markdown for agents", () => {
  const buildFresh = () => {
    for (const name of ["index.md", "404.md"]) {
      const path = join(ROOT, "_site", name);
      if (existsSync(path)) rmSync(path);
    }
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
  };

  it("writes a nonempty markdown homepage from the page's own words", () => {
    buildFresh();
    const md = readFileSync(join(ROOT, "_site/index.md"), "utf8");
    assert.ok(md.trim().length > 0);
    assert.doesNotMatch(md, /<!doctype|<html[\s>]|<script/i);
    const phrases = [
      "Grill your AI before you send it to your boss.",
      "Hear the strongest case against your plan, then decide for yourself.",
      "Free, with the AI you already use",
      "How it works",
      "Say “grill this”",
      "Tell the AI you already use what you’re deciding.",
      "A different AI pushes back",
      "A model from another company gives a verdict and one cheap test.",
      "You make the call",
      "The verdict never becomes the decision. Grill keeps nothing.",
      "Get started: pick the AI you use",
      "Invited to Grill in chat?",
      "Claude.ai, ChatGPT and Grok Bot are verified working. Gemini: Should work, testing now. US only, a personal Google account, Keep Activity on. Meta AI is coming soon. Use the same email each time, the email your invite went to, every time.",
      "Any AI (easiest)",
      "ChatGPT, Copilot, Gemini, Grok, Muse",
      "See three more examples",
      "Every detail of what is sent and counted is in",
    ];
    for (const phrase of phrases) {
      assert.ok(page.includes(phrase), `homepage is missing the wording ${phrase}`);
      assert.ok(md.includes(phrase), `markdown homepage is missing ${phrase}`);
    }
    for (const url of [
      "https://grillyour.ai/demo/",
      "https://grillyour.ai/start/",
      "https://grillyour.ai/privacy/",
      "https://grillyour.ai/llms.txt",
    ]) {
      assert.ok(md.includes(url), `markdown homepage should link ${url}`);
    }
    assert.match(md, /\[Connect it\]\(https:\/\/grillyour\.ai\/start\/\)/);
  });

  it("writes a markdown 404 that says the page is missing and links the agent files", () => {
    buildFresh();
    const md = readFileSync(join(ROOT, "_site/404.md"), "utf8");
    assert.ok(md.trim().length >= 20);
    assert.match(md, /page doesn[’']t exist/i);
    assert.ok(md.includes("https://grillyour.ai/llms.txt"));
    assert.ok(md.includes("https://grillyour.ai/sitemap.xml"));
    assert.doesNotMatch(md, /<!doctype|<html[\s>]|<script/i);
  });

  it("negotiates markdown on / and on 404s, and does not change the rewrites", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.deepEqual(config.rewrites, [
      { source: "/welcome", destination: "/api/welcome" },
      { source: "/checkout", destination: "/api/checkout" },
      { source: "/pro", destination: "/api/pro" },
      { source: "/pro/auth", destination: "/api/pro-auth" },
      { source: "/pro/try", destination: "/api/pro-try" },
      { source: "/pro/reports", destination: "/api/pro-reports" },
      { source: "/notify", destination: "/api/notify" },
      { source: "/notify/confirm", destination: "/api/notify-confirm" },
      { source: "/miss/send", destination: "/api/miss" },
      { source: "/mcp", destination: "/api/hosted?__route=mcp" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/hosted?__route=prm" },
      { source: "/.well-known/oauth-protected-resource/:extra*", destination: "/api/hosted?__route=prm" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/hosted?__route=oauth" },
      { source: "/.well-known/oauth-authorization-server/:extra*", destination: "/api/hosted?__route=oauth" },
      { source: "/.well-known/openid-configuration", destination: "/api/hosted?__route=oidc" },
      { source: "/.well-known/openid-configuration/:extra*", destination: "/api/hosted?__route=oidc" },
      { source: "/decisions/calendar/:link", destination: "/api/hosted?__route=calendar&t=:link" },
      { source: "/decisions", destination: "/api/hosted?__route=decisions" },
      { source: "/account", destination: "/api/hosted?__route=account" },
    ]);
    assert.ok(!config.rewrites.some((rule) => rule.source === "/" || rule.source === "/:path*" || rule.source === "/(.*)"));

    const routes = config.routes;
    assert.ok(Array.isArray(routes), "vercel.json routes negotiate Accept before the filesystem");
    const header = (route, name) => {
      const found = Object.entries(route.headers ?? {}).find(([key]) => key.toLowerCase() === name);
      assert.ok(found, `${name} header`);
      return found[1];
    };
    const acceptPattern = (route) => {
      const has = route.has?.find((item) => item.type === "header" && String(item.key).toLowerCase() === "accept");
      assert.ok(has, "Accept condition");
      const source = typeof has.value === "string" ? has.value : has.value?.re;
      assert.equal(typeof source, "string");
      return new RegExp(source);
    };

    const home = routes.find((route) => (route.dest ?? route.destination) === "/index.md");
    assert.ok(home, "homepage markdown route");
    assert.equal(home.src ?? home.source, "^/$");
    const homeAccept = acceptPattern(home);
    assert.ok(homeAccept.test("text/markdown"));
    assert.ok(homeAccept.test("text/markdown, text/html;q=0.9"));
    assert.equal(homeAccept.test("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), false);
    assert.match(header(home, "content-type"), /^text\/markdown\b/i);
    assert.match(header(home, "vary"), /\bAccept\b/);
    assert.ok(routes.filter((route) => (route.dest ?? route.destination) === "/index.md").every((route) => route.has));

    const errorAt = routes.findIndex((route) => route.handle === "error");
    const notFound = routes.find((route) => (route.dest ?? route.destination) === "/404.md");
    assert.ok(notFound, "404 markdown route");
    assert.ok(errorAt >= 0 && errorAt < routes.indexOf(notFound), "the 404 body is an error route, after a real 404");
    assert.ok(routes.indexOf(home) < errorAt, "the homepage route is not stuck in the error phase");
    assert.equal(notFound.status ?? notFound.statusCode, 404);
    const notFoundAccept = acceptPattern(notFound);
    assert.ok(notFoundAccept.test("text/markdown"));
    assert.equal(notFoundAccept.test("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), false);
    assert.match(header(notFound, "content-type"), /^text\/markdown\b/i);
    assert.match(header(notFound, "vary"), /\bAccept\b/);
    const notFoundPath = new RegExp(notFound.src ?? notFound.source);
    assert.ok(notFoundPath.test("/nope-404-check"));
    for (const kept of ["/mcp", "/decisions", "/decisions/calendar/abc", "/account", "/api/hosted", "/.well-known/oauth-protected-resource", "/pro", "/pro/auth", "/welcome", "/notify/confirm", "/miss/send"]) {
      assert.equal(notFoundPath.test(kept), false, `${kept} stays on its rewrite`);
    }
  });
});
