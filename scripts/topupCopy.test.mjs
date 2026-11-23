// Pricing, terms, and privacy describe the live check offer and not the old
// subscription. A card is charged only when automatic add is left on.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handlePricing } from "../api/_pricing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STALE = /Grill Pro|\bsubscription\b|founding member|\$9|\$90|Paid plans are off|Notify me|judge spend|\bmargin\b/i;

function prose(html) {
  return String(html).replace(/<style[\s\S]*?<\/style>/gi, "");
}

function assertCurrentOffer(html) {
  assert.match(html, /<h1>Pricing<\/h1>/);
  assert.match(html, /You get 100 free checks a month/);
  assert.match(html, /They reset on the 1st/);
  assert.match(html, /Unused free checks do not roll over/);
  assert.match(html, /Checks are weighted: a usual grill is one check, and a heavier one counts as more than one/);
  assert.match(html, /100 checks for \$5/);
  assert.match(html, /Unused checks from a pack carry over/);
  assert.match(html, /Automatic add is optional and starts unticked/);
  assert.match(html, /up to \$20 a month/);
  assert.match(html, /You can turn it off on the account page/);
  assert.match(html, /With it off, a card is not charged on its own/);
  assert.equal(html.includes("<script"), false);
  assert.doesNotMatch(prose(html), STALE);
  assert.doesNotMatch(prose(html), /\binternal\b/i);
}

describe("prepaid packs in the public terms and pricing", () => {
  it("says extra checks are prepaid, weighted, and that automatic add starts unticked", () => {
    const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");
    const chat = terms.slice(terms.indexOf("<h2>Grill inside your chat</h2>"), terms.indexOf("<h2>Using Grill fairly</h2>"));
    assert.match(chat, /100 free checks a month/);
    assert.match(chat, /Checks are weighted: a usual grill is one check, and a heavier one counts as more than one/);
    assert.match(chat, /prepaid pack/);
    assert.match(chat, /100 checks for \$5/);
    assert.match(chat, /Unused checks from a pack carry over/);
    assert.match(chat, /Automatic add is optional and starts unticked/);
    assert.match(chat, /If automatic add is on, another pack is charged to your saved card when you run out, up to your monthly ceiling/);
    assert.match(chat, /The ceiling starts at \$20 a month/);
    assert.match(chat, /You can turn it off on your account page/);
    assert.match(chat, /Nothing is charged to you/);
    assert.match(chat, /We never put the words of a decision on a Stripe customer/);
    assert.doesNotMatch(chat, /overage|automatically charged|metered/i);
    assert.doesNotMatch(terms, STALE);
    const privacy = readFileSync(join(ROOT, "site/privacy.html"), "utf8");
    assert.doesNotMatch(privacy, /prepaid pack/);
    assert.doesNotMatch(privacy, /Grill Pro|\$9|\$90|\bsubscription\b/);
    assert.match(privacy, /A founding member number/);
    assert.match(privacy, /we keep your email address, and only that, in Resend/);
  });

  it("states only the current check offer on the pricing page", async () => {
    const res = await handlePricing(new Request("https://grillyour.ai/pricing"), {
      env: {},
      fetch: () => Promise.reject(new Error("no network")),
    });
    const html = await res.text();
    assert.equal(res.status, 200);
    assertCurrentOffer(html);
    assert.equal(html.includes("<header"), false);
  });

  it("reads the pack size and price from the server, and keeps the ceiling at its default", async () => {
    const res = await handlePricing(new Request("https://grillyour.ai/pricing"), {
      env: { GRILL_FREE_CHECKS: "40", GRILL_TOPUP_CHECKS: "40", GRILL_TOPUP_PRICE_CENTS: "750", GRILL_AUTO_TOPUP: "on" },
      fetch: () => Promise.reject(new Error("no network")),
    });
    const html = await res.text();
    assert.match(html, /You get 40 free checks a month/);
    assert.match(html, /40 checks for \$7\.50/);
    assert.match(html, /up to \$20 a month/);
    assert.doesNotMatch(html, /100 checks for \$5|Nothing is charged automatically/);
    assert.doesNotMatch(prose(html), STALE);
  });
});
