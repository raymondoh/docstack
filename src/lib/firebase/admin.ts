import * as admin from "firebase-admin";
import { getApps } from "firebase-admin/app";
import { env } from "@/lib/env";

/**
 * Standardizes the private key format to handle
 * escaped newlines common in environment variables.
 */
const formatPrivateKey = (key: string) => key.replace(/\\n/g, "\n");

type FirebaseServiceAccountPayload = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

function requireServerString(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`[firebase-admin] Missing required Firebase Admin env var: ${name}`);
  }
  return normalized;
}

function parseServiceAccountJson(rawJson: string | undefined) {
  if (!rawJson?.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawJson) as FirebaseServiceAccountPayload;

    return {
      projectId: requireServerString(parsed.project_id, "FIREBASE_SERVICE_ACCOUNT_JSON.project_id"),
      clientEmail: requireServerString(parsed.client_email, "FIREBASE_SERVICE_ACCOUNT_JSON.client_email"),
      privateKey: formatPrivateKey(requireServerString(parsed.private_key, "FIREBASE_SERVICE_ACCOUNT_JSON.private_key"))
    };
  } catch (error: unknown) {
    throw new Error(
      `[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON: ${(error as Error)?.message ?? String(error)}`
    );
  }
}

function getFirebaseAdminCredentials() {
  const serviceAccount = parseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (serviceAccount) {
    return serviceAccount;
  }

  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.trim();

  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey: formatPrivateKey(privateKey)
    };
  }

  throw new Error(
    "[firebase-admin] Missing Firebase Admin credentials. Provide FIREBASE_SERVICE_ACCOUNT_JSON, or fallback FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY."
  );
}

export function getFirebaseAdmin() {
  const currentApps = getApps();

  if (currentApps.length > 0) {
    return currentApps[0];
  }

  const credentials = getFirebaseAdminCredentials();

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey
    }),
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  });
}

/**
 * Exported helpers for common Admin services
 */
export const adminDb = admin.firestore(getFirebaseAdmin());
export const adminAuth = admin.auth(getFirebaseAdmin());
export const adminStorage = admin.storage(getFirebaseAdmin());
