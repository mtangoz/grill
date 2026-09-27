// Stripe calls this when a Grill Pro subscription changes. Signed with STRIPE_WEBHOOK_SECRET;
// anything unsigned, stale or tampered with is refused before it's parsed.
import { syncAccountSubscription } from "./_account.mjs";
import { handleEvent, verifyStripeSignature } from "./_pro.mjs";

export async function POST(request) {
  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) {
    return new Response("invalid signature", { status: 400 });
  }
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  try {
    const outcome = await handleEvent(event, { env: process.env, fetch: globalThis.fetch });
    // The key switch above is the part that must happen. The account record follows it,
    // and a failure there is retried: switching a key off twice changes nothing.
    const account = await syncAccountSubscription(event, { env: process.env, fetch: globalThis.fetch });
    return Response.json({ received: true, ...outcome, account: account.action });
  } catch (e) {
    // A 500 makes Stripe retry, which is safe: switching a key on or off twice changes nothing.
    console.error(`[grill-pro] webhook ${event?.type}: ${e.message}`);
    return new Response("temporary failure, retry", { status: 500 });
  }
}
