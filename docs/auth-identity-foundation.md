# Authentication identity foundation

DocStack continues to use direct Google OAuth through NextAuth v4 with JWT sessions. The Firestore adapter's `users` and `accounts` collections are the canonical persistent identity store; Firebase Authentication is not involved. The dormant Firebase popup component remains for later cleanup, but its Credentials provider is no longer registered with NextAuth and cannot issue a Firebase UID session.

On an authoritative Google OAuth callback, DocStack transactionally bootstraps `users/{googleSub}` and a Google account mapping whose `providerAccountId` and `userId` are both that same subject. This preserves existing authenticated `orders.userId` values. The bootstrap rejects conflicting account or verified-email ownership and is safe to repeat.

DocStack remains on NextAuth v4. The selected Firebase adapter's TypeScript type originates from the newer `@auth/core` family, so the application uses one documented compatibility cast after deliberately reviewing the runtime method contract and Firestore schema. The Firestore Emulator integration test exercises bootstrap, adapter lookup, concurrency, conflict rejection, and JWT/session identity to protect that bridge.

The proposed `authIdentityKeys` uniqueness collection is deliberately deferred until passwordless email is introduced. Google-only bootstrap already uses deterministic user and account document IDs inside one transaction, so an additional identity index would add no correctness benefit in this phase. Adapter users and accounts remain canonical when that narrow concurrency index is added later.

## Production inventory

Before production deployment, run the read-only inventory deliberately with the exact Firebase project ID:

```sh
npm run auth:inventory -- --project-id=<exact-project-id> --confirm=READ_ONLY_AUTH_INVENTORY
```

The command refuses to run without both values, performs no writes, reads large application collections in bounded pages, and never selects order email fields. Review malformed identity diagnostics, checkout attempts without owned orders, adapter mapping duplicates, the representative Google lookup, and any existing data in `users`, `accounts`, `sessions`, `verificationTokens`, or `authIdentityKeys` before enabling the adapter. A legacy order ID must not be asserted to be a Google subject from an email match; identities without authoritative provider evidence must bootstrap on a fresh Google login or be handled manually.

## Firestore Emulator integration test

The integration suite does not use production credentials. It requires a local Java runtime because the Firestore Emulator is a Java process.

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
- future `authIdentityKeys`

These collections are server-only identity infrastructure. The Firebase Admin SDK and Firestore adapter bypass client rules and continue to operate server-side; do not grant client access to make the adapter work.
