/**
 * A stand-in for OpenRouter's key management API. Tests use it directly. The dev server
 * uses it when Grill Pro test mode is on, so a purchase can mint a key without a real
 * management key. It is not the chat API the judge calls.
 */
import { randomBytes } from "node:crypto";
import { ROUTER_API } from "./_pro.mjs";

export function createMockManagement() {
  const keys = new Map();
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const u = String(url);
    const base = `${ROUTER_API}/keys`;
    if (!u.startsWith(base)) return new Response(JSON.stringify({ error: `unrouted ${method} ${u}` }), { status: 599 });
    const rest = u.slice(base.length);
    if (method === "POST" && (rest === "" || rest === "/")) {
      const body = JSON.parse(init.body || "{}");
      const hash = randomBytes(32).toString("hex");
      const key = `sk-or-v1-test-${hash.slice(0, 12)}`;
      const data = { hash, name: body.name, limit: body.limit, limit_reset: null, usage: 0, usage_monthly: 0, disabled: false };
      keys.set(hash, data);
      return Response.json({ key, data: { ...data } });
    }
    const hash = decodeURIComponent(rest.replace(/^\//, ""));
    const data = keys.get(hash);
    if (!data) return Response.json({}, { status: 404 });
    if (method === "GET") return Response.json({ data: { ...data } });
    if (method === "PATCH") {
      const body = JSON.parse(init.body || "{}");
      if (body.limit_reset) data.limit_reset = body.limit_reset;
      if (typeof body.disabled === "boolean") data.disabled = body.disabled;
      return Response.json({ data: { ...data } });
    }
    if (method === "DELETE") {
      keys.delete(hash);
      return Response.json({ deleted: true });
    }
    return Response.json({ error: "unsupported" }, { status: 400 });
  };
  fetchImpl.noteUsage = (hash, usd) => {
    const data = keys.get(hash);
    if (!data) return;
    const next = Math.round((Number(data.usage_monthly) + Number(usd)) * 10000) / 10000;
    data.usage_monthly = next;
    data.usage = Math.round((Number(data.usage) + Number(usd)) * 10000) / 10000;
  };
  fetchImpl.keys = keys;
  return fetchImpl;
}
