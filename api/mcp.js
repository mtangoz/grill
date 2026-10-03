// /mcp when GRILL_HOSTED=on. Otherwise 404. The judge runs in this function, up to 300 seconds.
import { handleMcp } from "./_hosted.mjs";

export const maxDuration = 300;

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function POST(request) {
  return handleMcp(request, deps());
}

export function GET(request) {
  return handleMcp(request, deps());
}

export function DELETE(request) {
  return handleMcp(request, deps());
}
