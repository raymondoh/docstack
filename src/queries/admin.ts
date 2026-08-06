import { adminDb } from "@/lib/firebase/admin";
import { Product, Order } from "@/lib/schemas";

/**
 * Fetches ALL products (active, inactive, singles, and bundles)
 */
export async function getAdminProducts(): Promise<Product[]> {
  try {
    const snap = await adminDb.collection("products").orderBy("createdAt", "desc").get();

    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Product[];
  } catch (error) {
    console.error("❌ Error fetching admin products:", error);
    return [];
  }
}

/**
 * Fetches ALL successful orders and calculates total revenue
 */
export async function getAdminOrdersAndMetrics() {
  try {
    const snap = await adminDb.collection("orders").where("status", "==", "paid").orderBy("createdAt", "desc").get();

    const orders = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Order[];

    // Calculate total revenue in cents, then convert to dollars
    const totalRevenueCents = orders.reduce((sum, order) => sum + (order.amountTotal || 0), 0);
    const totalRevenue = totalRevenueCents / 100;

    return { orders, totalRevenue, totalSales: orders.length };
  } catch (error) {
    console.error("❌ Error fetching admin metrics:", error);
    return { orders: [], totalRevenue: 0, totalSales: 0 };
  }
}
