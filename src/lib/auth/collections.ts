export const AUTH_COLLECTIONS = {
  users: "users",
  accounts: "accounts",
  sessions: "sessions",
  verificationTokens: "verificationTokens"
} as const;

// Uniqueness index only; not another adapter user collection. Never TTL-delete.
export const AUTH_IDENTITY_KEYS = "authIdentityKeys";
