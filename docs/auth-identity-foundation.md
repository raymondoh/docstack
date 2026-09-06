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

## Phase 2A.2b: atomic verification tokens (Email remains disabled)

The guarded adapter overrides both token methods. `verificationTokens/verification-v1_<digest>` uses SHA-256 of `docstack:verification-token:v1\0` + canonical identifier + `\0` + the already-hashed NextAuth token (separators are NUL bytes). The record contains only canonical `identifier`, NextAuth-hashed `token`, and Firestore Timestamp `expires`. This second hash is only a storage locator; no raw emailed token or new secret is stored.

Creation uses an exact-document transaction and rejects all duplicate creation, including identical duplicates, without changing expiry. Different tokens for one email coexist. Consumption reads, validates and deletes the exact document in one Firestore transaction; concurrent consumers yield at most one token, with subsequent consumers receiving null. No query/legacy fallback exists. Corrupt records throw a non-sensitive integrity error and remain untouched for investigation; they never authenticate.

Installed NextAuth **4.24.15** source was inspected: `node_modules/next-auth/core/lib/email/signin.js` generates the raw token (default `randomBytes(32).toString("hex")`), sends it in the email URL, and passes `{ identifier, token: hashToken(raw, options), expires: Date }` to `createVerificationToken`. `core/lib/utils.js` hashes SHA-256 of the raw token concatenated with `provider.secret ?? options.secret`. `core/routes/callback.js` hashes the URL token the same way before `useVerificationToken({ identifier, token })`. It rejects a null result, an expiry earlier than `Date.now()`, or an identifier mismatch before loading/authenticating a User. Missing URL tokens take the configuration-error path. The adapter returns a Date and deliberately consumes expired tokens once for NextAuth to reject. TTL is never an authentication check.

The installed callback compares the returned identifier to the URL email literally. Canonical forms resolve identically in storage, but a manually changed/noncanonical callback email can still be rejected by NextAuth after consumption. A future Email provider must use the same canonical normalizer at initiation so generated links carry canonical identifiers; do not weaken callback validation.

The supplied production inventory for this phase reports zero verification tokens and email auth has never been enabled, so no token migration or legacy-format support is needed. This pass does not access production. Google remains the only provider: no Email provider, email UI, auth email delivery, or token endpoint is enabled here.

Later Firebase Console setup: Firestore Database → Time-to-live policies → Create policy; collection group **verificationTokens**, timestamp field **expires**, enable TTL. Verify server-only Firestore Rules before rollout. TTL asynchronously cleans unused expired links; NextAuth still enforces expiry immediately. Do not make this production change as part of this code pass. **Never enable TTL on authIdentityKeys.** No new collection, composite index, dependency or environment secret is required.

## Phase 2A.2c: gated Resend infrastructure and request throttling

Configuration invariant: **`AUTH_EMAIL_ENABLED=true` requires `AUTH_RATE_LIMIT_SECRET` of at least 32 characters.** The shared settings schema is validated during server environment initialization, before serving auth requests, including when general environment validation is skipped. Missing/empty/short secrets reject enabled configuration; omitted/empty flags default false, and malformed flags reject. Disabled email permits an absent/empty secret, but a supplied short secret is rejected consistently. Runtime limiter checks remain as defense in depth.

Only the canonical `/api/auth/signin/email` initiation shape proceeds. The route rejects extra email sign-in path segments (such as `/api/auth/signin/email/extra`) with an empty 404 before invoking NextAuth or any identity lookup. Legitimate Google, callback, CSRF, providers, session, signout and error routes are unchanged. Tests directly exercise this parsing helper and the same guard plus scoped options with the real NextAuth core; they do not execute the exported App Router handler or its Next.js request-context machinery. A full HTTP harness is deliberately deferred. Additional emulator tests cover simultaneous IP-19/global-99 admissions with deterministic clocks. Injected admission failure and corrupt Firestore state cover fail-closed behavior; no actual transport outage is simulated.

**Production remains disabled until Phase 2A.2d.** `AUTH_EMAIL_ENABLED` accepts only `true` or `false`, defaults to `false`, and omits the Email provider entirely when false. Direct `/api/auth/signin/email` calls then cannot initiate email login. No email form, custom check-email/error page or account-linking UI is added. Google OAuth, `select_account`, JWT sessions and all purchase/ownership paths are unchanged. Do not enable the flag on production in this phase.

