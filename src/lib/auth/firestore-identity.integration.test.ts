import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { AUTH_COLLECTIONS, AUTH_IDENTITY_KEYS } from "./collections";
import { emailIdentityKeyId, IdentityConflictError } from "./identity-email";
import { identityKeyRecord } from "./identity-records";
import { inspectIdentityKeys } from "./identity-inventory";
import { createFirestoreIdentityStore } from "./firestore-identity-store";
import { googleAccountDocumentId } from "./google-identity";
import { exposePersistentUserId, persistUserIdInJwt } from "./session-identity";
import { verificationTokenDocumentId, VerificationTokenIntegrityError } from "./verification-tokens";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { AUTH_RATE_LIMITS, createEmailRateLimiter, rateLimitIds } from "./email-rate-limit";
import { emailProviders } from "./email-provider";
import { emailRequestOptions, isUnsupportedEmailInitiation } from "./email-request";
import type { NextAuthOptions } from "next-auth";
import type { NextRequest } from "next/server";
import { CHECK_EMAIL_PATH, AUTH_ERROR_PATH } from "./login-policy";
import {
  GOOGLE_LINK_INTENTS,
  GoogleLinkIntentError,
  createGoogleLinkIntentToken,
  googleLinkIntentCookieName,
  googleLinkIntentDocumentId,
  googleLinkStateBinding
} from "./google-link-intent";
import { runGoogleLinkRequest } from "./google-link-request";

// Actual installed v4 core handler, not a mocked NextAuth flow.
const { AuthHandler } = createRequire(import.meta.url)("../../../node_modules/next-auth/core/index.js");

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const skipReason = emulatorHost
  ? false
  : "Firestore Emulator unavailable. Run npm run test:auth:emulator, or set FIRESTORE_EMULATOR_HOST for an existing emulator.";
const subject = "google-sub-integration";
const account = { provider: "google", providerAccountId: subject, type: "oauth" as const };
const profile = {
  sub: subject,
  email: "Buyer@Example.com",
  email_verified: true,
  name: "Integration Buyer",
  picture: "https://example.invalid/avatar.png"
};

