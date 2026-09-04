# Authentication identity foundation

DocStack continues to use direct Google OAuth through NextAuth v4 with JWT sessions. The Firestore adapter's `users` and `accounts` collections are the canonical persistent identity store; Firebase Authentication is not involved. The dormant Firebase popup component remains for later cleanup, but its Credentials provider is no longer registered with NextAuth and cannot issue a Firebase UID session.

On an authoritative Google OAuth callback, DocStack transactionally bootstraps `users/{googleSub}` and a Google account mapping whose `providerAccountId` and `userId` are both that same subject. This preserves existing authenticated `orders.userId` values. The bootstrap rejects conflicting account or verified-email ownership and is safe to repeat.

DocStack remains on NextAuth v4. The selected Firebase adapter's TypeScript type originates from the newer `@auth/core` family, so the application uses one documented compatibility cast after deliberately reviewing the runtime method contract and Firestore schema. The Firestore Emulator integration test exercises bootstrap, adapter lookup, concurrency, conflict rejection, and JWT/session identity to protect that bridge.

Phase 2A.2a introduces `authIdentityKeys` as a narrow server-only uniqueness index. Adapter `users` and `accounts` remain canonical. Google is still the only registered and visible provider; email authentication, account linking, and guest-order claiming are NOT enabled.

## Canonical email and identity keys

All identity email paths use `normalizeIdentityEmail`: bounded string input, Unicode NFKC before validation, surrounding-space trimming and lowercasing, followed by validation of one ordinary ASCII mailbox. Controls (including surrounding tabs/newlines), quoted/display-name mailboxes, recipient lists and ambiguous separators are rejected. Gmail dots and plus tags are preserved. Unicode forms that normalize to an ordinary mailbox are supported; remaining internationalized mailbox syntax is deliberately not accepted in this phase.

The deterministic key ID is `email-v1_` followed by SHA-256 of `docstack:identity-email:v1\0` plus the canonical email (the separator is a NUL byte). Each key contains only `kind: "email"`, `normalizationVersion: 1`, `userId`, and `createdAt` (Firestore Timestamp). No plaintext email, profile or order data is stored in keys. Hashes are not encryption; browser access must remain denied. No HMAC secret or new environment variable is needed. **Never configure TTL on identity keys.**

Google bootstrap and the guarded adapter `createUser`/`updateUser` methods claim keys in Firestore transactions. Every read precedes writes. Concurrent consistent callers resolve the same canonical owner. Google keeps `users/{googleSub}` and cannot attach an email-first user silently: that conflict produces `IdentityConflictError` with code `LINKING_REQUIRED`. Missing/malformed keys or ambiguous owners produce `IDENTITY_CONFLICT`. Messages contain no user IDs or addresses. Material established-email changes produce `EMAIL_CHANGE_REQUIRED`; equivalent case/space/NFKC forms do not move the key. Real email changes/linking need a future explicit verified workflow.

Adapter lookup is read-only and cannot reserve an address. Its controlled legacy fallback can return exactly one existing adapter user without a key. Since legacy `users.email` has no normalized-email index, resolution currently scans users in 500-document transaction pages to detect ALL normalization-equivalent duplicates, including when a key is present. This is intentionally conservative for the current small store: reads/cost and transaction contention grow with total user count. Pagination bounds fetched pages, not total transaction size. Review an indexed migration before growing this identity store substantially; do not optimize by selecting the first exact-email match.

Existing user IDs, Google account mappings, JWTs, order ownership and guest `userId: null` remain unchanged. `createUser` is an internal future adapter callback, not a public initiation endpoint; future email authentication must invoke it only after verification. Non-email profile updates remain possible, and verified callbacks may advance `emailVerified` without changing ownership. Ordinary updates cannot clear existing verification or move email ownership.

The stock verification-token methods remain untouched. Its non-atomic `useVerificationToken` must be replaced and tested in **Phase 2A.2b before registering an Email provider**. Do not interpret this foundation as safe magic-link authentication on its own.

