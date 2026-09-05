import { randomUUID } from "node:crypto";
import { FirestoreAdapter } from "@auth/firebase-adapter";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Account, Profile } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { AUTH_COLLECTIONS } from "./collections";
import {
  explicitGoogleAccountRecord,
  googleAccountDocumentId,
  googleAccountOwnership,
  googleAccountRecord,
  parseAuthoritativeGoogleIdentity,
  planGoogleIdentityBootstrap,
  validPersistentUserId
} from "./google-identity";
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

  async function googleAccountEntries(tx: FirebaseFirestore.Transaction, providerAccountId: string) {
    const accounts = firestore.collection(AUTH_COLLECTIONS.accounts);
    const canonicalRef = accounts.doc(googleAccountDocumentId(providerAccountId));
    const [matches, canonical] = await Promise.all([
      tx.get(accounts.where("provider", "==", "google").where("providerAccountId", "==", providerAccountId).limit(2)),
      tx.get(canonicalRef)
    ]);
    if (matches.size > 1) throw new IdentityConflictError();
    const records = new Map<string, FirebaseFirestore.DocumentSnapshot>(
      matches.docs.map(doc => [doc.id, doc])
    );
    if (canonical.exists) records.set(canonical.id, canonical);
    if (records.size > 1) throw new IdentityConflictError();
    const entry = [...records.entries()][0];
    if (entry && entry[0] !== canonicalRef.id) throw new IdentityConflictError();
    return { canonicalRef, entry };
  }

  async function validateGoogleAccountOwner(tx: FirebaseFirestore.Transaction, providerAccountId: string,
    entry: [string, FirebaseFirestore.DocumentSnapshot] | undefined,
    resolvedEmail?: Awaited<ReturnType<typeof readEmailIdentity>>) {
    if (!entry) return null;
    const ownership = googleAccountOwnership(entry[1].data()!, providerAccountId);
    const ownerSnap = await tx.get(userRef(ownership.userId));
    if (!ownerSnap.exists) throw new IdentityConflictError();
    const owner = adapterUser(ownerSnap.id, ownerSnap.data()!);
    if (ownership.mode === "explicit") {
      if (!(owner.emailVerified instanceof Date)) throw new IdentityConflictError();
      const resolved = resolvedEmail ?? await readEmailIdentity(firestore, tx, owner.email);
      if (!resolved.keyExists || resolved.keyRef.id !== ownership.linkedEmailKeyId ||
          resolved.owner?.id !== ownership.userId) throw new IdentityConflictError();
    }
    return { ownership, owner, ownerSnap };
  }

  // Never use the stock User converter: a persisted id can override snapshot.id.
  async function getUser(id: string) {
    const snap = await userRef(id).get();
    return snap.exists ? adapterUser(snap.id, snap.data()!) : null;
  }

  async function getUserByAccount({ provider, providerAccountId }: { provider: string; providerAccountId: string }) {
    return firestore.runTransaction(async tx => {
      if (provider === "google") {
        const { entry } = await googleAccountEntries(tx, providerAccountId);
        const validated = await validateGoogleAccountOwner(tx, providerAccountId, entry);
        return validated?.owner ?? null;
      }
      const matches = await tx.get(firestore.collection(AUTH_COLLECTIONS.accounts)
        .where("provider", "==", provider).where("providerAccountId", "==", providerAccountId).limit(2));
      if (matches.empty) return null;
      if (matches.size !== 1) throw new IdentityConflictError();
      const record = matches.docs[0].data();
      if (record.provider !== provider || record.providerAccountId !== providerAccountId ||
          typeof record.userId !== "string" || !record.userId || record.userId.includes("/")) {
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
    const subjectRef = users.doc(identity.subject);
    return firestore.runTransaction(async tx => {
      // Match createUser's lock order: shared email key before user/account documents.
      const resolved = await readEmailIdentity(firestore, tx, identity.email);
      const subjectSnap = await tx.get(subjectRef);
      if (subjectSnap.exists) assertEstablishedEmail(adapterUser(subjectSnap.id, subjectSnap.data()!).email, identity.email);
      const { canonicalRef, entry } = await googleAccountEntries(tx, identity.providerAccountId);
      const validated = await validateGoogleAccountOwner(tx, identity.providerAccountId, entry, resolved);
      if (validated) {
        if (validated.ownership.mode === "explicit") {
          if (subjectSnap.exists || validated.ownership.linkedEmailKeyId !== resolved.keyRef.id ||
              resolved.owner?.id !== validated.owner.id) throw new IdentityConflictError();
          return { userId: validated.owner.id, createUser: false, createAccount: false };
        }
        if (validated.owner.id !== identity.subject || !subjectSnap.exists ||
            resolved.owner?.id !== identity.subject) throw new IdentityConflictError();
      }
      const plan = planGoogleIdentityBootstrap(identity, {
        userExists: subjectSnap.exists,
        canonicalAccountOwnerId: entry?.[1].data()?.userId,
        accountOwnerIds: entry ? [entry[1].data()!.userId] : [],
        emailOwnerIds: resolved.owner ? [resolved.owner.id] : []
      });
      // All reads complete. Existing Google subjects and established emails stay put.
      tx.set(subjectRef, {
        name: identity.name ?? null,
        email: subjectSnap.exists ? subjectSnap.data()!.email : identity.email,
        emailVerified: subjectSnap.data()?.emailVerified ?? null,
        image: identity.image ?? null
      }, { merge: true });
      if (plan.createAccount) tx.create(canonicalRef, googleAccountRecord(identity));
      if (!resolved.keyExists) tx.create(resolved.keyRef, identityKeyRecord(identity.subject));
      return plan;
    });
  }

  async function linkGoogleIdentity(currentUserId: string, account: Account | null, profile: Profile | undefined) {
    if (!validPersistentUserId(currentUserId)) throw new IdentityConflictError();
    const identity = parseAuthoritativeGoogleIdentity(account, profile);
    const linkedAt = Timestamp.now(); // Stable across transaction retries; never supplied by the client.
    return firestore.runTransaction(async tx => {
      const currentSnap = await tx.get(userRef(currentUserId));
      if (!currentSnap.exists) throw new IdentityConflictError();
      const currentUser = adapterUser(currentSnap.id, currentSnap.data()!);
      if (currentUserId !== identity.subject && !(currentUser.emailVerified instanceof Date)) {
        throw new IdentityConflictError();
      }
      assertEstablishedEmail(currentUser.email, identity.email);
      const resolved = await readEmailIdentity(firestore, tx, currentUser.email);
      const { canonicalRef, entry } = await googleAccountEntries(tx, identity.providerAccountId);
      const subjectSnap = currentUserId === identity.subject ? currentSnap : await tx.get(userRef(identity.subject));
      const ownedAccounts = await tx.get(firestore.collection(AUTH_COLLECTIONS.accounts)
        .where("userId", "==", currentUserId));
      const currentGoogleAccounts = ownedAccounts.docs.filter(doc => doc.data().provider === "google");
      const validated = await validateGoogleAccountOwner(tx, identity.providerAccountId, entry, resolved);

      if (!resolved.keyExists || resolved.owner?.id !== currentUserId) throw new IdentityConflictError();
      if (currentGoogleAccounts.some(doc => doc.data().providerAccountId !== identity.providerAccountId)) {
        throw new IdentityConflictError();
      }
      if (validated) {
        if (validated.owner.id !== currentUserId) throw new IdentityConflictError();
        if (validated.ownership.mode === "google_first" && currentUserId !== identity.subject) {
          throw new IdentityConflictError();
        }
        if (validated.ownership.mode === "explicit" &&
            validated.ownership.linkedEmailKeyId !== resolved.keyRef.id) throw new IdentityConflictError();
        return { userId: currentUserId, alreadyLinked: true };
      }
      if (subjectSnap.exists && subjectSnap.id !== currentUserId) throw new IdentityConflictError();
      // All reads complete. Users, identity keys and orders are deliberately immutable here.
      tx.create(canonicalRef, currentUserId === identity.subject
        ? googleAccountRecord(identity)
        : explicitGoogleAccountRecord(identity, currentUserId, resolved.keyRef.id, linkedAt));
      return { userId: currentUserId, alreadyLinked: false };
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
    linkGoogleIdentityToUser: linkGoogleIdentity,
    seedIdentityKey
  };
}
