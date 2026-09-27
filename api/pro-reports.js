// grillyour.ai/pro/reports: copies of reports the signed-in Pro user chose to keep.
// Grill does not email a verdict or a weekly note. Saving is off until they turn it on.
import { handleProReports } from "./_account.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleProReports(request, deps());
}

export function POST(request) {
  return handleProReports(request, deps());
}
