// Monday batch for the four-week impact note. Vercel calls this once a day.
// The handler sends only on the pilot Mondays, and only once per account that week.
import { runImpactDigest } from "./_hosted.mjs";

export const maxDuration = 300;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function run() {
  try {
    const result = await runImpactDigest({ env: process.env, fetch: globalThis.fetch, now: Date.now() });
    return json(result);
  } catch {
    console.error("[grill-impact] batch failed");
    return new Response("error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export const GET = () => run();
export const POST = () => run();
