import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSignalIssues } from "./signals.mjs";
import { aggregate, FIELDS, isSignalIssue, parseSignal, recommend, renderReport, SIGNAL_LABEL, SIGNAL_TITLE } from "./signalsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS_CLI = join(ROOT, "scripts/signals.mjs");

/** Render a body the way GitHub renders an issue form submission. */
function body(values) {
  return Object.entries(FIELDS)
    .map(([id, f]) => `### ${f.label}\n\n${values[id] ?? "_No response_"}`)
    .join("\n\n");
}

const rated = (judge, rating, category = "pricing") => ({ event: "rated", category, judge, verdict: "shaky", rating, client: "desktop" });
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

  it("offers anthropic as a judge family, and the parser and the tally read it", () => {
    const form = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/grill-signal.yml"), "utf8");
    // A Claude model can be the judge whenever another company's assistant wrote the write-up.
    const judgeDropdown = form.slice(form.indexOf("id: judge"), form.indexOf("id: verdict"));
    assert.match(judgeDropdown, /options: \[.*"anthropic".*\]/);
    assert.ok(FIELDS.judge.options.includes("anthropic"));
    assert.equal(parseSignal(body(rated("anthropic", "yes"))).judge, "anthropic");
    assert.deepEqual(aggregate([rated("anthropic", "yes"), rated("anthropic", "no")]).worthEngaging.byJudge.anthropic, { yes: 1, n: 2 });
    // Every family the form offered before is still there, so an older signal still parses.
    for (const family of ["openai", "google", "deepseek", "meta", "mistral", "qwen", "xai", "moonshot", "other", "paste-route"]) {
      assert.ok(FIELDS.judge.options.includes(family), family);
    }
    // A name the form does not offer is still dropped whole.
    assert.equal(parseSignal(body(rated("claude", "yes"))), null);
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
    assert.equal(parseSignal(body({ event: "rated", category, judge: "openai", verdict: "solid" })).rating, undefined);
  });

  it("reads an older verdict name as the public one", () => {
    assert.equal(parseSignal(body({ event: "rated", category: "pricing", judge: "openai", verdict: "holds" })).verdict, "solid");
    assert.equal(
      parseSignal(body({ event: "rated", category: "pricing", judge: "openai", verdict: "holds-with-conditions" })).verdict,
      "solid if",
    );
    assert.equal(parseSignal(body({ event: "resolved", category: "hiring", judge: "openai", verdict: "weak", outcome: "no" })).verdict, "shaky");
    assert.equal(
      parseSignal(body({ event: "resolved", category: "hiring", judge: "openai", verdict: "refuted", outcome: "yes" })).verdict,
      "doesn't hold up",
    );
  });
});

describe("aggregate and recommend", () => {
  it("computes worth-engaging rates by judge and verdict outcomes", () => {
    const agg = aggregate([rated("openai", "yes"), rated("openai", "no"), rated("google", "yes"), resolved("shaky", "no"), resolved("solid", "yes")]);
    assert.equal(agg.counts.rated, 3);
    assert.deepEqual(agg.worthEngaging.byJudge.openai, { yes: 1, n: 2 });
    assert.deepEqual(agg.verdictOutcomes.shaky, { cameTrue: 0, n: 1 });
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
      ...Array.from({ length: 10 }, (_, i) => resolved("solid", i < 5 ? "yes" : "no")),
      ...Array.from({ length: 10 }, (_, i) => resolved("shaky", i < 6 ? "yes" : "no")),
    ];
    assert.match(recommend(aggregate(signals)).join("\n"), /don't predict outcomes/);
  });

  it("renders a report that says when there is nothing to act on", () => {
    const md = renderReport(aggregate([rated("openai", "yes")]), [], { dropped: 2, period: "2026-10" });
    assert.match(md, /Grill learning report: 2026-10/);
    assert.match(md, /2 dropped as off-form/);
    assert.match(md, /None yet/);
  });

  it("shows n/a, not a dash, where nothing was rated", () => {
    const md = renderReport(aggregate([resolved("solid", "yes")]), []);
    assert.match(md, /^\| \*\*all\*\* \| 0 \| n\/a \|$/m);
    assert.doesNotMatch(md, /[\u2013\u2014]/);
  });
});

describe("which issues the report reads", () => {
  const formLines = readFileSync(join(ROOT, ".github/ISSUE_TEMPLATE/grill-signal.yml"), "utf8").split("\n");

  it("looks for the form's own title and label", () => {
    assert.ok(formLines.includes(`title: ${JSON.stringify(SIGNAL_TITLE)}`), "the form's title is the one the report matches");
    assert.ok(formLines.includes(`labels: [${JSON.stringify(SIGNAL_LABEL)}]`), "the form's label is the one the report matches");
  });

  it("reads an issue that carries the signal label, whatever its title", () => {
    assert.equal(isSignalIssue({ number: 1, title: "A renamed signal", labels: [{ name: "signal" }] }), true);
    assert.equal(isSignalIssue({ number: 2, title: "Grill signal", labels: [{ name: "bug" }, { name: "signal" }] }), true);
    assert.equal(isSignalIssue({ number: 3, title: "A renamed signal", labels: ["signal"] }), true);
  });

  it("also reads an issue with no label when its title is exactly the form's title", () => {
    assert.equal(isSignalIssue({ number: 4, title: "Grill signal", labels: [] }), true);
    assert.equal(isSignalIssue({ number: 5, title: "Grill signal" }), true);
  });

  it("leaves out an issue with any other title and no label, and every pull request", () => {
    const others = ["Grill signal: pricing", "grill signal", "Grill signal ", " Grill signal", "Re: Grill signal", "Learning report", "Learning report: 2026-11", ""];
    for (const title of others) {
      assert.equal(isSignalIssue({ number: 6, title, labels: [{ name: "learning" }] }), false, JSON.stringify(title));
    }
    assert.equal(isSignalIssue({ number: 7, title: "Grill signal", labels: [{ name: "signal" }], pull_request: { url: "x" } }), false);
    for (const notAnIssue of [null, undefined, "Grill signal", 7, []]) assert.equal(isSignalIssue(notAnIssue), false);
  });
});

