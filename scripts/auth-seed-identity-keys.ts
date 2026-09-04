import { loadEnvConfig } from "@next/env";
import { inspectIdentityKeys } from "../src/lib/auth/identity-inventory";
import { parseIdentitySeedOptions } from "../src/lib/auth/identity-migration-options";

async function main() {
  const { projectId, dryRun } = parseIdentitySeedOptions(process.argv.slice(2));
  loadEnvConfig(process.cwd());
  const [{ adminDb, getFirebaseAdmin }, { createFirestoreIdentityStore }] = await Promise.all([
    import("../src/lib/firebase/admin"), import("../src/lib/auth/firestore-identity-store")
  ]);
  if (getFirebaseAdmin().options.projectId !== projectId) throw new Error("PROJECT_MISMATCH");
  // Entire read-only preflight must pass before the first key can be written.
  const inspection = await inspectIdentityKeys(adminDb);
  if (Object.entries(inspection.diagnostics).some(([kind, result]) =>
    kind !== "usersMissingIdentityKeys" && result.count > 0)) {
    console.error(JSON.stringify({ mode: "refused", diagnostics: inspection.diagnostics }));
    throw new Error("IDENTITY_PREFLIGHT_FAILED");
  }
  const store = createFirestoreIdentityStore(adminDb);
  const results: Record<string, number> = {};
  for (const userId of inspection.userIds) {
    // Revalidate ownership in each transaction; never trust preflight as a lock.
    const result = await store.seedIdentityKey(userId, dryRun);
    results[result] = (results[result] ?? 0) + 1;
  }
  console.log(JSON.stringify({ mode: dryRun ? "dry_run" : "apply", results }));
}

main().catch(() => {
  console.error("Identity-key seed stopped. Requires exact --project-id, --confirm=SEED_AUTH_IDENTITY_KEYS and --dry-run or --apply. Check preflight/project/environment. Completed keys are safe to rerun; no users, accounts or orders are rewritten.");
  process.exitCode = 1;
});
