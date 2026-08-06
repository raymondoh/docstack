import { adminDb } from "@/lib/firebase/admin";
import { Product } from "@/lib/schemas";

/**
 * Fetches all active products for the homepage grid.
 * Optional category filter for the navigation pills.
 */
export async function getActiveProducts(category?: string, limitCount = 20): Promise<Product[]> {
  try {
    let query: FirebaseFirestore.Query = adminDb.collection("products").where("active", "==", true);

    if (category && category !== "all") {
      query = query.where("category", "==", category);
    }

    // Default sorting by newest
    query = query.orderBy("createdAt", "desc").limit(limitCount);

    const snap = await query.get();

    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Product[];
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    return []; // Graceful fallback
  }
}

/**
 * Fetches a single product by its SEO-friendly slug.
 * Used primarily by the Product Detail Page (PDP).
 */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  try {
    const snap = await adminDb
      .collection("products")
      .where("slug", "==", slug)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (snap.empty) return null;

    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as Product;
  } catch (error) {
    console.error(`❌ Error fetching product slug ${slug}:`, error);
    return null;
  }
}
