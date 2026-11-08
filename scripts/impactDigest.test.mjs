// Weekly impact email. Opt-out, on for a signed-in account. Counts match the Your grills page.
import { createSign, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAccount, handleDecisions, handleMcp, resetHostedCaches, runImpactDigest } from "../api/_hosted.mjs";
import { startFakeOpenRouter } from "./fixtures/fake-openrouter.mjs";
import { CLAUDE_WEB_REDIRECT, createMemoryRedis, grillImpact } from "./hostedCore.mjs";
import { testSigningKey } from "./testSigningKey.mjs";
import {
  IMPACT_EMAIL_SUBJECT,
  digestForAccount,
  impactDigestText,
  impactDigestWeek,
  impactEmailOn,
  impactSentKey,
  newlyDueLookbacks,
  readEmailExperiment,
  openImpactToken,
  sealImpactToken,
  weekGrills,
} from "./impactDigest.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCE = "https://mcp.example/mcp";
const MONDAY = Date.parse("2026-11-16T15:00:00Z");
const WINDOW = impactDigestWeek(MONDAY);

let privateKey;
let jwk;
before(async () => {
  ({ privateKey, jwk } = await testSigningKey());
});

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${sig}`;
}

function row(extra = {}) {
  return {
    id: extra.id || "rec1",
    title: extra.title || "Hire the contractor",
    createdAt: extra.createdAt || "2026-11-12T12:00:00.000Z",
    review: extra.review || "",
    verdict: extra.verdict || "",
    supersedes: extra.supersedes || "",
    impact: extra.impact || "",
    challengeKinds: extra.challengeKinds || [],
    lookback: extra.lookback || null,
    block: extra.block || "",
  };
}

describe("weekly impact email copy", () => {
  it("uses the page count and never treats a verdict as a changed call", () => {
    const rows = [
      row({ id: "yes", impact: "changed", verdict: "holds up" }),
      row({ id: "after", supersedes: "2026-11-01 Earlier call" }),
      row({ id: "doubt", verdict: "doesn't hold up" }),
      row({ id: "kept", impact: "kept", verdict: "doesn't hold up" }),
      row({ id: "flag", challengeKinds: ["unsupported-claim"] }),
    ];
    const summary = grillImpact(rows);
    assert.equal(summary.changed, 2);
    assert.equal(summary.doubted, 1);
    assert.equal(summary.flagged, 1);
    assert.equal(summary.kept, 1);
    const text = impactDigestText({
      changed: summary.changed,
      count: summary.count,
      unknown: summary.unknown,
      doubted: summary.doubted,
      flagged: summary.flagged,
      lookbacks: [{ label: "Hire the contractor", held: "https://grillyour.ai/decisions?confirm=outcome&id=due&value=held&from=email", no: "https://grillyour.ai/decisions?confirm=outcome&id=due&value=no&from=email", mixed: "https://grillyour.ai/decisions?confirm=outcome&id=due&value=mixed&from=email" }],
      decisionsUrl: "https://grillyour.ai/decisions",
      unsubscribeUrl: "https://grillyour.ai/account?unsubscribe=token",
      settingsUrl: "https://grillyour.ai/account",
    });
    assert.equal(IMPACT_EMAIL_SUBJECT, "Did Grill change your call?");
    assert.match(text, /^This week: 2 of 5 grills changed your call\./);
    assert.match(text, /1 unknown \(impact not confirmed\) · 1 called out \(not a confirmed change\) · 1 flagged \(not proof\)/);
    assert.match(text, /Look-back due: Hire the contractor\nHeld up: https:\/\/grillyour\.ai\/decisions\?confirm=outcome&id=due&value=held&from=email\nDidn't: /);
    assert.match(text, /Mixed: https:\/\/grillyour\.ai\/decisions\?confirm=outcome&id=due&value=mixed&from=email/);
    assert.match(text, /Your grills → https:\/\/grillyour\.ai\/decisions/);
    assert.match(text, /Unsubscribe: https:\/\/grillyour\.ai\/account\?unsubscribe=token/);
    assert.match(text, /Email settings: https:\/\/grillyour\.ai\/account/);
    assert.doesNotMatch(text, /doesn't hold up|changed the call yet|\$|\bspend\b|\bcost\b/i);
    assert.doesNotMatch(text, /Grill Pro is ready|RESEND_UNSUBSCRIBE_URL/);
  });

  it("drops a zero plan count and a zero source count, and a week with neither line", () => {
    const plans = impactDigestText({ changed: 0, count: 2, doubted: 2, flagged: 0, lookbacks: [], decisionsUrl: "https://grillyour.ai/decisions", unsubscribeUrl: "https://grillyour.ai/u", settingsUrl: "https://grillyour.ai/account" });
    assert.match(plans, /This week: 0 of 2 grills changed your call\./);
    assert.match(plans, /2 called out \(not a confirmed change\)/);
    assert.doesNotMatch(plans, /flagged \(not proof\)/);
    assert.doesNotMatch(plans, /unknown/);
    const sources = impactDigestText({ changed: 1, count: 1, doubted: 0, flagged: 3, lookbacks: [], decisionsUrl: "https://grillyour.ai/decisions", unsubscribeUrl: "https://grillyour.ai/u", settingsUrl: "https://grillyour.ai/account" });
    assert.match(sources, /This week: 1 of 1 grills changed your call\./);
    assert.match(sources, /3 flagged \(not proof\)/);
    assert.doesNotMatch(sources, /called out/);
    const neither = impactDigestText({ changed: 0, count: 0, doubted: 0, flagged: 0, lookbacks: [{ label: "Ship Friday", held: "https://h", no: "https://n", mixed: "https://m" }], decisionsUrl: "https://grillyour.ai/decisions", unsubscribeUrl: "https://grillyour.ai/u", settingsUrl: "https://grillyour.ai/account" });
    assert.doesNotMatch(neither, /This week:/);
    assert.doesNotMatch(neither, /flagged/);
    assert.match(neither, /Look-back due: Ship Friday/);
  });

  it("counts only this week's grills, and only look-backs that came due this week", () => {
    const rows = [
      row({ id: "old", createdAt: "2026-11-01T12:00:00.000Z", review: "2026-11-08", title: "Old overdue" }),
      row({ id: "new", createdAt: "2026-11-12T12:00:00.000Z", verdict: "doesn't hold up", title: "New plan" }),
      row({ id: "due", createdAt: "2026-10-01T12:00:00.000Z", review: "2026-11-12", title: "Price the seats" }),
      row({ id: "done", createdAt: "2026-10-01T12:00:00.000Z", review: "2026-11-13", title: "Already read", lookback: { happened: "Held up." } }),
      row({ id: "later", createdAt: "2026-11-20T12:00:00.000Z", review: "2026-11-20", title: "Next week" }),
    ];
    assert.deepEqual(weekGrills(rows, WINDOW.startMs, WINDOW.endMs).map((item) => item.id), ["new"]);
    assert.deepEqual(newlyDueLookbacks(rows, WINDOW.startMs, WINDOW.endMs).map((item) => item.id), ["due"]);
    const digest = digestForAccount(rows, WINDOW, {
      outcome: (id, value) => `https://grillyour.ai/decisions?confirm=outcome&id=${id}&value=${value}&from=email`,
      decisions: "https://grillyour.ai/decisions",
      unsubscribe: "https://grillyour.ai/account?unsubscribe=token",
      settings: "https://grillyour.ai/account",
    });
    assert.match(digest.text, /This week: 0 of 1 grills changed your call\./);
    assert.match(digest.text, /1 called out \(not a confirmed change\)/);
    assert.match(digest.text, /Look-back due: Price the seats/);
    assert.doesNotMatch(digest.text, /Old overdue|Already read|Next week|New plan/);
    assert.equal(digestForAccount([row({ id: "quiet", createdAt: "2026-10-01T00:00:00.000Z", review: "2026-10-20" })], WINDOW, { outcome: () => "", decisions: "", unsubscribe: "", settings: "" }), null);
  });

  it("sends on Monday afternoons and not on any other day", () => {
    assert.equal(impactDigestWeek(Date.parse("2026-11-09T15:00:00Z")).key, "2026-11-09");
    assert.equal(impactDigestWeek(Date.parse("2026-11-30T14:00:00Z")).index, 3);
    assert.equal(impactDigestWeek(Date.parse("2026-11-16T13:59:00Z")), null);
    assert.equal(impactDigestWeek(Date.parse("2026-11-17T15:00:00Z")), null);
    assert.equal(impactEmailOn({ email: "a@example.com" }), true);
    assert.equal(impactEmailOn({ email: "a@example.com", impactEmail: false }), false);
    assert.equal(impactEmailOn({ impactEmail: true }), false);
  });

  it("signs an unsubscribe token that a later week can still open", () => {
    const secret = randomBytes(32);
    const token = sealImpactToken("g_person", secret, Date.parse("2026-12-30T00:00:00Z"));
    assert.deepEqual(openImpactToken(token, secret, MONDAY), { id: "g_person" });
    assert.equal(openImpactToken(token, secret, Date.parse("2026-12-31T00:00:00Z")), null);
    assert.equal(openImpactToken(`${token}x`, secret, MONDAY), null);
    assert.equal(openImpactToken(token, randomBytes(32), MONDAY), null);
  });
});

