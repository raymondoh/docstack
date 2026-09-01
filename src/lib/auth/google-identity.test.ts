import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  googleAccountRecord,
  googleAccountDocumentId,
  parseAuthoritativeGoogleIdentity,
  planGoogleIdentityBootstrap,
  type GoogleIdentityInput
} from "./google-identity";

const subject = "google-sub-123";
const identity: GoogleIdentityInput = {
  provider: "google",
  providerAccountId: subject,
  subject,
  email: "buyer@example.com",
  emailVerified: true,
  name: "Buyer"
};

describe("Google persistent identity bootstrap", () => {
  it("uses the existing Google sub as the persistent User ID", () => {
    const parsed = parseAuthoritativeGoogleIdentity(
      { provider: "google", providerAccountId: subject, type: "oauth" },
      { sub: subject, email: "Buyer@Example.com", email_verified: true, name: "Buyer" }
    );

    assert.equal(parsed.subject, subject);
    assert.equal(parsed.providerAccountId, subject);
    assert.equal(parsed.email, "buyer@example.com");
  });

  it("creates one deterministic account mapping for a new identity", () => {
    const plan = planGoogleIdentityBootstrap(identity, {
      userExists: false,
      accountOwnerIds: [],
      emailOwnerIds: []
    });

    assert.deepEqual(plan, { userId: subject, createUser: true, createAccount: true });
    assert.equal(googleAccountDocumentId(subject).length, 64);
    assert.deepEqual(googleAccountRecord(identity), {
      provider: "google",
      providerAccountId: subject,
      userId: subject,
      type: "oauth"
    });
  });

  it("is idempotent when the persistent user and mapping already exist", () => {
    const plan = planGoogleIdentityBootstrap(identity, {
      userExists: true,
      accountOwnerIds: [subject],
      canonicalAccountOwnerId: subject,
      emailOwnerIds: [subject]
    });

    assert.deepEqual(plan, { userId: subject, createUser: false, createAccount: false });
  });

  it("rejects conflicting provider-account ownership", () => {
    assert.throws(() =>
      planGoogleIdentityBootstrap(identity, {
        userExists: false,
        accountOwnerIds: ["different-user"],
        emailOwnerIds: []
      })
    , /already owned/);
  });

  it("requires a verified authoritative Google profile and never accepts order email data", () => {
    assert.throws(() =>
      parseAuthoritativeGoogleIdentity(
        { provider: "google", providerAccountId: subject, type: "oauth" },
        { sub: subject, email: "buyer@example.com", email_verified: false, accountEmail: "buyer@example.com" }
      )
    , /authoritative verified email/);
  });
});
