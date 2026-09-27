// grillyour.ai/checkout (rewritten here by vercel.json): starts Grill Pro checkout.
// GRILL_PRO_COUPON, when set, is applied here. The page copy is decided at build time from the same variable.
import { billingMode, renderCheckoutError, startCheckout, WELCOME_HEADERS } from "./_pro.mjs";
import { openStore, recordUsageEvent } from "./_account.mjs";

const REDIRECT_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request) {
  const plan = new URL(request.url).searchParams.get("plan") ?? "";
  try {
    const store = openStore(process.env, globalThis.fetch);
    await recordUsageEvent(store, "upgrade_clicked");
    if (billingMode(process.env) !== "subscription") {
      return new Response(renderCheckoutError("billing-off"), { status: 200, headers: WELCOME_HEADERS });
    }
    const result = await startCheckout(plan, { env: process.env, fetch: globalThis.fetch });
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