function world() {
  const memory = createMemoryRedis();
  const emails = [];
  const env = {
    GRILL_HOSTED: "on",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-do-not-leak-9999",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: "invitee@example.com",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
    RESEND_API_KEY: "re_test_key",
    GRILL_PRO_EMAIL_FROM: "Grill <notes@grillyour.ai>",
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      return Response.json({
        id: decodeURIComponent(u.split("/").pop()),
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: "invitee@example.com", verification: { status: "verified" } }],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && init.method === "POST") {
      return Response.json({ key: "sk-or-v1-hosted-user-key-never-shown-0001", data: { hash: "hash_hosted_1", limit: 1, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      return Response.json({ data: { hash: "hash_hosted_1", limit: 1, usage: 0, usage_monthly: 0, disabled: false } });
    }
    if (u === "https://api.resend.com/emails" && init.method === "POST") {
      emails.push(JSON.parse(init.body));
      return Response.json({ id: "email_1" });
    }
    if (u.startsWith("https://api.resend.com/")) throw new Error(`launch list was contacted ${u}`);
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return { env, fetch: fetchImpl, redis: async (args) => memory.command(args), memory, emails, impactArm: () => "send" };
}

function cookie() {
  return `__session=${signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
}

async function decide(ctx, fake, title, now) {
  const token = signJwt({
    iss: "https://clerk.example.test",
    sub: "user_invitee",
    aud: RESOURCE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    redirect_uri: CLAUDE_WEB_REDIRECT,
  });
  const deps = { judgeOpenRouterUrl: fake.env.JUDGE_OPENROUTER_URL, judgeDecisionsUrl: fake.env.JUDGE_DECISIONS_URL, now };
  const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const send = async (body) => {
    const res = await handleMcp(
      new Request(RESOURCE, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) }),
      { ...ctx, ...deps },
    );
    return res.json();
  };
  const grilled = await send(call(1, "grill", { subject: `Decision: ${title}\nI'm 60% sure.`, keep_records: true, quality_check: false }));
  assert.equal(grilled.result.isError, false, grilled.result?.content?.[0]?.text || "");
  await send(call(2, "grill_decided", { decided: `Go with ${title}.` }));
}

describe("weekly impact email batch", () => {
  it("logs a held-out account without sending, and marks a return within the week", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = { ...world(), impactArm: () => "holdout" };
      await decide(ctx, fake, "Hire the contractor", Date.parse("2026-11-12T12:00:00Z"));
      const held = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(held.sent, 0);
      assert.equal(held.held, 1);
      assert.equal(ctx.emails.length, 0);
      const holdout = await ctx.memory.command(["SMEMBERS", "grill:exp:weekly-email:2026-11-16:holdout"]);
      assert.equal(holdout.length, 1);
      await decide(ctx, fake, "Raise the price", Date.parse("2026-11-18T12:00:00Z"));
      const back = await ctx.memory.command(["SMEMBERS", "grill:exp:weekly-email:2026-11-16:grill"]);
      assert.deepEqual(back, holdout);
      const readout = await readEmailExperiment((args) => ctx.memory.command(args), Date.parse("2026-11-19T00:00:00Z"));
      assert.deepEqual(readout.holdout, { weeks: 1, returned: 1, activity: 1, tapOnly: 0 });
      assert.equal(readout.ready, false);
      const sendCtx = world();
      await decide(sendCtx, fake, "Hire the contractor", Date.parse("2026-11-12T12:00:00Z"));
      await runImpactDigest({ ...sendCtx, now: MONDAY });
      assert.equal((await sendCtx.memory.command(["SMEMBERS", "grill:exp:weekly-email:2026-11-16:send"])).length, 1);
    } finally {
      await fake.close();
    }
  });

  it("emails a signed-in account by default, skips a quiet week, and does not send twice", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const quiet = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(quiet.sent, 0);
      assert.equal(ctx.emails.length, 0);
      await decide(ctx, fake, "Hire the contractor", Date.parse("2026-11-12T12:00:00Z"));
      const first = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(first.sent, 1);
      assert.equal(ctx.emails.length, 1);
      assert.equal(ctx.emails[0].subject, "Did Grill change your call?");
      assert.equal(ctx.emails[0].to, "invitee@example.com");
      assert.match(ctx.emails[0].text, /This week: 0 of 1 grills changed your call\./);
      assert.match(ctx.emails[0].text, /Your grills → https:\/\/grillyour\.ai\/decisions\?from=email/);
      assert.match(ctx.emails[0].text, /Unsubscribe: https:\/\/grillyour\.ai\/account\?unsubscribe=/);
      assert.match(ctx.emails[0].text, /Email settings: https:\/\/grillyour\.ai\/account/);
      assert.equal(ctx.emails[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
      assert.doesNotMatch(ctx.emails[0].text, /\$|spend|doesn't hold up/);
      const again = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(again.sent, 0);
      assert.equal(ctx.emails.length, 1);
      const tuesday = await runImpactDigest({ ...ctx, now: Date.parse("2026-11-17T15:00:00Z") });
      assert.equal(tuesday.reason, "not-scheduled");
      assert.equal(ctx.emails.length, 1);
    } finally {
      await fake.close();
    }
  });

  it("does not email someone who turned it off, and one click from the email turns it off", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      await decide(ctx, fake, "Hire the contractor", Date.parse("2026-11-12T12:00:00Z"));
      const account = await handleAccount(new Request("https://grillyour.ai/account", { headers: { cookie: cookie() } }), { ...ctx, now: MONDAY });
      const html = await account.text();
      assert.match(html, /Weekly email: On/);
      assert.match(html, /name="action" value="impact-email"/);
      assert.match(html, /Turn off weekly email/);
      assert.doesNotMatch(html, /<script/);
      const off = await handleAccount(
        new Request("https://grillyour.ai/account", {
          method: "POST",
          headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
          body: "action=impact-email&value=off",
        }),
        { ...ctx, now: MONDAY },
      );
      assert.equal(off.status, 303);
      const skipped = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(skipped.sent, 0);
      assert.equal(ctx.emails.length, 0);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_unsubscribes"]), "1");
      const back = await handleAccount(
        new Request("https://grillyour.ai/account", {
          method: "POST",
          headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
          body: "action=impact-email&value=on",
        }),
        { ...ctx, now: MONDAY },
      );
      assert.equal(back.status, 303);
      const sent = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(sent.sent, 1);
      const link = ctx.emails[0].text.match(/Unsubscribe: (https:\/\/\S+)/)[1];
      const unsub = await handleAccount(new Request(link), { ...ctx, now: MONDAY });
      const done = await unsub.text();
      assert.equal(unsub.status, 200);
      assert.match(done, /Weekly email is off/);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_unsubscribes"]), "2");
      const repeat = await handleAccount(new Request(link, { method: "POST" }), { ...ctx, now: MONDAY });
      assert.equal(repeat.status, 200);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_unsubscribes"]), "2");
      await ctx.memory.command(["DEL", impactSentKey("invitee@example.com", "2026-11-16")]);
      const blocked = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(blocked.sent, 0);
      assert.equal(ctx.emails.length, 1);
    } finally {
      await fake.close();
    }
  });

  it("opens a confirm page from an outcome link and records only on an authenticated POST", async () => {
    const fake = await startFakeOpenRouter();
    try {
      resetHostedCaches();
      const ctx = world();
      const made = Date.parse("2026-11-10T12:00:00Z");
      await decide(ctx, fake, "Price the seats", made);
      const page = await handleDecisions(new Request("https://grillyour.ai/decisions", { headers: { cookie: cookie() } }), { ...ctx, now: made });
      const html = await page.text();
      const id = html.match(/\/decisions\?id=([A-Za-z0-9_-]+)/)[1];
      await handleDecisions(
        new Request("https://grillyour.ai/decisions", {
          method: "POST",
          headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
          body: `action=review&id=${id}&value=set&review=2026-11-12`,
        }),
        { ...ctx, now: made },
      );
      const sent = await runImpactDigest({ ...ctx, now: MONDAY });
      assert.equal(sent.sent, 1);
      assert.match(ctx.emails[0].text, /Look-back due: Price the seats/);
      const held = ctx.emails[0].text.match(/Held up: (https:\/\/\S+)/)[1];
      assert.match(held, /confirm=outcome/);
      assert.match(held, /value=held/);
      assert.match(held, /from=email/);
      const anon = await handleDecisions(new Request(held), { ...ctx, now: MONDAY });
      assert.equal(anon.status, 302);
      const back = new URL(new URL(anon.headers.get("location")).searchParams.get("redirect_url"));
      assert.equal(back.searchParams.get("confirm"), "outcome");
      assert.equal(back.searchParams.get("id"), id);
      assert.equal(back.searchParams.get("value"), "held");
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_lookbacks"]), null);
      const seen = await handleDecisions(new Request(held, { headers: { cookie: cookie() } }), { ...ctx, now: MONDAY });
      const confirm = await seen.text();
      assert.equal(seen.status, 200);
      assert.match(confirm, /Record this look-back\?/);
      assert.match(confirm, /Held up/);
      assert.match(confirm, /name="confirm" value="record"/);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_lookbacks"]), null);
      const still = await handleDecisions(new Request(`https://grillyour.ai/decisions?id=${id}`, { headers: { cookie: cookie() } }), { ...ctx, now: MONDAY });
      assert.doesNotMatch(await still.text(), /It came true/);
      const sneaky = await handleDecisions(
        new Request("https://grillyour.ai/decisions", {
          method: "POST",
          headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
          body: `action=outcome&id=${id}&value=held&from=email`,
        }),
        { ...ctx, now: MONDAY },
      );
      assert.equal(sneaky.status, 303);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_lookbacks"]), null);
      const unsigned = await handleDecisions(
        new Request("https://grillyour.ai/decisions", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: `action=outcome&id=${id}&value=held&from=email&confirm=record`,
        }),
        { ...ctx, now: MONDAY },
      );
      assert.equal(unsigned.status, 303);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_lookbacks"]), null);
      const recorded = await handleDecisions(
        new Request("https://grillyour.ai/decisions", {
          method: "POST",
          headers: { cookie: cookie(), "content-type": "application/x-www-form-urlencoded" },
          body: `action=outcome&id=${id}&value=held&from=email&confirm=record`,
        }),
        { ...ctx, now: MONDAY },
      );
      assert.equal(recorded.status, 303);
      assert.equal(await ctx.memory.command(["GET", "grill:metric:impact_email_lookbacks"]), "1");
      const after = await handleDecisions(new Request(`https://grillyour.ai/decisions?id=${id}`, { headers: { cookie: cookie() } }), { ...ctx, now: MONDAY });
      assert.match(await after.text(), /Held up/);
    } finally {
      await fake.close();
    }
  });

  it("schedules the batch with the existing Vercel project and no new secret", () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.deepEqual(config.crons, [{ path: "/api/hosted?__route=digest", schedule: "0 14 * * *" }]);
    assert.equal(config.functions["api/impact-digest.js"], undefined);
    const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((name) => name.endsWith(".yml"));
    for (const name of workflows) {
      assert.doesNotMatch(readFileSync(join(ROOT, ".github/workflows", name), "utf8"), /impact-digest|impact_email/);
    }
    const hostedJs = readFileSync(join(ROOT, "api/hosted.js"), "utf8");
    assert.match(hostedJs, /r === "digest"/);
    assert.doesNotMatch(hostedJs, /CRON_SECRET/);
    assert.equal(readdirSync(join(ROOT, "api")).includes("impact-digest.js"), false);
    assert.match(readFileSync(join(ROOT, "api/_hosted.mjs"), "utf8"), /sendResendEmail/);
    assert.doesNotMatch(readFileSync(join(ROOT, "scripts/impactDigest.mjs"), "utf8"), /clerk/i);
  });
});
