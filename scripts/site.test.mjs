// The onboarding site: one source (site/page.html), published as a Claude artifact as-is and
// on Vercel through scripts/build-site.mjs (every push to main redeploys). These pin what makes both work.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(ROOT, "site/page.html"), "utf8");
// The home page stays short. The paste-and-look-back tool and the full privacy text have their own pages.
const lookBack = readFileSync(join(ROOT, "site/look-back.html"), "utf8");
const privacyPage = readFileSync(join(ROOT, "site/privacy.html"), "utf8");

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

  it("leads with the choice staying with the person", () => {
    assert.match(page, /<p class="lede">Hear the strongest case against your plan, then decide for yourself\.<\/p>/);
    const line3 = readFileSync(join(ROOT, "README.md"), "utf8").split("\n")[2];
    assert.equal(line3, "**Hear the strongest case against your plan, then decide for yourself.**");
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
    for (const path of ["", "terms/", "contribute/", "look-back/", "privacy/"]) {
      assert.ok(sitemap.includes(`<loc>https://grillyour.ai/${path}</loc>`), `sitemap lists /${path}`);
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

  it("names the live commit in every public page footer when the deploy provides one, and nothing otherwise", () => {
    const pages = ["index.html", "terms/index.html", "contribute/index.html", "look-back/index.html", "privacy/index.html", "miss/index.html"];
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
});