async function clearCollection(firestore: Firestore, collection: string) {
  while (true) {
    const snapshot = await firestore.collection(collection).limit(100).get();
    if (snapshot.empty) return;
    const batch = firestore.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

describe("Firestore-backed persistent Google identity", { skip: skipReason }, () => {
  let app: App;
  let firestore: Firestore;
  let identityStore: ReturnType<typeof createFirestoreIdentityStore>;

  before(() => {
    const projectId = process.env.GCLOUD_PROJECT || "demo-docstack-auth";
    if (!/^127\.0\.0\.1:\d+$|^localhost:\d+$/u.test(emulatorHost!) || !projectId.startsWith("demo-")) {
      throw new Error("Tests require a loopback emulator and demo project, never production.");
    }
    app = initializeApp({ projectId }, "docstack-auth-integration-" + process.pid);
    firestore = getFirestore(app);
    identityStore = createFirestoreIdentityStore(firestore);
  });

  beforeEach(async () => {
    await Promise.all([
      clearCollection(firestore, AUTH_COLLECTIONS.accounts),
      clearCollection(firestore, AUTH_COLLECTIONS.users),
      clearCollection(firestore, AUTH_COLLECTIONS.sessions),
      clearCollection(firestore, AUTH_COLLECTIONS.verificationTokens),
      clearCollection(firestore, AUTH_RATE_LIMITS),
      clearCollection(firestore, GOOGLE_LINK_INTENTS),
      clearCollection(firestore, "orders"),
      clearCollection(firestore, AUTH_IDENTITY_KEYS)
    ]);
  });

  after(async () => {
    if (app) await deleteApp(app);
  });

  const tokenInput = { identifier: "buyer@example.com", token: "a".repeat(64), expires: new Date("2030-01-01") };

  const rateSecret = "synthetic-rate-limit-secret-for-emulator";
  const startTime = Date.parse("2030-01-01");

  it("rolling email minute/hour limits canonicalize inputs and expire independently of TTL", async () => {
    let now = startTime;
    const allow = createEmailRateLimiter(firestore, rateSecret, () => now);
    assert.equal(await allow("Buyer@example.com", "192.0.2.1"), true);
    assert.equal(await allow(" ＢＵＹＥＲ@example.com ", "192.0.2.2"), false);
    for (let i = 1; i < 5; i++) { now += 60_000; assert.equal(await allow("buyer@example.com", "192.0.2.1"), true); }
    now += 60_000;
    assert.equal(await allow("buyer@example.com", "192.0.2.1"), false);
    assert.equal(await allow("different@example.com", "192.0.2.1"), true);
    now = startTime + 3_600_000;
    assert.equal(await allow("buyer@example.com", "192.0.2.1"), true);
    const docs = await firestore.collection(AUTH_RATE_LIMITS).get();
    for (const doc of docs.docs) {
      assert.deepEqual(Object.keys(doc.data()).sort(), ["cleanupAt", "requests", "updatedAt"]);
      assert.ok(!doc.id.includes("@") && !doc.id.includes("192.0.2"));
    }
  });

  it("per-IP twentieth request succeeds and twenty-first is blocked", async () => {
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    for (let i = 0; i < 20; i++) assert.equal(await allow(`person${i}@example.com`, "192.0.2.1"), true);
    assert.equal(await allow("another@example.com", "192.0.2.1"), false);
    assert.equal(await allow("another@example.com", "192.0.2.2"), true);
  });

  it("global hundredth request succeeds and hundred-and-first is blocked", async () => {
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    for (let i = 0; i < 100; i++) assert.equal(await allow(`person${i}@example.com`, `192.0.2.${i + 1}`), true);
    assert.equal(await allow("another@example.com", "192.0.2.200"), false);
  });

  it("two concurrent requests at IP count 19 admit exactly one and commit 20", async () => {
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    for (let i = 0; i < 19; i++) assert.equal(await allow(`person${i}@example.com`, "192.0.2.1"), true);
    const results = await Promise.all([allow("boundary-a@example.com", "192.0.2.1"), allow("boundary-b@example.com", "192.0.2.1")]);
    assert.deepEqual(results.slice().sort(), [false, true]);
    const ids = rateLimitIds("boundary-a@example.com", "192.0.2.1", rateSecret);
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).doc(ids[1]).get()).data()?.requests.length, 20);
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).doc(ids[2]).get()).data()?.requests.length, 20);
  });

  it("two concurrent requests at global count 99 admit exactly one and commit 100", async () => {
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    for (let i = 0; i < 99; i++) assert.equal(await allow(`person${i}@example.com`, `192.0.2.${i + 1}`), true);
    const results = await Promise.all([allow("boundary-a@example.com", "192.0.2.200"), allow("boundary-b@example.com", "192.0.2.201")]);
    assert.deepEqual(results.slice().sort(), [false, true]);
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).doc("global-v1").get()).data()?.requests.length, 100);
    for (const [i, email] of ["boundary-a@example.com", "boundary-b@example.com"].entries()) {
      const ids = rateLimitIds(email, `192.0.2.${200 + i}`, rateSecret);
      assert.equal((await firestore.collection(AUTH_RATE_LIMITS).doc(ids[0]).get()).exists, results[i]);
      assert.equal((await firestore.collection(AUTH_RATE_LIMITS).doc(ids[1]).get()).exists, results[i]);
    }
  });

  it("concurrent requests cannot exceed limits or double-count transaction retries", async () => {
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    const results = await Promise.all(Array.from({ length: 6 }, () => allow("buyer@example.com", "192.0.2.1")));
    assert.equal(results.filter(Boolean).length, 1);
    for (const id of rateLimitIds("buyer@example.com", "192.0.2.1", rateSecret)) {
      assert.deepEqual((await firestore.collection(AUTH_RATE_LIMITS).doc(id).get()).data()?.requests, [startTime]);
    }
  });

  it("malformed emails create no counters and corrupt operational state fails closed", async () => {
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    await assert.rejects(allow("a@@example.com", "192.0.2.1"));
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).get()).size, 0);
    await firestore.collection(AUTH_RATE_LIMITS).doc("global-v1").set({ requests: "corrupt" });
    await assert.rejects(allow("buyer@example.com", "192.0.2.1"));
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).get()).size, 1);
  });

  for (const existingGoogle of [true, false]) it(`direct email POST and verified callback preserve identity: ${existingGoogle ? "existing Google" : "new email"}`, async () => {
    const secret = "synthetic-nextauth-test-secret";
    const csrf = "synthetic-csrf";
    const cookie = csrf + "|" + createHash("sha256").update(csrf + secret).digest("hex");
    let sends = 0;
    let sentUrl = "";
    const providerSettings = { enabled: true, from: "signin@example.com", apiKey: "re_synthetic", authUrl: "https://example.com" };
    const base: NextAuthOptions = {
      secret, useSecureCookies: false, session: { strategy: "jwt" },
      pages: { verifyRequest: CHECK_EMAIL_PATH, error: AUTH_ERROR_PATH },
      providers: emailProviders(providerSettings, async mail => {
        sends++;
        sentUrl = mail.react.props.url;
        return { data: { id: "synthetic" } };
      }),
      adapter: { ...identityStore.authAdapter,
        getUserByEmail: async () => { throw new Error("Initiation must not query identities"); },
        createUser: async () => { throw new Error("Initiation must not create identities"); }
      },
      logger: { error() {}, warn() {}, debug() {} },
      callbacks: { signIn: async ({ email }) => !email?.verificationRequest }
    };
    const allow = createEmailRateLimiter(firestore, rateSecret, () => startTime);
    async function post(options: NextAuthOptions, limiter = allow, validCsrf = true, segments = ["signin", "email"]) {
      const request = new Request("https://example.com/api/auth/signin/email", {
        method: "POST", headers: { "content-type": "application/json", cookie: `next-auth.csrf-token=${encodeURIComponent(cookie)}`, "x-vercel-forwarded-for": "192.0.2.1" },
        body: JSON.stringify({ email: " ＢＵＹＥＲ@example.com ", csrfToken: validCsrf ? csrf : "wrong", callbackUrl: "https://evil.example/" })
      });
      // Same early route guard as the exported App Router handler.
      if (isUnsupportedEmailInitiation(segments)) return { status: 404, redirect: undefined };
      const scoped = emailRequestOptions(options, request, segments, {
        authUrl: providerSettings.authUrl, runtime: { vercel: "1" }, allow: limiter
      });
      // Feed the real direct HTTP request through the same request-local options
      // used by route.ts and the installed core handler; pin trusted origin for test.
      const previousAuthUrl = process.env.NEXTAUTH_URL;
      process.env.NEXTAUTH_URL = providerSettings.authUrl; // v4 detects origin from server env.
      try {
        return await AuthHandler({ req: {
          method: request.method, action: "signin", providerId: "email",
          headers: Object.fromEntries(request.headers), body: await request.json(), query: {},
          cookies: { "next-auth.csrf-token": cookie }
        }, options: scoped });
      } finally {
        if (previousAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
        else process.env.NEXTAUTH_URL = previousAuthUrl;
      }
    }
    for (const enabled of [true, false]) {
      for (const segments of [["signin", "email", "extra"], ["signin", "email", "foo", "bar"]]) {
        const result = await post({ ...base, providers: emailProviders({ ...providerSettings, enabled }) }, allow, true, segments);
        assert.equal(result.status, 404);
      }
    }
    assert.equal(sends, 0);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 0);
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).get()).size, 0);
    await post(base, allow, false);
    assert.equal(sends, 0);
    assert.equal((await firestore.collection(AUTH_RATE_LIMITS).get()).size, 0);
    const first = await post(base);
    assert.equal(sends, 1);
    assert.equal(first.redirect, "https://example.com/api/auth/verify-request?provider=email&type=email");
    assert.equal(new URL(sentUrl).searchParams.get("callbackUrl"), providerSettings.authUrl);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 1);
    const blocked = await post(base);
    assert.equal(blocked.redirect, first.redirect);
    assert.equal(sends, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).size, 0);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    // Inject rejection at the existing admission boundary (not a real network outage).
    const failedStore = await post(base, async () => { throw new Error("Synthetic storage unavailable"); });
    assert.equal(failedStore.redirect, first.redirect);
    assert.equal(sends, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 1);
    // A real failing Firestore-backed transaction, without mocking the limiter.
    await firestore.collection(AUTH_RATE_LIMITS).doc("global-v1").set({ requests: "unavailable-state" });
    const unavailable = await post(base);
    assert.equal(unavailable.redirect, first.redirect);
    const googleOptions = emailRequestOptions(base, new Request("https://example.com/api/auth/signin/google", { method: "POST" }), ["signin", "google"], {
      authUrl: providerSettings.authUrl, runtime: { vercel: "1" }, allow
    });
    assert.equal(await googleOptions.callbacks!.signIn!({ user: { id: subject }, account }), true);
    assert.equal(sends, 1);
    await post({ ...base, providers: emailProviders({ ...providerSettings, enabled: false }) });
    assert.equal(sends, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 1);

    // Real verified callback must restore the guarded adapter, keep a historical
    // Google-sub owner, advance emailVerified and expose that same UID to JWT.
    const guestOrder = { checkoutMode: "guest", userId: null, deliveryEmail: "buyer@example.com", status: "paid" };
    await firestore.collection("orders").doc("guest-fixture").set(guestOrder);
    if (existingGoogle) {
      await identityStore.ensurePersistentGoogleIdentity(account, profile);
      await firestore.collection("orders").doc("historical-fixture").set({ userId: subject, status: "paid" });
    }
    let verifiedUid: unknown;
    const callbackBase: NextAuthOptions = { ...base, adapter: identityStore.authAdapter, callbacks: {
      ...base.callbacks,
      jwt: async ({ token, user }) => { persistUserIdInJwt(token, user); verifiedUid = token.uid; return token; }
    } };
    const callbackRequest = new Request(sentUrl);
    const callbackOptions = emailRequestOptions(callbackBase, callbackRequest, ["callback", "email"], {
      authUrl: providerSettings.authUrl, runtime: { vercel: "1" }, allow: async () => { throw new Error("No initiation limiter on verified callbacks"); }
    });
    assert.equal(callbackOptions.adapter, identityStore.authAdapter);
    const previousAuthUrl = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = providerSettings.authUrl;
    try {
      const response = await AuthHandler({ req: { method: "GET", action: "callback", providerId: "email", headers: {}, cookies: {}, body: {}, query: Object.fromEntries(new URL(sentUrl).searchParams) }, options: callbackOptions });
      assert.equal(response.redirect, providerSettings.authUrl);
      assert.equal(typeof verifiedUid, "string");
      if (existingGoogle) {
        assert.equal(verifiedUid, subject);
        assert.equal((await firestore.collection("orders").doc("historical-fixture").get()).data()?.userId, verifiedUid);
      } else {
        assert.match(verifiedUid as string, /^[0-9a-f-]{36}$/u);
        assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
      }
      const verifiedUser = await identityStore.authAdapter.getUser(verifiedUid as string);
      assert.ok(verifiedUser?.emailVerified instanceof Date);
      assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).doc(emailIdentityKeyId("buyer@example.com")).get()).data()?.userId, verifiedUid);
      const session = { user: {}, expires: "2030-01-01" } as Session;
      exposePersistentUserId(session, { uid: verifiedUid } as JWT);
      assert.equal(session.user.id, verifiedUid);
      assert.deepEqual((await firestore.collection("orders").doc("guest-fixture").get()).data(), guestOrder);
      assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).size, 1);
      assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 0);
      const checkEmail = await AuthHandler({ req: { method: "GET", action: "verify-request", headers: {}, cookies: {}, query: { provider: "email", type: "email" } }, options: callbackOptions });
      assert.equal(checkEmail.redirect, CHECK_EMAIL_PATH);
    } finally {
      if (previousAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = previousAuthUrl;
    }
  });

  it("creates and atomically consumes one token, returning Date shape; sequential replay is null", async () => {
    const created = await identityStore.authAdapter.createVerificationToken(tokenInput);
    assert.deepEqual(created, tokenInput);
    const ref = firestore.collection(AUTH_COLLECTIONS.verificationTokens)
      .doc(verificationTokenDocumentId(tokenInput.identifier, tokenInput.token));
    const stored = (await ref.get()).data()!;
    assert.deepEqual(Object.keys(stored).sort(), ["expires", "identifier", "token"]);
    assert.equal(stored.token, tokenInput.token);
    assert.equal(stored.expires.toDate().getTime(), tokenInput.expires.getTime());
    assert.deepEqual(await identityStore.authAdapter.useVerificationToken(tokenInput), tokenInput);
    assert.equal((await ref.get()).exists, false);
    assert.equal(await identityStore.authAdapter.useVerificationToken(tokenInput), null);
  });

  it("two genuine concurrent consumers return exactly one token and one null", async () => {
    await identityStore.authAdapter.createVerificationToken(tokenInput);
    const results = await Promise.all([
      identityStore.authAdapter.useVerificationToken(tokenInput),
      identityStore.authAdapter.useVerificationToken(tokenInput)
    ]);
    assert.equal(results.filter(value => value !== null).length, 1);
    assert.equal(results.filter(value => value === null).length, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 0);
  });

  it("canonical forms share a locator; different tokens remain independently consumable", async () => {
    await identityStore.authAdapter.createVerificationToken({ ...tokenInput, identifier: " ＢＵＹＥＲ@example.com " });
    const second = { ...tokenInput, token: "b".repeat(64) };
    await identityStore.authAdapter.createVerificationToken(second);
    assert.deepEqual(await identityStore.authAdapter.useVerificationToken({ ...tokenInput, identifier: "BUYER@example.com" }), tokenInput);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.verificationTokens).get()).size, 1);
    assert.deepEqual(await identityStore.authAdapter.useVerificationToken(second), second);
  });

  it("wrong token/identifier do not consume a valid link, and malformed input fails", async () => {
    await identityStore.authAdapter.createVerificationToken(tokenInput);
    assert.equal(await identityStore.authAdapter.useVerificationToken({ ...tokenInput, token: "c".repeat(64) }), null);
    assert.equal(await identityStore.authAdapter.useVerificationToken({ ...tokenInput, identifier: "other@example.com" }), null);
    await assert.rejects(identityStore.authAdapter.useVerificationToken({ ...tokenInput, identifier: "a@@example.com" }), VerificationTokenIntegrityError);
    await assert.rejects(identityStore.authAdapter.createVerificationToken({ ...tokenInput, identifier: "a@@example.com" }), VerificationTokenIntegrityError);
    assert.deepEqual(await identityStore.authAdapter.useVerificationToken(tokenInput), tokenInput);
  });

  it("expired tokens are consumed once and returned expired for NextAuth v4 to reject", async () => {
    const expired = { ...tokenInput, expires: new Date(0) };
    await identityStore.authAdapter.createVerificationToken(expired);
    const consumed = await identityStore.authAdapter.useVerificationToken(expired);
    assert.deepEqual(consumed, expired);
    assert.ok(consumed!.expires.valueOf() < Date.now()); // Installed callback.js invalidInvite check.
    assert.equal(await identityStore.authAdapter.useVerificationToken(expired), null);
  });

  it("duplicate creation cannot overwrite or extend a token, including concurrent creation", async () => {
    const results = await Promise.allSettled([
      identityStore.authAdapter.createVerificationToken(tokenInput),
      identityStore.authAdapter.createVerificationToken(tokenInput)
    ]);
    assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
    assert.equal(results.filter(value => value.status === "rejected").length, 1);
    await assert.rejects(identityStore.authAdapter.createVerificationToken({ ...tokenInput, expires: new Date("2031-01-01") }), VerificationTokenIntegrityError);
    assert.deepEqual(await identityStore.authAdapter.useVerificationToken(tokenInput), tokenInput);
  });

  it("corrupt deterministic records fail closed and remain unchanged for investigation", async () => {
    const ref = firestore.collection(AUTH_COLLECTIONS.verificationTokens)
      .doc(verificationTokenDocumentId(tokenInput.identifier, tokenInput.token));
    for (const corrupt of [
      { ...tokenInput, identifier: "other@example.com" },
      { ...tokenInput, identifier: "BUYER@example.com" },
      { ...tokenInput, token: "b".repeat(64) },
      { ...tokenInput, expires: "invalid" },
      { ...tokenInput, userId: "unexpected" },
      { identifier: tokenInput.identifier, token: tokenInput.token }
    ]) {
      await ref.set(corrupt);
      const before = (await ref.get()).data();
      await assert.rejects(identityStore.authAdapter.useVerificationToken(tokenInput), VerificationTokenIntegrityError);
      assert.deepEqual((await ref.get()).data(), before);
    }
  });

  it("bootstraps the Google sub and resolves it through the adapter into JWT/session identity", async () => {
    await identityStore.ensurePersistentGoogleIdentity(account, profile);

    const userDocument = await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get();
    assert.equal(userDocument.exists, true);
    assert.equal(userDocument.data()?.email, "buyer@example.com");

    const accountDocument = await firestore
      .collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(subject))
      .get();
    assert.deepEqual(accountDocument.data(), {
      provider: "google",
      providerAccountId: subject,
      type: "oauth",
      userId: subject
    });

    assert.ok(identityStore.authAdapter.getUserByAccount);
    const adapterUser = await identityStore.authAdapter.getUserByAccount({
      provider: "google",
      providerAccountId: subject
    });
    assert.equal(adapterUser?.id, subject);

    const token = persistUserIdInJwt({} as JWT, adapterUser as User);
    const session = exposePersistentUserId(
      { user: { id: "", name: null, email: null, image: null }, expires: "2099-01-01" } as Session,
      token
    );
    assert.equal(token.uid, subject);
    assert.equal(session.user.id, subject);
  });

  it("rejects conflicting persisted IDs on every User path without repair or JWT/session propagation", async () => {
    const sub = "google-sub-a";
    const userRef = firestore.collection(AUTH_COLLECTIONS.users).doc(sub);
    const accountRef = firestore.collection(AUTH_COLLECTIONS.accounts).doc(googleAccountDocumentId(sub));
    const orderRef = firestore.collection("orders").doc("identity-regression-sentinel");
    await userRef.set({ ...emailInput, id: "other-user" });
    await accountRef.set({ ...account, providerAccountId: sub, userId: sub });
    await orderRef.set({ userId: sub, status: "paid" });
    const beforeUser = (await userRef.get()).data();
    const beforeAccount = (await accountRef.get()).data();
    const beforeOrder = (await orderRef.get()).data();
    try {
      let reachedJwt = false;
      await assert.rejects(async () => {
        const user = await identityStore.authAdapter.getUserByAccount({ provider: "google", providerAccountId: sub });
        reachedJwt = true;
        const token = persistUserIdInJwt({} as JWT, user as User);
        exposePersistentUserId({ user: { id: "" }, expires: "2099-01-01" } as Session, token);
      }, IdentityConflictError);
      assert.equal(reachedJwt, false);
      await assert.rejects(identityStore.authAdapter.getUser(sub), IdentityConflictError);
      await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), IdentityConflictError);
      await assert.rejects(identityStore.authAdapter.createUser(emailInput), IdentityConflictError);
      await assert.rejects(identityStore.authAdapter.updateUser({ id: sub, name: "Must not change" }), IdentityConflictError);
      await assert.rejects(identityStore.ensurePersistentGoogleIdentity(
        { ...account, providerAccountId: sub }, { ...profile, sub }), IdentityConflictError);
      // Validate bootstrap even when the incoming email no longer matches the stored email.
      await assert.rejects(identityStore.ensurePersistentGoogleIdentity(
        { ...account, providerAccountId: sub }, { ...profile, sub, email: "changed@example.com" }), IdentityConflictError);
      for (const dryRun of [true, false]) await assert.rejects(identityStore.seedIdentityKey(sub, dryRun), IdentityConflictError);
      const report = await inspectIdentityKeys(firestore);
      assert.equal(report.diagnostics.conflictingStoredUserIds.count, 1);
      assert.match(report.diagnostics.conflictingStoredUserIds.samples[0], /^[a-f0-9]{64}$/u);
      assert.ok(Object.entries(report.diagnostics).some(([kind, result]) => kind !== "usersMissingIdentityKeys" && result.count > 0));
      assert.ok(!/other-user|google-sub-a|@/u.test(JSON.stringify(report.diagnostics)));
      assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).get()).size, 0);

      const keyRef = firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId);
      await keyRef.set(identityKeyRecord(sub));
      const beforeKey = (await keyRef.get()).data();
      await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), IdentityConflictError);
      for (const dryRun of [true, false]) await assert.rejects(identityStore.seedIdentityKey(sub, dryRun), IdentityConflictError);
      await firestore.collection(AUTH_COLLECTIONS.sessions).doc("bad-user-session").set({
        userId: sub, sessionToken: "synthetic-session", expires: new Date("2099-01-01")
      });
      await assert.rejects(identityStore.authAdapter.getSessionAndUser("synthetic-session"), IdentityConflictError);
      assert.deepEqual((await keyRef.get()).data(), beforeKey);
      assert.deepEqual((await userRef.get()).data(), beforeUser);
      assert.deepEqual((await accountRef.get()).data(), beforeAccount);
      assert.deepEqual((await orderRef.get()).data(), beforeOrder);
    } finally {
      await orderRef.delete(); // Synthetic fixture on the loopback demo emulator only.
    }
  });

  it("accepts equal persisted IDs through bootstrap, all reads and JWT/session", async () => {
    await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).set({ ...emailInput, id: subject });
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    const user = await identityStore.authAdapter.getUserByAccount(account);
    assert.equal(user?.id, subject);
    assert.equal((await identityStore.authAdapter.getUser(subject))?.id, subject);
    assert.equal((await identityStore.authAdapter.getUserByEmail(emailInput.email))?.id, subject);
    const token = persistUserIdInJwt({} as JWT, user as User);
    assert.equal(token.uid, subject);
    assert.equal(exposePersistentUserId({ user: { id: "" }, expires: "2099-01-01" } as Session, token).user.id, subject);
    await firestore.collection(AUTH_COLLECTIONS.sessions).doc("valid-session").set({
      userId: subject, sessionToken: "valid-token", expires: new Date("2099-01-01")
    });
    const sessionResult = await identityStore.authAdapter.getSessionAndUser("valid-token");
    assert.equal(sessionResult?.user.id, subject);
    assert.equal(sessionResult?.session.userId, subject);
    assert.ok(sessionResult?.session.expires instanceof Date);
    assert.equal((await inspectIdentityKeys(firestore)).diagnostics.conflictingStoredUserIds.count, 0);
  });

  it("account reads reject dangling, conflicting and duplicate ownership without email fallback", async () => {
    const ref = firestore.collection(AUTH_COLLECTIONS.accounts).doc(googleAccountDocumentId(subject));
    assert.equal(await identityStore.authAdapter.getUserByAccount(account), null);
    assert.equal(await identityStore.authAdapter.getUser(subject), null);
    await ref.set({ ...account, userId: subject });
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), IdentityConflictError);
    await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).set(emailInput);
    await ref.update({ userId: "other-user" });
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), IdentityConflictError);
    await ref.update({ userId: subject, providerAccountId: "inconsistent-sub" });
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), IdentityConflictError);
    await ref.update({ providerAccountId: subject });
    await firestore.collection(AUTH_COLLECTIONS.accounts).doc("duplicate-account").set({ ...account, userId: subject });
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), IdentityConflictError);
  });

  it("concurrent bootstrap creates one user and one Google account mapping", async () => {
    await Promise.all([
      identityStore.ensurePersistentGoogleIdentity(account, profile),
      identityStore.ensurePersistentGoogleIdentity(account, profile)
    ]);

    const users = await firestore.collection(AUTH_COLLECTIONS.users).get();
    const accounts = await firestore
      .collection(AUTH_COLLECTIONS.accounts)
      .where("provider", "==", "google")
      .where("providerAccountId", "==", subject)
      .get();

    assert.equal(users.size, 1);
    assert.equal(users.docs[0]?.id, subject);
    assert.equal(accounts.size, 1);
    assert.equal(accounts.docs[0]?.data().userId, subject);
  });

  it("rejects an existing Google account owned by another persistent user", async () => {
    const conflictingUserId = "different-persistent-user";
    await firestore.collection(AUTH_COLLECTIONS.users).doc(conflictingUserId).set({
      email: "different@example.com",
      emailVerified: null,
      image: null,
      name: "Different User"
    });
    const accountRef = firestore
      .collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(subject));
    await accountRef.set({
      provider: "google",
      providerAccountId: subject,
      type: "oauth",
      userId: conflictingUserId
    });

    await assert.rejects(
      identityStore.ensurePersistentGoogleIdentity(account, profile),
      IdentityConflictError
    );

    assert.equal((await accountRef.get()).data()?.userId, conflictingUserId);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
  });

  const emailInput = { email: "buyer@example.com", name: null, image: null, emailVerified: new Date(1000) };
  const isConflict = (error: unknown) => error instanceof IdentityConflictError;
  const isLinkingRequired = (error: unknown) => error instanceof IdentityConflictError && error.code === "LINKING_REQUIRED";
  const keyId = emailIdentityKeyId(emailInput.email);

  async function assertOneOwner(expectedId: string) {
    const users = await firestore.collection(AUTH_COLLECTIONS.users).get();
    const keys = await firestore.collection(AUTH_IDENTITY_KEYS).get();
    assert.equal(users.size, 1);
    assert.equal(users.docs[0].id, expectedId);
    assert.equal(keys.size, 1);
    assert.equal(keys.docs[0].id, keyId);
    assert.equal(keys.docs[0].data().userId, expectedId);
  }

  it("adds a key to an existing Phase 2A.1 Google user without rewriting identity", async () => {
    const userRef = firestore.collection(AUTH_COLLECTIONS.users).doc(subject);
    await userRef.set({ ...emailInput, emailVerified: null });
    await firestore.collection(AUTH_COLLECTIONS.accounts).doc(googleAccountDocumentId(subject)).set({
      userId: subject, provider: "google", providerAccountId: subject, type: "oauth"
    });
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    const first = (await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data();
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    assert.deepEqual((await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data(), first);
    assert.equal((await identityStore.authAdapter.getUserByEmail(" BUYER@example.com "))?.id, subject);
    await assertOneOwner(subject);
  });

  it("concurrent same-email createUser callbacks return exactly one opaque owner", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => identityStore.authAdapter.createUser({
      ...emailInput, email: i % 2 ? " Ｂｕｙｅｒ@example.com " : emailInput.email
    })));
    assert.equal(new Set(results.map(user => user.id)).size, 1);
    assert.match(results[0].id, /^[a-f0-9-]{36}$/u);
    await assertOneOwner(results[0].id);
  });

  it("Google wins first: future email creation resolves the same Google-sub owner", async () => {
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    const [user] = await Promise.all([
      identityStore.authAdapter.createUser(emailInput), identityStore.ensurePersistentGoogleIdentity(account, profile)
    ]);
    assert.equal(user.id, subject);
    assert.equal(user.emailVerified?.getTime(), 1000);
    assert.equal((await identityStore.authAdapter.getUserByEmail(emailInput.email))?.emailVerified?.getTime(), 1000);
    await assertOneOwner(subject);
  });

  it("email wins first: Google cannot steal or create a second owner", async () => {
    const first = await identityStore.authAdapter.createUser(emailInput);
    const results = await Promise.allSettled([
      identityStore.ensurePersistentGoogleIdentity(account, profile), identityStore.authAdapter.createUser(emailInput)
    ]);
    assert.equal(results[0].status, "rejected");
    if (results[0].status === "rejected") assert.ok(isLinkingRequired(results[0].reason));
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    await assertOneOwner(first.id);
  });

  it("simultaneous first Google/email calls contend on one key", async () => {
    const [google, email] = await Promise.allSettled([
      identityStore.ensurePersistentGoogleIdentity(account, profile), identityStore.authAdapter.createUser(emailInput)
    ]);
    assert.equal(email.status, "fulfilled");
    if (email.status !== "fulfilled") throw email.reason;
    await assertOneOwner(email.value.id);
    if (google.status === "fulfilled") assert.equal(email.value.id, subject);
    else {
      assert.ok(isLinkingRequired(google.reason));
      assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    }
  });

  it("fails closed for missing referenced user on lookup, creation and Google bootstrap", async () => {
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).set(identityKeyRecord("missing"));
    await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), isConflict);
    await assert.rejects(identityStore.authAdapter.createUser(emailInput), isConflict);
    await assert.rejects(identityStore.ensurePersistentGoogleIdentity(account, profile), isConflict);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).size, 0);
  });

  it("fails closed when key points at a user with a different canonical email", async () => {
    await firestore.collection(AUTH_COLLECTIONS.users).doc("other").set({ ...emailInput, email: "other@example.com" });
    await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).set(emailInput);
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).set(identityKeyRecord("other"));
    await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), isConflict);
    await assert.rejects(identityStore.authAdapter.createUser(emailInput), isConflict);
  });

  it("never picks an arbitrary duplicate, including legacy normalization variants and existing keys", async () => {
    await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).set(emailInput);
    await firestore.collection(AUTH_COLLECTIONS.users).doc("duplicate").set({ ...emailInput, email: " ＢＵＹＥＲ@example.com " });
    await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), isConflict);
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).set(identityKeyRecord(subject));
    await assert.rejects(identityStore.authAdapter.createUser(emailInput), isConflict);
    await assert.rejects(identityStore.ensurePersistentGoogleIdentity(account, profile), isConflict);
    await assert.rejects(identityStore.seedIdentityKey(subject, false), isConflict);
  });

  it("fails closed on malformed key without exposing private values", async () => {
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).set({ userId: "private-user", email: emailInput.email });
    await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), (error: unknown) =>
      isConflict(error) && !String(error).includes("private-user") && !String(error).includes("@"));
  });

  it("established-email drift fails for Google and updateUser; equivalent email remains valid", async () => {
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    await assert.rejects(identityStore.ensurePersistentGoogleIdentity(account, { ...profile, email: "changed@example.com" }),
      (error: unknown) => error instanceof IdentityConflictError && error.code === "EMAIL_CHANGE_REQUIRED");
    await assert.rejects(identityStore.authAdapter.updateUser({ id: subject, email: "changed@example.com" }), isConflict);
    const user = await identityStore.authAdapter.updateUser({ id: subject, email: " ＢＵＹＥＲ@example.com ", name: "Updated", emailVerified: new Date(2000) });
    assert.equal(user.id, subject);
    assert.equal(user.email, emailInput.email);
    assert.equal(user.name, "Updated");
    assert.equal(user.emailVerified?.getTime(), 2000);
    const retained = await identityStore.authAdapter.updateUser({ id: subject, emailVerified: null });
    assert.equal(retained.emailVerified?.getTime(), 2000);
    await assertOneOwner(subject);
  });

  it("legacy lookup is read-only; seed dry-run is read-only and apply is idempotent", async () => {
    const ref = firestore.collection(AUTH_COLLECTIONS.users).doc(subject);
    await ref.set({ ...emailInput, email: " Buyer@example.com " });
    const before = (await ref.get()).data();
    assert.equal((await identityStore.authAdapter.getUserByEmail(emailInput.email))?.id, subject);
    assert.equal(await identityStore.seedIdentityKey(subject), "would_create");
    assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).get()).size, 0);
    assert.equal(await identityStore.seedIdentityKey(subject, false), "created");
    assert.equal(await identityStore.seedIdentityKey(subject, false), "already_seeded");
    assert.deepEqual((await ref.get()).data(), before);
  });

  it("inventory detects inconsistencies without writes or plaintext email output", async () => {
    await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).set(emailInput);
    const missing = await inspectIdentityKeys(firestore);
    assert.equal(missing.diagnostics.usersMissingIdentityKeys.count, 1);
    await firestore.collection(AUTH_COLLECTIONS.users).doc("duplicate").set({ ...emailInput, email: "BUYER@example.com" });
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).set(identityKeyRecord("missing"));
    const report = await inspectIdentityKeys(firestore);
    assert.equal(report.diagnostics.duplicateCanonicalUsers.count, 1);
    assert.equal(report.diagnostics.keysPointingToMissingUsers.count, 1);
    assert.ok(!JSON.stringify(report.diagnostics).includes("@"));
    assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).get()).size, 1);
  });

  it("does not miss a legacy duplicate beyond the first 500-document page", async () => {
    const users = firestore.collection(AUTH_COLLECTIONS.users);
    const batch = firestore.batch();
    batch.set(users.doc("a-owner"), emailInput);
    for (let i = 0; i < 499; i++) {
      batch.set(users.doc("m-" + String(i).padStart(3, "0")), { ...emailInput, email: `person${i}@example.net` });
    }
    await batch.commit();
    await users.doc("z-duplicate").set({ ...emailInput, email: "ＢＵＹＥＲ@example.com" });
    await assert.rejects(identityStore.authAdapter.getUserByEmail(emailInput.email), isConflict);
    const inspection = await inspectIdentityKeys(firestore);
    assert.equal(inspection.userIds.size, 501);
    assert.equal(inspection.diagnostics.duplicateCanonicalUsers.count, 1);
    assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).get()).size, 0);
  });
  it("explicitly links an email-first User once and later resolves the same opaque owner", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const userBefore = (await firestore.collection(AUTH_COLLECTIONS.users).doc(user.id).get()).data();
    const keyBefore = (await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data();
    const authenticatedOrder = { checkoutMode: "authenticated", userId: user.id, status: "paid" };
    const guestOrder = { checkoutMode: "guest", userId: null, status: "paid" };
    await firestore.collection("orders").doc("owned-before-link").set(authenticatedOrder);
    await firestore.collection("orders").doc("guest-before-link").set(guestOrder);

    const results = await Promise.all([
      identityStore.linkGoogleIdentityToUser(user.id, account, profile),
      identityStore.linkGoogleIdentityToUser(user.id, account, profile)
    ]);
    assert.equal(results.filter(result => result.userId === user.id).length, 2);
    assert.deepEqual(results.map(result => result.alreadyLinked).sort(), [false, true]);
    const mappings = await firestore.collection(AUTH_COLLECTIONS.accounts)
      .where("provider", "==", "google").where("providerAccountId", "==", subject).get();
    assert.equal(mappings.size, 1);
    const accountSnap = await firestore.collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(subject)).get();
    assert.deepEqual(Object.keys(accountSnap.data()!).sort(), [
      "linkMode", "linkedAt", "linkedEmailKeyId", "linkingVersion",
      "provider", "providerAccountId", "type", "userId"
    ]);
    assert.equal(accountSnap.data()?.userId, user.id);
    assert.equal(accountSnap.data()?.providerAccountId, subject);
    assert.equal(accountSnap.data()?.linkMode, "explicit");
    assert.equal(accountSnap.data()?.linkingVersion, 1);
    assert.ok(accountSnap.data()?.linkedAt);
    assert.equal(accountSnap.data()?.linkedEmailKeyId, keyId);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
    assert.deepEqual((await firestore.collection(AUTH_COLLECTIONS.users).doc(user.id).get()).data(), userBefore);
    assert.deepEqual((await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data(), keyBefore);
    assert.deepEqual((await firestore.collection("orders").doc("owned-before-link").get()).data(), authenticatedOrder);
    assert.deepEqual((await firestore.collection("orders").doc("guest-before-link").get()).data(), guestOrder);

    const byAccount = await identityStore.authAdapter.getUserByAccount(account);
    assert.equal(byAccount?.id, user.id);
    assert.deepEqual(await identityStore.ensurePersistentGoogleIdentity(account, profile),
      { userId: user.id, createUser: false, createAccount: false });
    const jwt = persistUserIdInJwt({} as JWT, byAccount as User);
    assert.equal(jwt.uid, user.id);
    assert.equal(exposePersistentUserId({ user: {}, expires: "2030-01-01" } as Session, jwt).user.id, user.id);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).size, 1);
    const inventory = await inspectIdentityKeys(firestore);
    assert.equal(inventory.explicitGoogleLinks, 1);
    assert.equal(inventory.diagnostics.googleAccountUserConflicts.count, 0);
  });

  it("keeps an authenticated historical Google-first mapping marker-free and idempotent", async () => {
    await identityStore.ensurePersistentGoogleIdentity(account, profile);
    await identityStore.linkGoogleIdentityToUser(subject, account, profile);
    assert.deepEqual((await firestore.collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(subject)).get()).data(), {
      provider: "google", providerAccountId: subject, type: "oauth", userId: subject
    });
    assert.equal((await inspectIdentityKeys(firestore)).explicitGoogleLinks, 0);
  });

  it("requires the current User, its owned identity key and the same verified Google email", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    await assert.rejects(identityStore.linkGoogleIdentityToUser("missing-user", account, profile), isConflict);
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account,
      { ...profile, email: "different@example.com" }), isConflict);
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account,
      { ...profile, email_verified: false }), /authoritative verified email/u);
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id,
      { ...account, providerAccountId: "different-sub" }, profile), /subject did not match/u);
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).delete();
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
  });

  it("rejects an identity key owned by another User", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    await firestore.collection(AUTH_COLLECTIONS.users).doc("other-user").set({
      email: "other@example.com", emailVerified: null, name: null, image: null
    });
    await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).set(identityKeyRecord("other-user"));
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
  });

  it("rejects Google ownership by another User and multiple Google accounts for one User", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const other = await identityStore.authAdapter.createUser({
      ...emailInput, email: "other@example.com"
    });
    const otherKey = emailIdentityKeyId("other@example.com");
    await firestore.collection(AUTH_COLLECTIONS.accounts).doc(googleAccountDocumentId(subject)).set({
      provider: "google", providerAccountId: subject, type: "oauth", userId: other.id,
      linkMode: "explicit", linkingVersion: 1, linkedAt: new Date(),
      linkedEmailKeyId: otherKey
    });
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);

    await clearCollection(firestore, AUTH_COLLECTIONS.accounts);
    const firstSubject = "first-google-sub";
    await identityStore.linkGoogleIdentityToUser(user.id,
      { ...account, providerAccountId: firstSubject },
      { ...profile, sub: firstSubject });
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 1);
  });

  it("fails closed for malformed, dangling and duplicate explicit Google mappings", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const canonical = firestore.collection(AUTH_COLLECTIONS.accounts).doc(googleAccountDocumentId(subject));
    const valid = {
      provider: "google", providerAccountId: subject, type: "oauth", userId: user.id,
      linkMode: "explicit", linkingVersion: 1,
      linkedAt: (await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data()!.createdAt,
      linkedEmailKeyId: keyId
    };
    for (const malformed of [
      { ...valid, linkMode: "implicit" },
      { ...valid, linkingVersion: 2 },
      { ...valid, linkedAt: "invalid" },
      { ...valid, linkedEmailKeyId: "bad" }
    ]) {
      await canonical.set(malformed);
      await assert.rejects(identityStore.authAdapter.getUserByAccount(account), isConflict);
      await assert.rejects(identityStore.ensurePersistentGoogleIdentity(account, profile), isConflict);
    }

    await canonical.set({ ...valid, userId: "missing-user" });
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), isConflict);
    await canonical.set(valid);
    await firestore.collection(AUTH_COLLECTIONS.accounts).doc("duplicate-google-mapping").set(valid);
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), isConflict);
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);
  });

  it("keeps unauthenticated same-email Google bootstrap in LINKING_REQUIRED", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    await assert.rejects(identityStore.ensurePersistentGoogleIdentity(account, profile), isLinkingRequired);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).size, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).docs[0].id, user.id);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
  });

  it("requires a valid persisted verified-email state for cross-ID linking", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const ref = firestore.collection(AUTH_COLLECTIONS.users).doc(user.id);

    await ref.update({ emailVerified: null });
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);

    await ref.update({ emailVerified: "invalid" });
    await assert.rejects(identityStore.linkGoogleIdentityToUser(user.id, account, profile), isConflict);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);

    await ref.update({ emailVerified: new Date(2000) });
    await identityStore.linkGoogleIdentityToUser(user.id, account, profile);
    await ref.update({ emailVerified: null });
    await assert.rejects(identityStore.authAdapter.getUserByAccount(account), isConflict);
    await assert.rejects(identityStore.ensurePersistentGoogleIdentity(account, profile), isConflict);
    const inventory = await inspectIdentityKeys(firestore);
    assert.equal(inventory.explicitGoogleLinks, 0);
    assert.equal(inventory.diagnostics.googleAccountUserConflicts.count, 1);
  });

  it("allows at most one of two concurrent Google links for the same User", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const subjects = ["concurrent-google-a", "concurrent-google-b"];
    const attempts = subjects.map(providerAccountId => identityStore.linkGoogleIdentityToUser(
      user.id,
      { ...account, providerAccountId },
      { ...profile, sub: providerAccountId }
    ));
    const results = await Promise.allSettled(attempts);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);

    const owned = await firestore.collection(AUTH_COLLECTIONS.accounts).where("userId", "==", user.id).get();
    assert.equal(owned.size, 1);
    const winningSubject = owned.docs[0].data().providerAccountId;
    assert.ok(subjects.includes(winningSubject));
    assert.equal(owned.docs[0].id, googleAccountDocumentId(winningSubject));
    assert.equal((await identityStore.authAdapter.getUserByAccount({
      provider: "google", providerAccountId: winningSubject
    }))?.id, user.id);
    const losingSubject = subjects.find(candidate => candidate !== winningSubject)!;
    assert.equal(await identityStore.authAdapter.getUserByAccount({
      provider: "google", providerAccountId: losingSubject
    }), null);
    for (const candidate of subjects) {
      assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(candidate).get()).exists, false);
    }
  });

  it("gives exactly one User ownership when two verified Users concurrently link the same Google subject", async () => {
    const first = await identityStore.authAdapter.createUser(emailInput);
    const secondEmail = "other@example.com";
    const second = await identityStore.authAdapter.createUser({ ...emailInput, email: secondEmail });
    const firstProfile = { ...profile, email: emailInput.email };
    const secondProfile = { ...profile, email: secondEmail };

    const results = await Promise.allSettled([
      identityStore.linkGoogleIdentityToUser(first.id, account, firstProfile),
      identityStore.linkGoogleIdentityToUser(second.id, account, secondProfile)
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);

    const canonical = await firestore.collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(subject)).get();
    assert.equal(canonical.exists, true);
    const winner = results[0].status === "fulfilled" ? first : second;
    assert.equal(canonical.data()?.userId, winner.id);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts)
      .where("provider", "==", "google").where("providerAccountId", "==", subject).get()).size, 1);
    assert.equal((await identityStore.authAdapter.getUserByAccount(account))?.id, winner.id);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
  });

  it("converges when explicit linking races normal unauthenticated Google bootstrap", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const [link, bootstrap] = await Promise.allSettled([
      identityStore.linkGoogleIdentityToUser(user.id, account, profile),
      identityStore.ensurePersistentGoogleIdentity(account, profile)
    ]);
    assert.equal(link.status, "fulfilled");
    if (bootstrap.status === "rejected") assert.ok(isLinkingRequired(bootstrap.reason));

    const canonical = await firestore.collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(subject)).get();
    assert.equal(canonical.data()?.userId, user.id);
    assert.equal(canonical.data()?.linkMode, "explicit");
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).get()).size, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
    assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data()?.userId, user.id);
    assert.deepEqual(await identityStore.ensurePersistentGoogleIdentity(account, profile),
      { userId: user.id, createUser: false, createAccount: false });
  });

  const linkSecret = "synthetic-google-link-intent-secret";
  const linkSessionBinding = "a".repeat(64);
  const linkState = "nextauth-oauth-state-a";

  async function preparedIntent(userId: string, now = Timestamp.fromMillis(10_000)) {
    const rawToken = createGoogleLinkIntentToken();
    const session = { userId, sessionBinding: linkSessionBinding };
    await identityStore.createGoogleLinkIntentForSession(session, rawToken, now);
    await identityStore.bindGoogleLinkIntentToState(session, rawToken, linkState, linkSecret, now);
    return { rawToken, session, now };
  }

  it("persists the exact OAuth state generated through installed NextAuth initiation", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const rawToken = createGoogleLinkIntentToken();
    const session = { userId: user.id, sessionBinding: linkSessionBinding };
    const now = Timestamp.now();
    await identityStore.createGoogleLinkIntentForSession(session, rawToken, now);

    const csrf = "link-intent-csrf";
    const csrfCookie = csrf + "|" + createHash("sha256").update(csrf + linkSecret).digest("hex");
    const options: NextAuthOptions = {
      secret: linkSecret,
      session: { strategy: "jwt" },
      providers: [{
        id: "google", name: "Google", type: "oauth",
        authorization: { url: "https://accounts.example/authorize", params: {} },
        token: "https://accounts.example/token",
        userinfo: "https://accounts.example/userinfo",
        clientId: "client", clientSecret: "secret", checks: ["pkce", "state"],
        profile: value => ({ id: String(value.sub), email: String(value.email) })
      }],
      logger: { error() {}, warn() {}, debug() {} }
    };
    const intentCookie = googleLinkIntentCookieName(false) + "=" + rawToken;
    const initiation = new Request("https://app.example.com/api/auth/signin/google", {
      method: "POST", headers: { cookie: intentCookie }
    }) as NextRequest;
    const response = await runGoogleLinkRequest(initiation, ["signin", "google"], options,
      async scoped => {
        const generated = await AuthHandler({
          req: {
            method: "POST", action: "signin", providerId: "google", query: {},
            headers: {}, cookies: { "next-auth.csrf-token": csrfCookie },
            body: { csrfToken: csrf, callbackUrl: "https://app.example.com", json: "true" }
          },
          options: scoped
        });
        assert.equal(generated.cookies.some(
          (value: { name: string }) => value.name === "next-auth.pkce.code_verifier"), true);
        return new Response(null, { status: 302, headers: { location: generated.redirect } });
      },
      {
        authUrl: "https://app.example.com", secureCookie: false,
        session: async () => session,
        validate: identityStore.validateUnboundGoogleLinkIntent,
        bind: (value, token, state) =>
          identityStore.bindGoogleLinkIntentToState(value, token, state, linkSecret, now),
        consume: async () => ({ status: "rejected" as const })
      }
    );
    const state = new URL(response!.headers.get("location")!).searchParams.get("state");
    assert.ok(state);
    const persisted = (await firestore.collection(GOOGLE_LINK_INTENTS)
      .doc(googleLinkIntentDocumentId(rawToken)).get()).data()!;
    assert.equal(persisted.stateBinding, googleLinkStateBinding(state, linkSecret));
    const altered = state.slice(0, -1) + (state.endsWith("a") ? "b" : "a");
    await assert.rejects(identityStore.consumeGoogleLinkIntentAndLink(
      session, rawToken, altered, linkSecret, account, profile, now), GoogleLinkIntentError);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    assert.equal((await firestore.collection(GOOGLE_LINK_INTENTS)
      .doc(googleLinkIntentDocumentId(rawToken)).get()).exists, true);
  });

  it("atomically links and consumes one intent while preserving User, key and order ownership", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const intent = await preparedIntent(user.id);
    const persistedIntent = (await firestore.collection(GOOGLE_LINK_INTENTS)
      .doc(googleLinkIntentDocumentId(intent.rawToken)).get()).data()!;
    assert.deepEqual(Object.keys(persistedIntent).sort(), [
      "createdAt", "expiresAt", "intentVersion", "purpose", "sessionBinding", "stateBinding", "userId"
    ]);
    assert.equal(JSON.stringify(persistedIntent).includes(intent.rawToken), false);
    assert.equal(JSON.stringify(persistedIntent).includes(linkState), false);
    const userBefore = (await firestore.collection(AUTH_COLLECTIONS.users).doc(user.id).get()).data();
    const keyBefore = (await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data();
    const order = { checkoutMode: "authenticated", userId: user.id, status: "paid" };
    await firestore.collection("orders").doc("link-intent-order").set(order);

    const result = await identityStore.consumeGoogleLinkIntentAndLink(
      intent.session, intent.rawToken, linkState, linkSecret, account, profile, intent.now);
    assert.equal(result.status, "linked");
    await assert.rejects(identityStore.consumeGoogleLinkIntentAndLink(
      intent.session, intent.rawToken, linkState, linkSecret, account, profile, intent.now), GoogleLinkIntentError);
    assert.equal((await firestore.collection(GOOGLE_LINK_INTENTS).get()).size, 0);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
    assert.deepEqual((await firestore.collection(AUTH_COLLECTIONS.users).doc(user.id).get()).data(), userBefore);
    assert.deepEqual((await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data(), keyBefore);
    assert.deepEqual((await firestore.collection("orders").doc("link-intent-order").get()).data(), order);
  });

  it("consumes a wrong-email Google selection without changing identity or orders", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const intent = await preparedIntent(user.id);
    const before = (await firestore.collection(AUTH_COLLECTIONS.users).doc(user.id).get()).data();
    const result = await identityStore.consumeGoogleLinkIntentAndLink(
      intent.session, intent.rawToken, linkState, linkSecret, account,
      { ...profile, email: "different@example.com" }, intent.now);
    assert.equal(result.status, "rejected");
    assert.equal((await firestore.collection(GOOGLE_LINK_INTENTS).get()).size, 0);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 0);
    assert.deepEqual((await firestore.collection(AUTH_COLLECTIONS.users).doc(user.id).get()).data(), before);
    assert.equal((await firestore.collection(AUTH_IDENTITY_KEYS).doc(keyId).get()).data()?.userId, user.id);
  });

  it("allows at most one of two simultaneous callbacks to consume and link one intent", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const intent = await preparedIntent(user.id);
    const results = await Promise.allSettled([
      identityStore.consumeGoogleLinkIntentAndLink(
        intent.session, intent.rawToken, linkState, linkSecret, account, profile, intent.now),
      identityStore.consumeGoogleLinkIntentAndLink(
        intent.session, intent.rawToken, linkState, linkSecret, account, profile, intent.now)
    ]);
    assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
    assert.equal(results.filter(value => value.status === "rejected").length, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 1);
    assert.equal((await firestore.collection(GOOGLE_LINK_INTENTS).get()).size, 0);
  });

  it("one intent raced with two Google identities produces at most one account", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const intent = await preparedIntent(user.id);
    const otherSubject = "other-google-sub";
    const results = await Promise.allSettled([
      identityStore.consumeGoogleLinkIntentAndLink(
        intent.session, intent.rawToken, linkState, linkSecret, account, profile, intent.now),
      identityStore.consumeGoogleLinkIntentAndLink(
        intent.session, intent.rawToken, linkState, linkSecret,
        { ...account, providerAccountId: otherSubject }, { ...profile, sub: otherSubject }, intent.now)
    ]);
    assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.accounts).get()).size, 1);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(otherSubject).get()).exists, false);
  });

  it("rejects expired intents and an OAuth state from a different journey", async () => {
    const user = await identityStore.authAdapter.createUser(emailInput);
    const expired = await preparedIntent(user.id);
    await assert.rejects(identityStore.consumeGoogleLinkIntentAndLink(
      expired.session, expired.rawToken, linkState, linkSecret, account, profile,
      Timestamp.fromMillis(expired.now.toMillis() + 600_000)), GoogleLinkIntentError);

    await firestore.collection(GOOGLE_LINK_INTENTS).doc(googleLinkIntentDocumentId(expired.rawToken)).delete();
    const current = await preparedIntent(user.id, Timestamp.fromMillis(20_000));
    await assert.rejects(identityStore.consumeGoogleLinkIntentAndLink(
      { ...current.session, sessionBinding: "b".repeat(64) }, current.rawToken,
      linkState, linkSecret, account, profile, current.now), GoogleLinkIntentError);
    await assert.rejects(identityStore.bindGoogleLinkIntentToState(
      current.session, current.rawToken, "journey-b", linkSecret, current.now), GoogleLinkIntentError);
    await assert.rejects(identityStore.consumeGoogleLinkIntentAndLink(
      current.session, current.rawToken, "journey-b", linkSecret, account, profile, current.now),
    GoogleLinkIntentError);
    assert.equal((await firestore.collection(GOOGLE_LINK_INTENTS)
      .doc(googleLinkIntentDocumentId(current.rawToken)).get()).exists, true);
    assert.equal((await identityStore.consumeGoogleLinkIntentAndLink(
      current.session, current.rawToken, linkState, linkSecret, account, profile, current.now)).status, "linked");
  });
});
