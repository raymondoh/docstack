import { adminDb } from "@/lib/firebase/admin";
import { Order } from "@/lib/schemas";

/**
 * Fetches all successful orders for a specific user.
 * Used to populate the "My Downloads" section of the dashboard.
 */
export async function getUserOrders(userId: string): Promise<Order[]> {
  try {
    const snap = await adminDb
      .collection("orders")
      .where("userId", "==", userId)
      .where("status", "==", "paid") // Only show them templates they successfully paid for
      .orderBy("createdAt", "desc")
      .get();

    return snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as Order[];
  } catch (error) {
    console.error(`❌ Error fetching orders for user ${userId}:`, error);
    return [];
  }
}

/**
 * Fetches a single order by ID securely.
 * Used by the /success page to display instant download links.
 */
export async function getOrderById(orderId: string): Promise<Order | null> {
  try {
    const snap = await adminDb.collection("orders").doc(orderId).get();

    if (!snap.exists) return null;

    return { id: snap.id, ...snap.data() } as Order;
  } catch (error) {
    console.error(`❌ Error fetching order ${orderId}:`, error);
    return null;
  }
}
