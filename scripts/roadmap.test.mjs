// Later ideas and competitor notes stay in two files the growth work actually reads.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROCESS =
  "The daily growth work reviews docs/ROADMAP.md before it asks what to build. A weekly scan updates docs/ROADMAP.md and docs/COMPETITORS.md together.";

describe("later ideas and competitor notes", () => {
  const roadmap = readFileSync(join(ROOT, "docs/ROADMAP.md"), "utf8");
  const competitors = readFileSync(join(ROOT, "docs/COMPETITORS.md"), "utf8");

  it("says the daily growth work reviews the roadmap and a weekly scan updates both files", () => {
    assert.ok(roadmap.includes(PROCESS), "ROADMAP.md");
    assert.ok(competitors.includes(PROCESS), "COMPETITORS.md");
  });

  it("keeps each later idea behind a consider-when trigger", () => {
    assert.match(roadmap, /10 users/);
    assert.match(roadmap, /100 users/);
    assert.match(roadmap, /feedback themes/);
    assert.match(roadmap, /cost/);
    assert.match(roadmap, /Google Docs add-on/);
    assert.match(roadmap, /Consider when: 25\+ users, or if users ask for it in docs\./);
    assert.match(roadmap, /shared\/team sessions with a decision owner/i);
    assert.match(roadmap, /Consider when: 100 users, or team demand\./);
    assert.match(roadmap, /agent-to-agent harness/i);
    assert.match(roadmap, /Consider when: later, after shared sessions are in use, or if an agent platform asks for a harness\./);
    assert.match(roadmap, /Higher spend cap for contributors \(\$10\/month vs \$5\)/);
    assert.match(roadmap, /can be granted by hand at small scale/);
    assert.match(roadmap, /Consider when: first contributor near the \$5 cap, or 5\+ active contributors\./);
    assert.match(roadmap, /Contributor votes on the roadmap/);
    assert.match(roadmap, /Consider when: 10\+ active contributors\./);
    const ideas = roadmap.split(/^## /m).slice(1);
    assert.ok(ideas.length >= 5, "the seeded ideas plus the two contributor ideas");
    for (const idea of ideas) assert.match(idea, /Consider when:/, idea.slice(0, 80));
  });

  it("records the real-user count the user-count triggers read", () => {
    const strategy = readFileSync(join(ROOT, "docs/STRATEGY.md"), "utf8");
    assert.match(strategy, /As of 2026-11-09 the count is 1 real user and 0 evidenced look-backs\. Updated monthly\./);
    assert.match(
      strategy,
      /A real user is a person outside the maintainers and their agents or test accounts who ran at least one successful grill \(\[PRINCIPLES\.md\]\(PRINCIPLES\.md#north-star\)\)\./,
    );
    assert.match(
      roadmap,
      /Most triggers read the real-user count in STRATEGY\.md\. That count is 1 as of 2026-11-09, so every user-count trigger below reads as not met\./,
    );
    assert.match(roadmap, /\| Record the real-user count \| High, enables every other trigger \| Now \| Done \|/);
    assert.match(roadmap, /Done: recorded 2026-11-09 in STRATEGY\.md\. Monthly refresh\./);
    assert.match(
      roadmap,
      /\| Public launch \(Show HN, Product Hunt\) \| High, usage, one-off \| Real-user count recorded and activation measured \| Not met \|/,
    );
  });

  it("records what we learned from Cruxes, and a threat level", () => {
    assert.match(competitors, /cruxes\.io/);
    assert.match(competitors, /finds the one question that would change a decision/);
    assert.match(competitors, /quotes the user's text/);
    assert.match(competitors, /team and agent harnesses with a decision owner/);
    assert.match(competitors, /Claude Code, Claude and Google Docs/);
    assert.match(competitors, /15 free, then \$29 a month/);
    assert.match(competitors, /What we learned/);
    assert.match(competitors, /Threat level: medium/);
    assert.doesNotMatch(competitors, /worse than|inferior|beats Grill|behind Grill/i);
  });
});
