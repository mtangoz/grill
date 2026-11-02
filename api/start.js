// grillyour.ai/start?ref=… records the source, then the static page is what the person reads.
import { handleStart } from "./_start.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch };
}

export function GET(request) {
  return handleStart(request, deps());
}
