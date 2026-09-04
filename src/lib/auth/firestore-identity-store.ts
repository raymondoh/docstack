import { randomUUID } from "node:crypto";
import { FirestoreAdapter } from "@auth/firebase-adapter";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Account, Profile } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { AUTH_COLLECTIONS } from "./collections";
import { googleAccountDocumentId, googleAccountRecord, parseAuthoritativeGoogleIdentity, planGoogleIdentityBootstrap } from "./google-identity";
import { assertEstablishedEmail, IdentityConflictError, normalizeIdentityEmail } from "./identity-email";
import { adapterUser, identityKeyRecord, readEmailIdentity } from "./identity-records";
import { createVerificationTokenStore } from "./verification-tokens";

export function createFirestoreIdentityStore(firestore: Firestore) {
  // The adapter has newer @auth/core types, but its runtime/schema contract is
  // deliberately bridged to v4. Keep this cast isolated and emulator-tested.
  const baseAdapter = FirestoreAdapter({ firestore, collections: AUTH_COLLECTIONS }) as unknown as Adapter;
  const users = firestore.collection(AUTH_COLLECTIONS.users);

  function userRef(id: unknown) {
    if (typeof id !== "string" || !id || id.includes("/")) throw new IdentityConflictError();
    return users.doc(id);
  }

  // Never use the stock User converter: a persisted id can override snapshot.id.
  async function getUser(id: string) {
    const snap = await userRef(id).get();
    return snap.exists ? adapterUser(snap.id, snap.data()!) : null;
  }

  async function getUserByAccount({ provider, providerAccountId }: { provider: string; providerAccountId: string }) {
    return firestore.runTransaction(async tx => {
      const accounts = firestore.collection(AUTH_COLLECTIONS.accounts);
      const matches = await tx.get(accounts.where("provider", "==", provider)
        .where("providerAccountId", "==", providerAccountId).limit(2));
      if (matches.size > 1) throw new IdentityConflictError();
      const records = new Map(matches.docs.map(doc => [doc.id, doc.data()]));
      if (provider === "google") {
        const canonical = await tx.get(accounts.doc(googleAccountDocumentId(providerAccountId)));
        if (canonical.exists) records.set(canonical.id, canonical.data()!);
      }
      if (!records.size) return null;
      if (records.size !== 1) throw new IdentityConflictError();
      const record = [...records.values()][0];
      if (record.provider !== provider || record.providerAccountId !== providerAccountId ||
          (provider === "google" && (record.type !== "oauth" || record.userId !== providerAccountId))) {
        throw new IdentityConflictError();
      }
      const snap = await tx.get(userRef(record.userId));
      if (!snap.exists) throw new IdentityConflictError();
      return adapterUser(snap.id, snap.data()!);
    });
  }

  // JWT sessions remain configured; also guard this adapter User-returning path.
  async function getSessionAndUser(sessionToken: string) {
    return firestore.runTransaction(async tx => {
      const matches = await tx.get(firestore.collection(AUTH_COLLECTIONS.sessions)
        .where("sessionToken", "==", sessionToken).limit(2));
      if (matches.empty) return null;
      if (matches.size !== 1) throw new IdentityConflictError();
      const record = matches.docs[0].data();
      const snap = await tx.get(userRef(record.userId));
      if (!snap.exists) throw new IdentityConflictError();
      const user = adapterUser(snap.id, snap.data()!);
      const expires = record.expires instanceof Timestamp ? record.expires.toDate() : record.expires;
      if (!(expires instanceof Date) || !Number.isFinite(expires.getTime())) throw new IdentityConflictError();
      return { session: { sessionToken, userId: user.id, expires }, user };
    });
  }

  async function getUserByEmail(email: string) {
    return firestore.runTransaction(async tx => {
      const resolved = await readEmailIdentity(firestore, tx, email);
      return resolved.owner ? adapterUser(resolved.owner.id, resolved.owner.data()!) : null;
    });
  }

  // Internal adapter method, NOT an initiation endpoint. Future email callbacks
  // may call this only after successful verification. No Email provider exists yet.
  async function createUser(input: Omit<AdapterUser, "id">) {
    const email = normalizeIdentityEmail(input.email);
    const newRef = users.doc(randomUUID()); // Stable across Firestore transaction retries.
    const initial = adapterUser(newRef.id, {
      email, name: input.name ?? null, image: input.image ?? null, emailVerified: input.emailVerified ?? null
    });
    return firestore.runTransaction(async tx => {
      const resolved = await readEmailIdentity(firestore, tx, email);
      if (resolved.owner) {
        const current = adapterUser(resolved.owner.id, resolved.owner.data()!);
        if (initial.emailVerified) {
          current.emailVerified = new Date(Math.max(initial.emailVerified.getTime(), current.emailVerified?.getTime() ?? 0));
          tx.update(resolved.owner.ref, { emailVerified: current.emailVerified });
        }
        if (!resolved.keyExists) tx.create(resolved.keyRef, identityKeyRecord(current.id));
        return current;
      }
      const { id: _id, ...record } = initial;
      void _id;
      tx.create(newRef, record);
      tx.create(resolved.keyRef, identityKeyRecord(newRef.id));
      return initial;
    });
  }

  async function updateUser(input: Partial<AdapterUser> & Pick<AdapterUser, "id">) {
    if (!input.id || input.id.includes("/")) throw new IdentityConflictError();
    return firestore.runTransaction(async tx => {
      const snap = await tx.get(users.doc(input.id));
      if (!snap.exists) throw new IdentityConflictError();
      const current = adapterUser(snap.id, snap.data()!);
      const email = input.email === undefined ? current.email : assertEstablishedEmail(current.email, input.email);
      const resolved = await readEmailIdentity(firestore, tx, email);
      if (resolved.owner?.id !== snap.id) throw new IdentityConflictError();
      const changes = Object.fromEntries(Object.entries(input).filter(([key, value]) =>
        ["email", "emailVerified", "name", "image"].includes(key) && value !== undefined));
      delete changes.email; // Preserve equivalent stored representation; return canonical email.
      const next = adapterUser(snap.id, { ...snap.data(), ...changes });
      if (current.emailVerified && (!next.emailVerified || next.emailVerified < current.emailVerified)) {
        next.emailVerified = current.emailVerified;
        changes.emailVerified = current.emailVerified;
      }
      if (Object.keys(changes).length) tx.update(snap.ref, changes);
      if (!resolved.keyExists) tx.create(resolved.keyRef, identityKeyRecord(snap.id));
      return next;
    });
  }

  async function ensureGoogleIdentity(account: Account | null, profile: Profile | undefined) {
    const identity = parseAuthoritativeGoogleIdentity(account, profile);
    const userRef = users.doc(identity.subject);
    const accounts = firestore.collection(AUTH_COLLECTIONS.accounts);
    const canonicalAccountRef = accounts.doc(googleAccountDocumentId(identity.providerAccountId));
    return firestore.runTransaction(async tx => {
      // Match createUser's lock order: shared email key before user/account documents.
      const resolved = await readEmailIdentity(firestore, tx, identity.email);
      const userSnap = await tx.get(userRef);
      if (userSnap.exists) assertEstablishedEmail(adapterUser(userSnap.id, userSnap.data()!).email, identity.email);
      const canonicalAccountSnap = await tx.get(canonicalAccountRef);
      const accountSnaps = await tx.get(accounts.where("provider", "==", "google")
        .where("providerAccountId", "==", identity.providerAccountId).limit(2));
      if (accountSnaps.size > 1) throw new IdentityConflictError();
      const accountRecords = new Map(accountSnaps.docs.map(doc => [doc.id, doc.data()]));
      if (canonicalAccountSnap.exists) accountRecords.set(canonicalAccountSnap.id, canonicalAccountSnap.data()!);
      for (const record of accountRecords.values()) {
        if (record.userId !== identity.subject || record.provider !== "google" || record.type !== "oauth" ||
            record.providerAccountId !== identity.subject || !userSnap.exists) throw new IdentityConflictError();
      }
      const plan = planGoogleIdentityBootstrap(identity, {
        userExists: userSnap.exists,
        canonicalAccountOwnerId: canonicalAccountSnap.data()?.userId,
        accountOwnerIds: [...accountRecords.values()].map(record => record.userId),
        emailOwnerIds: resolved.owner ? [resolved.owner.id] : []
      });
      // All reads complete. Existing Google subjects and established emails stay put.
      tx.set(userRef, {
        name: identity.name ?? null,
        email: userSnap.exists ? userSnap.data()!.email : identity.email,
        emailVerified: userSnap.data()?.emailVerified ?? null,
        image: identity.image ?? null
      }, { merge: true });
      if (plan.createAccount) tx.create(canonicalAccountRef, googleAccountRecord(identity));
      if (!resolved.keyExists) tx.create(resolved.keyRef, identityKeyRecord(identity.subject));
      return plan;
    });
  }

  // Deliberate migration helper. Dry-run by default; never changes users/accounts/orders.
  async function seedIdentityKey(userId: string, dryRun = true) {
    if (!userId || userId.includes("/")) throw new IdentityConflictError();
    return firestore.runTransaction(async tx => {
      const snap = await tx.get(users.doc(userId));
      if (!snap.exists) throw new IdentityConflictError();
      const resolved = await readEmailIdentity(firestore, tx, adapterUser(snap.id, snap.data()!).email);
      if (resolved.owner?.id !== userId) throw new IdentityConflictError();
      if (!resolved.keyExists && !dryRun) tx.create(resolved.keyRef, identityKeyRecord(userId));
      return resolved.keyExists ? "already_seeded" : dryRun ? "would_create" : "created";
    });
  }

  return {
    authAdapter: { ...baseAdapter, ...createVerificationTokenStore(firestore), getUser, getUserByAccount, getSessionAndUser, getUserByEmail, createUser, updateUser } satisfies Adapter,
    ensurePersistentGoogleIdentity: ensureGoogleIdentity,
    seedIdentityKey
  };
}
