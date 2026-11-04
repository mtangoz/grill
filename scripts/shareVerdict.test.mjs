// Opt-in public verdict link. The fixture is an invented workshop price, not a real decision.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleDecisions, handleShare, resetHostedCaches } from "../api/_hosted.mjs";
import { createMemoryRedis, decryptString, encryptString, keyFromEnv } from "./hostedCore.mjs";
import { recordBlock } from "./reflection.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EMAIL = "invitee@example.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-key";
jwk.alg = "RS256";
jwk.use = "sig";

const WORKSHOP = {
  title: "Saturday kiln workshop price",
  subject: "Should the Saturday kiln workshop cost $180 a seat?",
  question: "Is $180 the price that fills the room?",
  prediction: "Twelve seats sell by Friday if the price stays at $180.",
  verdict: "Shaky. The $180 seat only works if the room is <full>.",
  sharpest: "1. A full room is the whole case, and one empty bench breaks it. — Count paid seats the Thursday before.",
  other: "2. Last March's clay invoice is treated as if the price never moved. — Reprice the clay before printing the poster.",
  lookback: "Two seats stayed empty and the clay bill rose.",
  decided: "Keep the Saturday price and add a second bench.",
  goal: "Fill the Saturday kiln workshop without losing money.",
  guardrail: "Do not cancel a paid seat to make the price look right.",
  sourceApp: "claude",
  email: EMAIL,
  confidence: "55%",
  date: "2026-04-04",
  review: "2026-05-02",
  falsifier: "Count paid seats the Thursday before.",
};

const PRIVATE = [
  WORKSHOP.title,
  WORKSHOP.subject,
  WORKSHOP.question,
  WORKSHOP.prediction,
  WORKSHOP.other,
  WORKSHOP.lookback,
  WORKSHOP.decided,
  WORKSHOP.goal,
  WORKSHOP.guardrail,
  WORKSHOP.sourceApp,
  "Claude",
  WORKSHOP.email,
  WORKSHOP.confidence,
  WORKSHOP.date,
  WORKSHOP.review,
  "Friday",
  "kiln",
  "clay invoice",
  "clay bill",
  "second bench",
  "poster",
];

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${body}`;
  const sig = createSign("RSA-SHA256").update(data).sign(privateKey).toString("base64url");
  return `${data}.${sig}`;
}

function cookie() {
  const token = signJwt({ iss: "https://clerk.example.test", sub: "user_invitee", exp: Math.floor(Date.now() / 1000) + 3600 });
  return `__session=${token}`;
}

function personKey(email) {
  return `grill:hosted:person:${createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex")}`;
}

function world() {
  const memory = createMemoryRedis();
  const shareSets = [];
  const env = {
    GRILL_HOSTED: "on",
    CLERK_ISSUER: "https://clerk.example.test",
    CLERK_JWKS_URL: "https://clerk.example.test/jwks.json",
    CLERK_SECRET_KEY: "sk_test_clerk",
    OPENROUTER_MANAGEMENT_KEY: "sk-or-v1-management-do-not-leak-9999",
    GRILL_KEY_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GRILL_RECORD_KEY: randomBytes(32).toString("base64"),
    GRILL_HOSTED_ALLOWLIST: EMAIL,
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "redis-token",
  };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === env.CLERK_JWKS_URL) return Response.json({ keys: [jwk] });
    if (u.startsWith("https://api.clerk.com/v1/users/")) {
      return Response.json({
        id: decodeURIComponent(u.split("/").pop()),
        primary_email_address_id: "idn_1",
        email_addresses: [{ id: "idn_1", email_address: EMAIL, verification: { status: "verified" } }],
      });
    }
    if (u === "https://openrouter.ai/api/v1/keys" && init.method === "POST") {
      return Response.json({ key: "sk-or-v1-hosted-user-key-never-shown-0001", data: { hash: "hash_hosted_1", limit: 1, limit_reset: null } });
    }
    if (u.startsWith("https://openrouter.ai/api/v1/keys/")) {
      return Response.json({ data: { hash: "hash_hosted_1", limit: 1, usage: 0, usage_monthly: 0, disabled: false } });
    }
    throw new Error(`unexpected fetch ${init.method || "GET"} ${u}`);
  };
  return {
    env,
    fetch: fetchImpl,
    memory,
    shareSets,
    redis: async (args) => {
      if (String(args[0] || "").toUpperCase() === "SET" && String(args[1]).startsWith("grill:hosted:share:")) shareSets.push(String(args[1]));
      return memory.command(args);
    },
  };
}

