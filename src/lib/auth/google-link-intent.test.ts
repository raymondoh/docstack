import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { encode } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import {
  GOOGLE_LINK_INTENT_LIFETIME_SECONDS,
  GoogleLinkIntentError,
  createGoogleLinkIntentToken,
  decodeGoogleLinkSession,
  googleLinkIntentCookie,
  googleLinkIntentDocumentId,
  googleLinkIntentRecord,
  googleLinkSessionFromRequest,
  googleLinkSessionBinding,
  googleLinkStateBinding,
  nextAuthSessionCookieName,
  validateGoogleLinkIntentRecord
} from "./google-link-intent";

const secret = "synthetic-nextauth-secret-for-google-link-tests";
const userId = "opaque-user-id";

describe("Google link-intent primitives", () => {
  it("generates independent 32-byte tokens and deterministic domain-separated document IDs", () => {
    const first = createGoogleLinkIntentToken();
    const second = createGoogleLinkIntentToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
    assert.notEqual(first, second);
    assert.equal(googleLinkIntentDocumentId(first), googleLinkIntentDocumentId(first));
    assert.match(googleLinkIntentDocumentId(first), /^google-link-v1_[a-f0-9]{64}$/u);
    assert.notEqual(googleLinkIntentDocumentId(first), googleLinkStateBinding(first, secret));
  });

  it("validates exact ten-minute records and rejects malformed, expired or mismatched records", () => {
    const now = Timestamp.fromMillis(1_000_000);
    const rawSession = "encrypted-session-value";
    const record = googleLinkIntentRecord(userId, googleLinkSessionBinding(rawSession, secret), now);
    assert.equal(record.expiresAt.toMillis() - now.toMillis(), GOOGLE_LINK_INTENT_LIFETIME_SECONDS * 1000);
    assert.deepEqual(validateGoogleLinkIntentRecord(record, Timestamp.fromMillis(now.toMillis() + 1)), record);
    for (const malformed of [
      { ...record, purpose: "other" },
      { ...record, intentVersion: 2 },
      { ...record, sessionBinding: "bad" },
      { ...record, stateBinding: "bad" },
      { ...record, expiresAt: Timestamp.fromMillis(record.expiresAt.toMillis() + 1) },
      { ...record, rawToken: createGoogleLinkIntentToken() }
    ]) assert.throws(() => validateGoogleLinkIntentRecord(malformed, now), GoogleLinkIntentError);
    assert.throws(() => validateGoogleLinkIntentRecord(record, record.expiresAt), GoogleLinkIntentError);
  });

  it("persists only non-reversible bindings and supplies a narrow HttpOnly cookie", () => {
    const rawToken = createGoogleLinkIntentToken();
    const rawSession = "raw-session-jwt";
    const rawState = "raw-oauth-state";
    const record = {
      ...googleLinkIntentRecord(userId, googleLinkSessionBinding(rawSession, secret), Timestamp.fromMillis(1000)),
      stateBinding: googleLinkStateBinding(rawState, secret)
    };
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(rawToken) && !serialized.includes(rawSession) && !serialized.includes(rawState));
    const cookie = googleLinkIntentCookie(rawToken, true);
    assert.equal(cookie.name, "__Secure-docstack.google-link-intent");
    assert.deepEqual(cookie.options, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/api/auth",
      maxAge: GOOGLE_LINK_INTENT_LIFETIME_SECONDS
    });
  });

  it("uses installed NextAuth JWT encryption and rejects invalid session identity", async () => {
    const valid = await encode({ secret, token: { sub: userId, uid: userId }, maxAge: 60 });
    assert.deepEqual(await decodeGoogleLinkSession(valid, secret), {
      userId, sessionBinding: googleLinkSessionBinding(valid, secret)
    });
    const different = await encode({ secret, token: { sub: userId, uid: userId }, maxAge: 60 });
    assert.notEqual((await decodeGoogleLinkSession(valid, secret)).sessionBinding,
      (await decodeGoogleLinkSession(different, secret)).sessionBinding);
    const tamperAt = Math.floor(valid.length / 2);
    const tampered = valid.slice(0, tamperAt) + (valid[tamperAt] === "a" ? "b" : "a") + valid.slice(tamperAt + 1);
    for (const token of [
      null,
      tampered,
      await encode({ secret, token: { sub: userId }, maxAge: 60 }),
      await encode({ secret, token: { uid: userId }, maxAge: 60 }),
      await encode({ secret, token: { sub: userId, uid: "different" }, maxAge: 60 }),
      await encode({ secret, token: { sub: userId, uid: userId }, maxAge: -60 })
    ]) await assert.rejects(decodeGoogleLinkSession(token, secret), GoogleLinkIntentError);
  });

  it("binds session and OAuth state independently", () => {
    assert.notEqual(googleLinkSessionBinding("same", secret), googleLinkStateBinding("same", secret));
    assert.notEqual(googleLinkStateBinding("journey-a", secret), googleLinkStateBinding("journey-b", secret));
  });

  it("requires the canonical browser session cookie", async () => {
    const valid = await encode({ secret, token: { sub: userId, uid: userId }, maxAge: 60 });
    const name = nextAuthSessionCookieName(false);
    const makeRequest = (cookie: string | null, authorization?: string) => new Request("https://app.example.com", {
      headers: Object.assign(cookie === null ? {} : { cookie }, authorization ? { authorization } : {})
    }) as NextRequest;
    await assert.rejects(googleLinkSessionFromRequest(
      makeRequest(null, "Bearer " + encodeURIComponent(valid)), secret, false), GoogleLinkIntentError);
    assert.equal((await googleLinkSessionFromRequest(
      makeRequest(name + "=" + valid, "Bearer not-the-session"), secret, false)).sessionBinding,
    googleLinkSessionBinding(valid, secret));

    const first = valid.slice(0, Math.floor(valid.length / 3));
    const second = valid.slice(first.length, Math.floor(valid.length * 2 / 3));
    const third = valid.slice(first.length + second.length);
    const reordered = name + ".2=" + third + "; " + name + ".0=" + first + "; " + name + ".1=" + second;
    assert.equal((await googleLinkSessionFromRequest(makeRequest(reordered), secret, false)).sessionBinding,
      googleLinkSessionBinding(valid, secret));
    for (const malformed of [
      name + ".0=" + first + "; " + name + ".2=" + third,
      name + ".00=" + first + "; " + name + ".1=" + second,
      name + ".x=" + first,
      name + "=" + valid + "; " + name + ".0=" + first,
      name + ".0=" + first + "; " + name + ".0=" + second,
      name + ".0="
    ]) await assert.rejects(googleLinkSessionFromRequest(makeRequest(malformed), secret, false),
      GoogleLinkIntentError);
    await assert.rejects(googleLinkSessionFromRequest(
      makeRequest(nextAuthSessionCookieName(true) + "=" + valid), secret, false), GoogleLinkIntentError);
    assert.equal((await googleLinkSessionFromRequest(
      makeRequest(nextAuthSessionCookieName(true) + "=" + valid), secret, true)).userId, userId);
  });
});