The local provider matches installed NextAuth 4.24.15 `EmailConfig`: `id/type: email`, `name: Email`, `from: EMAIL_FROM`, `maxAge: 900`, shared `normalizeIdentityEmail`, custom `sendVerificationRequest`, and inert `server: {}` / `options: {}` compatibility fields. The SMTP provider is never imported at runtime; no Nodemailer/SMTP credentials are installed. Existing `RESEND_API_KEY` and `EMAIL_FROM` are reused. The dedicated React sign-in email includes only branding, one sign-in CTA, the 15-minute expiry and ignore-if-unrequested notice, plus plain text.

Installed source verification: `core/routes/signin.js` normalizes the identifier, calls `getUserFromEmail` (which ordinarily queries the adapter), then calls `signIn` with `email.verificationRequest: true`. `core/index.js` first checks CSRF. Only after `signIn` allows initiation does `core/lib/email/signin.js` generate the raw token and invoke token persistence and `sendVerificationRequest` in parallel. Sender arguments are `{ identifier, token, url, expires, provider, theme }`; the URL is generated by NextAuth and includes its validated callback destination. No generation/hash/callback/session scheme is replaced here.

The App Router handler creates fresh per-request options without modifying shared `authOptions`. For POST `signin/email` only, its adapter returns the normal unknown-user result from `getUserByEmail` instead of querying identity/account/order data. This avoids pre-verification enumeration and database work. It cannot create Users during initiation. The request-local `signIn` callback, after NextAuth CSRF validation, enforces all limits before token creation or email sending. Other routes, including verified email callbacks, use the complete guarded adapter. The base callback refuses unguarded verification requests. A verified same-email Google purchase owner continues to resolve to the existing Google-sub User; new verified email users use the existing guarded `createUser`. Later Google linking remains refused; dangerous automatic linking stays disabled.

Limits are centralized in `EMAIL_LIMIT_POLICY`: at most 1/email/minute, 5/email/hour, 20/IP/hour and 100/global/hour. These are rolling windows, not reset-on-the-clock buckets. A single Firestore transaction reads all three exact documents, checks bounded timestamp logs and updates them together. Aborted retries cannot double-count a committed admission. Rejected requests do not write counters. Send failures still consume an admission (conservative anti-abuse behavior). The global document intentionally serializes admission at this small store's volume. This limits sends, not total HTTP/Firestore read traffic; platform-level abuse controls remain a future operational option.

`authRateLimits` is server-only and stores only `requests` (bounded to 5/20/100 epoch timestamps), `updatedAt` and `cleanupAt`. Email document IDs use domain-separated SHA-256; IP IDs use domain-separated HMAC-SHA-256. Provision a **new independent `AUTH_RATE_LIMIT_SECRET` of at least 32 random characters** before local/staging enablement. Reusing `NEXTAUTH_SECRET` would couple session/token rotation to throttle privacy and state, so it is not reused. Keep this secret stable across instances/deployments. To rotate it safely, disable email, drain old writers, wait at least one complete hour, then rotate and re-enable deliberately; otherwise new IP hashes reset IP buckets. Missing secret, corrupt records, missing trusted IP or unavailable Firestore all fail closed for email without invoking the limiter on Google requests.

IP trust: only when server environment `VERCEL=1`, read the platform-controlled `x-vercel-forwarded-for`, require exactly one valid IPv4/IPv6 address, and canonicalize IPv6 spelling. Do not fall back to client-controlled forwarding chains, `x-real-ip`, or Cloudflare headers. See [Vercel request-header documentation](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for): Vercel overwrites forwarding information to prevent spoofing; the Vercel-specific header avoids an overlaid proxy's `x-forwarded-for`. Deployment must route through Vercel's trusted ingress. Behind another proxy its observed address may be shared (conservative throttling). Non-Vercel production fails closed until a separately reviewed trusted-IP integration exists. Local development/test ignores supplied proxy headers and shares a loopback bucket, so `npm run dev` works without trusting spoofable headers.

Enumeration policy: all valid identifiers take the same initiation path, with no account/purchase lookup. Throttled or unavailable initiations return the same fixed, internal NextAuth verify-request destination as allowed requests but create no token and send nothing. Invalid input, CSRF errors and delivery errors may fail distinctly, but not based on account existence. No arbitrary redirect is accepted by this guard; verified callback redirects remain NextAuth-controlled. Missing/failed limiter state emits only a constant operational code. NextAuth logger metadata is discarded because adapter error arguments can include identifiers/tokens; logs contain constant operational codes only.

