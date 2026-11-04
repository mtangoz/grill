// Changes you asked for: credit is opt-in, and a missing consent never renders a name.
// Fixtures are made up. data/contributors.json starts empty.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyticsSnippet } from "./siteAnalytics.mjs";
import { renderContributorEntries } from "./contributorsCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "site/contribute.html");
const DATA = join(ROOT, "data/contributors.json");

// Made-up. These strings must never appear on the shipped page.
const UNNAMED = "Fixture Rowan Vale";
const NAMED = "Fixture Quill Handle";
const DECISION = "Fixture decided to close the north warehouse on a Tuesday";
const PR = "https://github.com/mtangoz/grill/pull/4242";
const LOG = "https://github.com/mtangoz/grill/blob/main/CHANGELOG.md";

function decoded(html) {
  return String(html)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function entry(over) {
  return {
    change: "The contribute page lists a shipped change people asked for.",
    credit: UNNAMED,
    consent: false,
    link: PR,
    ...over,
  };
}

describe("changes you asked for", () => {
  it("never renders a name when consent is not exactly true", () => {
    const withheld = [false, "true", 1, "yes", null, undefined];
    for (const consent of withheld) {
      const html = renderContributorEntries([
        entry({
          consent,
          decision: DECISION,
          credit: UNNAMED,
        }),
      ]);
      const text = decoded(html);
      assert.equal(text.includes(UNNAMED), false, `consent ${JSON.stringify(consent)} rendered the credit`);
      assert.equal(html.includes(UNNAMED), false, `consent ${JSON.stringify(consent)} left the credit in the markup`);
      assert.equal(text.includes(DECISION), false, "a decision field was rendered");
      assert.match(html, /suggested by a tester/);
      assert.match(html, new RegExp(`href="${PR}"`));
      assert.match(html, />Pull request</);
      assert.doesNotMatch(html, /<script/i);
    }

    const html = renderContributorEntries([
      entry({ consent: false, credit: UNNAMED, link: PR }),
      entry({
        change: "The changelog can thank product feedback that someone agreed to name.",
        credit: NAMED,
        consent: true,
        link: `${LOG}#unreleased`,
      }),
    ]);
    const text = decoded(html);
    assert.equal(text.includes(UNNAMED), false);
    assert.equal(html.includes(UNNAMED), false);
    assert.match(html, /Fixture Quill Handle/);
    assert.match(html, />Changelog</);
    assert.equal((html.match(/suggested by a tester/g) || []).length, 1);

    assert.throws(
      () =>
        renderContributorEntries([
          entry({
            change: `Shipped the list, and ${UNNAMED} asked for it.`,
            credit: UNNAMED,
            consent: false,
            link: PR,
          }),
        ]),
      /without consent/,
    );
  });

  it("escapes a consented credit and ignores anything that is not the change, the link, or that credit", () => {
    const html = renderContributorEntries([
      entry({
        change: "Show the shipped change <b>as text</b>.",
        credit: `${NAMED} <script>`,
        consent: true,
        link: LOG,
        decision: DECISION,
      }),
    ]);
    assert.match(html, /Fixture Quill Handle &lt;script&gt;/);
    assert.match(html, /&lt;b&gt;as text&lt;\/b&gt;/);
    assert.doesNotMatch(html, /<script|<b>/i);
    assert.equal(decoded(html).includes(DECISION), false);
    assert.doesNotMatch(html, /suggested by a tester/);
  });

  it("refuses a link that is not the pull request or the changelog", () => {
    for (const link of [
      "http://github.com/mtangoz/grill/pull/4242",
      "https://example.com/pull/4242",
      "javascript:alert(1)",
      "https://github.com/mtangoz/grill/issues/4242",
      PR + "?who=" + encodeURIComponent(UNNAMED),
    ]) {
      assert.throws(() => renderContributorEntries([entry({ link, consent: false })]), /link/);
    }
  });

  it("the contributor list starts empty", () => {
    const raw = readFileSync(DATA, "utf8");
    const entries = JSON.parse(raw);
    assert.deepEqual(entries, []);
    assert.match(raw, /^\s*\[\s*\]\s*$/);
    const html = renderContributorEntries(entries);
    assert.match(html, /Nothing is listed yet/);
    assert.match(html, /only after that person agrees/);
    assert.doesNotMatch(html, /suggested by a tester/);
    assert.equal(decoded(html).includes(UNNAMED), false);
    assert.equal(decoded(html).includes(NAMED), false);
  });

  it("says credit is opt-in product feedback, and the page runs no script", () => {
    const source = readFileSync(PAGE, "utf8");
    assert.match(source, /<h2>Changes you asked for<\/h2>/);
    assert.match(source, /Credit names the product feedback only, never anything about a person’s own decisions\./);
    assert.match(source, /An entry without consent says “suggested by a tester\.”/);
    assert.match(source, /Grill’s privacy promise covers your decisions\./);
    assert.match(source, /Credit is for product feedback and is opt-in only\./);
    assert.match(source, /Anyone can ask to be removed at any time by emailing <a href="mailto:support@grillyour\.ai">support@grillyour\.ai<\/a>\./);
    assert.equal((source.match(/<!-- CONTRIBUTORS -->/g) || []).length, 1);
    assert.doesNotMatch(source, /<script/i);
    assert.doesNotMatch(source, /\son[a-z]+=/i);
    assert.doesNotMatch(source, /javascript:/i);
    assert.ok(!source.includes("—"), "no em dashes");
    assert.equal(source.includes(UNNAMED), false);
    assert.equal(source.includes(NAMED), false);
  });

  it("bakes the empty list into the contribute page with no script of its own", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts/build-site.mjs")], { stdio: "pipe" });
    const built = readFileSync(join(ROOT, "_site/contribute/index.html"), "utf8");
    assert.match(built, /<h2>Changes you asked for<\/h2>/);
    assert.match(built, /Nothing is listed yet/);
    assert.doesNotMatch(built, /<!-- CONTRIBUTORS -->/);
    assert.equal(decoded(built).includes(UNNAMED), false);
    assert.equal(decoded(built).includes(NAMED), false);
    const rest = built.replace(analyticsSnippet(process.env), "");
    assert.equal(rest.match(/<script\b/gi)?.length ?? 0, 0, "/contribute has a script of its own");
  });
});
