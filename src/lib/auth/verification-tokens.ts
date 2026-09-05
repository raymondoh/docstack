import { createHash } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { VerificationToken } from "next-auth/adapters";
import { AUTH_COLLECTIONS } from "./collections";
import { normalizeIdentityEmail } from "./identity-email";

export class VerificationTokenIntegrityError extends Error {
  constructor() {
    super("Verification token state is invalid or conflicts with an existing record.");
    this.name = "VerificationTokenIntegrityError";
  }
}

function canonicalIdentifier(input: unknown): string {
  try { return normalizeIdentityEmail(input); }
  catch { throw new VerificationTokenIntegrityError(); }
}

function validateToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || !token.trim() || token.length > 1024 || /[\u0000-\u001f\u007f]/u.test(token)) {
    throw new VerificationTokenIntegrityError();
  }
}

export function verificationTokenDocumentId(identifier: unknown, token: unknown): string {
  const canonical = canonicalIdentifier(identifier);
  validateToken(token);
  return "verification-v1_" + createHash("sha256")
    .update("docstack:verification-token:v1\0" + canonical + "\0" + token).digest("hex");
}

export function verificationTokenRecord(data: Record<string, unknown>): VerificationToken {
  if (Object.keys(data).length !== 3 || !Object.keys(data).every(key => ["identifier", "token", "expires"].includes(key))) {
    throw new VerificationTokenIntegrityError();
  }
  const identifier = canonicalIdentifier(data.identifier);
  if (data.identifier !== identifier) throw new VerificationTokenIntegrityError();
  validateToken(data.token);
  const expires = data.expires instanceof Timestamp ? data.expires.toDate() : data.expires;
  if (!(expires instanceof Date) || !Number.isFinite(expires.getTime())) throw new VerificationTokenIntegrityError();
  try { Timestamp.fromDate(expires); } catch { throw new VerificationTokenIntegrityError(); }
  return { identifier, token: data.token, expires: new Date(expires.getTime()) };
}

export function createVerificationTokenStore(db: Firestore) {
  const collection = db.collection(AUTH_COLLECTIONS.verificationTokens);

  async function createVerificationToken(input: VerificationToken): Promise<VerificationToken> {
    console.info("AUTH_EMAIL_TOKEN_CREATE_STARTED");
    try {
      const record = verificationTokenRecord({ ...input, identifier: canonicalIdentifier(input.identifier) });
      console.info("AUTH_EMAIL_TOKEN_RECORD_VALID");
      const ref = collection.doc(verificationTokenDocumentId(record.identifier, record.token));
      console.info("AUTH_EMAIL_TOKEN_TRANSACTION_STARTED");
      const created = await db.runTransaction(async tx => {
        const existing = await tx.get(ref);
        // Even identical duplicate creation fails closed; never extend/overwrite a link.
        if (existing.exists) throw new VerificationTokenIntegrityError();
        tx.create(ref, { ...record, expires: Timestamp.fromDate(record.expires) });
        return record;
      });
      console.info("AUTH_EMAIL_TOKEN_CREATE_SUCCEEDED");
      return created;
    } catch (error) {
      console.info("AUTH_EMAIL_TOKEN_CREATE_FAILED");
      throw error;
    }
  }

  async function useVerificationToken(input: { identifier: string; token: string }): Promise<VerificationToken | null> {
    const identifier = canonicalIdentifier(input.identifier);
    const ref = collection.doc(verificationTokenDocumentId(identifier, input.token));
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const record = verificationTokenRecord(snap.data()!);
      if (record.identifier !== identifier || record.token !== input.token ||
          verificationTokenDocumentId(record.identifier, record.token) !== snap.id) throw new VerificationTokenIntegrityError();
      // Keep malformed records for investigation. Expiry is enforced by NextAuth
      // after consumption, never by asynchronous Firestore TTL cleanup.
      tx.delete(ref);
      return record;
    });
  }

  return { createVerificationToken, useVerificationToken };
}
