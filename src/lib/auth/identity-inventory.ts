import { createHash } from "node:crypto";
import { FieldPath, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { AUTH_COLLECTIONS, AUTH_IDENTITY_KEYS } from "./collections";
import { emailIdentityKeyId } from "./identity-email";
import { adapterUser, hasConflictingStoredUserId, validIdentityKey } from "./identity-records";

export type Diagnostic = { count: number; samples: string[] };
export function opaqueId(value: string) {
  return createHash("sha256").update("docstack:inventory:v1\0" + value).digest("hex");
}

export async function scanIdentityCollection(db: Firestore, collection: string,
  visit: (doc: QueryDocumentSnapshot) => void | Promise<void>) {
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) await visit(doc);
    if (page.size < 500) return;
    cursor = page.docs[page.docs.length - 1];
  }
}

// Read-only. Keep normalized addresses only transiently; reports contain hashes/counts.
export async function inspectIdentityKeys(db: Firestore) {
  const diagnostics = {
    malformedUsers: { count: 0, samples: [] } as Diagnostic,
    conflictingStoredUserIds: { count: 0, samples: [] } as Diagnostic,
    usersMissingIdentityKeys: { count: 0, samples: [] } as Diagnostic,
    duplicateCanonicalUsers: { count: 0, samples: [] } as Diagnostic,
    malformedIdentityKeys: { count: 0, samples: [] } as Diagnostic,
    keysPointingToMissingUsers: { count: 0, samples: [] } as Diagnostic,
    inconsistentKeyEmails: { count: 0, samples: [] } as Diagnostic,
    googleAccountUserConflicts: { count: 0, samples: [] } as Diagnostic,
    duplicateProviderAccounts: { count: 0, samples: [] } as Diagnostic
  };
  const add = (kind: keyof typeof diagnostics, id: string) => {
    diagnostics[kind].count++;
    if (diagnostics[kind].samples.length < 20) diagnostics[kind].samples.push(opaqueId(id));
  };
  const userIds = new Set<string>();
  const userKeys = new Map<string, string>();
  const owners = new Map<string, string>();
  await scanIdentityCollection(db, AUTH_COLLECTIONS.users, doc => {
    userIds.add(doc.id);
    if (hasConflictingStoredUserId(doc.id, doc.data())) add("conflictingStoredUserIds", doc.id);
    try {
      const user = adapterUser(doc.id, doc.data());
      const keyId = emailIdentityKeyId(user.email);
      userKeys.set(doc.id, keyId);
      if (owners.has(keyId)) add("duplicateCanonicalUsers", keyId);
      else owners.set(keyId, doc.id);
    } catch { add("malformedUsers", doc.id); }
  });
  const keys = new Set<string>();
  await scanIdentityCollection(db, AUTH_IDENTITY_KEYS, doc => {
    keys.add(doc.id);
    const data = doc.data();
    if (!/^email-v1_[a-f0-9]{64}$/u.test(doc.id) || !validIdentityKey(data)) add("malformedIdentityKeys", doc.id);
    if (typeof data.userId !== "string" || !userIds.has(data.userId)) add("keysPointingToMissingUsers", doc.id);
    else if (userKeys.get(data.userId) !== doc.id) add("inconsistentKeyEmails", doc.id);
  });
  for (const [userId, keyId] of userKeys) {
    if (!keys.has(keyId)) add("usersMissingIdentityKeys", userId);
  }
  const providerKeys = new Set<string>();
  await scanIdentityCollection(db, AUTH_COLLECTIONS.accounts, doc => {
    const data = doc.data();
    if (data.provider === "google" && (data.type !== "oauth" || typeof data.providerAccountId !== "string" ||
        !data.providerAccountId || data.providerAccountId !== data.userId || !userIds.has(data.userId))) {
      add("googleAccountUserConflicts", doc.id);
    }
    if (typeof data.provider === "string" && typeof data.providerAccountId === "string") {
      const key = data.provider + "\0" + data.providerAccountId;
      if (providerKeys.has(key)) add("duplicateProviderAccounts", doc.id);
      providerKeys.add(key);
    }
  });
  return { diagnostics, userIds, keyCount: keys.size };
}
