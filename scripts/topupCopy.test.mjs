// Pricing and terms stay true once prepaid packs exist: extra checks are prepaid,
// and a card is not charged on its own. The privacy page is not part of this change.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handlePricing } from "../api/_pricing.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("prepaid packs in the public terms and pricing", () => {
  it("says extra checks are prepaid and that a card is not charged on its own", () => {
    const terms = readFileSync(join(ROOT, "site/terms.html"), "utf8");
    const chat = terms.slice(terms.indexOf("<h2>Grill inside your chat</h2>"), terms.indexOf("<h2>Using Grill fairly</h2>"));
    assert.match(chat, /\$5 of use each month/);
    assert.match(chat, /prepaid pack/);
    assert.match(chat, /Unused checks from a pack carry over/);
    assert.match(chat, /Grill does not charge a card on its own/);
    assert.match(chat, /Nothing is charged to you/);
    assert.doesNotMatch(chat, /overage|automatically charged|metered/i);
    const privacy = readFileSync(join(ROOT, "site/privacy.html"), "utf8");
    assert.doesNotMatch(privacy, /prepaid pack/);
  });

  it("states the pack on the pricing page and says nothing is charged automatically", async () => {
    const res = await handlePricing(new Request("https://grillyour.ai/pricing"), {
      env: {},
      fetch: () => Promise.reject(new Error("no network")),
    });
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /100 checks for \$5/);
    assert.match(html, /Nothing is charged automatically/);
    assert.match(html, /\$9 a month/);
    assert.match(html, /The first \$5 of use each month is free/);
  });
});
