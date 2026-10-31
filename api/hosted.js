// Hosted endpoints (/mcp, /account, /decisions, /judge, /redeem, /decisions/calendar/<link>,
// /.well-known/oauth-protected-resource, including the /mcp path-inserted form,
// which serves the same metadata as the root path, and Clerk's authorization-server
// metadata at /.well-known/oauth-authorization-server and openid-configuration,
// including the /mcp path-inserted forms). 404 unless GRILL_HOSTED=on.
import { handleAccount, handleAuthorizationServer, handleCalendar, handleDecisions, handleJudge, handleMcp, handleProtectedResource, handleRedeem } from "./_hosted.mjs";

export const maxDuration = 300;

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

const PUBLIC_PATH = {
  account: "/account",
  redeem: "/redeem",
  calendar: "/decisions/calendar",
  decisions: "/decisions",
  judge: "/judge",
  prm: "/.well-known/oauth-protected-resource",
  oauth: "/.well-known/oauth-authorization-server",
  oidc: "/.well-known/openid-configuration",
  mcp: "/mcp",
};

function pick(request) {
  const url = new URL(request.url);
  const r = url.searchParams.get("__route");
  const p = url.pathname;
  if (r === "account" || p === "/account") return ["account", handleAccount];
  if (r === "redeem" || p === "/redeem") return ["redeem", handleRedeem];
  if (r === "calendar" || p.startsWith("/decisions/calendar/")) return ["calendar", handleCalendar];
  if (r === "decisions" || p === "/decisions") return ["decisions", handleDecisions];
  if (r === "judge" || p === "/judge") return ["judge", handleJudge];
  if (r === "prm" || p.startsWith("/.well-known/oauth-protected-resource")) return ["prm", handleProtectedResource];
  if (r === "oauth" || p.startsWith("/.well-known/oauth-authorization-server")) return ["oauth", handleAuthorizationServer];
  if (r === "oidc" || p.startsWith("/.well-known/openid-configuration")) return ["oidc", handleAuthorizationServer];
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
export const HEAD = (request) => run(request);

// Preflight is only meaningful on the authorization-server documents. Other
// routes keep answering 405, the same as when this function did not export OPTIONS.
export function OPTIONS(request) {
  const [route, handler] = pick(request);
  if (route === "oauth" || route === "oidc") return handler(forHandler(request, route), deps());
  return new Response("That request isn't supported.", {
    status: 405,
    headers: { Allow: "GET, POST, DELETE, HEAD", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