Resend 6.9.4 supports `emails.send(payload, { idempotencyKey })`. The key is `auth-signin-v1_` plus a domain-separated hash of the generated link, so retries of the same link share a bounded key while new requests do not. This is provider deduplication, **not exactly-once delivery**. Both returned `{ error }` results and thrown exceptions become one sanitized delivery failure; raw provider error bodies, email addresses, URLs and tokens are never logged by the sender. NextAuth performs persistence and sending concurrently: a failed send may leave an unused token until expiry/cleanup, and a persistence failure may leave an unusable emailed link. Neither creates a User or authenticates a session. No custom resend queue or retry scheme is introduced.

Deployment work (not performed in this phase): keep `AUTH_EMAIL_ENABLED=false` in production; provision the separate rate secret only in deliberately enabled environments; verify client reads/writes are denied on `authRateLimits`; later enable Firestore TTL on collection group `authRateLimits`, field **cleanupAt**. Cleanup is asynchronous and never used for enforcement. Retain future TTL on `verificationTokens.expires`; **NEVER TTL authIdentityKeys**. No composite index or new dependency is needed. No production inventory, migration, email send, environment change or TTL change is performed by automated tests.

Tests mock only delivery for the email integration flow and use the real guarded adapter, Firestore Emulator, request-local route option builder and installed NextAuth v4 core. Direct POST coverage includes CSRF rejection, enabled/disabled provider, a successful request, neutral throttling, no identity lookup/creation, and failed storage. This is a core/request-boundary integration test, not a running-server/browser E2E test. Emulator guards require loopback and a demo project. Existing Phase 2A.2a/2A.2b suites run unchanged alongside the new cases.

## Phase 2A.2d: customer login experience (deploy disabled)

The server login page renders email only when the Email provider is actually registered. Google remains first and keeps its account chooser. Both buttons receive the same restricted callback (`/dashboard` default; `/success` and `/checkout/cancel` with query strings). Existing sessions still redirect immediately. Email uses NextAuth's CSRF, normalization, throttle, verification and guarded adapter flow without any account/order lookup in the UI.

`/login/check-email` is static and neutral. Accepted, throttled and unavailable admissions all reach it through the shared NextAuth verify-request endpoint (the email client may navigate directly after the same neutral response). It neither echoes an address nor sends again. `/login/error` maps only allowlisted codes to static recovery messages; unknown input is never echoed. A genuine `LINKING_REQUIRED` Google bootstrap failure routes to safe recovery, never automatic linking. New email users receive opaque IDs; Google-backed email callbacks retain their Google subject. Guest orders remain unclaimed regardless of email equality.

Mandatory server-only collections: **users, accounts, sessions, verificationTokens, authIdentityKeys, authRateLimits, authLinkIntents**. Deny all browser/client access; do not loosen existing Firestore rules. TTL is cleanup only, not authentication, rate-limit, or linking-intent enforcement. Later policies: collection group `verificationTokens`, field `expires`; collection group `authRateLimits`, field `cleanupAt`; collection group `authLinkIntents`, field `expiresAt`. **authIdentityKeys → NEVER TTL.** None are configured by this phase.

## Phase 2A.3a: explicit Google-link foundation (no customer UI)

The canonical User never changes during explicit linking. Historical Google-first identities remain `users/{googleSub}` with `account.userId == account.providerAccountId` and require no marker or migration. An explicit Google link owned by an email-first User may have `account.userId != account.providerAccountId` only with all of this versioned metadata:

```text
linkMode: "explicit"
linkingVersion: 1
linkedAt: Firestore Timestamp
linkedEmailKeyId: deterministic authIdentityKeys document ID
```

The marker is valid only when the deterministic Google account document is unique, the referenced User exists, the referenced identity key exists and points to that User, and the key matches the User's canonical email. The account stores no additional plaintext email. Missing, malformed, duplicated, dangling or mismatched state fails closed. Existing marker-free Google-first records remain valid only when their User ID equals the authoritative Google subject.

Phase 2A.3a is persistence and validation foundation only. The server-only `linkGoogleIdentityToUser` primitive has no customer HTTP route or UI caller in this phase. A valid logged-in session proves identity, but does not itself prove linking consent. Ordinary Google callbacks always retain the existing authentication/bootstrap path; JWT presence, query parameters, callback destinations, client IDs and submitted email addresses are not linking authority.

