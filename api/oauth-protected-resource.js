// RFC 9728 protected resource metadata. 404 unless GRILL_HOSTED=on.
import { handleProtectedResource } from "./_hosted.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleProtectedResource(request, deps());
}