describe("reading the issues from GitHub", () => {
  /** A stand-in for fetch. It serves these pages in order and records each request. */
  function pagedFetch(pages) {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url: new URL(url), headers: init.headers });
      const page = Number(new URL(url).searchParams.get("page"));
      return { ok: true, status: 200, json: async () => pages[page - 1] ?? [] };
    };
    return { fetchImpl, calls };
  }
  const issue = (number, extra = {}) => ({ number, title: "Some other issue", labels: [], body: "", ...extra });
  const fullPage = (from) => Array.from({ length: 100 }, (_, i) => issue(from + i));

  it("asks for every issue with no label filter, and keeps only the signal issues", async () => {
    const page = [
      issue(10),
      issue(11, { title: "A renamed signal", labels: [{ name: "signal" }], body: body(rated("openai", "yes")) }),
      issue(12, { title: "Grill signal", body: body(rated("anthropic", "no")) }),
      issue(13, { title: "Grill signal", body: "free text" }),
      issue(14, { title: "Grill signal", pull_request: { url: "x" } }),
      issue(15, { title: "Learning report", labels: [{ name: "learning" }] }),
    ];
    const { fetchImpl, calls } = pagedFetch([page]);
    const got = await fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "" });
    assert.deepEqual(got.map((i) => i.number), [11, 12, 13]);
    // The off-form one is kept here on purpose: the report counts it as dropped.
    assert.deepEqual(got.map((i) => parseSignal(i.body)?.judge ?? null), ["openai", "anthropic", null]);
    assert.equal(calls.length, 1);
    const { url, headers } = calls[0];
    assert.equal(`${url.origin}${url.pathname}`, "https://api.github.com/repos/mtangoz/grill/issues");
    assert.equal(url.searchParams.get("state"), "all");
    assert.equal(url.searchParams.get("per_page"), "100");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.has("labels"), false, "a label filter would miss a signal that arrived without its label");
    assert.equal(headers.accept, "application/vnd.github+json");
    assert.equal("authorization" in headers, false, "with no token there is no authorization header");
  });

  it("reads page after page until a short one, and keeps an issue once when a page repeats it", async () => {
    const first = fullPage(1000);
    first[3] = issue(1003, { title: "Grill signal", body: body(rated("google", "yes")) });
    const second = [issue(1003, { title: "Grill signal", body: body(rated("google", "yes")) }), issue(2000, { labels: [{ name: "signal" }] })];
    const { fetchImpl, calls } = pagedFetch([first, second]);
    const got = await fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "" });
    assert.deepEqual(got.map((i) => i.number), [1003, 2000]);
    assert.deepEqual(calls.map((call) => call.url.searchParams.get("page")), ["1", "2"]);
  });

  it("sends the token when there is one", async () => {
    const { fetchImpl, calls } = pagedFetch([[]]);
    assert.deepEqual(await fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "t0ken-for-the-test" }), []);
    assert.equal(calls[0].headers.authorization, "Bearer t0ken-for-the-test");
  });

  it("fails rather than report on part of the issues", async () => {
    const refused = async () => ({ ok: false, status: 403, json: async () => ({}) });
    await assert.rejects(fetchSignalIssues("mtangoz/grill", { fetchImpl: refused, token: "" }), /GitHub API 403 for mtangoz\/grill/);
    const notAList = async () => ({ ok: true, status: 200, json: async () => ({ message: "moved" }) });
    await assert.rejects(fetchSignalIssues("mtangoz/grill", { fetchImpl: notAList, token: "" }), /no list of issues/);
    const { fetchImpl, calls } = pagedFetch([fullPage(1), fullPage(101), fullPage(201)]);
    await assert.rejects(
      fetchSignalIssues("mtangoz/grill", { fetchImpl, token: "", maxPages: 2 }),
      /more than 200 issues and pull requests, so the report would be incomplete/,
    );
    assert.equal(calls.length, 2);
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

  it("tells the workflow how many signals it counted, and still writes the job summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "grill-signals-"));
    const run = (issues) => {
      const file = join(dir, "issues.json");
      const output = join(dir, "output.txt");
      const summary = join(dir, "summary.md");
      writeFileSync(file, JSON.stringify(issues));
      writeFileSync(output, "");
      writeFileSync(summary, "");
      const out = execFileSync(process.execPath, [SIGNALS_CLI, "--from-file", file, "--period", "2026-12"], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
      });
      return { out, output: readFileSync(output, "utf8"), summary: readFileSync(summary, "utf8") };
    };
    const some = run([{ body: body(rated("openai", "yes")) }, { body: body(resolved("solid", "yes")) }, { body: "free text" }]);
    assert.equal(some.output, "signals=2\n");
    assert.match(some.out, /^2 signals \(1 rated, 1 resolved\); 1 dropped as off-form\.$/m);
    assert.equal(some.summary, some.out, "the job summary gets the same report");
    // Off-form issues are not signals. A report with nothing but those counts zero.
    const none = run([{ body: "free text" }]);
    assert.equal(none.output, "signals=0\n");
    assert.match(none.out, /^0 signals \(0 rated, 0 resolved\); 1 dropped as off-form\.$/m);
    assert.equal(none.summary, none.out, "a report with zero signals still reaches the job summary");
    assert.equal(run([]).output, "signals=0\n");
  });
});
