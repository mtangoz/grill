// The Pro launch list: double opt-in, an encrypted link, and interest counts that are not users.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { USAGE_EVENTS } from "../api/_account.mjs";
import {
  CONFIRM_SUBJECT,
  POSTAL_PLACEHOLDER,
  handleNotify,
  handleNotifyConfirm,
  launchEmailText,
  openNotifyToken,
  readNotifyInterest,
  sealNotifyToken,
  signIssued,
} from "../api/_notify.mjs";

const NOW = Date.UTC(2026, 8, 29, 15, 0, 0);
const EMAIL = "Notify.User+Pro@Example.com";
const NORMAL = "notify.user+pro@example.com";
const ENV = {
  RESEND_API_KEY: "re_test_key",
  GRILL_PRO_EMAIL_FROM: "Grill <support@grillyour.ai>",
  UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
  GRILL_NOTIFY_SECRET: "notify-secret-at-least-16",
  RESEND_NOTIFY_SEGMENT_ID: "segmentid12345678",
  RESEND_NOTIFY_TOPIC_ID: "topicid1234567890",
  GRILL_PRO_ORIGIN: "https://grillyour.ai",
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function redisEval(store, args) {
  const [op, key, ...rest] = args;
  if (op === "SET") {
    if (rest.includes("NX") && store.has(key)) return null;
    store.set(key, rest[0]);
    return "OK";
  }
  if (op === "GET") return store.has(key) ? store.get(key) : null;
  if (op === "INCR") {
    const n = (Number(store.get(key)) || 0) + 1;
    store.set(key, n);
    return n;
  }
  if (op === "EXPIRE") return 1;
  if (op === "DEL") return store.delete(key) ? 1 : 0;
  throw new Error(`unexpected redis ${op}`);
}

function world({ emailStatus = 200, contactStatus = 200, segmentStatus = 200 } = {}) {
  const store = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    const call = { url: String(url), method: init.method || "GET", body };
    calls.push(call);
    if (call.url === ENV.UPSTASH_REDIS_REST_URL) return json(200, { result: redisEval(store, body) });
    if (call.url === "https://api.resend.com/emails") return json(emailStatus, emailStatus === 200 ? { id: "email_1" } : {});
    if (call.url === "https://api.resend.com/contacts" && call.method === "POST") {
      return json(contactStatus, contactStatus === 200 ? { id: "contact_abc12345" } : {});
    }
    if (call.url.includes("/segments/") && call.method === "POST") return json(segmentStatus, segmentStatus === 200 ? { id: "seg" } : {});
    if (call.url.endsWith("/topics") && call.method === "PATCH") return json(200, {});
    if (call.url.startsWith("https://api.resend.com/contacts/") && call.method === "DELETE") return json(200, {});
    return json(500, {});
  };
  return { store, calls, fetchImpl };
}

function deps(fetchImpl, env = ENV, now = NOW) {
  return { env, fetch: fetchImpl, now };
}

