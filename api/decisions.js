// Signed-in decision records. 404 unless GRILL_HOSTED=on.
import { handleDecisions } from "./_hosted.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleDecisions(request, deps());
}

export function POST(request) {
  return handleDecisions(request, deps());
}
