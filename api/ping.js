// grillyour.ai/api/ping: anonymous usage counts. POST only. The tool calls this after an opted-in grill.
import { handlePing } from "./_ping.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function POST(request) {
  return handlePing(request, deps());
}

export function GET(request) {
  return handlePing(request, deps());
}
