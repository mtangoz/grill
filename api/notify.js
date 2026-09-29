// grillyour.ai/notify: ask to hear when Pro is ready. The confirmation is a separate POST.
import { handleNotify } from "./_notify.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleNotify(request, deps());
}

export function POST(request) {
  return handleNotify(request, deps());
}
