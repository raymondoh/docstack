import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_SESSION_STRATEGY } from "./session-identity";

describe("NextAuth persistence configuration", () => {
  it("keeps JWT sessions and therefore does not create database sessions", () => {
    assert.equal(AUTH_SESSION_STRATEGY, "jwt");
  });
});