When a future trusted caller invokes the primitive, the current User must already exist, have a valid persisted `emailVerified` value, own the canonical email identity key, and complete Google OAuth with the same canonical, verified email and matching `sub`/`providerAccountId`. The Google account must be unowned or already owned by that same User, and the User must not own a different Google account. Same-link retries are transactional and idempotent; concurrent attempts converge on the one deterministic mapping. No automatic same-email linking, dangerous provider linking, different-email linking, account replacement or unlinking is enabled.

Installed NextAuth 4.24.15 invokes the configured `signIn` callback before its callback handler. The existing Google `signIn` callback either validates/creates the deterministic Google-first mapping, resolves an already-valid explicit mapping, or fails with `LINKING_REQUIRED` before the handler can reach its generic `linkAccount` branch. With no Phase 2A.3a explicit-link route, current supported Google and Email flows therefore cannot use the base adapter to create an arbitrary unmarked cross-ID Google account. Later ordinary Google sign-in validates a directly test-created explicit marker and resolves the same opaque User ID. Users, identity keys, orders and guest ownership are never rewritten.

The read-only inventory counts valid `explicitGoogleLinks` separately. Cross-ID Google records are no longer reported as conflicts only when the complete explicit marker, deterministic account ID, User and identity-key ownership all validate. Historical Google-first accounts remain valid without marker fields. The updated inventory must be run before eventual deployment because the earlier production inventory did not validate deterministic Google account document IDs. No new collection, composite index, environment variable or TTL policy is introduced. All identity collections remain server-only.

Phase 2A.3a intentionally adds no Account Connections page, Link Google button, Settings UI, recovery screen, order migration or guest claiming. Phase 2A.3b must add a deliberate Link Google action, a server-controlled short-lived intent bound to the current session and OAuth journey, one-time/replay protection, and customer Account Connections UI while retaining the ordinary NextAuth Google flow's existing CSRF/state protections and account chooser.

## Phase 2A.3b1: dormant Google-link intent infrastructure

Phase 2A.3b1 adds no customer creator, Settings page, button, public start endpoint or client storage. Its server-only creation primitive is reserved for the separately reviewed Phase 2A.3b2 Account Connections UI. A valid logged-in session proves current identity but does not prove linking consent; email equality alone is never linking authority, and OAuth completion alone is never linking consent.

The future proof chain is: a valid current NextAuth browser session cookie with agreeing `sub`/`uid` claims → an explicit server-created one-time intent → an HMAC binding to that exact raw encrypted session cookie → a binding to the exact state generated by NextAuth for the following Google OAuth journey → NextAuth's independent state/PKCE validation → an authoritative verified Google callback → one Firestore transaction that links the account and consumes the intent.

`authLinkIntents/google-link-v1_<digest>` uses a domain-separated SHA-256 document ID derived from a random 32-byte browser token. Firestore stores no raw intent token, session JWT, OAuth state, email, Google subject or order data. The record contains only purpose/version, canonical User ID, non-reversible session/state bindings, and creation/expiry timestamps. The raw token exists only in an HttpOnly, SameSite=Lax cookie scoped to `/api/auth`, secure in production, with a centralized ten-minute lifetime.

Session authority comes only from the canonical NextAuth browser session cookie. Contiguous NextAuth cookie chunks are reconstructed in numeric order; Authorization Bearer tokens are never accepted as linking-session authority.

Initiation first validates the pending intent and exact current session. It then executes ordinary NextAuth Google initiation and transactionally binds the state extracted from NextAuth's returned authorization URL. The state binding supplements rather than replaces NextAuth's own state cookie/check. A second initiation cannot rebind an intent to another journey.

On the bound callback, request-local options invoke the explicit linker only after NextAuth has validated its own OAuth checks. Successful linking and intent deletion commit atomically. A completed wrong-account selection or ownership conflict consumes the intent without changing the User, identity key or orders. Missing, expired, replayed, wrong-session, malformed or wrong-state intents fail closed. Unexpected infrastructure failures do not link and may leave the record for expiry. Terminal callback responses clear only the dedicated link-intent cookie; ordinary Google and Email requests without it retain their exact existing behavior.

