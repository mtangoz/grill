// Grill's public commitments. Anyone can run: node --test scripts/principles.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** { id, file, anchor } — anchor must appear in file, case-insensitive. */
const COMMITMENTS = [
  { id: "verdict-not-decision", file: "docs/PRINCIPLES.md", anchor: "The verdict never becomes the decision." },
  { id: "human-decides", file: "docs/PRINCIPLES.md", anchor: "The human decides. Grill only advises." },
  { id: "no-pin", file: "docs/PRINCIPLES.md", anchor: "It does not pin models." },
  { id: "only-that-company", file: "docs/PRINCIPLES.md", anchor: "Only that company is excluded." },
  { id: "changing-mind", file: "docs/PRINCIPLES.md", anchor: "Changing your mind is part of the record, not a mark against it." },
  { id: "downloads", file: "docs/PRINCIPLES.md", anchor: "Downloads are not users." },
  { id: "no-deps", file: "docs/PRINCIPLES.md", anchor: "The tool has no third-party dependencies." },
  { id: "write-up", file: "docs/PRINCIPLES.md", anchor: "Only the write-up you approve leaves your machine" },
  { id: "telemetry", file: "docs/PRINCIPLES.md", anchor: "Any telemetry is opt-in." },
  { id: "never-about-person", file: "docs/PRINCIPLES.md", anchor: "never about the person" },
  { id: "principles-quick", file: "docs/PRINCIPLES.md", anchor: "quick or bulk" },
  { id: "principles-checked", file: "docs/PRINCIPLES.md", anchor: "Checked for you" },
  { id: "principles-yours", file: "docs/PRINCIPLES.md", anchor: "Your call" },
  { id: "enforced-by", file: "docs/PRINCIPLES.md", anchor: "Enforced by" },
  { id: "readme-promises", file: "README.md", anchor: "What Grill promises" },
  { id: "readme-values", file: "README.md", anchor: "Your values and judgment calls are yours" },
  { id: "skill-quick", file: "skills/grill/SKILL.md", anchor: "quick or bulk" },
  { id: "skill-checked", file: "skills/grill/SKILL.md", anchor: "Checked for you" },
  { id: "prompt-quick", file: "prompts/grill.md", anchor: "quick or bulk" },
  { id: "prompt-checked", file: "prompts/grill.md", anchor: "Checked for you" },
  { id: "prompt-yours", file: "prompts/grill.md", anchor: "Your call" },
  { id: "paste-checked", file: "skills/grill/paste-prompt.md", anchor: "Checked for you" },
  { id: "server-quick", file: "server/index.mjs", anchor: "quick or bulk" },
  { id: "core-checked", file: "scripts/judgeCore.mjs", anchor: "Checked for you" },
  { id: "core-yours", file: "scripts/judgeCore.mjs", anchor: "Your call" },
  { id: "default-chain", file: "scripts/judgeCore.mjs", anchor: 'export const DEFAULT_CHAIN = "openrouter/auto";' },
  { id: "changelog-checked", file: "CHANGELOG.md", anchor: "Checked for you" },
];

/** { file, phrase } — phrase must be absent from file. */
const FORBIDDEN = [
  { file: "skills/grill/SKILL.md", phrase: "This one never yields" },
  { file: "prompts/grill.md", phrase: "This one never yields" },
];

const read = (file) => readFileSync(join(ROOT, file), "utf8");

describe("public commitments", () => {
  it("checks each commitment, each forbidden phrase, each relative link and each cited test", () => {
    for (const { id, file, anchor } of COMMITMENTS) {
      const text = read(file);
      assert.ok(
        text.toLowerCase().includes(anchor.toLowerCase()),
        `${id}: ${file} is missing ${JSON.stringify(anchor)}`,
      );
    }

    for (const { file, phrase } of FORBIDDEN) {
      const text = read(file);
      assert.equal(
        text.toLowerCase().includes(phrase.toLowerCase()),
        false,
        `${file} still contains ${JSON.stringify(phrase)}`,
      );
    }

    const principlesPath = join(ROOT, "docs/PRINCIPLES.md");
    const principles = readFileSync(principlesPath, "utf8");
    const docsDir = dirname(principlesPath);
    const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
    const links = [...principles.matchAll(linkRe)].map((m) => m[1]);
    assert.ok(links.length > 0, "docs/PRINCIPLES.md has no markdown links");
    for (const raw of links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
      const href = decodeURIComponent(raw.split("#")[0]);
      if (href === "") continue;
      const target = normalize(join(docsDir, href));
      let fileOk = false;
      try {
        fileOk = statSync(target).isFile();
      } catch {
        fileOk = false;
      }
      assert.ok(fileOk, `relative link ${raw} does not resolve to a file (${target})`);
    }

    const citeRe = /"([^"]+)"\s+in\s+\[(scripts\/[^\]\s]+\.test\.mjs)\]/g;
    const enforced = principles.split("\n").filter((line) => line.trimStart().startsWith("Enforced by:"));
    assert.ok(enforced.length > 0, "docs/PRINCIPLES.md has no Enforced by line");
    const cites = [];
    for (const line of enforced) {
      for (const match of line.matchAll(citeRe)) cites.push({ name: match[1], file: match[2] });
    }
    assert.ok(cites.length > 0, "no test is cited on an Enforced by line");
    for (const { name, file } of cites) {
      const body = read(file);
      assert.ok(body.includes(name), `${file} has no test named ${JSON.stringify(name)}`);
    }
  });
});
