import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { AUTH_COLLECTIONS } from "../src/lib/auth/collections";
import { inspectIdentityKeys, opaqueId } from "../src/lib/auth/identity-inventory";
import { GOOGLE_LINK_INTENTS } from "../src/lib/auth/google-link-intent";

const CONFIRMATION = "READ_ONLY_AUTH_INVENTORY";
const PAGE_SIZE = 500;
const SAMPLE_LIMIT = 20;
const APP_COLLECTIONS = ["checkoutAttempts", "orders", "products", "stripeWebhookEvents"] as const;
const AUTH_SUPPORT_COLLECTIONS = ["authIdentityKeys", GOOGLE_LINK_INTENTS] as const;

type OrderSummary = {
  count: number;
  statuses: Record<string, number>;
  firstCreatedAt?: number;
  lastCreatedAt?: number;
};

type SampleCollector = {
  count: number;
  documentIds: string[];
};

function argument(name: string) {
  const prefix = "--" + name + "=";
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return undefined;
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function addSample(collector: SampleCollector, documentId: string) {
  collector.count += 1;
  if (collector.documentIds.length < SAMPLE_LIMIT) collector.documentIds.push(opaqueId(documentId));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validNullableString(value: unknown) {
  return value === undefined || value === null || typeof value === "string";
}

function validEmailVerified(value: unknown) {
  return (
    value === null ||
    value instanceof Date ||
    (value !== undefined &&
      typeof value === "object" &&
      "toDate" in value &&
      typeof value.toDate === "function")
  );
}

async function collectionCount(adminDb: FirebaseFirestore.Firestore, name: string) {
  const result = await adminDb.collection(name).count().get();
  return result.data().count;
}

async function scanQuery(
  baseQuery: FirebaseFirestore.Query,
  documentIdField: FirebaseFirestore.FieldPath,
  visit: (document: FirebaseFirestore.QueryDocumentSnapshot) => void | Promise<void>
) {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let total = 0;

  while (true) {
    let pageQuery = baseQuery.orderBy(documentIdField).limit(PAGE_SIZE);
    if (cursor) pageQuery = pageQuery.startAfter(cursor);
    const page = await pageQuery.get();

    for (const document of page.docs) {
      await visit(document);
      total += 1;
    }

    if (page.size < PAGE_SIZE) return total;
    cursor = page.docs.at(-1);
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const expectedProjectId = argument("project-id");
  const confirmation = argument("confirm");

  if (confirmation !== CONFIRMATION || !expectedProjectId) {
    throw new Error(
      "Refusing to run. Supply --project-id=<exact-project-id> --confirm=" +
        CONFIRMATION +
        ". This command reads production-capable Firestore credentials."
    );
  }

  const [{ FieldPath }, { adminDb, getFirebaseAdmin }, { createFirestoreIdentityStore }] = await Promise.all([
    import("firebase-admin/firestore"),
    import("../src/lib/firebase/admin"),
    import("../src/lib/auth/firestore-identity-store")
  ]);
  const configuredProjectId = getFirebaseAdmin().options.projectId;
  if (!configuredProjectId || configuredProjectId !== expectedProjectId) {
    throw new Error("The confirmed project ID does not match the Firebase Admin project. No inventory was run.");
  }

  const documentIdField = FieldPath.documentId();
  const orderCountsByUserId: Record<string, OrderSummary> = {};
  const statusDistribution: Record<string, number> = {};
  const checkoutModeDistribution: Record<string, number> = {};
  const authenticatedOrderUserIds = new Set<string>();
  const malformedOrderUserIds: SampleCollector = { count: 0, documentIds: [] };
  let guestOrdersWithUserId = 0;
  let authenticatedOrdersWithoutUserId = 0;
  let legacyOrdersWithoutUserId = 0;

  const orderTotal = await scanQuery(
    adminDb.collection("orders").select("userId", "status", "checkoutMode", "createdAt"),
    documentIdField,
    document => {
      const data = document.data();
      const rawUserId = data.userId;
      const userId = nonEmptyString(rawUserId) ? rawUserId : null;
      const status = typeof data.status === "string" ? data.status : "missing";
      const checkoutMode = typeof data.checkoutMode === "string" ? data.checkoutMode : "legacy_missing";
      const createdAt = timestampMillis(data.createdAt);

      if (rawUserId !== undefined && rawUserId !== null && !nonEmptyString(rawUserId)) {
        addSample(malformedOrderUserIds, document.id);
      }
      increment(statusDistribution, status);
      increment(checkoutModeDistribution, checkoutMode);
      if (checkoutMode === "guest" && userId !== null) guestOrdersWithUserId += 1;
      if (checkoutMode === "authenticated" && userId === null) authenticatedOrdersWithoutUserId += 1;
      if (checkoutMode === "legacy_missing" && userId === null) legacyOrdersWithoutUserId += 1;
      if (userId && checkoutMode !== "guest") authenticatedOrderUserIds.add(userId);

      if (userId) {
        const summary = (orderCountsByUserId[opaqueId(userId)] ??= { count: 0, statuses: {} });
        summary.count += 1;
        increment(summary.statuses, status);
        if (createdAt !== undefined) {
          summary.firstCreatedAt = Math.min(summary.firstCreatedAt ?? createdAt, createdAt);
          summary.lastCreatedAt = Math.max(summary.lastCreatedAt ?? createdAt, createdAt);
        }
      }
    }
  );

  const authenticatedAttemptUserIds = new Set<string>();
  const attemptsWithoutOwnedOrders: SampleCollector = { count: 0, documentIds: [] };
  const malformedAttemptUserIds: SampleCollector = { count: 0, documentIds: [] };
  const attemptTotal = await scanQuery(
    adminDb.collection("checkoutAttempts").select("userId", "checkoutMode"),
    documentIdField,
    document => {
      const data = document.data();
      if (data.checkoutMode === "guest") return;
      if (!nonEmptyString(data.userId)) {
        if (data.userId !== undefined && data.userId !== null) addSample(malformedAttemptUserIds, document.id);
        return;
      }
      authenticatedAttemptUserIds.add(data.userId);
      if (!authenticatedOrderUserIds.has(data.userId)) addSample(attemptsWithoutOwnedOrders, document.id);
    }
  );

  const malformedUsers: SampleCollector = { count: 0, documentIds: [] };
  const userIds = new Set<string>();
  const userCount = await scanQuery(adminDb.collection(AUTH_COLLECTIONS.users), documentIdField, document => {
    const data = document.data();
    userIds.add(document.id);
    const valid =
      nonEmptyString(document.id) &&
      nonEmptyString(data.email) &&
      validNullableString(data.name) &&
      validNullableString(data.image) &&
      validEmailVerified(data.emailVerified);
    if (!valid) addSample(malformedUsers, document.id);
  });

  const malformedAccounts: SampleCollector = { count: 0, documentIds: [] };
  const duplicateAccounts: SampleCollector = { count: 0, documentIds: [] };
  const accountKeys = new Set<string>();
  let representativeGoogleProviderAccountId: string | null = null;
  const accountCount = await scanQuery(adminDb.collection(AUTH_COLLECTIONS.accounts), documentIdField, document => {
    const data = document.data();
    const valid =
      nonEmptyString(data.provider) &&
      nonEmptyString(data.providerAccountId) &&
      nonEmptyString(data.userId) &&
      nonEmptyString(data.type) &&
      userIds.has(data.userId);
    if (!valid) addSample(malformedAccounts, document.id);
    if (!nonEmptyString(data.provider) || !nonEmptyString(data.providerAccountId)) return;

    const key = data.provider + "\0" + data.providerAccountId;
    if (accountKeys.has(key)) addSample(duplicateAccounts, document.id);
    else accountKeys.add(key);

    if (data.provider === "google" && representativeGoogleProviderAccountId === null) {
      representativeGoogleProviderAccountId = data.providerAccountId;
    }
  });

  let representativeGoogleLookup: Record<string, unknown> = {
    attempted: false,
    reason: "No valid Google Account mapping exists."
  };
  if (representativeGoogleProviderAccountId) {
    try {
      const { authAdapter } = createFirestoreIdentityStore(adminDb);
      if (!authAdapter.getUserByAccount) throw new Error("Adapter getUserByAccount is unavailable.");
      const user = await authAdapter.getUserByAccount({
        provider: "google",
        providerAccountId: representativeGoogleProviderAccountId
      });
      representativeGoogleLookup = { attempted: true, succeeded: true, resolvedUser: Boolean(user) };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "unknown";
      representativeGoogleLookup = { attempted: true, succeeded: false, errorCode: code };
    }
  }

  const supportCollectionCounts = Object.fromEntries(
    await Promise.all(
      [AUTH_COLLECTIONS.sessions, AUTH_COLLECTIONS.verificationTokens, ...AUTH_SUPPORT_COLLECTIONS].map(
        async name => [name, await collectionCount(adminDb, name)] as const
      )
    )
  );
  const identityInspection = await inspectIdentityKeys(adminDb);
  const historicalOwnersWithoutCanonicalUser: SampleCollector = { count: 0, documentIds: [] };
  for (const userId of authenticatedOrderUserIds) {
    if (!identityInspection.userIds.has(userId)) addSample(historicalOwnersWithoutCanonicalUser, userId);
  }
  const collectionCounts = {
    [AUTH_COLLECTIONS.users]: userCount,
    [AUTH_COLLECTIONS.accounts]: accountCount,
    ...supportCollectionCounts
  };
  const adapterCollectionConflicts = Object.values(AUTH_COLLECTIONS).filter(name =>
    APP_COLLECTIONS.includes(name as (typeof APP_COLLECTIONS)[number])
  );

  const output = {
    mode: "read_only",
    project: {
      id: configuredProjectId,
      fingerprint: createHash("sha256").update(configuredProjectId).digest("hex").slice(0, 12)
    },
    pagination: { pageSize: PAGE_SIZE },
    orders: {
      total: orderTotal,
      distinctNonNullUserIds: Object.keys(orderCountsByUserId).length,
      byUserId: orderCountsByUserId,
      statusDistribution,
      checkoutModeDistribution,
      guestOrdersWithNonNullUserId: guestOrdersWithUserId,
      authenticatedOrdersWithNullUserId: authenticatedOrdersWithoutUserId,
      legacyOrdersWithNullUserId: legacyOrdersWithoutUserId,
      malformedUserIds: malformedOrderUserIds
    },
    checkoutAttempts: {
      total: attemptTotal,
      distinctAuthenticatedUserIds: authenticatedAttemptUserIds.size,
      authenticatedUserIds: [...authenticatedAttemptUserIds].map(opaqueId).sort(),
      attemptsWithoutOwnedOrders,
      malformedUserIds: malformedAttemptUserIds
    },
    identityCollections: collectionCounts,
    identityDiagnostics: {
      malformedUsers,
      malformedAccounts,
      duplicateProviderAccounts: duplicateAccounts,
      representativeGoogleLookup,
      identityKeys: identityInspection.diagnostics,
      explicitGoogleLinks: identityInspection.explicitGoogleLinks,
      historicalOwnersWithoutCanonicalUser
    },
    collectionCompatibility: {
      applicationCollections: APP_COLLECTIONS,
      adapterCollections: AUTH_COLLECTIONS,
      adapterCollectionConflicts,
      hasConflict: adapterCollectionConflicts.length > 0,
      authIdentityKeysEnabled: true
    },
    notes: [
      "No Firestore writes were performed.",
      "Collections were read in bounded pages; aggregate state remains proportional to distinct identity count.",
      "Order email fields were neither selected nor used for identity association.",
      "A non-null order userId is inventory evidence only; this report does not assert that it is a Google subject.",
      "Unseeded identities must bootstrap from a fresh authoritative Google OAuth response or be handled manually.",
      "Document identifiers are hashed; samples are capped at " + SAMPLE_LIMIT + ".",
      "Pagination is not a database-wide snapshot. Repeat during quiet traffic before migration."
    ]
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}

main().catch(error => {
  console.error(error instanceof Error && error.message.startsWith("Refusing to run.") ? error.message :
    "Authentication inventory failed. Check the confirmed project, environment and server diagnostics; no writes were requested.");
  process.exitCode = 1;
});
