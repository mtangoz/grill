// Signed-in Grill account. 404 unless GRILL_HOSTED=on.
import { handleAccount } from "./_hosted.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleAccount(request, deps());
}

export function POST(request) {
  return handleAccount(request, deps());
}
