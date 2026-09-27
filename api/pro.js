// grillyour.ai/pro (rewritten here by vercel.json): the Grill Pro account.
// The free tool never sends anyone here. Test mode, when it is on, can simulate a purchase.
import { handlePro } from "./_account.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handlePro(request, deps());
}

export function POST(request) {
  return handlePro(request, deps());
}
