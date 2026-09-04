import { createHash } from "node:crypto";
import type { Account, Profile } from "next-auth";
import { IdentityConflictError, normalizeIdentityEmail } from "./identity-email";
export { normalizeIdentityEmail } from "./identity-email";

type GoogleProfile = Profile & {
  sub?: string;
  email_verified?: boolean;
  picture?: string;
};

export type GoogleIdentityInput = {
  provider: "google";
  providerAccountId: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  image?: string | null;
};

export type GoogleBootstrapState = {
  userExists: boolean;
  accountOwnerIds: string[];
  canonicalAccountOwnerId?: string;
  emailOwnerIds: string[];
};

export type GoogleIdentityPlan = {
  userId: string;
  createUser: boolean;
  createAccount: boolean;
};

export function googleAccountRecord(identity: GoogleIdentityInput) {
  return {
    userId: identity.subject,
    type: "oauth" as const,
    provider: identity.provider,
    providerAccountId: identity.providerAccountId
  };
}

export function googleAccountDocumentId(providerAccountId: string) {
  return createHash("sha256").update(`google\0${providerAccountId}`).digest("hex");
}

export function parseAuthoritativeGoogleIdentity(
  account: Account | null,
  profile: Profile | undefined
): GoogleIdentityInput {
  if (account?.provider !== "google" || account.type !== "oauth") {
    throw new Error("Not a Google OAuth identity.");
  }

  const googleProfile = profile as GoogleProfile | undefined;
  const subject = googleProfile?.sub;
  const email = googleProfile?.email;

  if (typeof subject !== "string" || !subject || subject.includes("/") || subject !== account.providerAccountId) {
    throw new Error("Google subject did not match the OAuth account identifier.");
  }
  if (!email || googleProfile.email_verified !== true) {
    throw new Error("Google did not provide an authoritative verified email.");
  }

  return {
    provider: "google",
    providerAccountId: account.providerAccountId,
    subject,
    email: normalizeIdentityEmail(email),
    emailVerified: true,
    name: googleProfile.name,
    image: googleProfile.picture
  };
}

export function planGoogleIdentityBootstrap(
  identity: GoogleIdentityInput,
  state: GoogleBootstrapState
): GoogleIdentityPlan {
  if (identity.subject !== identity.providerAccountId) {
    throw new Error("Google subject and provider account identifier must match.");
  }

  const conflictingAccountOwner = state.accountOwnerIds.find(ownerId => ownerId !== identity.subject);
  if (conflictingAccountOwner || (state.canonicalAccountOwnerId && state.canonicalAccountOwnerId !== identity.subject)) {
    throw new IdentityConflictError();
  }

  const conflictingEmailOwner = state.emailOwnerIds.find(ownerId => ownerId !== identity.subject);
  if (conflictingEmailOwner) {
    throw new IdentityConflictError("LINKING_REQUIRED");
  }

  return {
    userId: identity.subject,
    createUser: !state.userExists,
    createAccount: state.accountOwnerIds.length === 0 && !state.canonicalAccountOwnerId
  };
}