Future production cleanup may enable Firestore TTL for collection group **authLinkIntents**, field **expiresAt**. Application code enforces expiry synchronously; TTL is cleanup only. The collection remains blanket-denied to browser/client Firestore access. It uses exact-document reads and introduces no composite index, dependency, environment variable or new secret; bindings reuse `NEXTAUTH_SECRET` specifically as part of NextAuth session integrity.

Phase 2A.3b2 must be the only first customer-facing creator. It must add a deliberate Link Google action, create and set the intent through the authenticated server primitive, initiate the immediately following Google journey, and provide Account Connections UI with clear retry/recovery behavior. Session presence, query flags and callback URLs remain insufficient authority.

## Phase 2A.3b2: customer-activated Google connection

`/dashboard/settings` is the first customer-accessible activation boundary. The customer proof chain is: authenticated Settings page → deliberate **Connect Google** click → Server Action creates one-time intent → Server Action sets its dedicated HttpOnly cookie → the client starts ordinary NextAuth Google OAuth → the exact NextAuth-generated state is bound → NextAuth validates state and PKCE on callback → Firestore links the Google account and consumes the intent atomically → the original canonical User remains unchanged.

The Connect button is consent. A session by itself is not consent, the same email by itself is not authority, and query parameters are not proof. The Server Action passes only the incoming Cookie header to the existing canonical-session decoder, returns only `ready`, `already_connected` or `error`, and never serializes the intent token, User ID, provider identifiers or bindings. An authoritative Firestore read determines Connected/Not connected/unavailable; `?google=connected` produces a success notice only when that read independently confirms the mapping.

Historical Google-first Users and explicitly linked email-first Users both display **Connected**, regardless of the method used for the current session. Verified email-first Users without a mapping may connect only the Google account with the same authoritative verified email. Malformed or ambiguous identity state fails closed and hides the action. Expected wrong-account and ownership-conflict callbacks consume the one-time intent and return a fixed generic Settings error. No unlink, replacement or account migration is introduced.

Before activating Phase 2A.3b2 in production, enable Firestore TTL for collection group **authLinkIntents** on timestamp field **expiresAt**. Application checks remain authoritative and TTL is cleanup only. Never enable TTL on **authIdentityKeys**. The connection-state query uses the existing single-field `accounts.userId` index; this phase adds no composite index, environment variable, Firestore Rule change or provider configuration.

### Manual rollout after review, commit and disabled deployment

NextAuth v4 routes standard sign-in errors (including `OAuthAccountNotLinked`, `OAuthSignin`, `OAuthCallback` and `OAuthCreateAccount`) through `/api/auth/signin` to `/login?error=...`, rather than `pages.error`. The login card displays these through the same static allowlist used by `/login/error`, without echoing raw query values. Existing sessions redirect to the restricted callback before showing any stale notice. A regression follows both installed NextAuth core redirects and then exercises the login state/notice used by the page; no OAuth traffic is sent.

The existing callback policy is intentionally unchanged: direct relative `/success?...` and `/checkout/cancel` callbacks survive error rendering; absolute callbacks, including those expanded by NextAuth's default redirect callback, fall back to `/dashboard`. Preserving those absolute same-origin round trips would require a separately reviewed callback-policy change.

1. Verify the production identity inventory remains clean using the explicit read-only inventory safeguards.
2. Verify production `/api/auth/providers` contains Google only.
3. Generate a new independent `AUTH_RATE_LIMIT_SECRET` of at least 32 random characters.
4. Add it to Vercel as a server secret; never use a `NEXT_PUBLIC_` variable.
5. Configure the two TTL cleanup policies specified above.
6. Verify browser/client Firestore access is denied for all six collections listed above.
7. Set `AUTH_EMAIL_ENABLED=true` deliberately.
8. Redeploy.
9. Confirm `/api/auth/providers` contains Google and Email.
10. Confirm the login UI shows both methods.
11. Perform one real magic-link login with an existing Google-backed user.
12. Confirm the same historical purchase remains owned and available.
13. Optionally test a new email-only user.
14. Rerun the production inventory.
15. If unexpected identity conflicts appear, disable email immediately before investigation.

First-line rollback: **`AUTH_EMAIL_ENABLED=false` → redeploy**. This removes provider/UI while preserving Google login, Users, identity keys, existing JWT sessions and purchases. Do not delete identity or verification-token collections. Do not execute this runbook during the coding pass.

### Production inventory commands

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
