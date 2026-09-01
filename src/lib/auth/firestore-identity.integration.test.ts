import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { AUTH_COLLECTIONS } from "./collections";
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
    app = initializeApp({ projectId }, "docstack-auth-integration-" + process.pid);
    firestore = getFirestore(app);
    identityStore = createFirestoreIdentityStore(firestore);
  });

  beforeEach(async () => {
    await Promise.all([
      clearCollection(firestore, AUTH_COLLECTIONS.accounts),
      clearCollection(firestore, AUTH_COLLECTIONS.users)
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
      /already owned by another persistent user/
    );

    assert.equal((await accountRef.get()).data()?.userId, conflictingUserId);
    assert.equal((await firestore.collection(AUTH_COLLECTIONS.users).doc(subject).get()).exists, false);
  });
});
