// grillyour.ai/checkout (rewritten here by vercel.json): starts Grill Pro checkout.
// GRILL_PRO_COUPON, when set, is applied here. The page copy is decided at build time from the same variable.
import { billingMode, esc, page, renderCheckoutError, startCheckout, WELCOME_HEADERS } from "./_pro.mjs";
import { openStore, recordUsageEvent, redisCommand, sessionAccountId } from "./_account.mjs";
import { recordPaidIntent } from "./_paidIntent.mjs";
import { foundingMemberLine, foundingSkipsPaywall, readFoundingNumber } from "./_founding.mjs";

const REDIRECT_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request) {
  const plan = new URL(request.url).searchParams.get("plan") ?? "";
  try {
    const store = openStore(process.env, globalThis.fetch);
    await recordUsageEvent(store, "upgrade_clicked");
    const accountId = sessionAccountId(request, process.env);
    if (accountId && store && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        const account = await store.getById(accountId);
        const number = account?.email ? await readFoundingNumber(redisCommand(process.env, globalThis.fetch), account.email) : null;
        if (foundingSkipsPaywall(number)) {
          const body = page(
            "You're a founding member · Grill",
            `<h1>You don't need to pay.</h1><p>${esc(foundingMemberLine(number))}</p><p><a href="/pro">Back to your account</a></p>`,
          );
          return new Response(body, { status: 200, headers: WELCOME_HEADERS });
        }
      } catch {
        // A missed lookup still leaves checkout on its existing path.
      }
    }
    if (billingMode(process.env) !== "subscription") {
      await recordPaidIntent(process.env, globalThis.fetch, "checkout");
      return new Response(renderCheckoutError("billing-off"), { status: 200, headers: WELCOME_HEADERS });
    }
    const result = await startCheckout(plan, {
      env: process.env,
      fetch: globalThis.fetch,
      clientReferenceId: sessionAccountId(request, process.env),
    });
    if (result.state === "redirect") {
      return new Response(null, { status: 303, headers: { ...REDIRECT_HEADERS, Location: result.url } });
    }
    const status = result.state === "invalid" ? 400 : 503;
    return new Response(renderCheckoutError(result.state), { status, headers: WELCOME_HEADERS });
  } catch (e) {
    console.error(`[grill-pro] checkout: ${e.message}`);
    return new Response(renderCheckoutError("error"), { status: 503, headers: WELCOME_HEADERS });
  }
}
