// /support is a plain page: the support address, links to the FAQ, terms and privacy,
// and how to delete your data. No script, and no new promise.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(ROOT, "site/support.html");

describe("the /support page", () => {
  it("names support@grillyour.ai, links the FAQ, terms and privacy, and says how to delete data", () => {
    assert.ok(existsSync(sourcePath), "site/support.html exists");
    const html = readFileSync(sourcePath, "utf8");
    assert.match(html, /^<title>Support \| Grill<\/title>/);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.match(html, /<h1>Support\.<\/h1>/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /onclick=|javascript:/i);
    assert.ok(!html.includes("—"), "support source has an em dash");
    assert.match(html, /href="mailto:support@grillyour\.ai"/);
    assert.match(html, /support@grillyour\.ai/);
    assert.match(html, /href="\/faq\/"/);
    assert.match(html, /href="\/terms\/"/);
    assert.match(html, /href="\/privacy\/"/);
    assert.match(html, /<a href="\/decisions">Your grills<\/a>/);
    assert.match(html, /href="\/account"/);
    assert.match(html, /See, export or delete any record, or all of them/);
    assert.match(html, /Deleting your account at <a href="\/account">\/account<\/a> removes your records, your key and your sign-in/);
    assert.match(html, /The free tool has no account\. Grill keeps a grill from it only when you send that one/);
    const nav = html.match(/<nav aria-label="Sections">[\s\S]*?<\/nav>/)?.[0] || "";
    assert.match(nav, /<a href="\/decisions">Your grills<\/a>/);
  });

  it("is built into the sitemap, llms.txt and a markdown twin", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const sitemap = readFileSync(join(ROOT, "_site/sitemap.xml"), "utf8");
    const llms = readFileSync(join(ROOT, "_site/llms.txt"), "utf8");
    const md = readFileSync(join(ROOT, "_site/support/index.md"), "utf8");
    const built = readFileSync(join(ROOT, "_site/support/index.html"), "utf8");
    assert.match(sitemap, /<loc>https:\/\/grillyour\.ai\/support\/<\/loc>/);
    assert.match(llms, /\[Support\]\(https:\/\/grillyour\.ai\/support\/\): Write to support@grillyour\.ai\. How to delete your data\./);
    assert.match(built, /<link rel="canonical" href="https:\/\/grillyour\.ai\/support\/">/);
    assert.match(md, /# Support\./);
    assert.match(md, /support@grillyour\.ai/);
    assert.match(md, /\/faq\//);
    assert.match(md, /\/terms\//);
    assert.match(md, /\/privacy\//);
    assert.match(md, /See, export or delete any record, or all of them/);
    assert.match(md, /\/account/);
    assert.doesNotMatch(md, /<script/i);
    assert.doesNotMatch(built.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ""), /<script/i);
  });
});
