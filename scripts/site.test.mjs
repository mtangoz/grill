// The onboarding site: one source (site/page.html), published as a Claude artifact as-is and as
// GitHub Pages through scripts/build-site.mjs. These pin what makes both work.
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

  it("while pre-release, shows no link into the private repo and offers an invite instead", () => {
    // The switch is one class on <main>. Once it is removed, this test has nothing to check.
    if (!/<main class="prerelease"/.test(page)) return;
    assert.match(page, /\.prerelease \.only-public \{ display: none; \}/);
    assert.match(page, /main:not\(\.prerelease\) \.only-pre \{ display: none; \}/);
    // Drop every element marked only-public (none nests an element of its own tag), and what
    // is left is the page a visitor sees.
    const visible = page.replace(/<(\w+)\b[^>]*\bclass="[^"]*\bonly-public\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, "");
    assert.doesNotMatch(visible, /github\.com|\/plugin |releases\/latest/);
    assert.match(visible, /class="[^"]*only-pre[^"]*"[^>]*>[\s\S]*?mailto:hello@hold\.quest/);
  });

  it("defines its colours as tokens for light, dark-by-system and dark-by-choice", () => {
    assert.match(page, /:root \{[\s\S]*--paper:/);
    assert.match(page, /@media \(prefers-color-scheme: dark\)[\s\S]*:root:not\(\[data-theme="light"\]\)/);
    assert.match(page, /:root\[data-theme="dark"\]/);
  });
});

describe("the Pages build", () => {
  it("wraps the page into a full document, with its title and styles in the head", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const html = readFileSync(join(ROOT, "_site/index.html"), "utf8");
    const [head, rest] = html.split("</head>");
    assert.match(html, /^<!doctype html>/);
    assert.match(head, /<title>Grill<\/title>/);
    assert.match(head, /<meta property="og:title" content="Grill">/);
    assert.match(head, /<meta name="color-scheme" content="light dark">/);
    assert.match(head, /<meta name="theme-color" content="#f7f4ef" media="\(prefers-color-scheme: light\)">/);
    assert.match(head, /<meta name="theme-color" content="#161513" media="\(prefers-color-scheme: dark\)">/);
    assert.match(head, /--paper:/);
    assert.match(rest, /<body>[\s\S]*id="setup"/);
  });
});