## Production inventory

Before production deployment, run the read-only inventory deliberately with the exact Firebase project ID:

```sh
npm run auth:inventory -- \
  --project-id=docstack-b46f1 \
  --confirm=READ_ONLY_AUTH_INVENTORY
```

The npm script runs the standalone process in development mode and loads `.env.development.local` through Node's native `--env-file` support. The inventory still refuses to run without both explicit values, performs no writes, reads large application collections in bounded pages, and never selects order email fields. Review malformed identity diagnostics, checkout attempts without owned orders, adapter mapping duplicates, the representative Google lookup, and any existing data in `users`, `accounts`, `sessions`, `verificationTokens`, or `authIdentityKeys` before enabling the adapter. A legacy order ID must not be asserted to be a Google subject from an email match; identities without authoritative provider evidence must bootstrap on a fresh Google login or be handled manually.

The report now includes missing keys, missing referenced users, key/email inconsistency, malformed keys, duplicate canonical emails, Google-account/user conflicts and historical authenticated order owners without adapter users. Output identifiers are hashed and samples capped at 20; no customer emails are printed. Aggregate memory remains proportional to identity count. Paginated inventory reads are not a database-wide snapshot: run during quiet traffic and repeat before migration. An order owner without an adapter user requires authoritative Google bootstrap; never reconstruct identity from an order email.

## Deliberate seed/migration

Every adapter User read validates the raw Firestore document: an absent stored `id` or one equal to the document ID is valid; a conflicting stored `id` fails closed without repair. Account and identity-key references use that same validator, as do Google bootstrap and seed transactions. Inventory reports `conflictingStoredUserIds` with counts and opaque document hashes; this blocks both seed dry-run and apply preflight. No identity is recovered by matching an order email.

Nothing seeds on startup. Existing users may lazily acquire their own key on a verified Google login. To seed all existing canonical users, first inspect the read-only inventory and resolve duplicates/malformed records. Deploy only index-aware identity writers; do not mix old and new writers during migration or later enable email against old writers.

Dry-run (no writes):

```sh
npm run auth:seed-identity-keys -- \
  --project-id=docstack-b46f1 \
  --confirm=SEED_AUTH_IDENTITY_KEYS \
  --dry-run
```

Only after reviewing that output, an administrator may deliberately replace `--dry-run` with `--apply`. The command requires exactly one mode, the exact confirmed project and the distinct seed confirmation. It refuses preflight conflicts before writing. Every key is then revalidated and created in its own transaction; there is no collection-wide atomic commit. A later conflict can stop a partially completed run, but completed keys are safe and rerunning is idempotent. Users, accounts and orders are never deleted, recreated or rewritten by the seed command. No order-email matching occurs.

No composite index, package upgrade, Resend/Google Cloud change or new environment secret is required. Keep Firestore client access denied for the new key collection. Future email rollout must also resolve historical order owners missing canonical users before promising email access to their purchases.

## Firestore Emulator integration test

The integration suite does not use production credentials. It requires a local Java runtime because the Firestore Emulator is a Java process. It refuses non-loopback emulator hosts and non-`demo-` project IDs. Collection cleanup is emulator-only.

Automated emulator startup and test:

```sh
npm run test:auth:emulator
```

Against an emulator that is already running:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:auth:integration
```

Running `npm run test:auth:integration` without `FIRESTORE_EMULATOR_HOST` produces an explicit skipped-test message rather than attempting production Firestore.

## Mandatory Firestore Rules check

Firestore Rules are not managed in this repository. Before deployment, verify in the deployed Firebase project that browser/client reads and writes are denied for all documents in:

- `users`
- `accounts`
- `sessions`
- `verificationTokens`
- `authIdentityKeys` (no TTL)

These collections are server-only identity infrastructure. The Firebase Admin SDK and Firestore adapter bypass client rules and continue to operate server-side; do not grant client access to make the adapter work.
