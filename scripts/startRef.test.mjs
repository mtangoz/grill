// ?ref= on /start is recorded as a count. The page itself is the answer. No script.
// A cookie carries the label only while sign-up is invite-only. A crawler is not counted.
// Made-up source labels only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { START_VIEWS_KEY, countsAsVisit, handleStart, normalizeRef, refFromCookie, renderStartPage, startRefKey } from "../api/_start.mjs";
import { createMemoryRedis } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function world(env = {}) {
  const memory = createMemoryRedis();
  const commands = [];
  return {
    env,
    redis: async (args) => {
      commands.push(args.map((part) => String(part)));
      return memory.command(args);
    },
    memory,
    commands,
  };
}

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

describe("start attribution", () => {
  it("accepts a short source and drops anything else", () => {
    assert.equal(normalizeRef(" askgrill "), "askgrill");
    assert.equal(normalizeRef("AskGrill"), "askgrill");
    for (const bad of ["", "  ", "a b", "a@b.com", "https://evil.example", "x".repeat(41), "lead\naskgrill", null]) {
      assert.equal(normalizeRef(bad), "", JSON.stringify(bad));
    }
  });

  it("records ref=askgrill and shows the page, without sending the query back", async () => {
    const ctx = world();
    const res = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill"), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("location"), null);
    const html = await res.text();
    assert.match(html, /First 100 users get Grill free for life, 100 spots left\./);
    assert.match(html, /id="copy-starter"/);
    assert.match(html, /id="starter-prompt"/);
    assert.equal(html.includes("askgrill"), false);
    assert.doesNotMatch(html, /grillTrack|posthog|phc_/i);
    assert.match(res.headers.get("set-cookie"), /grill_ref=askgrill/);
    assert.match(res.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(res.headers.get("set-cookie").includes("askgrill@"), false);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "1");
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), "1");
    const again = await handleStart(new Request("https://preview.example/start/?ref=AskGrill"), ctx);
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("location"), null);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "2");
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), "2");
    assert.equal(refFromCookie(again.headers.get("set-cookie")), "askgrill");
  });

  it("does not record a bad ref, and still shows the page when the store is missing", async () => {
    const ctx = world();
    const bad = await handleStart(new Request("https://grillyour.ai/start?ref=not%20a%20ref"), ctx);
    assert.equal(bad.status, 200);
    assert.equal(bad.headers.get("location"), null);
    assert.match(await bad.text(), /First 100 users get Grill free for life, 100 spots left\./);
    assert.equal(bad.headers.get("set-cookie"), null);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), null);
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), "1");

    let called = false;
    const bare = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill"), {
      env: {},
      fetch: async () => {
        called = true;
        throw new Error("no store");
      },
    });
    assert.equal(bare.status, 200);
    assert.equal(bare.headers.get("location"), null);
    assert.match(await bare.text(), /Connect Grill to your AI/);
    assert.equal(called, false);

    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const rewrites = config.rewrites.filter((row) => row.destination === "/api/hosted?__route=start");
    assert.deepEqual(rewrites.map((row) => row.source), ["/start", "/start/"]);
    for (const row of rewrites) assert.equal(row.has, undefined);
    const route = config.routes.find((row) => row.dest === "/api/hosted?__route=start" && row.src === "^/start/?$");
    assert.ok(route, "a route serves /start before the HTML file");
    const start = readFileSync(join(ROOT, "site/start.html"), "utf8");
    assert.match(start, /id="copy-starter"/);
    assert.match(start, /First 100 users get Grill free for life, 100 spots left\./);
    const STARTER = "Grill this: should I captain Erling Haaland or Nicholas Jackson this week?";
    assert.ok(start.includes(STARTER), "starter prompt");
    assert.ok(start.includes("https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=Grill&amp;connectorUrl=https%3A%2F%2Fgrillyour.ai%2Fmcp"));
  });
});

