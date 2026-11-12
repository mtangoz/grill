#!/usr/bin/env node
/**
 * Tell IndexNow which public grillyour.ai pages changed. Run this by hand after a page
 * change. It is not part of CI and it is not a deploy hook.
 *
 *   node scripts/indexnow.mjs [--sitemap path] [--send]
 *
 * With no flags it reads https://grillyour.ai/sitemap.xml and prints the URLs and the
 * JSON body. Nothing is sent. --sitemap reads a local sitemap instead. --send POSTs
 * that one body.
 *
 * The POST goes to https://api.indexnow.org/indexnow. It carries only public page URLs
 * from the sitemap, no user data. The key is public by design.
 */
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const INDEXNOW_HOST = "grillyour.ai";
export const INDEXNOW_KEY = "0fdf90c83b980b1b1f91d7ebf96d6806";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_SITEMAP = `https://${INDEXNOW_HOST}/sitemap.xml`;

function decodeXml(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
    switch (entity) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default:
        return entity;
    }
  });
}

/** Every <loc> text, in order, with XML entities decoded. */
export function sitemapLocs(xml) {
  const locs = [];
  for (const match of String(xml).matchAll(/<loc>([^<]*)<\/loc>/gi)) {
    const loc = decodeXml(match[1]).trim();
    if (loc) locs.push(loc);
  }
  return locs;
}

/** Absolute http(s) URLs whose host is exactly `host`. Others are dropped. */
export function urlsOnHost(locs, host = INDEXNOW_HOST) {
  const wanted = String(host).toLowerCase();
  const urls = [];
  for (const loc of locs) {
    let url;
    try {
      url = new URL(loc);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.hostname !== wanted) continue;
    urls.push(url.href);
  }
  return urls;
}

/** One IndexNow JSON body. urlList is copied. */
export function indexNowBody(urlList, { host = INDEXNOW_HOST, key = INDEXNOW_KEY, keyLocation = `https://${host}/${key}.txt` } = {}) {
  return { host, key, keyLocation, urlList: [...urlList] };
}

function usage() {
  return "usage: node scripts/indexnow.mjs [--sitemap path] [--send]";
}

function parseArgs(argv) {
  const opts = { sitemap: DEFAULT_SITEMAP, send: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--send") {
      opts.send = true;
      continue;
    }
    if (arg === "--sitemap") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(usage());
      opts.sitemap = value;
      continue;
    }
    throw new Error(usage());
  }
  return opts;
}

async function readSitemap(source, fetchImpl, readFileImpl) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetchImpl(source);
    if (!response.ok) throw new Error(`sitemap returned HTTP ${response.status}: ${source}`);
    return await response.text();
  }
  return readFileImpl(source, "utf8");
}

async function run(argv, { fetchImpl = globalThis.fetch, readFileImpl = readFileSync, stdout = console.log, stderr = console.error } = {}) {
  const opts = parseArgs(argv);
  const xml = await readSitemap(opts.sitemap, fetchImpl, readFileImpl);
  const urls = urlsOnHost(sitemapLocs(xml));
  const body = indexNowBody(urls);
  for (const url of urls) stdout(url);
  stdout(JSON.stringify(body));
  if (!opts.send) {
    stderr("dry run: not sent (pass --send to submit)");
    return 0;
  }
  // api.indexnow.org receives this body only: public page URLs, no user data.
  let response;
  try {
    response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "error",
    });
  } catch (error) {
    stderr(`IndexNow request failed: ${error?.message ?? error}`);
    return 1;
  }
  if (!response.ok) {
    stderr(`IndexNow returned HTTP ${response.status}`);
    return 1;
  }
  stdout(`sent ${urls.length} URLs, HTTP ${response.status}`);
  return 0;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error?.message ?? error);
      process.exit(1);
    },
  );
}
