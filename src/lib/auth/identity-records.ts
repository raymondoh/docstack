import { FieldPath, Timestamp, type DocumentSnapshot, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { AdapterUser } from "next-auth/adapters";
import { AUTH_COLLECTIONS, AUTH_IDENTITY_KEYS } from "./collections";
import { emailIdentityKeyId, IdentityConflictError, normalizeIdentityEmail } from "./identity-email";

export function validIdentityKey(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return !!data && data.kind === "email" && data.normalizationVersion === 1 &&
    typeof data.userId === "string" && data.userId.length > 0 && !data.userId.includes("/") &&
    data.createdAt instanceof Timestamp &&
    Object.keys(data).every(key => ["kind", "normalizationVersion", "userId", "createdAt"].includes(key));
}

export function identityKeyRecord(userId: string) {
  return { kind: "email", normalizationVersion: 1, userId, createdAt: Timestamp.now() };
}

export function hasConflictingStoredUserId(id: string, data: FirebaseFirestore.DocumentData): boolean {
  return Object.prototype.hasOwnProperty.call(data, "id") && data.id !== id;
}

export function adapterUser(id: string, data: FirebaseFirestore.DocumentData): AdapterUser {
  if (hasConflictingStoredUserId(id, data)) throw new IdentityConflictError();
  const email = normalizeIdentityEmail(data.email);
  const emailVerified = data.emailVerified instanceof Timestamp ? data.emailVerified.toDate() : data.emailVerified;
  if ((emailVerified !== null && emailVerified !== undefined &&
      (!(emailVerified instanceof Date) || !Number.isFinite(emailVerified.getTime()))) ||
      [data.name, data.image].some(value => value != null && typeof value !== "string")) {
    throw new IdentityConflictError();
  }
  return { ...data, id, email, emailVerified: emailVerified ?? null, name: data.name ?? null, image: data.image ?? null };
}

/**
 * Legacy users have no canonical-email field. Exact equality queries alone miss
 * case/NFKC duplicates. Until a separately reviewed indexed migration exists,
 * use paginated transactional reads to check ALL normalized matches, even when
 * a key exists. This favors correctness for this small store over login scale.
 * No users are changed or keys reserved by this resolver.
 */
export async function readEmailIdentity(db: Firestore, tx: Transaction, input: unknown) {
  const email = normalizeIdentityEmail(input);
  const keyRef = db.collection(AUTH_IDENTITY_KEYS).doc(emailIdentityKeyId(email));
  const keySnap = await tx.get(keyRef);
  let keyedUser: DocumentSnapshot | undefined;
  if (keySnap.exists) {
    if (!validIdentityKey(keySnap.data())) throw new IdentityConflictError();
    keyedUser = await tx.get(db.collection(AUTH_COLLECTIONS.users).doc(keySnap.data()!.userId));
    if (!keyedUser.exists || adapterUser(keyedUser.id, keyedUser.data()!).email !== email) throw new IdentityConflictError();
  }

  const matches: DocumentSnapshot[] = [];
  let cursor: DocumentSnapshot | undefined;
  while (true) {
    let query = db.collection(AUTH_COLLECTIONS.users).orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await tx.get(query);
    for (const doc of page.docs) {
      let candidate: string;
      try { candidate = normalizeIdentityEmail(doc.data().email); }
      catch { continue; } // Invalid unrelated users are reported by inventory, never adopted.
      if (candidate === email) matches.push(doc);
      if (matches.length > 1) throw new IdentityConflictError();
    }
    if (page.size < 500) break;
    cursor = page.docs[page.docs.length - 1];
  }
  const owner = matches[0];
  if (keyedUser && owner?.id !== keyedUser.id) throw new IdentityConflictError();
  if (owner) adapterUser(owner.id, owner.data()!);
  return { email, keyRef, keyExists: keySnap.exists, owner };
}
