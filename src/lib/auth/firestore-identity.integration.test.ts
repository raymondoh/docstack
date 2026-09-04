import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { AUTH_COLLECTIONS, AUTH_IDENTITY_KEYS } from "./collections";
import { emailIdentityKeyId, IdentityConflictError } from "./identity-email";
import { identityKeyRecord } from "./identity-records";
import { inspectIdentityKeys } from "./identity-inventory";
import { createFirestoreIdentityStore } from "./firestore-identity-store";
import { googleAccountDocumentId } from "./google-identity";
import { exposePersistentUserId, persistUserIdInJwt } from "./session-identity";

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
      clearCollection(firestore, AUTH_IDENTITY_KEYS)
    ]);
  });

  after(async () => {
    if (app) await deleteApp(app);
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
});