function post(handler, path, fields, d) {
  return handler(
    new Request(`https://grillyour.ai${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    }),
    d,
  );
}

function signupFields(extra = {}) {
  return {
    email: EMAIL,
    via: "tool",
    issued: signIssued(NOW - 10_000, ENV.GRILL_NOTIFY_SECRET),
    leave_blank: "",
    ...extra,
  };
}

function encodings(email) {
  const body = Buffer.from(email, "utf8");
  return [email, encodeURIComponent(email), body.toString("base64"), body.toString("base64url"), body.toString("hex")];
}

function confirmUrl(calls) {
  const email = calls.find((c) => c.url === "https://api.resend.com/emails");
  assert.ok(email, "no confirmation email");
  const match = email.body.text.match(/https:\/\/grillyour\.ai\/notify\/confirm\?t=([A-Za-z0-9_-]+)/);
  assert.ok(match, email.body.text);
  return { url: match[0], token: match[1] };
}

describe("the form stays quiet until it is configured", () => {
  it("says sign-ups aren't open yet, and does not answer 503, when Resend or Upstash is missing", async () => {
    for (const drop of ["RESEND_API_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "GRILL_NOTIFY_SECRET"]) {
      const env = { ...ENV };
      delete env[drop];
      const calls = [];
      const res = await handleNotify(
        new Request("https://grillyour.ai/notify"),
        deps(async () => {
          calls.push(1);
          throw new Error("should not be called");
        }, env),
      );
      assert.notEqual(res.status, 503, drop);
      assert.equal(res.status, 200, drop);
      assert.match(await res.text(), /aren't open yet/);
      assert.equal(calls.length, 0, drop);
    }
  });
});

describe("asking to be notified", () => {
  it("stores nothing but a hash before confirm, and the confirm URL does not contain the address in any encoding", async () => {
    const w = world();
    const res = await post(handleNotify, "/notify", signupFields(), deps(w.fetchImpl));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Nothing is saved until you click it/);
    const { url, token } = confirmUrl(w.calls);
    const link = new URL(url);
    assert.deepEqual([...link.searchParams.keys()], ["t"]);
    for (const email of [EMAIL, NORMAL]) {
      for (const encoded of encodings(email)) {
        assert.equal(url.includes(encoded), false, encoded);
        assert.equal(token.includes(encoded), false, encoded);
      }
      assert.equal(Buffer.from(token, "base64url").includes(Buffer.from(email, "utf8")), false);
    }
    assert.equal(openNotifyToken(token, ENV.GRILL_NOTIFY_SECRET, NOW)?.email, NORMAL);
    const contact = w.calls.filter((c) => c.url.startsWith("https://api.resend.com/contacts"));
    assert.equal(contact.length, 0);
    for (const key of w.store.keys()) {
      assert.equal(String(key).includes(NORMAL), false);
      assert.equal(String(key).includes(EMAIL), false);
      assert.equal(String(w.store.get(key)).includes(NORMAL), false);
    }
    assert.ok([...w.store.keys()].some((key) => key.startsWith("grill:notify:cool:")));
    assert.equal(w.calls.some((c) => c.url.includes("broadcast")), false);
  });

  it("sends the confirmation once per address per day, and pauses at the daily cap", async () => {
    const w = world();
    const d = deps(w.fetchImpl);
    const first = await post(handleNotify, "/notify", signupFields(), d);
    assert.match(await first.text(), /Check your inbox/);
    const second = await post(handleNotify, "/notify", signupFields({ email: "other.person@example.com" }), deps(w.fetchImpl, { ...ENV, GRILL_NOTIFY_DAILY_CAP: "1" }));
    assert.match(await second.text(), /paused for today/);
    const emails = w.calls.filter((c) => c.url === "https://api.resend.com/emails");
    assert.equal(emails.length, 1);
    const again = await post(handleNotify, "/notify", signupFields(), d);
    assert.match(await again.text(), /Check your inbox/);
    assert.equal(w.calls.filter((c) => c.url === "https://api.resend.com/emails").length, 1);
  });

  it("rejects a honeypot and a too-quick submit without sending or storing", async () => {
    for (const fields of [
      signupFields({ leave_blank: "filled by a script" }),
      signupFields({ issued: signIssued(NOW, ENV.GRILL_NOTIFY_SECRET) }),
      signupFields({ issued: "" }),
    ]) {
      const calls = [];
      const res = await post(
        handleNotify,
        "/notify",
        fields,
        deps(async () => {
          calls.push(1);
          throw new Error("should not be called");
        }),
      );
      assert.equal(res.status, 200);
      assert.equal(calls.length, 0);
      const body = await res.text();
      assert.doesNotMatch(body, /honeypot/i);
      assert.doesNotMatch(body, /window\.va|_vercel\/insights/);
      if (fields.leave_blank) assert.match(body, /Check your inbox/);
      else assert.match(body, /Notify me/);
    }
  });

  it("logs a status code only when email fails, never the address", async () => {
    const w = world({ emailStatus: 500 });
    const logs = [];
    const orig = console.error;
    console.error = (...args) => logs.push(args.join(" "));
    try {
      const res = await post(handleNotify, "/notify", signupFields(), deps(w.fetchImpl));
      assert.equal(res.status, 200);
      assert.match(await res.text(), /Nothing was saved/);
    } finally {
      console.error = orig;
    }
    assert.ok(logs.some((line) => line.includes("[grill-notify] resend 500")));
    for (const line of logs) {
      assert.equal(line.includes(NORMAL), false);
      assert.equal(line.includes(EMAIL), false);
    }
  });
});

describe("confirming", () => {
  async function ready() {
    const w = world();
    await post(handleNotify, "/notify", signupFields(), deps(w.fetchImpl));
    return { w, ...confirmUrl(w.calls) };
  }

  it("GET shows a button and does not confirm; POST is what adds the contact", async () => {
    const { w, url, token } = await ready();
    const before = w.calls.length;
    const seen = await handleNotifyConfirm(new Request(url), deps(w.fetchImpl));
    assert.equal(seen.status, 200);
    const page = await seen.text();
    assert.match(page, /<button[^>]*>Confirm<\/button>/);
    assert.equal(page.includes(NORMAL), false);
    assert.equal(w.calls.length, before, "opening the link makes no requests");
    const saved = await post(handleNotifyConfirm, "/notify/confirm", { t: token }, deps(w.fetchImpl));
    assert.match(await saved.text(), /You're on the list/);
    const created = w.calls.find((c) => c.url === "https://api.resend.com/contacts" && c.method === "POST");
    assert.deepEqual(created.body, { email: NORMAL, unsubscribed: false });
    assert.deepEqual(Object.keys(created.body).sort(), ["email", "unsubscribed"]);
    const resendCalls = w.calls.filter((c) => c.url.startsWith("https://api.resend.com/"));
    for (const call of resendCalls) {
      assert.equal(call.url.includes(NORMAL), false);
      assert.equal(call.url.includes("via="), false);
      if (call.body && !Array.isArray(call.body)) assert.equal(Object.hasOwn(call.body, "via"), false);
      assert.equal(JSON.stringify(call.body ?? "").includes('"via"'), false);
    }
    const segment = resendCalls.find((c) => c.url.includes("/segments/"));
    assert.equal(segment.url, `https://api.resend.com/contacts/contact_abc12345/segments/${ENV.RESEND_NOTIFY_SEGMENT_ID}`);
    const topic = resendCalls.find((c) => c.url.endsWith("/topics"));
    assert.deepEqual(topic.body, [{ id: ENV.RESEND_NOTIFY_TOPIC_ID, subscription: "opt_in" }]);
    const interest = await readNotifyInterest(ENV, w.fetchImpl);
    assert.equal(interest.label, "Pro interest");
    assert.equal(interest.countsAsUsers, false);
    assert.equal(interest.notify_list, 1);
    assert.equal(interest.notify_tool, 1);
    assert.equal(interest.notify_paste, 0);
    assert.equal(interest.notify_site, 0);
    assert.equal(interest.users, undefined);
    assert.equal(interest.total, undefined);
    for (const name of ["notify_confirmed", "notify_confirmed_via_tool", "notify_list"]) {
      assert.equal(USAGE_EVENTS.includes(name), false);
    }
  });

  it("rejects a bad, tampered or expired token and stores nothing further", async () => {
    const { w, token } = await ready();
    const flipped = `${token.slice(0, -2)}${token.endsWith("a") ? "b" : "a"}${token.slice(-1)}`;
    const expired = sealNotifyToken({ email: NORMAL, via: "tool", exp: NOW - 1 }, ENV.GRILL_NOTIFY_SECRET);
    const wrong = sealNotifyToken({ email: NORMAL, via: "tool", exp: NOW + 1000 }, "a-different-secret-value");
    for (const t of ["nope", flipped, expired, wrong]) {
      const res = await post(handleNotifyConfirm, "/notify/confirm", { t }, deps(w.fetchImpl));
      assert.match(await res.text(), /doesn't work/);
    }
    assert.equal(w.calls.some((c) => c.url === "https://api.resend.com/contacts"), false);
    const getExpired = await handleNotifyConfirm(new Request(`https://grillyour.ai/notify/confirm?t=${expired}`), deps(w.fetchImpl));
    const expiredPage = await getExpired.text();
    assert.match(expiredPage, /doesn't work/);
    assert.doesNotMatch(expiredPage, /<button/);
  });
});

describe("the launch email", () => {
  it("keeps the postal line as the env var placeholder and is not sent", () => {
    const text = launchEmailText({});
    assert.match(text, new RegExp(POSTAL_PLACEHOLDER));
    assert.match(text, /60 days after this email/);
    assert.match(text, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
    assert.equal(launchEmailText({ NOTIFY_POSTAL_ADDRESS: "100 Market Street, Suite 1" }).includes("100 Market Street, Suite 1"), true);
    assert.equal(CONFIRM_SUBJECT, "Confirm: tell me when Grill Pro is ready");
  });
});
