"use server";

import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase/admin";
import { Order, OrderItem, Product } from "@/lib/schemas";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { headers } from "next/headers";

export async function createCheckoutSession(productId: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email || !session?.user?.id) {
      return { error: "You must be logged in to purchase." };
    }

    // 1. Fetch the main product (Single or Bundle)
    const productSnap = await adminDb.collection("products").doc(productId).get();
    if (!productSnap.exists) {
      return { error: "Product not found." };
    }

    const product = { id: productSnap.id, ...productSnap.data() } as Product;
    if (!product.active) {
      return { error: "This product is no longer available." };
    }

    let orderItems: OrderItem[] = [];

    // 2. THE UNPACKER: Handle Bundles vs Singles
    if (product.isBundle && product.includedProductIds.length > 0) {
      // Fetch all included products efficiently in one single database round-trip
      const productRefs = product.includedProductIds.map(id => adminDb.collection("products").doc(id));
      const includedSnaps = await adminDb.getAll(...productRefs);

      // Map the bundle contents into individual deliverables
      orderItems = includedSnaps
        .filter(snap => snap.exists)
        .map(snap => {
          const itemData = snap.data() as Product;
          return {
            productId: snap.id,
            title: itemData.title,
            price: itemData.price, // Store standalone value for receipt clarity
            deliverableUrl: itemData.deliverableUrl || ""
          };
        });
    } else {
      // It is a standard single product
      orderItems = [
        {
          productId: product.id as string,
          title: product.title,
          price: product.price,
          deliverableUrl: product.deliverableUrl || ""
        }
      ];
    }

    // 3. Create a "Pending" Order in Firestore FIRST
    const orderRef = adminDb.collection("orders").doc();
    const newOrder: Order = {
      id: orderRef.id,
      userId: session.user.id,
      customerEmail: session.user.email,
      stripeSessionId: "", // Will update momentarily
      amountTotal: product.price,
      items: orderItems, // <--- This now contains either 1 file or 15 files
      status: "pending",
      deliveryEmailSent: false,
      createdAt: Date.now()
    };

    await orderRef.set(newOrder);

    // 4. Create the Stripe Checkout Session
    const headersList = await headers();
    const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const stripeSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      customer_email: session.user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: product.title,
              description: product.description.substring(0, 255), // Stripe character limit
              // Safely attach the thumbnail if it exists
              images: product.images?.length > 0 ? [product.images[0]] : []
            },
            unit_amount: product.price // Charge the total bundle price (e.g., $4.00)
          },
          quantity: 1
        }
      ],
      mode: "payment",
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/product/${product.slug}`,
      metadata: {
        orderId: orderRef.id // The critical link back to our database
      }
    });

    // 5. Update the pending order with the generated Stripe Session ID
    await orderRef.update({ stripeSessionId: stripeSession.id });

    return { url: stripeSession.url };
  } catch (error: any) {
    console.error("❌ Checkout error:", error);
    return { error: error.message || "An unexpected error occurred during checkout." };
  }
}
