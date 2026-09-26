import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate, FIELDS, parseSignal, recommend, renderReport } from "./signalsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Render a body the way GitHub renders an issue form submission. */
function body(values) {
  return Object.entries(FIELDS)
    .map(([id, f]) => `### ${f.label}\n\n${values[id] ?? "_No response_"}`)
    .join("\n\n");
}

const rated = (judge, rating, category = "pricing") => ({ event: "rated", category, judge, verdict: "weak", rating, client: "desktop" });
const resolved = (verdict, outcome) => ({ event: "resolved", category: "hiring", judge: "openai", verdict, outcome, confidence: "70-89" });

describe("the form and the parser agree", () => {
  it("every field id, label and option in the issue form matches FIELDS", () => {
    const form = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/grill-signal.yml"), "utf8");
    for (const [id, f] of Object.entries(FIELDS)) {
      assert.ok(form.includes(`id: ${id}`), `form lacks id ${id}`);
      assert.ok(form.includes(`label: ${f.label}`), `form lacks label ${f.label}`);
      assert.ok(form.includes(JSON.stringify(f.options).replace(/","/g, '", "')), `options drifted for ${id}`);
    }
    assert.doesNotMatch(form, /type: (input|textarea|checkboxes)/, "the form must stay dropdown-only");
  });
});

describe("parseSignal", () => {
  it("reads a well-formed submission", () => {
    assert.deepEqual(parseSignal(body(rated("openai", "yes"))), rated("openai", "yes"));
  });

  it("drops a body with free text in a field", () => {
    assert.equal(parseSignal(body({ ...rated("openai", "yes"), category: "we are raising a $2M seed" })), null);
  });

  it("drops a body with an added section", () => {
    assert.equal(parseSignal(`${body(rated("openai", "yes"))}\n\n### Notes\n\nmy decision was…`), null);
  });

  it("drops a body missing a required field, and ignores optional non-answers", () => {
    const { category, ...noCategory } = rated("openai", "yes");
    assert.equal(parseSignal(body(noCategory)), null);
    assert.equal(parseSignal(body({ event: "rated", category, judge: "openai", verdict: "holds" })).rating, undefined);
  });
});

describe("aggregate and recommend", () => {
  it("computes worth-engaging rates by judge and verdict outcomes", () => {
    const agg = aggregate([rated("openai", "yes"), rated("openai", "no"), rated("google", "yes"), resolved("weak", "no"), resolved("holds", "yes")]);
    assert.equal(agg.counts.rated, 3);
    assert.deepEqual(agg.worthEngaging.byJudge.openai, { yes: 1, n: 2 });
    assert.deepEqual(agg.verdictOutcomes.weak, { cameTrue: 0, n: 1 });
  });

  it("stays silent on thin data", () => {
    assert.deepEqual(recommend(aggregate([rated("meta", "no"), rated("openai", "yes")])), []);
  });

  it("flags a judge family rated far below the rest, with enough data", () => {
    const signals = [
      ...Array.from({ length: 30 }, () => rated("openai", "yes")),
      ...Array.from({ length: 8 }, () => rated("meta", "no")),
      ...Array.from({ length: 3 }, () => rated("meta", "yes")),
    ];
    const recs = recommend(aggregate(signals));
    assert.equal(recs.length, 1);
    assert.match(recs[0], /`meta`/);
  });

  it("flags verdicts that don't predict outcomes", () => {
    const signals = [
      ...Array.from({ length: 10 }, (_, i) => resolved("holds", i < 5 ? "yes" : "no")),
      ...Array.from({ length: 10 }, (_, i) => resolved("weak", i < 6 ? "yes" : "no")),
    ];
    assert.match(recommend(aggregate(signals)).join("\n"), /don't predict outcomes/);
  });

  it("renders a report that says when there is nothing to act on", () => {
    const md = renderReport(aggregate([rated("openai", "yes")]), [], { dropped: 2, period: "2026-10" });
    assert.match(md, /Grill learning report: 2026-10/);
    assert.match(md, /2 dropped as off-form/);
    assert.match(md, /None yet/);
  });
});

describe("the CLI, offline", () => {
  it("reads saved issues and prints the report", () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-signals-"));
    const file = join(dir, "issues.json");
    writeFileSync(file, JSON.stringify([{ body: body(rated("openai", "yes")) }, { body: "free text" }]));
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/signals.mjs"), "--from-file", file, "--period", "2026-10"], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    assert.match(out, /1 signals \(1 rated, 0 resolved\); 1 dropped as off-form/);
  });
});