// The page a person lands on from a post or a message is the served one, not the static file.
// What a link preview needs is checked here against fixed values, so this test does not lean
// on the site build.
describe("the served /start page in a link preview", () => {
  const CANONICAL = "https://grillyour.ai/start/";
  const OG_IMAGE = "https://grillyour.ai/brand/og-image.png";
  const ICONS = [
    '<link rel="icon" href="/favicon.ico" sizes="any">',
    '<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">',
    '<link rel="icon" type="image/png" sizes="192x192" href="/brand/icon-192.png">',
    '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">',
  ];
  const DESCRIPTION = "Pick your AI, then connect Grill and paste one message.";
  const head = (html) => html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)">`))?.[1] ?? null;

  it("carries a title, a description, the share image and the icons", async () => {
    const res = await handleStart(new Request("https://grillyour.ai/start", { headers: { "user-agent": BROWSER } }), world());
    const html = head(await res.text());
    assert.equal(meta(html, "property", "og:title"), "Start using Grill");
    assert.equal(meta(html, "name", "twitter:title"), "Start using Grill");
    assert.equal(meta(html, "name", "description"), DESCRIPTION);
    assert.equal(meta(html, "property", "og:description"), DESCRIPTION);
    assert.ok(DESCRIPTION.length < 160);
    assert.equal(meta(html, "property", "og:type"), "website");
    assert.equal(meta(html, "property", "og:image"), OG_IMAGE);
    assert.equal(meta(html, "name", "twitter:image"), OG_IMAGE);
    assert.equal(meta(html, "property", "og:image:width"), "1200");
    assert.equal(meta(html, "property", "og:image:height"), "630");
    assert.match(meta(html, "property", "og:image:alt"), /Grill your AI before you send it to your boss\./);
    assert.equal(meta(html, "name", "twitter:card"), "summary_large_image");
    for (const icon of ICONS) assert.ok(html.includes(icon), icon);
    // Each file the tags point at is in the site folder the build copies from.
    assert.ok(existsSync(join(ROOT, "site/brand/og-image.png")));
    for (const file of ["favicon.ico", "favicon-32.png", "icon-192.png", "apple-touch-icon.png"]) {
      assert.ok(existsSync(join(ROOT, "site/brand", file)), file);
    }
    // One of each: a preview reads the first, and a second would be a second answer.
    for (const tag of ['property="og:title"', 'property="og:image"', 'property="og:url"', 'rel="canonical"', 'name="description"']) {
      assert.equal(html.split(tag).length, 2, tag);
    }
  });

  it("names the canonical address, never the address that was asked for", async () => {
    for (const url of ["https://grillyour.ai/start?ref=askgrill", "https://preview.example/start/?ref=AskGrill&x=1", "https://grillyour.ai/api/hosted?__route=start&ref=hn"]) {
      const res = await handleStart(new Request(url, { headers: { "user-agent": BROWSER } }), world());
      const html = await res.text();
      assert.equal(meta(html, "property", "og:url"), CANONICAL, url);
      assert.equal(html.match(/<link rel="canonical" href="([^"]*)">/)?.[1], CANONICAL, url);
      assert.equal(/askgrill|preview\.example|__route|[?&]ref=/i.test(html), false, url);
    }
    assert.equal(renderStartPage("x").includes(`<meta property="og:url" content="${CANONICAL}">`), true);
  });

  it("adds no script, no tracker and no second style to the page", async () => {
    const res = await handleStart(new Request("https://grillyour.ai/start", { headers: { "user-agent": BROWSER } }), world());
    const html = await res.text();
    assert.equal((html.match(/<script/g) || []).length, 1, "the one script copies the starter prompt");
    assert.doesNotMatch(html, /grillTrack|posthog|phc_|_vercel\/insights/i);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(head(html), /[\u2013\u2014]/);
  });
});

