import { FirestoreAdapter } from "@auth/firebase-adapter";
import type { Firestore } from "firebase-admin/firestore";
import type { Account, Profile } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { AUTH_COLLECTIONS } from "@/lib/auth/collections";
import {
  googleAccountDocumentId,
  googleAccountRecord,
  parseAuthoritativeGoogleIdentity,
  planGoogleIdentityBootstrap
} from "@/lib/auth/google-identity";

export function createFirestoreIdentityStore(firestore: Firestore) {
  // DocStack remains on NextAuth v4, while this adapter's type originates from
  // the newer @auth/core family. Its v4 runtime methods and Firestore schemas
  // were deliberately reviewed; the emulator integration test protects this bridge.
  const adapter = FirestoreAdapter({
    firestore,
    collections: AUTH_COLLECTIONS
  }) as unknown as Adapter;

  async function ensureGoogleIdentity(account: Account | null, profile: Profile | undefined) {
    const identity = parseAuthoritativeGoogleIdentity(account, profile);
    const userRef = firestore.collection(AUTH_COLLECTIONS.users).doc(identity.subject);
    const canonicalAccountRef = firestore
      .collection(AUTH_COLLECTIONS.accounts)
      .doc(googleAccountDocumentId(identity.providerAccountId));
    const accountQuery = firestore
      .collection(AUTH_COLLECTIONS.accounts)
      .where("provider", "==", identity.provider)
      .where("providerAccountId", "==", identity.providerAccountId)
      .limit(2);
    const emailQuery = firestore.collection(AUTH_COLLECTIONS.users).where("email", "==", identity.email).limit(2);

    return firestore.runTransaction(async transaction => {
      // Firestore transactions require all reads before writes.
      const userSnap = await transaction.get(userRef);
      const canonicalAccountSnap = await transaction.get(canonicalAccountRef);
      const accountSnaps = await transaction.get(accountQuery);
      const emailSnaps = await transaction.get(emailQuery);

      const plan = planGoogleIdentityBootstrap(identity, {
        userExists: userSnap.exists,
        canonicalAccountOwnerId: canonicalAccountSnap.exists
          ? (canonicalAccountSnap.data()?.userId as string | undefined)
          : undefined,
        accountOwnerIds: accountSnaps.docs
          .map(doc => doc.data().userId)
          .filter((userId): userId is string => typeof userId === "string"),
        emailOwnerIds: emailSnaps.docs.map(doc => doc.id)
      });

      transaction.set(
        userRef,
        {
          name: identity.name ?? null,
          email: identity.email,
          // NextAuth v4 uses this field for successful passwordless-email
          // verification, which is deliberately deferred to Phase 2A.2.
          emailVerified: userSnap.data()?.emailVerified ?? null,
          image: identity.image ?? null
        },
        { merge: true }
      );

      if (plan.createAccount) {
        transaction.create(canonicalAccountRef, googleAccountRecord(identity));
      } else if (canonicalAccountSnap.exists) {
        // Repair incomplete canonical records without changing their owner.
        transaction.set(canonicalAccountRef, googleAccountRecord(identity), { merge: true });
      }

      return plan;
    });
  }

  return { authAdapter: adapter, ensurePersistentGoogleIdentity: ensureGoogleIdentity };
}
