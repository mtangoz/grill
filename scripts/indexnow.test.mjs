// IndexNow tells Bing and the engines that read it which public pages changed.
// The key file is public by design. It is not a page, so it stays out of the sitemap and llms.txt.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INDEXNOW_ENDPOINT, INDEXNOW_HOST, INDEXNOW_KEY, indexNowBody, sitemapLocs, urlsOnHost } from "./indexnow.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "0fdf90c83b980b1b1f91d7ebf96d6806";
const PATHNAME = `/${KEY}.txt`;

function header(route, name) {
  const found = Object.entries(route.headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return found ? found[1] : undefined;
}

describe("IndexNow key file", () => {
  it("the built site serves the public key, and the sitemap and llms.txt do not list it", () => {
    execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: ROOT, stdio: "pipe" });
    const body = readFileSync(join(ROOT, "_site", `${KEY}.txt`), "utf8");
    assert.match(body, new RegExp(`^${KEY}\\n?$`));
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    assert.equal(sitemap.includes(KEY), false);
    assert.equal(llms.includes(KEY), false);
    assert.equal(sitemap.includes(`${KEY}.txt`), false);
  });

  it("serves the key file as text/plain with 200, and markdown negotiation does not take it", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const routes = config.routes;
    assert.ok(Array.isArray(routes));
    const errorAt = routes.findIndex((route) => route.handle === "error");
    assert.ok(errorAt > 0, "error handle");

    const before = routes.slice(0, errorAt);
    const matches = before.filter((route) => {
      const src = route.src ?? route.source;
      return typeof src === "string" && new RegExp(src).test(PATHNAME);
    });
    assert.equal(matches.length, 1, "exactly one route before the error phase matches the key file");
    const route = matches[0];
    assert.equal(route.dest ?? route.destination, PATHNAME);
    assert.equal(route.status ?? 200, 200);
    assert.equal(route.has, undefined, "the key file is not conditional on Accept");
    assert.equal(header(route, "content-type"), "text/plain");
    assert.equal(route.check, true, "the route serves the built file");

    for (const other of before) {
      if (other === route) continue;
      const src = other.src ?? other.source;
      if (typeof src !== "string") continue;
      assert.equal(new RegExp(src).test(PATHNAME), false, `another route matches ${PATHNAME}: ${src}`);
    }
    assert.equal(
      (config.rewrites ?? []).some((rule) => rule.source === PATHNAME || rule.source === `${KEY}.txt`),
      false,
    );
  });
});

describe("IndexNow submission", () => {
  it("parses sitemap locs, keeps only grillyour.ai, and builds one body", () => {
    assert.equal(INDEXNOW_KEY, KEY);
    assert.equal(INDEXNOW_HOST, "grillyour.ai");
    assert.equal(INDEXNOW_ENDPOINT, "https://api.indexnow.org/indexnow");
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<urlset>",
      "  <url><loc>https://grillyour.ai/</loc></url>",
      "  <url><loc> https://grillyour.ai/terms/ </loc></url>",
      "  <url><loc>https://example.com/nope</loc></url>",
      "  <url><loc>https://grillyour.ai.example/nope</loc></url>",
      "  <url><loc>https://www.grillyour.ai/nope</loc></url>",
      "  <url><loc>not a url</loc></url>",
      "  <url><loc></loc></url>",
      "  <url><loc>https://grillyour.ai/faq/?q=a&amp;b=c</loc></url>",
      "</urlset>",
    ].join("\n");
    assert.deepEqual(sitemapLocs(xml), [
      "https://grillyour.ai/",
      "https://grillyour.ai/terms/",
      "https://example.com/nope",
      "https://grillyour.ai.example/nope",
      "https://www.grillyour.ai/nope",
      "not a url",
      "https://grillyour.ai/faq/?q=a&b=c",
    ]);
    const urls = urlsOnHost(sitemapLocs(xml));
    assert.deepEqual(urls, [
      "https://grillyour.ai/",
      "https://grillyour.ai/terms/",
      "https://grillyour.ai/faq/?q=a&b=c",
    ]);
    const body = indexNowBody(urls);
    assert.deepEqual(body, {
      host: "grillyour.ai",
      key: KEY,
      keyLocation: `https://grillyour.ai/${KEY}.txt`,
      urlList: urls,
    });
    assert.deepEqual(Object.keys(body), ["host", "key", "keyLocation", "urlList"]);
    urls.push("https://grillyour.ai/extra/");
    assert.equal(body.urlList.includes("https://grillyour.ai/extra/"), false);
  });
});
