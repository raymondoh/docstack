import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { verificationTokenDocumentId, verificationTokenRecord, VerificationTokenIntegrityError } from "./verification-tokens";

const token = "a".repeat(64); // Synthetic NextAuth-hash-shaped fixture.
const identifier = "buyer@example.com";
const expires = new Date("2030-01-01");

it("uses a canonical, domain-separated versioned token locator", () => {
  const expected = "verification-v1_" + createHash("sha256")
    .update("docstack:verification-token:v1\0" + identifier + "\0" + token).digest("hex");
  for (const email of [identifier, " BUYER@example.com ", "ＢＵＹＥＲ@example.com"]) {
    assert.equal(verificationTokenDocumentId(email, token), expected);
  }
  assert.notEqual(verificationTokenDocumentId(identifier, token), verificationTokenDocumentId(identifier, "b".repeat(64)));
});

it("rejects malformed identifiers and token inputs without sensitive errors", () => {
  for (const email of [null, "", "a@@example.com", "a@example.com,b@example.com"]) {
    assert.throws(() => verificationTokenDocumentId(email, token), VerificationTokenIntegrityError);
  }
  for (const value of [undefined, null, 123, "", "  ", "x\0y", "x".repeat(1025)]) {
    assert.throws(() => verificationTokenDocumentId(identifier, value), VerificationTokenIntegrityError);
  }
  assert.ok(!new VerificationTokenIntegrityError().message.includes(identifier));
  assert.ok(!new VerificationTokenIntegrityError().message.includes(token));
});

it("validates exact stored shape and converts expiry to an adapter Date", () => {
  for (const expiry of [expires, Timestamp.fromDate(expires)]) {
    assert.deepEqual(verificationTokenRecord({ identifier, token, expires: expiry }), { identifier, token, expires });
  }
  for (const expiry of [undefined, null, "2030-01-01", 123, new Date(NaN), new Date("+010000-01-01")]) {
    assert.throws(() => verificationTokenRecord({ identifier, token, expires: expiry }), VerificationTokenIntegrityError);
  }
  assert.throws(() => verificationTokenRecord({ identifier, token, expires, userId: "unexpected" }), VerificationTokenIntegrityError);
  assert.throws(() => verificationTokenRecord({ identifier: "BUYER@example.com", token, expires }), VerificationTokenIntegrityError);
  assert.throws(() => verificationTokenRecord({ identifier, token }), VerificationTokenIntegrityError);
});
