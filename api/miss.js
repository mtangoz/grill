// grillyour.ai/miss/send: share how AI failed at a decision, without the decision.
import { handleMiss } from "./_miss.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleMiss(request, deps());
}

export function POST(request) {
  return handleMiss(request, deps());
}
