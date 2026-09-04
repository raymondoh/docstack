import { createHash } from "node:crypto";

export type IdentityErrorCode = "INVALID_EMAIL" | "IDENTITY_CONFLICT" | "EMAIL_CHANGE_REQUIRED" | "LINKING_REQUIRED";

// Messages deliberately contain no customer addresses or persistent user IDs.
export class IdentityConflictError extends Error {
  constructor(public readonly code: IdentityErrorCode = "IDENTITY_CONFLICT") {
    super({
      INVALID_EMAIL: "Invalid email address.",
      IDENTITY_CONFLICT: "Identity records require manual review.",
      EMAIL_CHANGE_REQUIRED: "An explicit verified email-change workflow is required.",
      LINKING_REQUIRED: "Explicit account linking is required."
    }[code]);
    this.name = "IdentityConflictError";
  }
}

export function normalizeIdentityEmail(input: unknown): string {
  if (typeof input !== "string" || input.length > 320 || /[\u0000-\u001f\u007f-\u009f]/u.test(input)) {
    throw new IdentityConflictError("INVALID_EMAIL");
  }
  // Preserve NextAuth 4.24.15's security ordering: canonicalize BEFORE validating.
  const email = input.normalize("NFKC").trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9.-]+$/u.test(email)) {
    throw new IdentityConflictError("INVALID_EMAIL");
  }
  const [local, domain] = email.split("@");
  const labels = domain.split(".");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
    throw new IdentityConflictError("INVALID_EMAIL");
  }
  return email;
}

export function emailIdentityKeyId(email: unknown): string {
  return "email-v1_" + createHash("sha256")
    .update("docstack:identity-email:v1\0" + normalizeIdentityEmail(email)).digest("hex");
}

export function assertEstablishedEmail(existing: unknown, proposed: unknown): string {
  const email = normalizeIdentityEmail(proposed);
  if (normalizeIdentityEmail(existing) !== email) throw new IdentityConflictError("EMAIL_CHANGE_REQUIRED");
  return email;
}
