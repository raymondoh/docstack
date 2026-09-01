import { adminDb } from "@/lib/firebase/admin";
import { createFirestoreIdentityStore } from "@/lib/auth/firestore-identity-store";

export { createFirestoreIdentityStore } from "@/lib/auth/firestore-identity-store";

const identityStore = createFirestoreIdentityStore(adminDb);

export const authAdapter = identityStore.authAdapter;
export const ensurePersistentGoogleIdentity = identityStore.ensurePersistentGoogleIdentity;
