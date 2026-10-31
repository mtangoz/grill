// Sign-in for Grill in chat is an emailed code, and an invitee must use the email the invite went
// to every time. Every place a person reads sign-in steps says so, says to check spam for the
// code, and does not offer Google (it is off in production).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { INVITE_ONLY } from "./hostedCore.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const SAME_EMAIL = /the email your invite went to, every time/i;

describe("sign-in wording", () => {
  it("the Meta AI steps on the home page and README name the invite email and spam", () => {
    for (const file of ["site/page.html", "README.md"]) {
      const text = read(file);
      const muse = text.slice(text.indexOf("Meta AI (Muse)"));
      const step = muse.match(/(?:<li>|4\. )Tap[^\n]*/)?.[0] ?? "";
      assert.match(step, SAME_EMAIL, `${file}: ${step}`);
      assert.match(step, /check spam/i, `${file}: ${step}`);
    }
  });

  it("the hosted guide says email code only, the invite email, and spam, and never offers Google", () => {
    const hosted = read("docs/HOSTED.md");
    const person = hosted.slice(hosted.indexOf("## What a person does"), hosted.indexOf("## ", hosted.indexOf("## What a person does") + 3));
    assert.match(person, /emailed code/i);
    assert.match(person, SAME_EMAIL);
    assert.match(person, /check spam/i);
    assert.doesNotMatch(person, /Google/);
    assert.doesNotMatch(hosted, /^- Google, and an emailed code\.$/m);
  });

  it("the privacy notes and the data ledger say email code only", () => {
    const privacy = read("docs/PRIVACY.md");
    assert.match(privacy, /Sign-in is Clerk \(an emailed code only\)\. There is no password\./);
    const signIn = privacy.slice(privacy.indexOf("Sign-in is Clerk"), privacy.indexOf("Records live in Upstash"));
    assert.doesNotMatch(signIn, /Google|AgentID/);
    const ledger = read("docs/DATA-LEDGER.md");
    const row = ledger.split("\n").find((line) => line.startsWith("| Sign-in |"));
    assert.equal(row, "| Sign-in | Clerk. Email, and the sign-in event. An emailed code only. | Until you delete the account. Clerk's own retention applies to its logs. | You, by deleting the account (Grill calls Clerk's delete). Clerk, under their policy. | No sign-in. |");
    assert.doesNotMatch(row, /Google|AgentID/);
  });

  it("the invite-only reply tells an invitee to sign in again with the invited email", () => {
    assert.match(INVITE_ONLY, /^Grill in chat is invite-only for now/);
    assert.match(INVITE_ONLY, /email your invite went to/);
    assert.match(INVITE_ONLY, /support@grillyour\.ai/);
    assert.match(INVITE_ONLY, /\/redeem/);
  });
});
