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
// The standalone sentence "Grill keeps nothing." A word boundary keeps this from matching
// "The free tool has no account and keeps nothing." on /privacy.
const GRILL_KEEPS_NOTHING = /\bGrill keeps nothing\./;
const CHAT_KEEPS_CHOSEN = "Grill in chat keeps only what you choose";

describe("site/page.html", () => {
  it("is a body with no document skeleton, so it publishes as an artifact unchanged", () => {
    assert.doesNotMatch(page, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i);
    assert.match(page.slice(0, 8192), /<title>Grill: grill your AI before you send it to your boss<\/title>/);
  });

  it("links /start, and the README keeps the other setup routes", () => {
    assert.match(page, /<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    for (const needle of ["releases/latest/download/grill.mcpb", "releases/latest/download/grill-skill.zip", "/plugin install grill@grill", "openrouter.ai/keys", "prompts/grill.md"]) {
      assert.ok(readme.includes(needle), `missing ${needle}`);
    }
  });

  it("keeps Meta AI (Muse) connector setup in the README, with a public URL and client ID", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme, /### Meta AI \(Muse\)/);
    assert.match(readme, /ask it to add a custom connector named Grill/);
    assert.match(readme, /custom connectors are created in chat/);
    assert.match(readme, /https:\/\/grillyour\.ai\/mcp/);
    assert.match(readme, /RNdHSHmWCRJO40vd/);
    assert.match(readme, /Same for everyone\. No secret\./);
    assert.doesNotMatch(page, /Meta AI \(Muse\)/);
  });

  it("pairs Copilot only with a company it can't run, in the README", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const table = readme.slice(readme.indexOf("| You think with |"), readme.indexOf("### Meta AI"));
    for (const name of ["Claude", "ChatGPT", "Copilot", "DeepSeek", "Gemini", "Grok", "Muse"]) {
      assert.ok(table.includes(name), `no row for ${name}`);
    }
    assert.match(table, /\| Copilot \| Gemini, because Copilot can run/);
    assert.doesNotMatch(table, /\| Copilot \| Gemini[^\n]*(Claude|ChatGPT|Grok)/);
  });

  it("is open: the homepage sends people to connect, and the invite wall is gone", () => {
    assert.doesNotMatch(page, /prerelease|Ask for an invite|Opening to everyone|only-pre|only-public/);
    assert.match(page, /<main id="top">/);
    assert.match(page, /href="\/start\/\?ref=home"/);
    assert.equal(page.indexOf('id="pro"'), -1);
    assert.equal(page.indexOf('id="setup"'), -1);
  });

  it("keeps Pro checkout off the homepage", () => {
    assert.doesNotMatch(page, /id="pro"|Get Pro|checkout\?plan|Notify me|Get a starter key|\$4\.50 a month|\$9 a month/);
    const pricing = readFileSync(join(ROOT, "api/_pricing.mjs"), "utf8");
    assert.match(pricing, /a month or/);
    assert.match(pricing, /Notify me/);
  });

  it("leads with the tagline, then the choice staying with the person", () => {
    assert.match(page, /^<title>Grill: grill your AI before you send it to your boss<\/title>/);
    assert.match(page, /<h1>Grill your AI before you send it to your boss\.<\/h1>/);
    assert.doesNotMatch(page, /<h1>Get a second opinion before you decide\.<\/h1>/);
    assert.match(page, /<p class="lede">Get the strongest case against your plan from a different AI, right in the chat you already use\. Then you decide\.<\/p>/);
    const line3 = readFileSync(join(ROOT, "README.md"), "utf8").split("\n")[2];
    assert.equal(line3, "**Hear the strongest case against your plan, then decide for yourself.**");
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    assert.match(readme.split("\n")[0], /Grill: grill your AI before you send it to your boss/);
    assert.match(readme, /https:\/\/grillyour\.ai\/demo\//);
  });

  it("says Desktop and Claude Code enforce a different company, and the paste routes warn", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const why = readFileSync(join(ROOT, "docs/WHY.md"), "utf8");
    assert.match(readme, /Claude Desktop and Claude Code enforce that in code/);
    assert.match(readme, /copy-and-paste routes check it and warn you/);
    assert.match(why, /^# Why not just ask your own assistant\?$/m);
  });

  it("says the website counts visits anonymously, and the tool's usage ping is opt-in", () => {
    const visits = "This website counts visits anonymously, with no cookies and nothing that identifies you.";
    const tool = "The installed tool can optionally send one anonymous usage ping to this site after the first successful grill, if you turn that on at install; off by default; never again; never decision words.";
    const launch = "If you join the Pro launch list, we keep your email address, and only that, in Resend until Pro launches, and you can unsubscribe with one click.";
    assert.ok(privacyPage.includes(visits));
    assert.ok(privacyPage.includes(tool));
    assert.ok(privacyPage.includes(launch));
    const PRIVACY_LINE = "Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us.";
    assert.ok(page.includes(`<a href="/terms">${PRIVACY_LINE}</a>`), "the home page states the privacy line, linked to /terms");
    assert.doesNotMatch(page, /Nothing kept unless you choose/);
    assert.doesNotMatch(page, /keeps nothing/i);
    assert.doesNotMatch(page, /keeps none of your decisions/);
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
    assert.match(readme, /On your own key you pay the router/);
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
    assert.match(readFileSync(join(ROOT, "site/about.html"), "utf8"), /href="\/look-back\/"/, "the about page links the look-back page");
    assert.ok(readFileSync(join(ROOT, "docs/DECISION-RECORD.md"), "utf8").includes("version: 1"));
  });

  it("the README says saved decisions and look-back reminders are free today, and paid plans are off", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const costs = readme.slice(readme.indexOf("## What it costs"), readme.indexOf("## Privacy"));
    assert.ok(costs.length > 0 && costs.length < 1000, "the What it costs section sits right before Privacy");
    assert.ok(
      costs.includes("Saved decisions and look-back reminders are free today with [Grill in your chat](https://grillyour.ai/start/?ref=readme). Paid plans are off."),
      "the README should say what is free today and that paid plans are off",
    );
    assert.match(costs, /Grill is free\. On your own key you pay the router\./);
    assert.match(costs, /The free tool stays free and account-free\./);
    assert.doesNotMatch(costs, /Coming later|Pro plan|Hear when|notify\?via=/);
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

  it("does not count install clicks on the homepage, and the README still states the Desktop setup time", () => {
    assert.doesNotMatch(page, /data-track|grillTrack|CHANNEL_REFS/);
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /optional channel tag \(`ref`\)/);
    assert.match(privacyPage, /optional channel tag \(<code>ref<\/code>\) from a fixed list/);
    assert.match(privacyPage, /A missing tag is left off/);
    assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /about 2 minutes with a key, about 10 if you need one/);
  });

  it("is one pitch, one sentence, one Connect Grill button, and the privacy line", () => {
    assert.equal((page.match(/<h1>/g) || []).length, 1);
    assert.equal((page.match(/<a class="button"/g) || []).length, 1);
    assert.match(page, /<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
    assert.match(page, /Grill only uses your decisions to give you a verdict and your later look-backs\. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us\./);
    assert.doesNotMatch(page, /id="how"|id="examples"|id="setup"|class="chat"|class="routes"/);
    assert.equal((page.match(/<script\b/gi) || []).length, 0);
    assert.doesNotMatch(page, /Settings → Connectors/);
  });

  it("defines its colours as tokens for light, dark-by-system and dark-by-choice", () => {
    assert.match(page, /:root \{[\s\S]*--paper:/);
    assert.match(page, /@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme="light"\]\)/);
    assert.match(page, /:root\[data-theme="dark"\]/);
  });
});

