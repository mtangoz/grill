// The PII corpus pins what redactSensitive masks, kind by kind. Recall: every labelled positive is
// masked as its kind. Precision: no negative changes, and no positive gets a mask of the wrong kind.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MASK_KINDS, redactSensitive } from "./judgeCore.mjs";

const corpus = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/pii-corpus.json"), "utf8"));

describe("PII corpus", () => {
  for (const [kind] of MASK_KINDS) {
    it(`masks every labelled ${kind}, and nothing of another kind`, () => {
      const cases = corpus.positives.filter((c) => c.kind === kind);
      assert.ok(cases.length >= 2, `the corpus needs at least two ${kind} cases`);
      for (const c of cases) {
        const r = redactSensitive(c.text);
        assert.ok(r.masked[kind] >= 1, `missed ${kind}: ${c.text} -> ${r.text}`);
        for (const [other] of MASK_KINDS) {
          if (other !== kind) assert.equal(r.masked[other], 0, `masked ${other} in a ${kind} case: ${c.text} -> ${r.text}`);
        }
      }
    });
  }

  it("leaves every negative exactly as written", () => {
    for (const text of corpus.negatives) {
      const r = redactSensitive(text);
      assert.equal(r.text, text, `false mask: ${text} -> ${r.text}`);
      assert.deepEqual(r.secrets, [], text);
    }
  });

  it("blocks credentials in a link or a password pair instead of masking them", () => {
    for (const text of ["Point it at postgres://admin:hunter22@db.example.com/prod", "the login is password=Tr0ub4dor&3"]) {
      assert.ok(redactSensitive(text).secrets.length > 0, text);
    }
    for (const text of ["The password policy is the problem.", "password: rotate it weekly", "see https://example.com/a:b"]) {
      assert.deepEqual(redactSensitive(text).secrets, [], text);
    }
  });
});
