// grillyour.ai/pro/try: a sample grill. Exists only while Grill Pro test mode is on.
// In production this answers 404, and write-ups never come here.
import { handleProTry } from "./_account.mjs";

export function POST(request) {
  return handleProTry(request, { env: process.env, fetch: globalThis.fetch, now: Date.now() });
}

export function GET() {
  return handleProTry(new Request("https://grillyour.ai/pro/try"), { env: process.env, fetch: globalThis.fetch, now: Date.now() });
}
