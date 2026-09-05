import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { createVerificationTokenStore, verificationTokenDocumentId, verificationTokenRecord, VerificationTokenIntegrityError } from "./verification-tokens";

const token = "a".repeat(64); // Synthetic NextAuth-hash-shaped fixture.
const identifier = "buyer@example.com";
const expires = new Date("2030-01-01");

async function captureInfo(run: () => unknown | Promise<unknown>) {
  const original = console.info;
  const calls: unknown[][] = [];
  console.info = (...args: unknown[]) => { calls.push(args); };
  let error: unknown;
  try { await run(); } catch (caught) { error = caught; } finally { console.info = original; }
  return { calls, error };
}

it("logs only constant token-creation stages and preserves success/failure semantics", async () => {
  function store(existing: boolean) {
    const ref = {};
    const db = {
      collection: () => ({ doc: () => ref }),
      runTransaction: async (run: (tx: { get: () => Promise<{ exists: boolean }>; create: () => void }) => Promise<unknown>) =>
        run({ get: async () => ({ exists: existing }), create: () => {} })
    };
    return createVerificationTokenStore(db as never);
  }
  const input = { identifier, token, expires };
  const successful = (await captureInfo(async () => assert.deepEqual(await store(false).createVerificationToken(input), input))).calls;
  assert.deepEqual(successful.flat(), ["AUTH_EMAIL_TOKEN_CREATE_STARTED", "AUTH_EMAIL_TOKEN_RECORD_VALID", "AUTH_EMAIL_TOKEN_TRANSACTION_STARTED", "AUTH_EMAIL_TOKEN_CREATE_SUCCEEDED"]);
  const failed = (await captureInfo(async () => assert.rejects(store(true).createVerificationToken(input), VerificationTokenIntegrityError))).calls;
  assert.deepEqual(failed.flat(), ["AUTH_EMAIL_TOKEN_CREATE_STARTED", "AUTH_EMAIL_TOKEN_RECORD_VALID", "AUTH_EMAIL_TOKEN_TRANSACTION_STARTED", "AUTH_EMAIL_TOKEN_CREATE_FAILED"]);
  const invalid = (await captureInfo(async () => assert.rejects(store(false).createVerificationToken({ ...input, identifier: "private@@example.com" }), VerificationTokenIntegrityError))).calls;
  assert.deepEqual(invalid.flat(), ["AUTH_EMAIL_TOKEN_CREATE_STARTED", "AUTH_EMAIL_TOKEN_CREATE_FAILED"]);
  for (const call of [...successful, ...failed, ...invalid]) assert.equal(call.length, 1);
  assert.ok(![...successful, ...failed, ...invalid].flat().join(" ").includes(identifier));
  assert.ok(![...successful, ...failed, ...invalid].flat().join(" ").includes(token));
});

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
