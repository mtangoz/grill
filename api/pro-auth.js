// grillyour.ai/pro/auth: ask for a magic link, or finish signing in with one.
import { handleProAuth } from "./_account.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleProAuth(request, deps());
}

export function POST(request) {
  return handleProAuth(request, deps());
}