describe("the terms page", () => {
  const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");

  it("says what the code does: the allowance, the prices, cancelling and refunds", () => {
    assert.match(terms, /a one-time allowance of checks for one verified email and does not refill/);
    assert.match(terms, /a generous monthly allowance of checks/);
    assert.match(terms, /\$9 a month or \$90 a year/);
    assert.doesNotMatch(page, /Grill Pro is \$9 a month/);
    assert.match(readFileSync(join(ROOT, "api/_pricing.mjs"), "utf8"), /a month or/);
    assert.match(terms, /cancel anytime/);
    assert.match(terms, /within 30 days of your first payment/);
    assert.match(terms, /No card/);
    assert.match(terms, /mailto:support@grillyour\.ai/);
    assert.doesNotMatch(terms, /hello@/);
    assert.doesNotMatch(page, /hello@/);
    assert.doesNotMatch(readFileSync(join(ROOT, "README.md"), "utf8"), /hello@/);
    assert.doesNotMatch(readFileSync(join(ROOT, "SECURITY.md"), "utf8"), /hello@/);
    assert.doesNotMatch(readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8"), /hello@/);
    assert.ok(!terms.includes("—"), "no em dashes");
    assert.match(terms, /<h2>Grill inside your chat<\/h2>/);
    assert.match(terms, /Nothing is charged to you/);
    assert.match(terms, /Grill advises, you decide/);
    assert.doesNotMatch(terms, /made by Hold(?! Systems)/);
    const privacySrc = readFileSync(join(ROOT, "site/privacy.html"), "utf8");
    assert.ok(privacySrc.includes("This website counts visits anonymously, with no cookies and nothing that identifies you."));
    assert.ok(!privacySrc.includes("—"), "no em dashes");
    assert.ok(!page.includes("—"), "no em dashes");
    assert.ok(!lookBack.includes("—"), "no em dashes");
    assert.ok(!privacyPage.includes("—"), "no em dashes");
  });

  it("names the operator and the postal address, with no placeholder left", () => {
    assert.match(terms, /Grill is made by Hold Systems, a DBA, the trading name of a sole proprietor\./);
    assert.match(terms, /418 Broadway # 12493, Albany, NY 12207, USA/);
    assert.match(terms, /mailto:support@grillyour\.ai/);
    assert.doesNotMatch(terms, /\[address coming soon\]/i);
    assert.doesNotMatch(terms, /\[ADDRESS\]/);
    assert.doesNotMatch(terms, /\bTODO\b/);
    assert.doesNotMatch(terms, /\bTBD\b/);
    assert.doesNotMatch(terms, /\b(?:LLC|Inc)\b/);
    assert.doesNotMatch(terms, /limited liability/i);
  });
});

describe("the contribute page", () => {
  const contribute = readFileSync(join(ROOT, "site/contribute.html"), "utf8");

  it("is linked from the terms page, and the homepage footer stays the Hold line", () => {
    assert.doesNotMatch(page, /href="\/contribute\/"/);
    const footer = page.match(/<div class="footer">[\s\S]*?<\/div>/)?.[0] || "";
    assert.match(footer, /Made at <a href="https:\/\/hold\.quest">Hold<\/a>/);
    assert.match(readFileSync(join(ROOT, "site/terms.html"), "utf8"), /href="\/contribute\/"/);
    assert.match(contribute, /<a href="\/contribute\/">Contribute<\/a>/);
  });

  it("says why help matters, the ways to help, and how a change is reviewed", () => {
    assert.match(contribute, /<title>Contribute to Grill<\/title>/);
    assert.match(contribute, /one model, from a different company/);
    assert.match(contribute, /no ads, no selling your data, and no training on your decisions\. Grill is paid for by subscriptions only\./);
    assert.match(contribute, /<h2>Ways to help<\/h2>/);
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
    assert.match(head, /<meta name="description" content="Grill your AI before you send it to your boss\. A different AI argues the case against your plan and names one cheap test\. Works with ChatGPT, Claude, Gemini and more\.">/);
    assert.match(head, /<link rel="canonical" href="https:\/\/grillyour\.ai\/">/);
    assert.match(head, /<meta name="color-scheme" content="light dark">/);
    assert.match(head, /<meta name="theme-color" content="#f7f4ef" media="\(prefers-color-scheme: light\)">/);
    assert.match(head, /<meta name="theme-color" content="#161513" media="\(prefers-color-scheme: dark\)">/);
    assert.match(head, /--paper:/);
    assert.match(rest, /<body>[\s\S]*<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
    const terms = readFileSync(join(ROOT, "_site/terms/index.html"), "utf8");
    assert.match(terms, /<title>Grill terms<\/title>/);
    assert.match(terms, /<link rel="canonical" href="https:\/\/grillyour\.ai\/terms\/">/);
    assert.match(terms, /--paper:/, "the terms page borrows the site's styles");
    const contribute = readFileSync(join(ROOT, "_site/contribute/index.html"), "utf8");
    assert.match(contribute, /<title>Contribute to Grill<\/title>/);
    assert.match(contribute, /<link rel="canonical" href="https:\/\/grillyour\.ai\/contribute\/">/);
    assert.match(contribute, /How to improve Grill\./);
    assert.match(contribute, /--paper:/, "the contribute page borrows the site's styles");
    assert.match(contribute, /src="\/brand\/favicon-32\.png"/);
    for (const [dir, title] of [["look-back", "Look back on a decision | Grill"], ["privacy", "Grill privacy"]]) {
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

  // Search results and link previews show the <title>. Every public page names the
  // product as a word, the way /check-your-ai/ already does ("… | Grill"). Lowercase
  // "grill" in a sentence does not count.
  it("names Grill in the title of every sitemap page", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    assert.ok(locs.includes("https://grillyour.ai/demo/"));
    assert.ok(locs.includes("https://grillyour.ai/look-back/"));
    const missing = [];
    for (const loc of locs) {
      const pathname = new URL(loc).pathname;
      const htmlPath = pathname === "/"
        ? join(ROOT, "_site/index.html")
        : join(ROOT, "_site", pathname.replace(/^\//, ""), "index.html");
      const html = readFileSync(htmlPath, "utf8");
      const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      if (!/\bGrill\b/.test(title)) missing.push(`${pathname} <title>${title}</title>`);
    }
    assert.deepEqual(missing, []);
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
        /^> Grill your AI before you send it to your boss\. An outside judge gives the strongest case against a decision\. When Grill can tell which AI wrote the plan, the judge is from a different company\.\n/m,
      );
      assert.match(llms, /https:\/\/grillyour\.ai\/mcp/);
      assert.match(llms, /Anyone can sign up and connect Grill to the AI they use at https:\/\/grillyour\.ai\/mcp\./);
      assert.match(llms, /Asking Claude in a chat to connect it does not work\./);
      assert.doesNotMatch(llms, /invite-only/);
      assert.doesNotMatch(llms, /Join the waitlist/);
      assert.match(llms, /\[GitHub\]\(https:\/\/github\.com\/mtangoz\/grill\): \S/);
      // The GitHub line says what is in the repo. It makes no claim about the judge.
      assert.match(llms, /^- \[GitHub\]\(https:\/\/github\.com\/mtangoz\/grill\): The code, the tests and the judge prompt\.$/m);
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
    const OWN_SCRIPTS = { "look-back/index.html": 1, "miss/index.html": 1, "start/index.html": 1 };
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
    const invite = "Anyone can sign up and connect Grill to the AI they use at https://grillyour.ai/mcp.";
    const build = (extra = {}) => {
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe", env: { ...process.env, ...extra } });
      return readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    };
    const check = (llms) => {
      assert.equal(llms.split(invite).length - 1, 1);
      assert.equal(llms.split("## When to use Grill").length - 1, 1);
      const whenAt = llms.indexOf("## When to use Grill\n");
      const pagesAt = llms.indexOf("## Pages\n");
      assert.ok(whenAt > llms.indexOf(invite), "the sign-up line stays above the new section");
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
    assert.doesNotMatch(off, /starter-amount|Get a starter key|checkout\?plan/);
    const on = build({ GRILL_PRO_BILLING: "subscription" });
    assert.match(on, /<main id="top" data-billing="subscription">/);
    assert.doesNotMatch(on, /starter-amount|Get a starter key|checkout\?plan/);
    const ignored = build({ GRILL_PRO_BILLING: "yes" });
    assert.doesNotMatch(ignored, /<main[^>]*data-billing/);
    const custom = build({ GRILL_STARTER_ALLOWANCE_USD: "1.25" });
    assert.doesNotMatch(custom, /starter-amount|\$1\.25/);
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
    assert.match(demo, /<meta property="og:title" content="See a grill before you set one up \| Grill">/);
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
    assert.doesNotMatch(off, /Get a starter key|Notify me|action="\/notify"/);
    const on = build("1");
    assert.match(on, /<main id="top" data-notify>/);
    assert.doesNotMatch(on, /Get a starter key|Notify me|action="\/notify"|href="\/pro"/);
    assert.match(readFileSync(join(ROOT, "vercel.json"), "utf8"), /GRILL_PRO_NOTIFY=1 node scripts\/build-site\.mjs/);
    const ignored = build("yes-please");
    assert.doesNotMatch(ignored, /<main[^>]*data-notify/);
    assert.doesNotMatch(ignored, /Get a starter key|Notify me/);
  });
});

// /start asks which AI, then shows that tool's short steps, then one prompt to copy.
// The only script copies that prompt. It does not read ?ref=.
describe("the /start page", () => {
  const startPath = join(ROOT, "site/start.html");
  const CLAUDE_LINK = "https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=Grill&amp;connectorUrl=https%3A%2F%2Fgrillyour.ai%2Fmcp";
  const CURSOR_LINK = "https://cursor.com/en/install-mcp?name=Grill&amp;config=eyJ1cmwiOiJodHRwczovL2dyaWxseW91ci5haS9tY3AifQ==";
  const VSCODE_LINK = "https://insiders.vscode.dev/redirect/mcp/install?name=Grill&amp;config=%7B%22name%22%3A%22Grill%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fgrillyour.ai%2Fmcp%22%7D";
  const HOSTED = "https://grillyour.ai/mcp";
  const PROMPT_LINK = "https://github.com/mtangoz/grill/blob/main/prompts/grill.md";
  const STARTER = "Grill this: should I captain Erling Haaland or Nicholas Jackson this week?";
  const PRIVACY_LINE = "Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us.";
  const CHIPS = [
    ["chatgpt", "ChatGPT"],
    ["claude", "Claude"],
    ["grok", "Grok Bot"],
    ["cursor", "Cursor / VS Code"],
    ["other", "Other AI"],
  ];

  function section(html, id, next) {
    const from = html.indexOf(`id="${id}"`);
    const to = html.indexOf(`id="${next}"`);
    assert.ok(from !== -1, id);
    assert.ok(to > from, `${id} comes before ${next}`);
    return html.slice(from, to);
  }

  it("asks which AI, then shows that tool's steps and one prompt", () => {
    const start = readFileSync(startPath, "utf8");
    assert.match(start, /^<title>Start using Grill<\/title>/);
    assert.match(start, /<h1>Connect Grill to your AI\.<\/h1>/);
    assert.match(page, /\.tool-panel\s*\{[^}]*display:\s*none/);
    assert.match(page, /code\s*\{[^}]*overflow-wrap:\s*anywhere/);
    assert.match(page, /\.picker\s*\{[^}]*min-inline-size:\s*0/);
    assert.match(page, /@media \(prefers-color-scheme: dark\)/);
    let seen = -1;
    for (const [id, label] of CHIPS) {
      const at = start.indexOf(`id="pick-${id}"`);
      assert.ok(at > seen, `chip ${id} keeps the order`);
      seen = at;
      assert.match(start, new RegExp(`<input class="tool-pick" type="radio" name="tool" id="pick-${id}">`));
      assert.match(start, new RegExp(`<label class="choice" for="pick-${id}">${label.replace("/", "\\/")}<\\/label>`));
      assert.match(page, new RegExp(`#pick-${id}:checked ~ \\.for-${id}`));
      assert.match(page, new RegExp(`#pick-${id}:checked ~ \\.for-either`));
      for (const [other] of CHIPS) {
        if (other === id) continue;
        assert.doesNotMatch(page, new RegExp(`#pick-${id}:checked ~ \\.for-${other}`));
      }
    }
    assert.ok(start.indexOf('id="pick-other"') < start.indexOf('id="chatgpt-steps"'), "every chip comes before the panels");
    const chatgpt = section(start, "chatgpt-steps", "claude-steps");
    assert.match(chatgpt, /Use it on chatgpt\.com, in the same account or workspace where you added it\. Pick @Grill so ChatGPT actually calls it\. The phone app can't run custom connectors yet\./);
    assert.match(chatgpt, /If ChatGPT answers "as Grill" without showing a Grill tool call, it hasn't really grilled anything\./);
    assert.doesNotMatch(chatgpt, /works in the phone app|iOS app|Custom plugins can't be added/);
    assert.match(chatgpt, /https:\/\/chatgpt\.com\//);
    assert.equal((chatgpt.match(/<li>/g) ?? []).length, 4, "ChatGPT is four lines");
    assert.match(chatgpt, /Plugins → \+ → Add custom MCP server/);
    assert.match(chatgpt, /https:\/\/grillyour\.ai\/mcp/);
    assert.match(chatgpt, /Authentication: OAuth/);
    assert.match(chatgpt, /I understand and want to continue/);
    assert.doesNotMatch(chatgpt, /Developer mode|Settings → Security and login/);
    const claude = section(start, "claude-steps", "grok-steps");
    assert.ok(claude.includes(CLAUDE_LINK), "Claude deep link");
    assert.match(claude, /Customize → Connectors → Add custom connector/);
    assert.doesNotMatch(claude, /Settings → Connectors/);
    assert.equal((claude.match(/<li>/g) ?? []).length, 0);
    assert.match(claude, /Works on the web, the desktop app and the phone app\. The free plan allows only one custom connector\. On a Team plan, an owner adds Grill, then each person signs in to Grill themselves\./);
    const grok = section(start, "grok-steps", "cursor-steps");
    assert.match(grok, /Tell the bot <code>Add this MCP server: https:\/\/grillyour\.ai\/mcp<\/code>, then sign in when asked\./);
    assert.equal((grok.match(/<li>/g) ?? []).length, 0);
    assert.doesNotMatch(grok, /coming soon|Gemini|Meta AI|Keep Activity|custom app/i);
    assert.match(grok, /Works on the desktop app and the phone app\. Premium, Super and Ultra on The X Subscription include it\. Check your X plan includes Grok Bot\./);
    assert.doesNotMatch(grok, /\bweb\b/i);
    const cursor = section(start, "cursor-steps", "other-steps");
    const mcpAt = cursor.indexOf(HOSTED);
    const keyAt = cursor.indexOf("--set-key");
    assert.ok(mcpAt !== -1, "hosted connector URL in the Cursor / VS Code panel");
    assert.ok(keyAt > mcpAt, "hosted path leads, before --set-key");
    assert.ok(cursor.includes(CURSOR_LINK), "Cursor one-click install");
    assert.ok(cursor.includes(VSCODE_LINK), "VS Code one-click install");
    const cursorConfig = JSON.parse(Buffer.from(new URL(CURSOR_LINK.replaceAll("&amp;", "&")).searchParams.get("config"), "base64").toString());
    assert.equal(cursorConfig.url, HOSTED);
    assert.equal(cursorConfig.command, undefined);
    const vscodeConfig = JSON.parse(new URL(VSCODE_LINK.replaceAll("&amp;", "&")).searchParams.get("config"));
    assert.equal(vscodeConfig.name, "Grill");
    assert.equal(vscodeConfig.type, "http");
    assert.equal(vscodeConfig.url, HOSTED);
    assert.equal(vscodeConfig.command, undefined);
    assert.match(cursor, /Add Grill to Cursor/);
    assert.match(cursor, /Add Grill to VS Code/);
    assert.match(cursor, /Or add it by hand\. Name: <code>Grill<\/code>\. Type: Streamable HTTP \(HTTP in VS Code\)\. URL: <code>https:\/\/grillyour\.ai\/mcp<\/code>\. Leave the token and header fields empty, then Save\. Grill asks you to sign in the first time you use it\./);
    assert.match(cursor, /Streamable HTTP/);
    assert.match(cursor, /Leave the token and header fields empty/);
    assert.doesNotMatch(cursor, /Authentication: OAuth/);
    assert.match(cursor, /Sign in with your email\. We send you a code \(check spam\)\. No key\./);
    assert.match(cursor, /Copilot in VS Code uses the same server\./);
    assert.match(cursor, /Or use your own key\. Once: <code>npx -y grillyour --set-key<\/code>\. Paste your key, Enter, then Ctrl-D\./);
    assert.match(cursor, /add a server named <code>grill<\/code> that runs:/);
    assert.match(cursor, /<p><code>npx -y grillyour<\/code><\/p>/);
    assert.match(cursor, /In VS Code: MCP: Open User Configuration\./);
    assert.match(cursor, /In Cursor, a desktop connection and a Cloud Agent connection are separate sign-ins\./);
    assert.doesNotMatch(cursor, /coming soon|verified working/i);
    assert.doesNotMatch(cursor, /eyJjb21tYW5kIjoibnB4|"command":"npx"/);
    const other = section(start, "other-steps", "try-grill");
    assert.match(other, /Copilot, DeepSeek, Gemini, Muse, Grok and more\. Copy and paste\. No install, no key\./);
    assert.ok(other.includes(PROMPT_LINK), "the paste prompt");
    assert.match(other, /into the assistant you think with, and say what you're deciding/);
    assert.match(other, /gives you a prompt for the judge/);
    assert.match(other, /Paste that into an assistant from a different company, then paste the answer back/);
    assert.match(other, /ChatGPT into Claude, Gemini or Grok\. Copilot into Gemini, because Copilot can run OpenAI, Anthropic or xAI models\. DeepSeek into Claude, ChatGPT, Gemini or Grok\. Gemini into Claude, ChatGPT or Grok\. Grok into Claude, ChatGPT or Gemini\. Muse into Claude, ChatGPT or Gemini\./);
    assert.match(other, /To connect Grill in Microsoft 365 Copilot, an admin has to add it first\. Copy and paste works without that\. Consumer Copilot's documented connectors don't include custom servers, so use copy and paste\./);
    assert.doesNotMatch(other, /Copilot into (Claude|ChatGPT|Grok)/);
    assert.doesNotMatch(other, /grillyour\.ai\/mcp|custom connector|Keep Activity|Connected Apps|Add a custom app|Should work|coming soon|Meta AI|RNdHSHmWCRJO40vd|US only|personal Google/i);
    assert.match(start, /When Grill is connected, most apps show a Grill tool call when it runs\. If yours shows none and the answer still claims to be Grill's, Grill may not have run\./);
    assert.doesNotMatch(start, /Grill doesn't (see|keep)|Grill does not (see|keep) grills/i);
    assert.ok(start.includes(`<p id="starter-prompt">${STARTER}</p>`), "starter prompt");
    assert.match(start, /<button class="button" type="button" id="copy-starter">Copy<\/button>/);
    assert.match(start, /class="tool-panel for-either" id="try-grill"/);
    assert.doesNotMatch(start, /Should work, testing now|coming soon|Meta AI|verified working|Keep Activity|Connected Apps|Add a custom app|personal Google account/i);
    assert.doesNotMatch(start, /the same email you signed up with, every time/i);
    assert.doesNotMatch(start, /invite-only|waitlist/i);
    const github = [...start.matchAll(/https:\/\/github\.com[^"'\s<]*/g)].map((match) => match[0]);
    assert.deepEqual(github, [PROMPT_LINK]);
    assert.doesNotMatch(start, /chatgpt\.com\/gpts|plugin directory|directory listing/i);
    assert.doesNotMatch(start, /<style/i);
    assert.ok(start.includes(`<a href="/terms">${PRIVACY_LINE}</a>`));
    assert.doesNotMatch(start, /Nothing kept unless you choose|keeps nothing/i);
    const scripts = start.match(/<script\b/gi) ?? [];
    assert.equal(scripts.length, 1);
    const script = start.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "";
    assert.match(script, /getElementById\("copy-starter"\)/);
    assert.doesNotMatch(script, /grillTrack|cookie|localStorage|pick-/);
    const log = readFileSync(join(ROOT, "MERGE-LOG.md"), "utf8");
    assert.match(log, /2026-11-07/);
    assert.match(log, /Connect Grill \(2 minutes\)/);
    assert.match(log, /\/start/);
    assert.match(log, /\| 2026-11-08 \| \/start also offers Grok Bot, Cursor \/ VS Code, and Other AI\. Grok Bot uses its verified connector line\. Cursor and VS Code use the documented npx setup\. Other AI is copy and paste for Copilot, Gemini, Muse, Grok and more\. \|/);
    assert.match(log, /\| 2026-11-09 \| Muse setup copy matches Meta's current custom-connector flow: ask Muse in chat, URL https:\/\/grillyour\.ai\/mcp, Client ID only if Muse asks\. Not yet verified end to end\. \|/);
    assert.match(log, /\| 2026-11-09 \| Tony approved on 2026-11-09: Other AI and the paste route list DeepSeek\. DeepSeek is copy-and-paste only; its consumer chat cannot add a remote connector\. The prompt pairs DeepSeek with Claude, ChatGPT, Gemini or Grok\. \|/);
    assert.match(log, /\| 2026-11-09 \| Homepage Connect links to \/start\/\?ref=home\. Every \/start view increments grill:metric:start_views\. Weekly metrics print start views and start refs\. cta_connect is on the event allowlist\. The \/start API page sends no client analytics\. Plan: docs\/experiments\/analytics-loop\.md\. \|/);
    assert.match(log, /\| 2026-11-11 \| Tony approved on 2026-11-11: ChatGPT setup copy no longer says the phone app runs Grill\. Custom connectors work on chatgpt\.com, and in the desktop app where that is supported, in the account or workspace where they were added\. The iPhone and Android apps cannot run them\. Developer Mode is not required\. The start page says to pick @Grill, and that an answer "as Grill" with no Grill tool call has not grilled anything\. \|/);
    assert.match(log, /\| 2026-11-11 \| Setup copy names each app's limit before you hit it, and how to check Grill ran: when Grill is connected, most apps show a Grill tool call when it runs; if yours shows none and the answer still claims to be Grill's, Grill didn't run\. Claude works on the web, desktop and phone; the free plan allows only one custom connector; on a Team plan an owner adds Grill, then each person signs in themselves\. Gemini stays a personal Google account, in the US, 18 or over, in English, with Keep Activity on\. To connect Grill in Microsoft 365 Copilot, an admin has to add it first; copy and paste works without that\. Consumer Copilot's documented connectors don't include custom servers, so use copy and paste\. Cursor desktop and Cloud Agent sign-ins are separate\. Codex cloud authentication is checked separately\. Grok Bot works on desktop and phone\. Premium, Super and Ultra on The X Subscription include it\. Check your X plan includes Grok Bot\. Muse stays not yet verified\. \|/);
    assert.match(log, /\| 2026-11-11 \| Tony approved on 2026-11-11: the line that checks Grill ran is no longer absolute\. On \/start, in the README, and in docs\/UX\.md it now ends: if yours shows none and the answer still claims to be Grill's, Grill may not have run\. \|/);
    const ux = readFileSync(join(ROOT, "docs/UX.md"), "utf8");
    assert.match(ux, /ChatGPT shows four short steps/);
    assert.match(ux, /Claude shows a pre-filled add-connector link/);
    assert.match(ux, /Grok Bot shows the one line that adds `https:\/\/grillyour\.ai\/mcp`/);
    assert.match(ux, /Cursor and VS Code show the hosted connector at `https:\/\/grillyour\.ai\/mcp`, then the npx setup for your own key/);
    assert.match(ux, /Other AI shows the copy-and-paste steps for Copilot, DeepSeek, Gemini, Muse, Grok and more/);
    assert.match(ux, /Then one prompt to copy\. Its only script copies that prompt/);
    assert.match(ux, /and if yours shows none and the answer still claims to be Grill's, Grill may not have run\./);
  });

  it("does not say Gemini or Muse are testing now, still being tested, or coming soon", () => {
    const stale = /testing now|still being tested|coming soon/i;
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const hosted = readFileSync(join(ROOT, "docs/HOSTED.md"), "utf8");
    const faq = readFileSync(join(ROOT, "site/faq.html"), "utf8");
    for (const [file, text] of [["README.md", readme], ["docs/HOSTED.md", hosted], ["site/faq.html", faq]]) {
      assert.doesNotMatch(text, stale, `${file} still has a stale Gemini or Muse line`);
    }
    const chat = readme.slice(readme.indexOf("### Grill in chat"), readme.indexOf("###", readme.indexOf("### Grill in chat") + 4));
    assert.match(chat, /\*\*Gemini\*\*: Copy and paste works today\. No install, no key\./);
    assert.match(chat, /Adding Grill as a connector inside Gemini is not verified\. You can try it\./);
    assert.match(chat, /\*\*Meta AI \(Muse\)\*\*: Copy and paste works today\. No install, no key\./);
    assert.match(chat, /Adding Grill as a connector inside Muse is not verified\. You can try the steps/);
    assert.match(hosted, /Gemini and Muse work today by copy and paste, no install, no key\. Adding Grill as a connector inside Gemini or Muse is not verified\./);
    assert.match(faq, /<strong>Live\.<\/strong> Copy and paste into ChatGPT, Copilot, DeepSeek, Gemini, Grok or Muse\. No install, no key\./);
    assert.match(faq, /<strong>Preview\.<\/strong> Adding Grill as a connector inside Gemini or Muse is not verified\./);
    assert.match(faq, /<strong>Planned\.<\/strong>/);
  });

  it("the homepage button is the only way in, and the README keeps the other setups", () => {
    assert.match(page, /<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
    assert.equal((page.match(/<a class="button"/g) || []).length, 1);
    assert.doesNotMatch(page, /id="pro"|Get Pro|checkout\?plan|Notify me|Get a starter key/);
    assert.doesNotMatch(page, /Settings → Connectors/);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const chat = readme.slice(readme.indexOf("### Grill in chat"), readme.indexOf("###", readme.indexOf("### Grill in chat") + 4));
    assert.match(chat, /https:\/\/grillyour\.ai\/start\//);
    assert.match(chat, /The steps are at \[grillyour\.ai\/start\]\(https:\/\/grillyour\.ai\/start\/\?ref=readme\)\./, "the README setup link carries the readme tag");
    assert.match(chat, /https:\/\/claude\.ai\/customize\/connectors\?modal=add-custom-connector/);
    assert.match(chat, /Customize → Connectors → Add custom connector/);
    assert.doesNotMatch(chat, /Settings → Connectors → Add custom connector/);
    assert.match(chat, /Add custom MCP server/);
    assert.match(chat, /same account or workspace where you add it/);
    assert.match(chat, /desktop app where that is supported/);
    assert.match(chat, /iPhone and Android apps can't run custom connectors/);
    assert.doesNotMatch(chat, /Developer mode|phone app too|Settings → Security and login/);
    assert.match(chat, /OAuth/);
    assert.match(chat, /I understand and want to continue/);
    assert.match(chat, /Grok Bot/);
    assert.match(chat, /Add this MCP server: https:\/\/grillyour\.ai\/mcp/);
    assert.match(chat, /Asking Claude in a chat to connect it does not work/);
    assert.match(chat, /Anyone can sign up/);
    assert.match(chat, /Works on the web, the desktop app and the phone app\. The free plan allows only one custom connector\. On a Team plan, an owner adds Grill, then each person signs in to Grill themselves\./);
    assert.match(chat, /Works on the desktop app and the phone app\. Premium, Super and Ultra on The X Subscription include it\. Check your X plan includes Grok Bot\./);
    assert.match(chat, /For now, a personal Google account, in the US, 18 or over, in English, with Keep Activity on\./);
    assert.match(chat, /\*\*Microsoft 365 Copilot\.\*\* To connect Grill in Microsoft 365 Copilot, an admin has to add it first\. Copy and paste works without that\. Consumer Copilot's documented connectors don't include custom servers, so use copy and paste\./);
    assert.match(chat, /Not yet verified end to end/);
    const setup = readme.slice(readme.indexOf("## Set up"), readme.indexOf("## What it costs"));
    assert.match(setup, /When Grill is connected, most apps show a Grill tool call when it runs\. If yours shows none and the answer still claims to be Grill's, Grill may not have run\./);
    assert.match(setup, /In Cursor, a desktop connection and a Cloud Agent connection are separate sign-ins\. In Codex, check cloud authentication separately from the desktop app\./);
    assert.doesNotMatch(setup, /Grill doesn't (see|keep)|Grill does not (see|keep) grills/i);
    assert.doesNotMatch(chat, /invite-only/i);
    assert.doesNotMatch(readme, /### Inside Claude\.ai/);
    const hosted = readFileSync(join(ROOT, "docs/HOSTED.md"), "utf8");
    const person = hosted.slice(hosted.indexOf("## What a person does"), hosted.indexOf("## ", hosted.indexOf("## What a person does") + 3));
    assert.match(person, /Customize → Connectors → Add custom connector/);
    assert.doesNotMatch(person, /Settings → Connectors → Add custom connector/);
    assert.match(person, /Anyone can sign up/);
    assert.match(hosted, /https:\/\/grillyour\.ai\/start\//);
  });

  it("builds to /start/ with the site's styles and is in the sitemap", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const built = readFileSync(join(ROOT, "_site/start/index.html"), "utf8");
    assert.match(built, /<title>Start using Grill<\/title>/);
    assert.match(built, /When Grill is connected, most apps show a Grill tool call when it runs\. If yours shows none and the answer still claims to be Grill's, Grill may not have run\./);
    assert.match(built, /<link rel="canonical" href="https:\/\/grillyour\.ai\/start\/">/);
    assert.match(built, /<meta name="description" content="Pick your AI, then connect Grill and paste one message\.">/);
    assert.match(built, /--paper:/);
    assert.match(built, /prefers-color-scheme: dark/);
    assert.ok(built.includes(CLAUDE_LINK));
    assert.ok(built.includes(CURSOR_LINK));
    assert.ok(built.includes(VSCODE_LINK));
    assert.ok(built.includes(PROMPT_LINK));
    assert.ok(built.includes(STARTER));
    assert.match(readFileSync(join(ROOT, "_site/llms.txt"), "utf8"), /\[Start\]\(https:\/\/grillyour\.ai\/start\/\): Pick your AI, then connect\./);
    assert.match(readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8"), /https:\/\/grillyour\.ai\/start\//);
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
    const keys = "Only you see your records on the site. Grill's maintainers hold the encryption keys, so they could technically decrypt records you chose to keep. A grill you choose to send can be read by them, so Grill can learn what is working. They don't publish it, and they don't read a grill you did not send.";
    assert.ok(privacyPage.includes(keys), "encryption-keys line");
    assert.match(privacyPage, /<h2>Using Grill in chat \(the connector\)<\/h2>/);
    assert.match(privacyPage, /The free tool has no account\. Grill keeps a grill from it only when you send that one\. Grill in chat keeps only what you choose, encrypted, and you can delete it\./);
    assert.match(privacyPage, /We don't keep what you decide unless you choose to keep decision records \(Grill in chat\) or saved report copies \(Pro\), and you can delete them\./);
  });
});

// /demo lets a visitor see the grill format on four made-up decisions
// before they connect anything. The first is the work memo from the tagline.
// The verdicts are illustrative. Nothing here is a saved record.
describe("the /demo page", () => {
  const demoPath = join(ROOT, "site/demo.html");
  const VERDICTS = ["solid", "solid, if\u2026", "shaky", "doesn\u2019t hold up"];
  const closing = "Say \u2018more\u2019, \u2018options\u2019, or your call.";
  const disclaimer = "These are made-up decisions and illustrative verdicts, written to show the format, not real users\u2019 decisions and not saved records.";

  it("is four made-up chats, with a visible label and no script", () => {
    assert.ok(existsSync(demoPath), "site/demo.html exists");
    const demo = readFileSync(demoPath, "utf8");
    const contribute = readFileSync(join(ROOT, "site/contribute.html"), "utf8");
    const nav = (html) => html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0];
    const footer = (html) => html.match(/<div class="footer">[\s\S]*?<\/div>/)?.[0];
    assert.equal(nav(demo), nav(contribute));
    assert.equal(footer(demo), footer(contribute));
    assert.match(demo, /^<title>See a grill before you set one up \| Grill<\/title>/);
    assert.equal((demo.match(/<h1>/g) ?? []).length, 1);
    assert.match(demo, /<h1>See a grill before you set one up\.<\/h1>/);
    assert.equal((demo.match(/class="lede"/g) ?? []).length, 1);
    assert.doesNotMatch(demo, /<script/i);
    assert.doesNotMatch(demo, /onclick=|javascript:/i);

    const label = disclaimer.slice("These are ".length);
    const labelAt = demo.toLowerCase().indexOf(label);
    const h1 = demo.indexOf("<h1>");
    const firstChat = demo.indexOf('class="chat"');
    assert.ok(labelAt > h1 && labelAt < firstChat, "the made-up label sits near the top, before the examples");
    assert.doesNotMatch(demo, /<!--[\s\S]*made-up decisions/);

    const chats = [...demo.matchAll(/<div class="chat"[\s\S]*?<\/div>/g)].map((match) => match[0]);
    assert.equal(chats.length, 4);
    assert.match(chats[0], /ChatGPT drafted my memo/);
    assert.match(chats[0], /\bboss\b/);
    assert.match(chats[1], /used car/);
    assert.match(chats[2], /two-year lease/);
    assert.match(chats[3], /school across town/);
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
    assert.equal(details.length, 4);
    for (const block of details) {
      assert.match(block, /<summary>more<\/summary>/);
      const text = block.replace(/<summary>more<\/summary>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.ok(sentences.length >= 2 && sentences.length <= 3, text);
      assert.match(text, /strongest case against/i);
      assert.match(text, /your call/i);
    }
    assert.doesNotMatch(demo, /\b(coworker|workplace|office|sprint|standup|company)\b/i);

    const lastDetails = demo.lastIndexOf("</details>");
    const cta = demo.indexOf('class="cta"');
    const foot = demo.indexOf('class="footer"');
    assert.ok(lastDetails < cta && cta < foot, "the call to action follows the examples");
    // Both links under the examples carry the demo tag, so /start can count who came from here.
    assert.match(demo, /<a class="button" href="\/start\/\?ref=demo">Connect Grill<\/a>/);
    assert.match(demo, /<a href="\/start\/\?ref=demo">Anyone can sign up<\/a>/);
    assert.equal((demo.match(/href="\/start\/\?ref=demo"/g) ?? []).length, 2);
    assert.equal((demo.match(/href="\/start\/"/g) ?? []).length, 1, "only the shared nav links /start/ without a tag");
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
    assert.match(llms, /\[Demo\]\(https:\/\/grillyour\.ai\/demo\/\): Four made-up decisions, and what Grill said about each\./);
    const builtChats = [...built.matchAll(/<div class="chat"[\s\S]*?<\/div>/g)].map((match) => match[0]);
    assert.equal(builtChats.length, 4);
    assert.match(builtChats[0], /ChatGPT drafted my memo/);
    assert.match(builtChats[0], /\bboss\b/);
    assert.ok(built.includes(disclaimer), "the disclaimer is still present");
    assert.doesNotMatch(readFileSync(demoPath, "utf8"), /<script/i);
    const rest = built.replace(analyticsSnippet(process.env), "");
    assert.equal(rest.match(/<script\b/gi)?.length ?? 0, 0, "/demo has a script of its own");
    const threeMadeUp = /three made-up/i;
    const textFiles = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(html|md|txt|xml)$/i.test(entry.name)) textFiles.push(path);
      }
    };
    walk(join(ROOT, "_site"));
    const hits = textFiles.filter((path) => threeMadeUp.test(readFileSync(path, "utf8"))).map((path) => relative(ROOT, path));
    assert.deepEqual(hits, [], `three made-up remains in ${hits.join(", ")}`);
    assert.doesNotMatch(llms, threeMadeUp);
    assert.doesNotMatch(readFileSync(join(ROOT, "README.md"), "utf8"), threeMadeUp);
  });

  it("the README links /demo/, and the homepage does not list examples", () => {
    assert.doesNotMatch(page, /href="\/demo\/"/);
    assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /https:\/\/grillyour\.ai\/demo\//);
  });
});

// /check-your-ai is a short guide for someone about to forward an AI draft.
// It is built like /demo and /about: shared styles, the prose nav and footer, no script of its own.
describe("the /check-your-ai page", () => {
  const sourcePath = join(ROOT, "site/check-your-ai.html");
  const TITLE = "How to check your AI's work before you send it to your boss | Grill";
  const H1 = "Check your AI's work before you send it to your boss.";
  const DESCRIPTION = "Plain checks for an AI draft before you send it to your boss: the assumption, the facts, and one cheap test.";
  const CANONICAL = "https://grillyour.ai/check-your-ai/";
  // The judge line is conditional: a different company only when Grill can tell which AI wrote the draft.
  const JUDGE_LINE = "The judge did not write your draft. When Grill can tell which AI did, the judge comes from a different company. When it cannot, the verdict says so.";
  const nav = (html) => html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0];
  const footer = (html) => html.match(/<div class="footer">[\s\S]*?<\/div>/)?.[0];

  function adviceText(html) {
    const start = html.indexOf("<h1>");
    const end = html.indexOf('<div class="footer">');
    assert.ok(start > 0 && end > start, "advice sits between the h1 and the footer");
    return html.slice(start, end)
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  it("is a script-free guide in the same chrome as the other prose pages", () => {
    assert.ok(existsSync(sourcePath), "site/check-your-ai.html exists");
    const source = readFileSync(sourcePath, "utf8");
    const about = readFileSync(join(ROOT, "site/about.html"), "utf8");
    assert.match(source, new RegExp(`^<title>${TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
    assert.doesNotMatch(source, /<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|<style[\s>]|<script/i);
    assert.equal((source.match(/<h1>/g) ?? []).length, 1);
    assert.ok(source.includes(`<h1>${H1}</h1>`));
    assert.equal(nav(source), nav(about));
    assert.equal(footer(source), footer(about));
    assert.match(source, /href="\/demo\/"/);
    assert.match(source, /href="\/start\/"/);
    assert.ok(source.includes(JUDGE_LINE));
    assert.match(source, /Say [“"]grill this[”"]/);
    assert.match(source, /made-up/);
    assert.match(source, /Nothing in that example is a real decision/);
    assert.ok(!source.includes("—") && !source.includes("–"), "no em dash or en dash");

    const whyAt = source.indexOf("<h2>Why AI drafts sound sure even when they are wrong</h2>");
    assert.ok(whyAt > 0, "the sure-tone section is there");
    const why = source.slice(whyAt).split("<h2>")[1] ?? "";
    const whyText = why.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const sentences = whyText.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length >= 1 && sentences.length <= 2, whyText);
    assert.doesNotMatch(whyText, /\d/);

    const checks = source.slice(source.indexOf("<h2>Four quick checks</h2>"), source.indexOf("<h2>Why a second AI helps</h2>"));
    assert.equal((checks.match(/<li>/g) ?? []).length, 4);
    assert.match(checks, /Find the one assumption the whole draft rests on/);
    assert.match(checks, /Check every number and every name against the source/);
    assert.match(checks, /Ask what would make the recommendation wrong/);
    assert.match(checks, /Pick one cheap test you could run before deciding/);

    const words = adviceText(source).split(" ").filter(Boolean);
    assert.ok(words.length >= 300 && words.length <= 450, `advice is ${words.length} words`);
    assert.doesNotMatch(adviceText(source), /\d/);
    assert.doesNotMatch(adviceText(source), /\b(testimonial|testimonials|studies|study)\b/i);
  });

  it("builds to /check-your-ai/ with a markdown twin, and is listed for people and agents", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const builtPath = join(ROOT, "_site/check-your-ai/index.html");
    const mdPath = join(ROOT, "_site/check-your-ai/index.md");
    assert.ok(existsSync(builtPath), "_site/check-your-ai/index.html exists");
    assert.ok(existsSync(mdPath), "the markdown twin exists");
    const built = readFileSync(builtPath, "utf8");
    const md = readFileSync(mdPath, "utf8");
    assert.match(built, new RegExp(`<title>${TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</title>`));
    assert.ok(built.includes(`<h1>${H1}</h1>`));
    assert.match(built, new RegExp(`<link rel="canonical" href="${CANONICAL}">`));
    assert.match(built, new RegExp(`<meta property="og:url" content="${CANONICAL}">`));
    assert.match(built, new RegExp(`<meta property="og:title" content="${TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    const description = built.match(/<meta name="description" content="([^"]*)">/)?.[1];
    assert.equal(description, DESCRIPTION);
    assert.ok(description.length < 160, `meta description is ${description.length} characters`);
    assert.match(built, new RegExp(`<meta property="og:description" content="${DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
    assert.match(built, /--paper:/, "the page borrows the site's styles");
    assert.match(built, /href="\/demo\/"/);
    assert.match(built, /href="\/start\/"/);
    const source = readFileSync(sourcePath, "utf8");
    assert.doesNotMatch(source, /<script/i);
    const rest = built.replace(analyticsSnippet(process.env), "");
    assert.equal(rest.match(/<script\b/gi)?.length ?? 0, 0, "/check-your-ai has a script of its own");
    assert.ok(md.includes(H1));
    assert.ok(md.includes(JUDGE_LINE));
    assert.ok(md.includes("https://grillyour.ai/demo/"));
    assert.ok(md.includes("https://grillyour.ai/start/"));
    assert.doesNotMatch(md, /<script/i);
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    assert.ok(sitemap.includes(`<loc>${CANONICAL}</loc>`));
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    assert.match(llms, /\[Check your AI's work\]\(https:\/\/grillyour\.ai\/check-your-ai\/\): Four quick checks before you send an AI draft to your boss\./);
  });

  it("the demo page links the guide once, under the examples", () => {
    const demo = readFileSync(join(ROOT, "site/demo.html"), "utf8");
    const needle = '<a href="/check-your-ai/">How to check your AI\'s work</a>';
    assert.equal(demo.split(needle).length - 1, 1);
    const link = demo.indexOf(needle);
    const cta = demo.indexOf('class="cta"');
    const foot = demo.indexOf('class="footer"');
    assert.ok(cta > 0 && cta < link && link < foot, "the guide link sits at the bottom, after the call to action");
  });
});

// /about and /contact are trust pages. Assistants look for them before trusting the site.
// They are built like privacy and terms: the shared template, no script of their own.
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
    assert.doesNotMatch(text, /Get a second opinion before you decide\./);
    assert.match(text, /A model from another company gives a verdict and one cheap test\./);
    assert.ok(
      text.includes("The judge did not write your plan. When Grill can tell which AI did, the judge comes from a different company. When it cannot, the verdict says so."),
      "about should say the judge is from a different company only when Grill can tell which AI wrote the plan",
    );
    // The line above carries the condition, so this one does not say different company on its own.
    assert.match(text, /An outside AI argues the other side\. You decide\. Later you can look back and see how your judgement did\./);
    assert.doesNotMatch(text, /The verdict never becomes the decision\./);
    assert.ok(source.includes(CHAT_KEEPS_CHOSEN), "about source should say what Grill in chat keeps");
    assert.ok(text.includes(CHAT_KEEPS_CHOSEN), "about page should say what Grill in chat keeps");
    assert.doesNotMatch(source, GRILL_KEEPS_NOTHING);
    assert.doesNotMatch(text, GRILL_KEEPS_NOTHING);
    const aboutMd = readFileSync(join(ROOT, "_site/about/index.md"), "utf8");
    assert.ok(aboutMd.includes(CHAT_KEEPS_CHOSEN), "about markdown twin should say what Grill in chat keeps");
    assert.doesNotMatch(aboutMd, GRILL_KEEPS_NOTHING);
    assert.match(text, /Anyone can sign up and connect Grill to the AI they use at/);
    assert.match(text, /Customize → Connectors → Add custom connector/);
    assert.match(text, /Asking Claude in a chat to connect it does not work/);
    assert.doesNotMatch(text, /invite-only/);
    assert.doesNotMatch(text, /waitlist/i);
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

// Open sign-up is on. The public pages say anyone can sign up, and they do not
// send someone to a waitlist or an invite wall to get in.
describe("anyone can sign up", () => {
  const SIGN_UP = "Anyone can sign up";
  const CLAUDE = "Customize → Connectors → Add custom connector";
  const CHAT_DOES_NOT = "Asking Claude in a chat to connect it does not work.";
  const build = () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
  };

  it("points the homepage Connect Grill button at /start", () => {
    assert.match(page, /<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
    assert.doesNotMatch(page, /Settings → Connectors/);
    build();
    const html = readFileSync(join(ROOT, "_site/index.html"), "utf8");
    assert.match(html, /<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
    const md = readFileSync(join(ROOT, "_site/index.md"), "utf8");
    assert.match(md, /\[Connect Grill \(2 minutes\)\]\(https:\/\/grillyour\.ai\/start\/\)/);
  });

  it("points llms.txt at sign-up, not a waitlist", () => {
    build();
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    const invite = "Anyone can sign up and connect Grill to the AI they use at https://grillyour.ai/mcp.";
    const at = llms.indexOf(invite);
    assert.ok(at > 0, "the sign-up sentence stays");
    const between = llms.slice(at + invite.length, llms.indexOf("## When to use Grill"));
    assert.match(
      between,
      /^\n\nIn Claude, open Customize → Connectors → Add custom connector and paste https:\/\/grillyour\.ai\/mcp\. Asking Claude in a chat to connect it does not work\.\n\n$/,
    );
    assert.equal(llms.split(invite).length - 1, 1);
    assert.doesNotMatch(llms, /invite-only/);
    assert.doesNotMatch(llms, /Join the waitlist/);
  });

  it("points the README, about, FAQ and demo at sign-up", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    const about = readFileSync(join(ROOT, "site/about.html"), "utf8");
    const faq = readFileSync(join(ROOT, "site/faq.html"), "utf8");
    const demo = readFileSync(join(ROOT, "site/demo.html"), "utf8");
    const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");
    const privacy = readFileSync(join(ROOT, "site/privacy.html"), "utf8");
    const chat = readme.slice(readme.indexOf("### Grill in chat"), readme.indexOf("\n## ", readme.indexOf("### Grill in chat")));
    for (const [name, text] of [
      ["readme chat", chat],
      ["about", about],
      ["faq", faq],
      ["demo", demo],
      ["terms", terms],
      ["privacy", privacy],
    ]) {
      assert.ok(text.includes(SIGN_UP), `${name} should say anyone can sign up`);
      assert.equal(/invite-only/i.test(text), false, `${name} still says invite-only`);
      assert.equal(/Join the waitlist|No invite code|You hit the invite wall|Invited testers|For invited/.test(text), false, `${name} still sends people to a waitlist or an invite`);
    }
    assert.ok(chat.includes(CLAUDE), "the Grill in chat section names the Claude connector path");
    assert.ok(chat.includes(CHAT_DOES_NOT), "the Grill in chat section says a chat request does not connect Grill");
    assert.ok(about.includes(CLAUDE));
    assert.ok(about.includes(CHAT_DOES_NOT));
    assert.ok(faq.includes(CLAUDE));
    assert.ok(faq.includes(CHAT_DOES_NOT));
    assert.doesNotMatch(readme, /not live yet/);
    assert.match(
      readme,
      /An in-chat account is open to anyone who signs up; what it stores is in \[docs\/DATA-LEDGER\.md\]\(docs\/DATA-LEDGER\.md\)\./,
    );
    build();
    for (const file of ["_site/about/index.md", "_site/faq/index.md", "_site/demo/index.md"]) {
      const md = readFileSync(join(ROOT, file), "utf8");
      assert.ok(md.includes(SIGN_UP), `${file} should say anyone can sign up`);
      assert.doesNotMatch(md, /invite-only/);
      assert.doesNotMatch(md, /Join the waitlist/);
    }
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    const faqSection = llms.slice(llms.indexOf("## FAQ\n"));
    assert.ok(faqSection.includes("Anyone can sign up for Grill in chat."), "llms.txt FAQ should say anyone can sign up");
    assert.ok(faqSection.includes(CHAT_DOES_NOT), "llms.txt FAQ should say a chat request does not connect Grill");
    assert.doesNotMatch(faqSection, /Join the waitlist/);
  });

  it("routes /redeem/ the same way as /redeem", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const redeem = config.rewrites.find((rule) => rule.source === "/redeem");
    const slashed = config.rewrites.find((rule) => rule.source === "/redeem/");
    assert.ok(redeem, "/redeem rewrite");
    assert.deepEqual(slashed, { source: "/redeem/", destination: redeem.destination });
    assert.equal(redeem.destination, "/api/hosted?__route=redeem");
    const sources = config.rewrites.map((rule) => rule.source);
    assert.deepEqual(
      sources.filter((source) => source === "/redeem" || source === "/redeem/"),
      ["/redeem", "/redeem/"],
    );
    assert.equal(sources.filter((source) => source === "/start" || source === "/start/").length, 2);
    assert.equal(config.rewrites.filter((rule) => rule.destination === "/api/hosted?__route=waitlist").length, 1);
    assert.equal(config.rewrites.filter((rule) => rule.source === "/waitlist/").length, 0);
    const route = config.routes.find((row) => row.src === "^/redeem/$");
    assert.ok(route, "a route answers /redeem/");
    assert.equal(route.dest, redeem.destination);
    assert.equal(route.has, undefined);
    const pattern = new RegExp(route.src);
    assert.equal(pattern.test("/redeem/"), true);
    assert.equal(pattern.test("/redeem"), false);
    assert.equal(pattern.test("/redeem/extra"), false);
    assert.equal(pattern.test("/start/"), false);
    const notFound = config.routes.find((row) => row.dest === "/404.md");
    assert.equal(new RegExp(notFound.src).test("/redeem/"), false, "/redeem/ is not a markdown 404");
    assert.equal(new RegExp(notFound.src).test("/redeem"), false, "/redeem stays off the markdown 404");
  });

  it("does not let the /start markdown twin contradict the live spots count", async () => {
    build();
    const md = readFileSync(join(ROOT, "_site/start/index.md"), "utf8");
    const { foundingSpotsLine } = await import("../api/_founding.mjs");
    const { renderStartPage } = await import("../api/_start.mjs");
    const live = renderStartPage(foundingSpotsLine(2));
    assert.match(live, /First 100 users get Grill free for life, 98 spots left\./);
    assert.match(md, /First 100 users get Grill free for life\./);
    assert.equal(md.match(/First 100 users get Grill free for life, \d+ spots? left/), null);
    assert.equal(md.includes("100 spots left"), false);
    assert.equal(md.includes("98 spots left"), false);
    assert.doesNotMatch(md, /All 100 founding spots are taken/);
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
      "Get the strongest case against your plan from a different AI, right in the chat you already use. Then you decide.",
      "Connect Grill",
      "Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us.",
    ];
    for (const phrase of phrases) {
      assert.ok(page.includes(phrase), `homepage is missing the wording ${phrase}`);
      assert.ok(md.includes(phrase), `markdown homepage is missing ${phrase}`);
    }
    const homeHtml = readFileSync(join(ROOT, "_site/index.html"), "utf8");
    assert.doesNotMatch(homeHtml, /Nothing kept unless you choose|keeps nothing/i);
    assert.doesNotMatch(md, /Nothing kept unless you choose|keeps nothing/i);
    assert.doesNotMatch(homeHtml, GRILL_KEEPS_NOTHING);
    assert.doesNotMatch(md, GRILL_KEEPS_NOTHING);
    assert.equal(GRILL_KEEPS_NOTHING.test("The free tool has no account and keeps nothing."), false);
    assert.doesNotMatch(privacyPage, GRILL_KEEPS_NOTHING);
    assert.match(privacyPage, /The free tool has no account\. Grill keeps a grill from it only when you send that one\. Grill in chat keeps only what you choose, encrypted, and you can delete it\./);
    for (const url of [
      "https://grillyour.ai/start/",
      "https://grillyour.ai/terms",
      "https://grillyour.ai/llms.txt",
    ]) {
      assert.ok(md.includes(url), `markdown homepage should link ${url}`);
    }
    assert.match(md, /\[Connect Grill \(2 minutes\)\]\(https:\/\/grillyour\.ai\/start\/\)/);
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
      { source: "/pricing", destination: "/api/hosted?__route=pricing" },
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
      { source: "/share/:token", destination: "/api/hosted?__route=share&t=:token" },
      { source: "/decisions", destination: "/api/hosted?__route=decisions" },
      { source: "/judge", destination: "/api/hosted?__route=judge" },
      { source: "/account", destination: "/api/hosted?__route=account" },
      { source: "/redeem", destination: "/api/hosted?__route=redeem" },
      { source: "/redeem/", destination: "/api/hosted?__route=redeem" },
      { source: "/start", destination: "/api/hosted?__route=start" },
      { source: "/start/", destination: "/api/hosted?__route=start" },
      { source: "/waitlist", destination: "/api/hosted?__route=waitlist" },
      { source: "/api/feedback", destination: "/api/hosted?__route=feedback" },
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
    for (const kept of ["/mcp", "/decisions", "/judge", "/decisions/calendar/abc", "/share/abc", "/account", "/redeem", "/api/hosted", "/.well-known/oauth-protected-resource", "/pro", "/pro/auth", "/welcome", "/notify/confirm", "/miss/send"]) {
      assert.equal(notFoundPath.test(kept), false, `${kept} stays on its rewrite`);
    }
  });

  // Every page in the built sitemap, not only the homepage. The twin is generated next to
  // index.html. Nav chrome and styles are dropped; the page's own sentences stay.
  it("writes a markdown twin for every sitemap page, from that page's own words", () => {
    const h1Text = (html) =>
      (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    const twinPath = (loc) => {
      const pathname = new URL(loc).pathname;
      return pathname === "/" ? join(ROOT, "_site/index.md") : join(ROOT, "_site", pathname.replace(/^\//, ""), "index.md");
    };
    const check = (extra = {}) => {
      execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], {
        stdio: "pipe",
        env: { ...process.env, ...extra },
      });
      const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
      const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
      assert.ok(locs.includes("https://grillyour.ai/"));
      assert.ok(locs.includes("https://grillyour.ai/start/"));
      for (const loc of locs) {
        const pathname = new URL(loc).pathname;
        const htmlPath = pathname === "/"
          ? join(ROOT, "_site/index.html")
          : join(ROOT, "_site", pathname.replace(/^\//, ""), "index.html");
        const mdPath = twinPath(loc);
        assert.ok(existsSync(mdPath), `${pathname} has a markdown twin`);
        const md = readFileSync(mdPath, "utf8");
        const h1 = h1Text(readFileSync(htmlPath, "utf8"));
        assert.ok(h1.length > 0, `${pathname} has an H1`);
        assert.ok(md.trim().length > 0, `${pathname} markdown is empty`);
        assert.ok(md.includes(h1), `${pathname} markdown is missing its H1: ${h1}`);
        assert.doesNotMatch(md, /<script/i, `${pathname} markdown has a script`);
        assert.doesNotMatch(md, /<style/i, `${pathname} markdown has a style`);
      }
      const start = readFileSync(twinPath("https://grillyour.ai/start/"), "utf8");
      assert.ok(start.includes("Add Grill to Claude"));
      assert.ok(start.includes("Customize → Connectors → Add custom connector"));
      assert.ok(start.includes("Add this MCP server: https://grillyour.ai/mcp"));
      assert.ok(start.includes("npx -y grillyour --set-key"));
      const cursorMd = start.slice(start.indexOf("Add Grill to Cursor"), start.indexOf("Copilot, Gemini, Muse"));
      const hosted = "https://grillyour.ai/mcp";
      assert.ok(cursorMd.includes(hosted), "markdown twin leads the Cursor panel with the hosted URL");
      assert.ok(cursorMd.indexOf(hosted) < cursorMd.indexOf("--set-key"), "markdown twin keeps the hosted path first");
      assert.ok(cursorMd.includes("https://cursor.com/en/install-mcp?name=Grill&config=eyJ1cmwiOiJodHRwczovL2dyaWxseW91ci5haS9tY3AifQ=="));
      assert.ok(cursorMd.includes("https://insiders.vscode.dev/redirect/mcp/install?name=Grill&config=%7B%22name%22%3A%22Grill%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fgrillyour.ai%2Fmcp%22%7D"));
      assert.ok(start.includes("Copilot, DeepSeek, Gemini, Muse, Grok and more"));
      assert.ok(start.includes("Copilot into Gemini, because Copilot can run OpenAI, Anthropic or xAI models"));
      assert.equal(start.includes("Settings → Connectors"), false);
      assert.equal(start.includes("coming soon"), false);
      assert.equal(start.includes("Keep Activity"), false);
      assert.equal(start.includes("Meta AI"), false);
      assert.equal(start.includes("invite-only"), false);
      assert.equal(start.includes("You hit the invite wall"), false);
      assert.ok(start.includes("Grill this: should I captain Erling Haaland or Nicholas Jackson this week?"));
      assert.ok(start.includes("https://grillyour.ai/mcp"));
      assert.ok(start.includes("https://grillyour.ai/terms"));
      assert.ok(start.includes("Grill only uses your decisions to give you a verdict and your later look-backs. We don't read them, share them or use them for anything else, so we can't learn what's working unless you tell us."));
      const privacy = readFileSync(twinPath("https://grillyour.ai/privacy/"), "utf8");
      for (const line of [
        "Your decisions are never public.",
        "We never publish a decision, and we never tie one to your name in public.",
        "No ads.",
        "We never sell your data.",
        "We never train AI on your decisions.",
        "The free tool has no account. Grill keeps a grill from it only when you send that one.",
        "Grill in chat keeps only what you choose, encrypted, and you can delete it.",
      ]) {
        assert.ok(privacy.includes(line), `privacy markdown is missing: ${line}`);
      }
    };
    check();
    check({ GRILL_MISS: "1" });
    const miss = readFileSync(join(ROOT, "_site/miss/index.md"), "utf8");
    assert.ok(miss.includes("Share a miss, not your decision."));
    assert.doesNotMatch(miss, /<script/i);
  });

  // One route, before the filesystem, sends Accept: text/markdown to that twin.
  // The HTML for the same paths keeps its file and gains Vary: Accept, so a shared
  // cache cannot swap the two. Rewrites stay on their own paths.
  it("negotiates markdown for every sitemap page and adds Vary: Accept to the HTML", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], {
      stdio: "pipe",
      env: { ...process.env, GRILL_MISS: "1" },
    });
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.deepEqual(config.rewrites.map((rule) => rule.source), [
      "/welcome",
      "/checkout",
      "/pricing",
      "/pro",
      "/pro/auth",
      "/pro/try",
      "/pro/reports",
      "/notify",
      "/notify/confirm",
      "/miss/send",
      "/mcp",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/:extra*",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/:extra*",
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/:extra*",
      "/decisions/calendar/:link",
      "/share/:token",
      "/decisions",
      "/judge",
      "/account",
      "/redeem",
      "/redeem/",
      "/start",
      "/start/",
      "/waitlist",
      "/api/feedback",
    ]);
    const routes = config.routes;
    const errorAt = routes.findIndex((route) => route.handle === "error");
    assert.ok(errorAt > 0, "error handle");
    const before = routes.slice(0, errorAt);
    const header = (route, name) => {
      const found = Object.entries(route.headers ?? {}).find(([key]) => key.toLowerCase() === name);
      return found ? found[1] : "";
    };
    const acceptSource = (route) => {
      const has = route.has?.find((item) => item.type === "header" && String(item.key).toLowerCase() === "accept");
      if (!has) return null;
      const source = typeof has.value === "string" ? has.value : has.value?.re;
      return typeof source === "string" ? source : null;
    };
    const destFor = (route, pathname) => {
      const match = pathname.match(new RegExp(route.src ?? route.source));
      if (!match) return null;
      let dest = route.dest ?? route.destination ?? "";
      dest = dest.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? "");
      return dest;
    };
    const fileExists = (dest) => dest.startsWith("/") && existsSync(join(ROOT, "_site", dest.slice(1)));
    // A route answers only when its Accept condition matches and, if it checks the
    // filesystem, the destination file is actually there. Otherwise the request falls through.
    const answers = (route, pathname, accept) => {
      if (route.handle) return false;
      if (!new RegExp(route.src ?? route.source).test(pathname)) return false;
      const source = acceptSource(route);
      if (source !== null && !new RegExp(source).test(accept)) return false;
      if (route.check && !fileExists(destFor(route, pathname) ?? "")) return false;
      return true;
    };
    const browser = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    const pathnames = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
    for (const extra of ["", "miss/"]) {
      assert.ok(pathnames.includes(`/${extra}`), `sitemap lists /${extra}`);
    }
    for (const pathname of pathnames) {
      const paths = pathname === "/" ? ["/"] : [pathname, pathname.replace(/\/$/, "")];
      const expected = pathname === "/" ? "/index.md" : `/${pathname.replace(/^\/|\/$/g, "")}/index.md`;
      for (const path of paths) {
        const markdown = before.filter((route) => answers(route, path, "text/markdown") && !route.continue);
        assert.ok(markdown.length >= 1, `${path} has a markdown route`);
        const chosen = markdown[0];
        assert.equal(destFor(chosen, path), expected, `${path} markdown dest`);
        assert.match(header(chosen, "content-type"), /^text\/markdown;\s*charset=utf-8$/i, path);
        assert.match(header(chosen, "vary"), /\bAccept\b/, path);
        assert.ok(chosen.status == null || chosen.status === 200, `${path} markdown is 200`);
        assert.equal(acceptSource(chosen) !== null && new RegExp(acceptSource(chosen)).test(browser), false, `${path} markdown route also matches a browser`);
        assert.ok(fileExists(expected), `${expected} is built`);

        for (const accept of [browser, ""]) {
          const html = before.filter((route) => answers(route, path, accept) && !route.continue);
          const htmlChosen = html.find((route) => (route.dest ?? route.destination) && !String(route.dest ?? route.destination).endsWith(".md"));
          assert.ok(htmlChosen, `${path} HTML still has a route when Accept is ${JSON.stringify(accept)}`);
          const htmlDest = destFor(htmlChosen, path);
          const barePath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
          const htmlExpected = barePath === "/start"
            ? "/api/hosted?__route=start"
            : pathname === "/"
              ? "/index.html"
              : `/${pathname.replace(/^\/|\/$/g, "")}/index.html`;
          assert.equal(htmlDest, htmlExpected, `${path} HTML dest`);
          assert.match(header(htmlChosen, "vary"), /\bAccept\b/, `${path} HTML varies on Accept`);
          assert.equal(String(header(htmlChosen, "content-type")).includes("text/markdown"), false);
        }
      }
    }
    const kept = ["/mcp", "/decisions", "/judge", "/decisions/calendar/abc", "/share/abc", "/account", "/redeem", "/api/hosted", "/.well-known/oauth-protected-resource", "/pro", "/pro/auth", "/welcome", "/notify/confirm", "/miss/send", "/checkout", "/pricing"];
    for (const path of kept) {
      const stolen = before.filter((route) => answers(route, path, "text/markdown") && (route.dest ?? route.destination));
      assert.equal(stolen.length, 0, `${path} stays on its rewrite`);
    }
    const notFound = routes.slice(errorAt + 1).find((route) => (route.dest ?? route.destination) === "/404.md");
    assert.ok(notFound, "404 markdown route");
    assert.equal(notFound.status, 404);
    assert.ok(answers(notFound, "/nope-404-check", "text/markdown"));
    const ghost = before.filter((route) => answers(route, "/nope-404-check", "text/markdown") && !route.continue);
    assert.equal(ghost.length, 0, "a missing page is not served as a markdown 200");
  });
});

describe("where saved grills are", () => {
  const NAV_PAGES = [
    "site/about.html",
    "site/faq.html",
    "site/contact.html",
    "site/check-your-ai.html",
    "site/contribute.html",
    "site/demo.html",
    "site/look-back.html",
    "site/miss.html",
    "site/privacy.html",
    "site/support.html",
  ];
  const nav = (html) => html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0] || "";

  it("links Your grills from the shared nav", () => {
    for (const file of NAV_PAGES) {
      const html = readFileSync(join(ROOT, file), "utf8");
      assert.match(nav(html), /<a href="\/decisions">Your grills<\/a>/, file);
    }
  });

  it("links Your grills from the built homepage", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const html = readFileSync(join(ROOT, "_site/index.html"), "utf8");
    const header = html.match(/<div class="top">[\s\S]*?<\/div>/)?.[0] ?? "";
    assert.match(header, /<nav aria-label="Sections">[\s\S]*<a href="\/decisions">Your grills<\/a>[\s\S]*<\/nav>/);
    assert.equal((html.match(/<a class="button"/g) || []).length, 1);
    assert.match(html, /<a class="button" href="\/start\/\?ref=home"[^>]*>Connect Grill \(2 minutes\)<\/a>/);
  });

  it("keeps Your grills on the about page for someone already using Grill", () => {
    const about = readFileSync(join(ROOT, "site/about.html"), "utf8");
    assert.match(about, /If you use Grill in chat, those choices are at <a href="\/decisions">Your grills<\/a>\./);
  });

  it("points Grill in chat at /decisions and keeps the look-back page for paste", () => {
    const about = readFileSync(join(ROOT, "site/about.html"), "utf8");
    assert.match(about, /<a href="\/decisions">Your grills<\/a>/);
    assert.match(about, /The <a href="\/look-back\/">look-back page<\/a> is the paste option when you are not using Grill in chat\./);
    const faq = readFileSync(join(ROOT, "site/faq.html"), "utf8");
    assert.doesNotMatch(faq, /Saved history and look-back reminders are coming later/);
    assert.match(faq, /grillyour\.ai\/decisions/);
    assert.match(faq, /Your grills/);
    assert.match(faq, /14-day look-back/);
    assert.match(faq, /look back/);
    assert.match(faq, /off until you opt in/);
  });
});
