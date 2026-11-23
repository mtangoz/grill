// /pricing. Plain HTML for the live check offer: a free monthly allowance,
// a prepaid pack, and optional automatic add. No subscription copy.
// A view is an anonymous count while subscription billing is off.
// Served from the hosted function so it does not add a serverless function.
import { recordPaidIntent } from "./_paidIntent.mjs";
import { hasPageSession } from "./_hosted.mjs";
import { billingMode, esc, page } from "./_pro.mjs";
import { topupPriceLabel } from "./_topup.mjs";
import { DEFAULT_AUTO_TOPUP_CEILING_CENTS, freeMonthlyChecks, topupPack } from "../scripts/hostedCore.mjs";

const CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const CSP_SIGNED_IN = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": CSP,
};

function html(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...HEADERS, ...extra } });
}

function pricingPage(env, { signedIn = false } = {}) {
  const free = freeMonthlyChecks(env);
  const pack = topupPack(env);
  const price = topupPriceLabel(pack.priceCents);
  const ceiling = topupPriceLabel(DEFAULT_AUTO_TOPUP_CEILING_CENTS);
  return page(
    "Pricing · Grill",
    `<h1>Pricing</h1>
<p>You get ${esc(String(free))} free checks a month. They reset on the 1st. Unused free checks do not roll over. Checks are weighted: a usual grill is one check, and a heavier one counts as more than one.</p>
<p>Add ${esc(String(pack.checks))} checks for ${esc(price)} on the <a href="/account#checks">account page</a>. Unused checks from a pack carry over.</p>
<p>Automatic add is optional and starts ticked. It adds another pack when you run out, up to ${esc(ceiling)} a month. You can turn it off on the account page. With it off, a card is not charged on its own.</p>
<p><a href="/">Back to Grill</a></p>`,
    { nav: signedIn ? "other" : "" },
  );
}

export async function handlePricing(request, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return html(405, page("Pricing · Grill", "<h1>That request isn't supported.</h1>"));
  }
  if (billingMode(env) !== "subscription") await recordPaidIntent(env, fetchImpl, "pricing");
  const signedIn = await hasPageSession(request, { env, fetch: fetchImpl, now: deps.now });
  return html(200, pricingPage(env, { signedIn }), signedIn ? { "Content-Security-Policy": CSP_SIGNED_IN } : {});
}
