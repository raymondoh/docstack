import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import {
  authenticatedOrderBelongsToUser,
  exposePersistentUserId,
  persistUserIdInJwt
} from "./session-identity";

describe("persistent session and order ownership", () => {
  it("keeps the adapter User ID in JWT and session identity", () => {
    const token = persistUserIdInJwt({} as JWT, { id: "google-sub-123" } as User);
    const session = exposePersistentUserId(
      { user: { id: "", name: null, email: null, image: null }, expires: "2099-01-01" } as Session,
      token
    );

    assert.equal(token.uid, "google-sub-123");
    assert.equal(session.user.id, "google-sub-123");
  });

  it("preserves dashboard and success ownership equality with existing order userId", () => {
    const existingOrderUserId = "google-sub-123";
    const persistentSessionUserId = "google-sub-123";

    assert.equal(authenticatedOrderBelongsToUser(existingOrderUserId, persistentSessionUserId), true);
    assert.equal(existingOrderUserId, persistentSessionUserId);
  });

  it("keeps guest orders unowned", () => {
    assert.equal(authenticatedOrderBelongsToUser(null, "google-sub-123"), false);
  });

  it("keeps a historical JWT uid stable without a new sign-in user", () => {
    const token = persistUserIdInJwt({ uid: "google-sub-123" } as JWT);
    const session = exposePersistentUserId(
      { user: { id: "", name: null, email: null, image: null }, expires: "2099-01-01" } as Session,
      token
    );

    assert.equal(token.uid, "google-sub-123");
    assert.equal(session.user.id, "google-sub-123");
  });
});
