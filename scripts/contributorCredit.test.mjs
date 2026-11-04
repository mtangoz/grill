// Credit rules: feedback only, two separate consents, and an optional changelog line.
// No fixture in this file is a credited person.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = () => readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
const rules = () => readFileSync(join(ROOT, "docs/CONTRIBUTOR-CREDIT.md"), "utf8");

const THANKS = "Thanks to <name or handle>, for <the product feedback>.";

describe("contributor credit", () => {
  it("documents an optional Thanks to line for consented credit", () => {
    const log = changelog();
    const doc = rules();
    assert.match(log, /# Changelog/);
    assert.ok(log.indexOf(THANKS) < log.indexOf("## Unreleased"), "the convention sits above the entries");
    assert.match(log, /docs\/CONTRIBUTOR-CREDIT\.md/);
    assert.ok(doc.includes(THANKS));
    assert.match(doc, /optional/i);
    assert.match(doc, /Leave the line off/);
  });

  it("requires separate explicit consent for the site and for a public X post", () => {
    const doc = rules();
    assert.match(doc, /separate explicit consent/);
    assert.match(doc, /being named on the site/);
    assert.match(doc, /being @-tagged in a public X post/);
    assert.match(doc, /Credit is for feedback, never decisions\./);
    assert.match(doc, /Tony approves every public post\./);
    assert.match(doc, /removing them from the site within a day/);
    assert.match(doc, /We can delete X posts, but we can't recall them\./);
    assert.match(doc, /support@grillyour\.ai/);
    assert.equal((doc.match(/Thanks to /g) || []).length, 1, "the only thanks line is the placeholder");
  });
});
