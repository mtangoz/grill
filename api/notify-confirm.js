// grillyour.ai/notify/confirm: a button press adds the address. Opening the link does not.
import { handleNotifyConfirm } from "./_notify.mjs";

function deps() {
  return { env: process.env, fetch: globalThis.fetch, now: Date.now() };
}

export function GET(request) {
  return handleNotifyConfirm(request, deps());
}

export function POST(request) {
  return handleNotifyConfirm(request, deps());
}