function absent(text, extra = []) {
  for (const secret of [...PRIVATE, ...extra]) assert.equal(String(text).includes(secret), false, secret);
}

function shareBlock(html) {
  return html.match(/<div class="share-public">([\s\S]*?)<\/div>/)?.[1] ?? "";
}

function tokenFrom(html) {
  return html.match(/https:\/\/grillyour\.ai\/share\/([A-Za-z0-9_-]{43})/)?.[1] || "";
}

async function getDecisions(ctx, path = "/decisions", { cookieHeader = cookie() } = {}) {
  const res = await handleDecisions(new Request(`https://grillyour.ai${path}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} }), ctx);
  return { res, html: await res.text() };
}

async function postDecisions(ctx, body, { cookieHeader = cookie() } = {}) {
  return handleDecisions(
    new Request("https://grillyour.ai/decisions", {
      method: "POST",
      headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    ctx,
  );
}

async function plant(ctx, extra = {}) {
  const first = await getDecisions(ctx);
  assert.equal(first.res.status, 200, first.html.slice(0, 240));
  const accountId = ctx.memory.command(["GET", personKey(EMAIL)]);
  assert.equal(typeof accountId, "string");
  const master = keyFromEnv(ctx.env, "GRILL_RECORD_KEY");
  const dataKey = randomBytes(32);
  ctx.memory.command(["SET", `grill:hosted:rkey:${accountId}`, encryptString(dataKey.toString("base64"), master)]);
  const id = extra.id || "workshop01";
  const verdict = extra.verdict || WORKSHOP.verdict;
  const falsifier = extra.falsifier || WORKSHOP.falsifier;
  const block = recordBlock({
    date: WORKSHOP.date,
    title: WORKSHOP.title,
    prediction: WORKSHOP.prediction,
    verdict,
    falsifier,
    confidence: WORKSHOP.confidence,
    review: WORKSHOP.review,
    goal: WORKSHOP.goal,
    guardrails: WORKSHOP.guardrail,
    source_app: WORKSHOP.sourceApp,
    decided: WORKSHOP.decided,
  });
  const row = {
    id,
    createdAt: "2026-04-04T15:00:00.000Z",
    date: WORKSHOP.date,
    title: WORKSHOP.title,
    verdict,
    review: WORKSHOP.review,
    subject: WORKSHOP.subject,
    question: WORKSHOP.question,
    prediction: WORKSHOP.prediction,
    challenges: extra.challenges || [WORKSHOP.sharpest, WORKSHOP.other],
    lookback: { happened: WORKSHOP.lookback },
    sourceApp: WORKSHOP.sourceApp,
    email: WORKSHOP.email,
    accountId,
    decided: WORKSHOP.decided,
    block: `${block}\nquestion: ${WORKSHOP.question}\nsubject: ${WORKSHOP.subject}`,
  };
  ctx.memory.command(["SET", `grill:hosted:record:${accountId}:${id}`, encryptString(JSON.stringify(row), dataKey)]);
  ctx.memory.command(["ZADD", `grill:hosted:records:${accountId}`, Date.parse(row.createdAt), id]);
  return { accountId, id, dataKey };
}

function rewrite(ctx, planted, patch) {
  const key = `grill:hosted:record:${planted.accountId}:${planted.id}`;
  const row = JSON.parse(decryptString(ctx.memory.command(["GET", key]), planted.dataKey));
  Object.assign(row, patch);
  ctx.memory.command(["SET", key, encryptString(JSON.stringify(row), planted.dataKey)]);
}

async function publicPage(ctx, token, init = {}) {
  const res = await handleShare(new Request(`https://grillyour.ai/share/${token}`, init), ctx);
  return { res, html: await res.text() };
}

describe("share this verdict", { concurrency: false }, () => {
  beforeEach(() => resetHostedCaches());

  it("keeps every record private until the owner shares it", async () => {
    const ctx = world();
    const planted = await plant(ctx);
    const { html } = await getDecisions(ctx);
    assert.match(html, /Saturday kiln workshop price/);
    assert.match(html, /href="\/decisions\?confirm=share&amp;id=workshop01">Share verdict/);
    assert.equal(html.includes("/share/"), false);
    assert.equal(ctx.shareSets.length, 0);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:shareof:${planted.accountId}:${planted.id}`]), null);
    const guessed = await publicPage(ctx, "a".repeat(43));
    assert.equal(guessed.res.status, 404);
    assert.equal(guessed.html.includes(WORKSHOP.verdict), false);
  });

  it("previews the exact public text, then a signed-in POST creates the link", async () => {
    const ctx = world();
    const planted = await plant(ctx);
    const bare = await postDecisions(ctx, `action=share&id=${planted.id}`);
    assert.equal(bare.status, 303);
    assert.equal(ctx.shareSets.length, 0, "a post without the confirm button shares nothing");

    const ask = await getDecisions(ctx, `/decisions?confirm=share&id=${planted.id}`);
    assert.equal(ask.res.status, 200);
    assert.match(ask.html, /<h1>Share this verdict\?<\/h1>/);
    assert.match(ask.html, /<button type="submit" name="confirm" value="share">Share verdict<\/button>/);
    assert.match(ask.html, /<a href="\/decisions">Don't share<\/a>/);
    assert.equal(ask.html.includes("<script"), false);
    assert.equal(ask.html.includes("/share/"), false);
    absent(ask.html, [planted.accountId]);
    const preview = shareBlock(ask.html);
    assert.ok(preview.includes("Shaky."));
    assert.ok(preview.includes("one empty bench"));
    assert.ok(preview.includes('href="https://grillyour.ai/"'));
    assert.equal(preview.includes("<full>"), false);
    assert.ok(preview.includes("&lt;full&gt;"));

    const posted = await postDecisions(ctx, `action=share&id=${encodeURIComponent(planted.id)}&confirm=share`);
    assert.equal(posted.status, 303);
    assert.equal(posted.headers.get("location"), "https://grillyour.ai/decisions");
    assert.equal(await posted.text(), "");
    const shown = await getDecisions(ctx);
    const token = tokenFrom(shown.html);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(token.includes(planted.id), false);
    assert.match(shown.html, /<input readonly style="width:100%;box-sizing:border-box" value="https:\/\/grillyour\.ai\/share\//);
    assert.match(shown.html, /<button type="submit">Stop sharing<\/button>/);
    assert.equal(shown.html.includes("<script"), false);

    const pub = await publicPage(ctx, token);
    assert.equal(pub.res.status, 200);
    assert.equal(shareBlock(pub.html), preview);
    const exported = await getDecisions(ctx, "/decisions?export=json");
    assert.equal(exported.html.includes(token), false);
    assert.equal(exported.html.includes("/share/"), false);
  });

  it("shows only the verdict, one challenge, and a link to grillyour.ai", async () => {
    const ctx = world();
    const planted = await plant(ctx);
    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const token = tokenFrom((await getDecisions(ctx)).html);
    const pub = await publicPage(ctx, token);
    assert.equal(pub.res.status, 200);
    assert.equal(pub.res.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(pub.res.headers.get("x-robots-tag"), "noindex");
    assert.equal(pub.res.headers.get("cache-control"), "no-store");
    assert.equal(pub.res.headers.get("referrer-policy"), "no-referrer");
    assert.match(pub.html, /<meta name="robots" content="noindex">/);
    assert.match(pub.html, /<html lang="en">/);
    assert.equal(pub.html.includes("<script"), false);
    assert.match(pub.html, /<title>A Grill verdict<\/title>/);
    assert.match(pub.html, /Shaky\. The \$180 seat only works if the room is &lt;full&gt;\./);
    assert.match(pub.html, /one empty bench breaks it/);
    assert.match(pub.html, /<a href="https:\/\/grillyour\.ai\/">grillyour\.ai<\/a>/);
    absent(pub.html, [planted.accountId, planted.id]);
    assert.equal(pub.html.includes(WORKSHOP.other), false);
    assert.equal((pub.html.match(/challenge/gi) || []).length, 0, "the second challenge is not labelled, and no other challenge is named");
  });

  it("uses the falsifier when the record has no first challenge line", async () => {
    const ctx = world();
    const falsifier = "Count the unsold seats on Thursday and stop if two are open.";
    const planted = await plant(ctx, {
      id: "workshop02",
      challenges: ["", WORKSHOP.other],
      falsifier,
      verdict: "Shaky. One open seat is enough to rethink the number.",
    });
    const ask = await getDecisions(ctx, `/decisions?confirm=share&id=${planted.id}`);
    assert.match(ask.html, /unsold seats/);
    assert.equal(ask.html.includes("clay invoice"), false);
    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const token = tokenFrom((await getDecisions(ctx)).html);
    const raw = ctx.memory.command(["GET", `grill:hosted:share:${token}`]);
    assert.equal(JSON.parse(raw).challenge, falsifier);
    assert.equal(raw.includes("clay invoice"), false);
    const pub = await publicPage(ctx, token);
    assert.match(pub.html, /unsold seats/);
    absent(pub.html, [planted.accountId, planted.id]);
  });

  it("stores a 43-character token and a snapshot later edits cannot change", async () => {
    const ctx = world();
    const planted = await plant(ctx);
    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const token = tokenFrom((await getDecisions(ctx)).html);
    assert.equal(token.length, 43);
    const key = `grill:hosted:share:${token}`;
    assert.deepEqual(ctx.shareSets, [key]);
    const raw = ctx.memory.command(["GET", key]);
    assert.equal(raw, JSON.stringify({ verdict: WORKSHOP.verdict, challenge: WORKSHOP.sharpest }));
    assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["challenge", "verdict"]);
    absent(raw, [planted.accountId, planted.id]);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:shareof:${planted.accountId}:${planted.id}`]), token);

    const revisedVerdict = "Doesn't hold up. A weekday class is the cheaper test.";
    const revisedChallenge = "1. The Thursday count never happened, so the room-size bet is still a guess.";
    rewrite(ctx, planted, {
      title: "Weekday clay class instead",
      verdict: revisedVerdict,
      challenges: [revisedChallenge, "2. A new private note about the teacher's cut."],
      lookback: { happened: "The poster run was cancelled after two empty benches." },
      prediction: "Nobody signs up for a dawn class.",
      subject: "Move the kiln workshop to Wednesday.",
    });
    const owner = await getDecisions(ctx);
    assert.match(owner.html, /Weekday clay class instead/);
    const still = await publicPage(ctx, token);
    assert.match(still.html, /one empty bench breaks it/);
    assert.equal(still.html.includes("weekday"), false);
    assert.equal(still.html.includes("cancelled"), false);
    assert.equal(still.html.includes("teacher's cut"), false);
    assert.equal(still.html.includes("dawn class"), false);
    assert.equal(still.html.includes("Wednesday"), false);
    assert.equal(ctx.memory.command(["GET", key]), raw);

    const again = await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    assert.equal(again.status, 303);
    assert.equal(tokenFrom((await getDecisions(ctx)).html), token, "sharing again keeps the original snapshot");
    assert.equal(ctx.memory.command(["GET", key]), raw);

    await postDecisions(ctx, `action=unshare&id=${planted.id}`);
    assert.equal((await publicPage(ctx, token)).res.status, 404);
    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const next = tokenFrom((await getDecisions(ctx)).html);
    assert.notEqual(next, token);
    assert.equal(JSON.parse(ctx.memory.command(["GET", `grill:hosted:share:${next}`])).verdict, revisedVerdict);
    assert.match((await publicPage(ctx, next)).html, /weekday class/);
    assert.equal((await publicPage(ctx, next)).html.includes("one empty bench"), false);
    assert.equal((await publicPage(ctx, token)).res.status, 404);
  });

  it("stops sharing on POST, and a revoked, missing or deleted record is a 404", async () => {
    const ctx = world();
    const planted = await plant(ctx);
    assert.equal((await publicPage(ctx, "not-a-token")).res.status, 404);
    assert.equal((await publicPage(ctx, `${"c".repeat(43)}extra`)).res.status, 404);
    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const token = tokenFrom((await getDecisions(ctx)).html);
    assert.equal((await publicPage(ctx, token)).res.status, 200);
    const stopped = await postDecisions(ctx, `action=unshare&id=${planted.id}`);
    assert.equal(stopped.status, 303);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:share:${token}`]), null);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:shareof:${planted.accountId}:${planted.id}`]), null);
    const gone = await publicPage(ctx, token);
    assert.equal(gone.res.status, 404);
    assert.equal(gone.res.headers.get("x-robots-tag"), "noindex");
    assert.equal(gone.html.includes("Shaky"), false);
    const list = await getDecisions(ctx);
    assert.equal(list.html.includes(token), false);
    assert.match(list.html, /Share verdict/);

    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const live = tokenFrom((await getDecisions(ctx)).html);
    assert.equal((await publicPage(ctx, live)).res.status, 200);
    const deleted = await postDecisions(ctx, `action=delete&id=${planted.id}&confirm=delete`);
    assert.equal(deleted.status, 303);
    assert.equal((await publicPage(ctx, live)).res.status, 404);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:share:${live}`]), null);

    ctx.env.GRILL_HOSTED = "off";
    assert.equal((await publicPage(ctx, live)).res.status, 404);
  });

  it("refuses create and revoke when nobody is signed in", async () => {
    const ctx = world();
    const planted = await plant(ctx);
    const created = await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`, { cookieHeader: "" });
    assert.equal(created.status, 303);
    assert.equal(created.headers.get("location"), "https://grillyour.ai/decisions");
    assert.equal(ctx.shareSets.length, 0);
    assert.equal((await publicPage(ctx, "d".repeat(43))).res.status, 404);

    await postDecisions(ctx, `action=share&id=${planted.id}&confirm=share`);
    const token = tokenFrom((await getDecisions(ctx)).html);
    const revoked = await postDecisions(ctx, `action=unshare&id=${planted.id}`, { cookieHeader: "" });
    assert.equal(revoked.status, 303);
    assert.equal((await publicPage(ctx, token)).res.status, 200);
    assert.equal(ctx.memory.command(["GET", `grill:hosted:share:${token}`]), JSON.stringify({ verdict: WORKSHOP.verdict, challenge: WORKSHOP.sharpest }));
  });

  it("routes GET /share/:token with no sign-in, and the privacy note says what is public", async () => {
    const config = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    assert.ok(config.rewrites.some((rule) => rule.source === "/share/:token" && rule.destination === "/api/hosted?__route=share&t=:token"));
    const notFound = config.routes.find((route) => route.dest === "/404.md");
    assert.equal(new RegExp(notFound.src).test("/share/abc"), false);
    const privacy = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");
    assert.match(privacy, /Shared verdicts are opt-in, and the public page shows only the verdict and one challenge\./);
    const ledger = readFileSync(join(ROOT, "docs/DATA-LEDGER.md"), "utf8");
    assert.match(ledger, /grill:hosted:share:/);
    assert.match(ledger, /verdict and one challenge/);
    const ux = readFileSync(join(ROOT, "docs/UX.md"), "utf8");
    assert.match(ux, /Share verdict/);
    assert.match(ux, /\/share\//);

    const saved = { hosted: process.env.GRILL_HOSTED, fetch: globalThis.fetch };
    process.env.GRILL_HOSTED = "on";
    globalThis.fetch = async () => {
      throw new Error("public share does not fetch");
    };
    try {
      const { GET, POST } = await import("../api/hosted.js");
      const missing = await GET(new Request("https://grillyour.ai/api/hosted?__route=share&t=short"));
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get("x-robots-tag"), "noindex");
      assert.equal(await missing.text(), "not found");
      const posted = await POST(new Request("https://grillyour.ai/api/hosted?__route=share&t=short", { method: "POST" }));
      assert.equal(posted.status, 405);
      process.env.GRILL_HOSTED = "off";
      const off = await GET(new Request("https://grillyour.ai/api/hosted?__route=share&t=short"));
      assert.equal(off.status, 404);
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.hosted === undefined) delete process.env.GRILL_HOSTED;
      else process.env.GRILL_HOSTED = saved.hosted;
    }
  });
});
