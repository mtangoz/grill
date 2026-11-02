// /pricing. Plain HTML. Paid plans stay off unless GRILL_PRO_BILLING=subscription.
// A view, and a Notify me click, are anonymous counts. Prices are the ones already on the site.
// Served from the hosted function so it does not add a serverless function.
import { recordPaidIntent } from "./_paidIntent.mjs";
import { foundingMemberLine, foundingSkipsPaywall, foundingSpotsLine, readFoundingCount, readFoundingNumber } from "./_founding.mjs";
import { PLANS, billingMode, couponId, esc, page } from "./_pro.mjs";
import { openStore, redisCommand, sessionAccountId } from "./_account.mjs";

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

function pricingPage(env, { spots = "", founding = null } = {}) {
  const month = PLANS.month.list;
  const year = PLANS.year.list;
  const offer = couponId(env)
    ? `<p>Early access, when that offer is on, is ${esc(PLANS.month.offer)} a month or ${esc(PLANS.year.offer)} a year. The list price stays ${esc(month)} a month or ${esc(year)} a year.</p>`
    : "";
  const parked = billingMode(env) !== "subscription";
  const spotsLine = spots ? `<p>${esc(spots)}</p>` : "";
  const member = foundingSkipsPaywall(founding)
    ? `<p>${esc(foundingMemberLine(founding))}</p><p>You don't need to pay.</p>`
    : "";
  const next = member
    ? ""
    : parked
      ? `<p>Paid plans are off. Nothing is charged.</p>
<form method="post" action="/pricing">
<input type="hidden" name="intent" value="notify">
<p class="row"><input type="submit" value="Notify me"></p>
</form>`
      : `<p><a href="/checkout?plan=month">Get Pro · ${esc(month)} a month</a> or <a href="/checkout?plan=year">${esc(year)} a year</a>.</p>`;
  return page(
    "Pricing · Grill",
    `<h1>Grill Pro</h1>
${spotsLine}
${member}
<p>Pro is ${esc(month)} a month or ${esc(year)} a year. A founding member does not pay that.</p>
${offer}
${next}
<p><a href="/">Back to Grill</a></p>`,
  );
}

async function foundingView(env, fetchImpl, request) {
  let spots = foundingSpotsLine(0);
  let founding = null;
  if (env?.UPSTASH_REDIS_REST_URL && env?.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const command = redisCommand(env, fetchImpl);
      spots = foundingSpotsLine(await readFoundingCount(command));
      const id = sessionAccountId(request, env);
      if (id) {
        const store = openStore(env, fetchImpl);
        const account = store ? await store.getById(id) : null;
        if (account?.email) founding = await readFoundingNumber(command, account.email);
      }
    } catch {
      spots = foundingSpotsLine(0);
    }
  }
  return { spots, founding };
}

export async function handlePricing(request, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const view = await foundingView(env, fetchImpl, request);
  if (request.method === "POST") {
    const form = new URLSearchParams(await request.text());
    if (form.get("intent") === "notify" && billingMode(env) !== "subscription" && !foundingSkipsPaywall(view.founding)) {
      await recordPaidIntent(env, fetchImpl, "notify");
    }
    return html(303, "", { Location: "/notify" });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return html(405, page("Pricing · Grill", "<h1>That request isn't supported.</h1>"));
  }
  if (billingMode(env) !== "subscription" && !foundingSkipsPaywall(view.founding)) await recordPaidIntent(env, fetchImpl, "pricing");
  return html(200, pricingPage(env, view));
}
