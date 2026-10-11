// Hosted endpoints (/mcp, /account, /decisions, /.well-known/oauth-protected-resource). 404 unless GRILL_HOSTED=on.
import { handleAccount, handleDecisions, handleMcp, handleProtectedResource } from "./_hosted.mjs";

export const maxDuration = 300;

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

const PUBLIC_PATH = {
  account: "/account",
  decisions: "/decisions",
  prm: "/.well-known/oauth-protected-resource",
  mcp: "/mcp",
};

function pick(request) {
  const url = new URL(request.url);
  const r = url.searchParams.get("__route");
  const p = url.pathname;
  if (r === "account" || p === "/account") return ["account", handleAccount];
  if (r === "decisions" || p === "/decisions") return ["decisions", handleDecisions];
  if (r === "prm" || p.startsWith("/.well-known/oauth-protected-resource")) return ["prm", handleProtectedResource];
  return ["mcp", handleMcp];
}

// Handlers never see __route. When the rewrite lands on this function, the
// public path is restored so a sign-in return goes to /account or /decisions.
function forHandler(request, route) {
  const url = new URL(request.url);
  url.searchParams.delete("__route");
  if (url.pathname === "/api/hosted" || url.pathname === "/hosted") url.pathname = PUBLIC_PATH[route];
  return new Request(url, request);
}

function run(request) {
  const [route, handler] = pick(request);
  return handler(forHandler(request, route), deps());
}

export const GET = (request) => run(request);
export const POST = (request) => run(request);
export const DELETE = (request) => run(request);