describe("what /start counts", () => {
  const CRAWLERS = [
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    "Discordbot/2.0; +https://discordapp.com",
    "TelegramBot (like TwitterBot)",
    "WhatsApp/2.23.20.0",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
    "curl/8.4.0",
    "python-requests/2.31.0",
  ];
  const PEOPLE = [
    BROWSER,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29",
    "Mozilla/5.0 (Linux; Android 11; CUBOT NOTE 20 PRO) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "",
  ];
  const get = (agent, url = "https://grillyour.ai/start?ref=askgrill", method = "GET") => new Request(url, { method, headers: agent ? { "user-agent": agent } : {} });

  it("tells a crawler, a link-preview fetch and a script from a visit", () => {
    for (const agent of CRAWLERS) assert.equal(countsAsVisit(get(agent)), false, agent);
    for (const agent of PEOPLE) assert.equal(countsAsVisit(get(agent)), true, agent || "no user-agent");
  });

  it("serves a crawler the page and counts nothing for it, with or without a ref", async () => {
    const ctx = world();
    for (const agent of CRAWLERS) {
      const res = await handleStart(get(agent), ctx);
      assert.equal(res.status, 200, agent);
      assert.match(await res.text(), /Connect Grill to your AI/, agent);
      assert.equal(res.headers.get("set-cookie"), null, agent);
    }
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), null);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), null);
    // Nothing was written at all: no count of crawlers, and nothing about who asked.
    assert.deepEqual(ctx.commands.filter((args) => args[0] !== "GET"), []);
    for (const args of ctx.commands) assert.equal(/bot|curl|mozilla|whatsapp/i.test(args.join(" ")), false, args.join(" "));
  });

  it("does not count a request that is not a GET", async () => {
    const ctx = world();
    for (const method of ["HEAD", "POST", "DELETE"]) {
      const res = await handleStart(get(BROWSER, "https://grillyour.ai/start?ref=askgrill", method), ctx);
      assert.equal(res.status, 200, method);
      assert.equal(res.headers.get("set-cookie"), null, method);
    }
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), null);
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), null);
  });

  it("counts a browser visit once, and stores nothing from its user-agent", async () => {
    const ctx = world();
    const res = await handleStart(get(BROWSER), ctx);
    assert.equal(res.status, 200);
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), "1");
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "1");
    for (const args of ctx.commands) assert.equal(/mozilla|safari|macintosh/i.test(args.join(" ")), false, args.join(" "));
    const source = readFileSync(join(ROOT, "api/_start.mjs"), "utf8");
    assert.equal(source.split('headers.get("user-agent")').length, 2, "the user-agent is read in one place");
    assert.doesNotMatch(source, /console\./, "and nothing on this route is logged");
  });
});

describe("the grill_ref cookie", () => {
  it("is set while sign-up is invite-only, and not when sign-up is open", async () => {
    for (const env of [{}, { GRILL_OPEN_SIGNUP: "off" }, { GRILL_OPEN_SIGNUP: "ON" }]) {
      const closed = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill"), world(env));
      assert.equal(refFromCookie(closed.headers.get("set-cookie")), "askgrill", JSON.stringify(env));
    }
    const ctx = world({ GRILL_OPEN_SIGNUP: "on" });
    const open = await handleStart(new Request("https://grillyour.ai/start?ref=askgrill", { headers: { "user-agent": BROWSER } }), ctx);
    assert.equal(open.status, 200);
    assert.equal(open.headers.get("set-cookie"), null, "open sign-up: /start sets no cookie");
    assert.deepEqual(open.headers.getSetCookie(), []);
    // The source is still counted. Only the cookie is gone.
    assert.equal(ctx.memory.command(["GET", startRefKey("askgrill")]), "1");
    assert.equal(ctx.memory.command(["GET", START_VIEWS_KEY]), "1");
  });

  it("is described in the data ledger the way the code behaves", () => {
    const ledger = readFileSync(join(ROOT, "docs/DATA-LEDGER.md"), "utf8");
    const row = ledger.split("\n").find((line) => line.startsWith("| `/start` source"));
    assert.ok(row, "the ledger has a /start row");
    assert.match(row, /Only while sign-up is invite-only, a cookie on your browser \(`grill_ref`\)/);
    assert.match(row, /With open sign-up, `\/start` sets no cookie\./);
    assert.match(row, /The user-agent is read only to tell those apart\. It is not stored and not logged\./);
    assert.doesNotMatch(row, /count of every `\/start` load/);
  });
});
