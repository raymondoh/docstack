import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { assertEstablishedEmail, emailIdentityKeyId, IdentityConflictError, normalizeIdentityEmail } from "./identity-email";
import { adapterUser, identityKeyRecord, validIdentityKey } from "./identity-records";
import { parseIdentitySeedOptions } from "./identity-migration-options";

describe("canonical identity email", () => {
  for (const input of ["Buyer@Example.com", "  buyer@example.com  ", "ｂｕｙｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ"]) {
    it("canonicalizes an equivalent representation: " + JSON.stringify(input), () => {
      assert.equal(normalizeIdentityEmail(input), "buyer@example.com");
    });
  }
  for (const input of [null, undefined, 4, {}, "", "a".repeat(321), "buyer＠evil@example.com", "a@@example.com",
    "@example.com", "a@", "a@example.com\n", "\tb@example.com", "a\u007f@example.com", '"a"@example.com',
    "Buyer <a@example.com>", "a@example.com,b@example.com", "a@example.com;b@example.com", "a@example.com,",
    "a＠example.com＠evil.com", "a b@example.com", "a..b@example.com", ".a@example.com", "a@example..com",
    "a@-example.com", "a@localhost", "a（b）@example.com", "a\u200b@example.com"]) {
    it("rejects non-single/invalid mailbox: " + JSON.stringify(input), () => {
      assert.throws(() => normalizeIdentityEmail(input), IdentityConflictError);
    });
  }
  it("does not remove plus tags or Gmail dots", () => {
    assert.equal(normalizeIdentityEmail("A.B+Tag@gmail.com"), "a.b+tag@gmail.com");
    assert.notEqual(emailIdentityKeyId("a.b@gmail.com"), emailIdentityKeyId("ab@gmail.com"));
  });
  it("derives the versioned domain-separated SHA-256 key", () => {
    assert.equal(emailIdentityKeyId(" BUYER@example.com "), "email-v1_" + createHash("sha256")
      .update("docstack:identity-email:v1\0buyer@example.com").digest("hex"));
    assert.equal(emailIdentityKeyId("ＢＵＹＥＲ@example.com"), emailIdentityKeyId("buyer@example.com"));
  });
  it("allows equivalent established email and rejects material drift without PII", () => {
    assert.equal(assertEstablishedEmail(" Buyer@example.com ", "Ｂｕｙｅｒ@example.com"), "buyer@example.com");
    assert.throws(() => assertEstablishedEmail("buyer@example.com", "other@example.com"),
      (error: unknown) => error instanceof IdentityConflictError && error.code === "EMAIL_CHANGE_REQUIRED" &&
        !error.message.includes("@"));
  });
});

describe("adapter record invariants", () => {
  it("keeps the real document ID, canonical email and Date return shape", () => {
    const user = adapterUser("google-sub", { email: " BUYER@example.com ", emailVerified: Timestamp.fromMillis(1234) });
    assert.equal(user.id, "google-sub");
    assert.equal(user.email, "buyer@example.com");
    assert.equal(user.emailVerified?.getTime(), 1234);
    assert.equal(user.name, null);
  });
  it("accepts an equal persisted id and rejects conflicting persisted ids without PII", () => {
    assert.equal(adapterUser("google-sub", { id: "google-sub", email: "b@example.com" }).id, "google-sub");
    for (const id of ["other-user", null, 42, undefined]) {
      assert.throws(() => adapterUser("google-sub", { id, email: "b@example.com" }),
        (error: unknown) => error instanceof IdentityConflictError && error.code === "IDENTITY_CONFLICT" &&
          !String(error).includes("other-user") && !String(error).includes("google-sub") && !String(error).includes("@"));
    }
  });
  it("rejects malformed profile or verification data", () => {
    assert.throws(() => adapterUser("id", { email: "b@example.com", emailVerified: "yesterday" }), IdentityConflictError);
    assert.throws(() => adapterUser("id", { email: "b@example.com", name: {} }), IdentityConflictError);
  });
  it("keys contain only uniqueness metadata, never plaintext email", () => {
    const record = identityKeyRecord("google-sub");
    assert.equal(validIdentityKey(record), true);
    assert.equal(validIdentityKey({ ...record, email: "b@example.com" }), false);
    assert.equal(validIdentityKey({ ...record, userId: "" }), false);
    assert.equal(validIdentityKey({ ...record, createdAt: 123 }), false);
    assert.equal(validIdentityKey({ ...record, normalizationVersion: 2 }), false);
  });
});

describe("seed command safety gates", () => {
  const gates = ["--project-id=demo-docstack-auth", "--confirm=SEED_AUTH_IDENTITY_KEYS"];
  it("requires exact confirmation, explicit project and exactly one mode", () => {
    for (const args of [[], gates, [gates[0], "--dry-run"], [...gates, "--apply", "--dry-run"],
      [gates[0], "--confirm=READ_ONLY_AUTH_INVENTORY", "--apply"], [...gates, "--apply", "--force"]]) {
      assert.throws(() => parseIdentitySeedOptions(args));
    }
    assert.equal(parseIdentitySeedOptions([...gates, "--dry-run"]).dryRun, true);
    assert.equal(parseIdentitySeedOptions([...gates, "--apply"]).dryRun, false);
  });
});
