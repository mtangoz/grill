// grillyour.ai/pricing. Plain HTML. Paid plans stay off unless GRILL_PRO_BILLING=subscription.
// A view, and a Notify me click, are anonymous counts. Prices are the ones already on the site.
import { recordPaidIntent } from "./_paidIntent.mjs";
import { PLANS, billingMode, couponId, esc, page } from "./_pro.mjs";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function html(status, body, extra = {}) {
  return new Response(body, { status, headers: { ...HEADERS, ...extra } });
}

function pricingPage(env) {
  const month = PLANS.month.list;
  const year = PLANS.year.list;
  const offer = couponId(env)
    ? `<p>Early access, when that offer is on, is ${esc(PLANS.month.offer)} a month or ${esc(PLANS.year.offer)} a year. The list price stays ${esc(month)} a month or ${esc(year)} a year.</p>`
    : "";
  const parked = billingMode(env) !== "subscription";
  const next = parked
    ? `<p>Paid plans are off. Nothing is charged.</p>
<form method="post" action="/pricing">
<input type="hidden" name="intent" value="notify">
<p class="row"><input type="submit" value="Notify me"></p>
</form>`
    : `<p><a href="/checkout?plan=month">Get Pro · ${esc(month)} a month</a> or <a href="/checkout?plan=year">${esc(year)} a year</a>.</p>`;
  return page(
    "Pricing · Grill",
    `<h1>Grill Pro</h1>
<p>Pro is ${esc(month)} a month or ${esc(year)} a year.</p>
${offer}
${next}
<p><a href="/">Back to Grill</a></p>`,
  );
}

export async function GET() {
  if (billingMode(process.env) !== "subscription") await recordPaidIntent(process.env, globalThis.fetch, "pricing");
  return html(200, pricingPage(process.env));
}

export async function POST(request) {
  const form = new URLSearchParams(await request.text());
  if (form.get("intent") === "notify" && billingMode(process.env) !== "subscription") {
    await recordPaidIntent(process.env, globalThis.fetch, "notify");
  }
  return html(303, "", { Location: "/notify" });
}
