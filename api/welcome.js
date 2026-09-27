// grillyour.ai/welcome (rewritten here by vercel.json): where Stripe sends a Grill Pro buyer.
// GET confirms the payment and offers a button; POST creates the key and shows it once.
import { attachIssuedKey } from "./_account.mjs";
import { checkSession, issueKey, renderWelcome, statusFor, WELCOME_HEADERS } from "./_pro.mjs";

async function respond(run, sessionId, request) {
  let result;
  try {
    result = await run(sessionId, { env: process.env, fetch: globalThis.fetch });
    if (result?.state === "issued") {
      // If they're already signed in, keep the hash on that account. The page still shows the key once.
      await attachIssuedKey(request, { customerId: result.customerId, hash: result.hash, key: result.key }, { env: process.env, fetch: globalThis.fetch });
    }
  } catch (e) {
    // Never the key: an upstream error message carries statuses and field names only.
    console.error(`[grill-pro] welcome: ${e.message}`);
    result = { state: "error" };
  }
  return new Response(renderWelcome(result, process.env, sessionId), { status: statusFor(result.state), headers: WELCOME_HEADERS });
}

export async function GET(request) {
  return respond(checkSession, new URL(request.url).searchParams.get("session_id") ?? "", request);
}

export async function POST(request) {
  let sessionId = "";
  try {
    sessionId = new URLSearchParams(await request.text()).get("session_id") ?? "";
  } catch {
    sessionId = "";
  }
  return respond(issueKey, sessionId, request);
}
