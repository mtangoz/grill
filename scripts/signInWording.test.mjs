// Sign-in for Grill in chat is an email code or Google, run by Clerk. Clerk links a Google sign-in to
// an account by verified email, and Grill matches the account on that email. Every place a person
// reads sign-in steps says both ways, what Google shares, to use the same email, and to check spam.
// None of them says there is no password.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INVITE_ONLY } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const SAME_EMAIL = /the same email you signed up with, every time/i;
const GOOGLE_SHARES = "If you use Google, Google shares with Grill your name, email address and profile picture. Grill uses the verified email to identify your account. Chat apps you connect may receive your name and picture.";
const NO_PASSWORD_CLAIM = /no password|There's no password|There is no password|does not store a password/i;

describe("sign-in wording", () => {
  it("the Meta AI steps in the README name the sign-up email and spam", () => {
    for (const file of ["README.md"]) {
      const text = read(file);
      const muse = text.slice(text.indexOf("Meta AI (Muse)"));
      const step = muse.match(/(?:<li>|4\. )Tap[^\n]*/)?.[0] ?? "";
      assert.match(step, SAME_EMAIL, `${file}: ${step}`);
      assert.match(step, /check spam/i, `${file}: ${step}`);
    }
  });

  it("the hosted guide offers an email code or Google, says what Google shares, the sign-up email, and spam", () => {
    const hosted = read("docs/HOSTED.md");
    const person = hosted.slice(hosted.indexOf("## What a person does"), hosted.indexOf("## ", hosted.indexOf("## What a person does") + 3));
    assert.match(person, /Sign in with an email code or with Google\./);
    assert.ok(person.includes(GOOGLE_SHARES), person);
    assert.match(person, SAME_EMAIL);
    assert.match(person, /check spam/i);
    assert.doesNotMatch(person, NO_PASSWORD_CLAIM);
    assert.doesNotMatch(hosted, /Google is off in production/);
  });

  it("the privacy notes and the data ledger say an email code or Google, and what Google shares", () => {
    const privacy = read("docs/PRIVACY.md");
    assert.ok(privacy.includes(`Sign-in is Clerk, with an email code or with Google. ${GOOGLE_SHARES} You don't need a password to sign in.`));
    const signIn = privacy.slice(privacy.indexOf("Sign-in is Clerk"), privacy.indexOf("Records live in Upstash"));
    assert.doesNotMatch(signIn, /AgentID|There is no password/);
    assert.doesNotMatch(privacy, /emailed code only|An emailed code only/);
    const ledger = read("docs/DATA-LEDGER.md");
    const row = ledger.split("\n").find((line) => line.startsWith("| Sign-in |"));
    assert.equal(row, `| Sign-in | Clerk. Email, and the sign-in event. An email code or Google. ${GOOGLE_SHARES} | Until you delete the account. Clerk's own retention applies to its logs. | You, by deleting the account (Grill calls Clerk's delete). Clerk, under their policy. | No sign-in. |`);
    assert.doesNotMatch(row, /AgentID/);
  });

  it("the public privacy page offers both ways and does not say there is no password", () => {
    const page = read("site/privacy.html");
    const item = page.split("\n").find((line) => line.includes("<strong>Sign-in.</strong>")) ?? "";
    assert.match(item, /You can sign in with an email code or with Google\./);
    assert.ok(item.includes(GOOGLE_SHARES), item);
    assert.match(item, SAME_EMAIL);
    assert.match(item, /check spam/i);
    assert.match(item, /You don't need a password to sign in\./);
    assert.doesNotMatch(page, /There's no password/);
  });

  it("the Pro notes say an email code or Google, and drop the old Google-off line", () => {
    const pro = read("docs/PRO.md");
    assert.match(pro, /OAuth, with an email code or Google, and a verified email\./);
    assert.ok(pro.includes(GOOGLE_SHARES));
    assert.doesNotMatch(pro, /Google sign-in is off in production|does not store a password/);
  });

  it("the invite-only reply tells an invitee to sign in again with the invited email", () => {
    assert.match(INVITE_ONLY, /^Grill in chat is invite-only for now/);
    assert.match(INVITE_ONLY, /email your invite went to/);
    assert.match(INVITE_ONLY, /support@grillyour\.ai/);
    assert.match(INVITE_ONLY, /\/redeem/);
  });
});
