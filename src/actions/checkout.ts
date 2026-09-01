"use server";

import Stripe from "stripe";
import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase/admin";
import { authOptions } from "@/lib/auth";
import { Order, OrderItem, Product } from "@/lib/schemas";
import { STRIPE_SAFE_RETRY_WINDOW_MS } from "@/lib/payment-windows";

const CHECKOUT_REQUEST_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutResult = {
  url?: string;
  error?: string;
  retryable?: boolean;
  endAttempt?: boolean;
};

type CancelCheckoutResult = {
  cancelled?: boolean;
  successUrl?: string;
  authenticationRequired?: boolean;
  error?: string;
};

export type GuestCheckoutResolution =
  | { status: "ready"; items: OrderItem[]; deliveryEmail?: string; emailDeliveryConfirmed: boolean }
  | { status: "finalizing" }
  | { status: "failed" }
  | { status: "unauthorized"; error: string };

type CheckoutMode = "authenticated" | "guest";

type CheckoutActor = {
  checkoutMode: CheckoutMode;
  userId: string | null;
};

type CheckoutAttemptData = {
  orderId?: string;
  productId?: string;
  checkoutMode?: CheckoutMode;
  userId?: string | null;
};

function isDefiniteStripeFailure(error: unknown) {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError ||
    error instanceof Stripe.errors.StripeAuthenticationError ||
    error instanceof Stripe.errors.StripePermissionError ||
    error instanceof Stripe.errors.StripeCardError
  );
}

function checkoutAttemptDocumentId(userId: string, requestToken: string) {
  return createHash("sha256").update(`${userId}:${requestToken}`).digest("hex");
}

function guestCheckoutAttemptDocumentId(requestToken: string) {
  return createHash("sha256").update(`guest:${requestToken}`).digest("hex");
}

function successUrl(sessionId: string, productId?: string) {
  const productContext = productId ? `&product=${encodeURIComponent(productId)}` : "";
  return `/success?session_id=${encodeURIComponent(sessionId)}${productContext}`;
}

function attemptMatches(data: CheckoutAttemptData, productId: string, actor: CheckoutActor) {
  const modeMatches =
    actor.checkoutMode === "guest"
      ? data.checkoutMode === "guest" && data.userId === null
      : (data.checkoutMode === undefined || data.checkoutMode === "authenticated") && data.userId === actor.userId;
  return modeMatches && data.productId === productId && typeof data.orderId === "string";
}

function orderMatchesActor(order: Order, actor: CheckoutActor) {
  if (actor.checkoutMode === "guest") return order.checkoutMode === "guest" && order.userId === null;
  return (
    order.userId === actor.userId &&
    (order.checkoutMode === undefined || order.checkoutMode === "authenticated")
  );
}

async function findCheckoutAttempt(requestToken: string, userId?: string | null) {
  const guestRef = adminDb.collection("checkoutAttempts").doc(guestCheckoutAttemptDocumentId(requestToken));
  const guestSnap = await guestRef.get();
  if (guestSnap.exists) {
    return {
      ref: guestRef,
      data: guestSnap.data() as CheckoutAttemptData,
      actor: { checkoutMode: "guest", userId: null } satisfies CheckoutActor
    };
  }

  if (!userId) return null;
  const authenticatedRef = adminDb.collection("checkoutAttempts").doc(checkoutAttemptDocumentId(userId, requestToken));
  const authenticatedSnap = await authenticatedRef.get();
  if (!authenticatedSnap.exists) return null;
  return {
    ref: authenticatedRef,
    data: authenticatedSnap.data() as CheckoutAttemptData,
    actor: { checkoutMode: "authenticated", userId } satisfies CheckoutActor
  };
}

async function resolveStoredSession(
  orderRef: FirebaseFirestore.DocumentReference,
  order: Order,
  session: Stripe.Checkout.Session
): Promise<CheckoutResult> {
  if (session.payment_status === "paid") return { url: successUrl(session.id, order.checkoutProductId) };
  if (session.status === "open" && session.url) return { url: session.url };

  if (session.status === "complete" && order.status !== "failed") {
    return { url: successUrl(session.id, order.checkoutProductId) };
  }

  if (session.status === "expired" || order.checkoutStatus === "session_expired") {
    await adminDb.runTransaction(async transaction => {
      const latestSnap = await transaction.get(orderRef);
      if (!latestSnap.exists) return;
      const latestOrder = latestSnap.data() as Order;
      if (latestOrder.status === "paid") return;
      transaction.update(orderRef, {
        status: "failed",
        checkoutStatus: "session_expired",
        updatedAt: Date.now()
      });
    });
    return { error: "This checkout session expired. Please start a new checkout.", retryable: false, endAttempt: true };
  }

  if (order.status === "failed") {
    return { error: "This payment attempt was not completed. Please start a new checkout.", retryable: false, endAttempt: true };
  }

  return {
    error: "Stripe is still resolving this checkout. Please retry this same checkout attempt shortly.",
    retryable: true,
    endAttempt: false
  };
}

async function recordCheckoutFailure(orderRef: FirebaseFirestore.DocumentReference, error: unknown, definite: boolean) {
  const message = error instanceof Error ? error.message : "An unexpected error occurred during checkout.";

  await adminDb.runTransaction(async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) return;

    const order = orderSnap.data() as Order;
    if (order.status === "paid" || order.stripeSessionId) return;

    transaction.update(orderRef, {
      ...(definite ? { status: "failed" } : {}),
      checkoutStatus: definite ? "session_creation_failed" : "session_creation_indeterminate",
      checkoutFailureReason: message.slice(0, 500),
      updatedAt: Date.now()
    });
  });
}

async function checkoutProductIsActive(order: Order) {
  if (!order.checkoutProductId) return false;
  const productSnap = await adminDb.collection("products").doc(order.checkoutProductId).get();
  return productSnap.exists && Boolean((productSnap.data() as Product).active);
}

async function endUnavailableCheckout(
  orderRef: FirebaseFirestore.DocumentReference,
  order: Order,
  stripeSession?: Stripe.Checkout.Session
): Promise<CheckoutResult> {
  if (stripeSession?.payment_status === "paid" || stripeSession?.status === "complete") {
    return { url: successUrl(stripeSession.id, order.checkoutProductId) };
  }
  if (stripeSession && stripeSession.metadata?.orderId !== order.id) {
    return {
      error: "The existing Stripe Checkout Session could not be correlated safely. Please contact support.",
      retryable: false,
      endAttempt: false
    };
  }

  let resolvedSession = stripeSession;
  if (resolvedSession?.status === "open") {
    try {
      resolvedSession = await stripe.checkout.sessions.expire(resolvedSession.id);
    } catch (error) {
      console.error("Inactive-product Checkout Session expiration failed:", error);
      return {
        error:
          "This product is no longer available, but the existing checkout could not yet be closed safely. Please retry.",
        retryable: true,
        endAttempt: false
      };
    }
  }

  if (resolvedSession && resolvedSession.status !== "expired") {
    return {
      error: "This product is no longer available, but Stripe has not confirmed the checkout is closed. Please retry.",
      retryable: true,
      endAttempt: false
    };
  }

  const latestPaidSessionId = await adminDb.runTransaction(async transaction => {
    const latestSnap = await transaction.get(orderRef);
    if (!latestSnap.exists) return "";
    const latestOrder = latestSnap.data() as Order;
    if (latestOrder.status === "paid") return latestOrder.stripeSessionId;

    transaction.update(orderRef, {
      status: "failed",
      checkoutStatus: "product_unavailable",
      checkoutFailureReason: "The product was deactivated before this unpaid checkout completed.",
      updatedAt: Date.now()
    });
    return "";
  });

  if (latestPaidSessionId) {
    const paidSession = await stripe.checkout.sessions.retrieve(latestPaidSessionId);
    return resolveStoredSession(orderRef, { ...order, status: "paid" }, paidSession);
  }

  return {
    error: "This product is no longer available. This checkout attempt has been closed.",
    retryable: false,
    endAttempt: true
  };
}

async function resumeCheckoutOrder(orderId: string, actor: CheckoutActor): Promise<CheckoutResult> {
  const orderRef = adminDb.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { error: "Checkout attempt could not be recovered.", retryable: true, endAttempt: false };

  const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
  if (!orderMatchesActor(order, actor) || !order.stripeCheckoutSnapshot || !order.stripeCheckoutIdempotencyKey) {
    return { error: "Checkout attempt data is invalid.", retryable: false, endAttempt: false };
  }

  if (!order.stripeSessionId && order.checkoutStatus === "product_unavailable") {
    return {
      error: "This product is no longer available. This checkout attempt has been closed.",
      retryable: false,
      endAttempt: true
    };
  }

  if (!order.stripeSessionId && order.checkoutStatus === "session_creation_failed") {
    return {
      error: order.checkoutFailureReason || "Stripe rejected this checkout request. Please start a new checkout.",
      retryable: false,
      endAttempt: true
    };
  }

  try {
    if (order.stripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
      if (existingSession.payment_status === "paid" || existingSession.status === "complete") {
        return { url: successUrl(existingSession.id, order.checkoutProductId) };
      }
      if (!(await checkoutProductIsActive(order))) {
        return endUnavailableCheckout(orderRef, order, existingSession);
      }
      return resolveStoredSession(orderRef, order, existingSession);
    }

    if (!(await checkoutProductIsActive(order))) {
      return endUnavailableCheckout(orderRef, order);
    }

    const attemptState = await adminDb.runTransaction(async transaction => {
      const latestSnap = await transaction.get(orderRef);
      if (!latestSnap.exists) throw new Error(`Order ${orderId} not found in database`);
      const latestOrder = latestSnap.data() as Order;
      if (latestOrder.stripeSessionId) return { sessionId: latestOrder.stripeSessionId, canAttempt: false };
      if (latestOrder.checkoutStatus === "session_creation_manual_review") {
        return { sessionId: "", canAttempt: false };
      }

      const attemptAge = latestOrder.stripeCheckoutFirstAttemptAt
        ? Date.now() - latestOrder.stripeCheckoutFirstAttemptAt
        : 0;
      if (attemptAge >= STRIPE_SAFE_RETRY_WINDOW_MS) {
        transaction.update(orderRef, {
          checkoutStatus: "session_creation_manual_review",
          checkoutFailureReason:
            "Automatic Stripe retry stopped before Stripe's 24-hour idempotency limit; confirm the original attempt before creating another session.",
          updatedAt: Date.now()
        });
        return { sessionId: "", canAttempt: false };
      }

      if (!latestOrder.stripeCheckoutFirstAttemptAt) {
        transaction.update(orderRef, { stripeCheckoutFirstAttemptAt: Date.now(), updatedAt: Date.now() });
      }
      return { sessionId: "", canAttempt: true };
    });

    if (attemptState.sessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(attemptState.sessionId);
      const latestSnap = await orderRef.get();
      const latestOrder = { id: latestSnap.id, ...latestSnap.data() } as Order;
      if (existingSession.payment_status === "paid" || existingSession.status === "complete") {
        return { url: successUrl(existingSession.id, latestOrder.checkoutProductId) };
      }
      if (!(await checkoutProductIsActive(latestOrder))) {
        return endUnavailableCheckout(orderRef, latestOrder, existingSession);
      }
      return resolveStoredSession(orderRef, latestOrder, existingSession);
    }
    if (!attemptState.canAttempt) {
      return {
        error: "This checkout attempt needs review because Stripe's safe retry window has elapsed. Please contact support.",
        retryable: false,
        endAttempt: false
      };
    }

    const snapshot = order.stripeCheckoutSnapshot;
    const stripeSession = await stripe.checkout.sessions.create(
      {
        payment_method_types: ["card"],
        ...(snapshot.customerEmail ? { customer_email: snapshot.customerEmail } : {}),
        line_items: [
          {
            price_data: {
              currency: snapshot.currency,
              product_data: {
                name: snapshot.productName,
                description: snapshot.productDescription,
                images: snapshot.productImage ? [snapshot.productImage] : []
              },
              unit_amount: snapshot.unitAmount
            },
            quantity: 1
          }
        ],
        mode: "payment",
        success_url: snapshot.successUrl,
        cancel_url: snapshot.cancelUrl,
        metadata: {
          orderId: order.id,
          checkoutAttemptId: order.checkoutAttemptId || ""
        }
      },
      { idempotencyKey: order.stripeCheckoutIdempotencyKey }
    );

    await orderRef.update({
      stripeSessionId: stripeSession.id,
      updatedAt: Date.now()
    });

    if (stripeSession.payment_status === "paid" || stripeSession.status === "complete") {
      return { url: successUrl(stripeSession.id, order.checkoutProductId) };
    }
    if (!(await checkoutProductIsActive(order))) {
      return endUnavailableCheckout(orderRef, { ...order, stripeSessionId: stripeSession.id }, stripeSession);
    }

    await orderRef.update({
      checkoutStatus: "session_created",
      checkoutFailureReason: "",
      updatedAt: Date.now()
    });
    return stripeSession.url
      ? { url: stripeSession.url }
      : { error: "Stripe did not return a checkout URL. Please try again.", retryable: true };
  } catch (error) {
    const definite = isDefiniteStripeFailure(error);
    try {
      await recordCheckoutFailure(orderRef, error, definite);
    } catch (recordError) {
      console.error("Failed to record checkout error:", recordError);
    }

    console.error("Checkout error:", error);
    return {
      error: definite
        ? error instanceof Error
          ? error.message
          : "Stripe rejected this checkout request."
        : "Checkout confirmation was interrupted. Please retry; the same secure checkout attempt will be reused.",
      retryable: !definite,
      endAttempt: definite
    };
  }
}

export async function cancelCheckoutSession(productId: string, requestToken: string): Promise<CancelCheckoutResult> {
  const session = await getServerSession(authOptions);
  if (!CHECKOUT_REQUEST_TOKEN_PATTERN.test(requestToken)) return { error: "Invalid checkout attempt." };

  const resolvedAttempt = await findCheckoutAttempt(requestToken, session?.user?.id);
  if (!resolvedAttempt) {
    if (!session?.user?.id) return { authenticationRequired: true };
    return { cancelled: true };
  }
  const { actor, data: attempt } = resolvedAttempt;
  if (!attemptMatches(attempt, productId, actor)) {
    return { error: "Checkout attempt correlation mismatch." };
  }

  const orderRef = adminDb.collection("orders").doc(attempt.orderId as string);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { error: "Checkout attempt could not be recovered." };
  const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
  if (!orderMatchesActor(order, actor) || (order.checkoutProductId && order.checkoutProductId !== productId)) {
    return { error: "Checkout attempt correlation mismatch." };
  }

  if (order.status === "paid" && order.stripeSessionId) {
    return { successUrl: successUrl(order.stripeSessionId, productId) };
  }
  if (!order.stripeSessionId) {
    if (order.checkoutStatus === "session_creation_failed") return { cancelled: true };
    return {
      error: "Stripe may still be creating this checkout. Retry cancellation shortly so the same attempt can be resolved safely."
    };
  }

  try {
    let stripeSession = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
    if (stripeSession.metadata?.orderId !== order.id) {
      return { error: "Stripe Checkout Session correlation could not be verified. Please contact support." };
    }
    if (stripeSession.payment_status === "paid" || stripeSession.status === "complete") {
      return { successUrl: successUrl(stripeSession.id, productId) };
    }
    if (stripeSession.status === "open") {
      stripeSession = await stripe.checkout.sessions.expire(stripeSession.id);
    }
    if (stripeSession.status !== "expired") {
      return { error: "Stripe has not confirmed that this checkout is cancelled. Please try again." };
    }

    await adminDb.runTransaction(async transaction => {
      const latestSnap = await transaction.get(orderRef);
      if (!latestSnap.exists) return;
      const latestOrder = latestSnap.data() as Order;
      if (latestOrder.status === "paid") return;
      transaction.update(orderRef, {
        status: "failed",
        checkoutStatus: "session_expired",
        checkoutFailureReason: "Customer cancelled the Stripe Checkout session.",
        updatedAt: Date.now()
      });
    });
    return { cancelled: true };
  } catch (error) {
    console.error("Checkout cancellation could not be confirmed:", error);
    return { error: "Checkout cancellation could not be confirmed. Please retry so this attempt remains protected." };
  }
}

export async function resolveGuestCheckout(
  sessionId: string,
  productId: string,
  requestToken: string
): Promise<GuestCheckoutResolution> {
  if (
    !CHECKOUT_REQUEST_TOKEN_PATTERN.test(requestToken) ||
    !sessionId.startsWith("cs_") ||
    sessionId.length > 255 ||
    !productId ||
    productId.length > 200
  ) {
    return { status: "unauthorized", error: "This guest checkout could not be verified." };
  }

  const attemptRef = adminDb.collection("checkoutAttempts").doc(guestCheckoutAttemptDocumentId(requestToken));
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists) return { status: "unauthorized", error: "This guest checkout could not be verified." };

  const attempt = attemptSnap.data() as CheckoutAttemptData;
  const guestActor = { checkoutMode: "guest", userId: null } satisfies CheckoutActor;
  if (!attemptMatches(attempt, productId, guestActor)) {
    return { status: "unauthorized", error: "This guest checkout could not be verified." };
  }

  const orderRef = adminDb.collection("orders").doc(attempt.orderId as string);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return { status: "unauthorized", error: "This guest checkout could not be verified." };
  const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
  if (
    !orderMatchesActor(order, guestActor) ||
    order.checkoutProductId !== productId ||
    order.stripeSessionId !== sessionId
  ) {
    return { status: "unauthorized", error: "This guest checkout could not be verified." };
  }

  try {
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    if (stripeSession.metadata?.orderId !== order.id) {
      return { status: "unauthorized", error: "This guest checkout could not be verified." };
    }

    if (stripeSession.payment_status === "paid" && order.status === "paid") {
      const emailDeliveryConfirmed =
        Boolean(order.deliveryEmail) && order.deliveryEmailStatus !== "manual_review";
      return {
        status: "ready",
        items: order.items,
        ...(emailDeliveryConfirmed ? { deliveryEmail: order.deliveryEmail } : {}),
        emailDeliveryConfirmed
      };
    }
    if (stripeSession.payment_status !== "paid" && order.status === "failed") return { status: "failed" };
    return { status: "finalizing" };
  } catch (error) {
    console.error("Guest checkout verification failed:", error);
    return { status: "unauthorized", error: "This guest checkout could not be verified." };
  }
}

export async function createCheckoutSession(productId: string, requestToken: string): Promise<CheckoutResult> {
  const session = await getServerSession(authOptions);
  if (!CHECKOUT_REQUEST_TOKEN_PATTERN.test(requestToken)) {
    return { error: "Invalid checkout attempt. Please try again.", retryable: false, endAttempt: true };
  }

  const authenticatedUserId = session?.user?.id ?? null;
  const accountEmail = session?.user?.email?.trim().toLowerCase();
  const existingAttempt = await findCheckoutAttempt(requestToken, authenticatedUserId);
  if (existingAttempt) {
    if (!attemptMatches(existingAttempt.data, productId, existingAttempt.actor)) {
      return { error: "Checkout attempt correlation mismatch.", retryable: false, endAttempt: true };
    }
    return resumeCheckoutOrder(existingAttempt.data.orderId as string, existingAttempt.actor);
  }

  const productSnap = await adminDb.collection("products").doc(productId).get();
  if (!productSnap.exists) return { error: "Product not found.", retryable: false, endAttempt: true };

  const product = { id: productSnap.id, ...productSnap.data() } as Product;
  if (!product.active) return { error: "This product is no longer available.", retryable: false, endAttempt: true };

  let orderItems: OrderItem[];
  if (product.isBundle && product.includedProductIds.length > 0) {
    const productRefs = product.includedProductIds.map(id => adminDb.collection("products").doc(id));
    const includedSnaps = await adminDb.getAll(...productRefs);
    orderItems = includedSnaps
      .filter(snap => snap.exists)
      .map(snap => {
        const itemData = snap.data() as Product;
        return {
          productId: snap.id,
          title: itemData.title,
          price: itemData.price,
          deliverableUrl: itemData.deliverableUrl || ""
        };
      });
  } else {
    orderItems = [
      {
        productId: product.id as string,
        title: product.title,
        price: product.price,
        deliverableUrl: product.deliverableUrl || ""
      }
    ];
  }

  const headersList = await headers();
  const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const proposedOrderRef = adminDb.collection("orders").doc();
  const checkoutAttemptId = randomUUID();
  const stripeCheckoutIdempotencyKey = `docstack-checkout-${checkoutAttemptId}`;
  const now = Date.now();
  const newActor: CheckoutActor = authenticatedUserId
    ? { checkoutMode: "authenticated", userId: authenticatedUserId }
    : { checkoutMode: "guest", userId: null };
  const guestAttemptRef = adminDb.collection("checkoutAttempts").doc(guestCheckoutAttemptDocumentId(requestToken));
  const authenticatedAttemptRef = authenticatedUserId
    ? adminDb.collection("checkoutAttempts").doc(checkoutAttemptDocumentId(authenticatedUserId, requestToken))
    : null;

  const attempt = await adminDb.runTransaction(async transaction => {
    const guestAttemptSnap = await transaction.get(guestAttemptRef);
    if (guestAttemptSnap.exists) {
      const existing = guestAttemptSnap.data() as CheckoutAttemptData;
      const actor = { checkoutMode: "guest", userId: null } satisfies CheckoutActor;
      if (!attemptMatches(existing, productId, actor)) {
        throw new Error("Checkout attempt correlation mismatch.");
      }
      return { orderId: existing.orderId as string, actor };
    }

    if (authenticatedAttemptRef) {
      const authenticatedAttemptSnap = await transaction.get(authenticatedAttemptRef);
      if (authenticatedAttemptSnap.exists) {
        const existing = authenticatedAttemptSnap.data() as CheckoutAttemptData;
        const actor = { checkoutMode: "authenticated", userId: authenticatedUserId } satisfies CheckoutActor;
        if (!attemptMatches(existing, productId, actor)) {
          throw new Error("Checkout attempt correlation mismatch.");
        }
        return { orderId: existing.orderId as string, actor };
      }
    }

    const stripeCheckoutSnapshot = {
      ...(accountEmail ? { customerEmail: accountEmail } : {}),
      currency: "usd",
      productName: product.title,
      productDescription: product.description.substring(0, 255),
      productImage: product.images?.[0] || "",
      unitAmount: product.price,
      successUrl: `${origin}/success?session_id={CHECKOUT_SESSION_ID}&product=${encodeURIComponent(productId)}`,
      cancelUrl: `${origin}/checkout/cancel?product=${encodeURIComponent(productId)}`
    };
    const newOrder: Order = {
      id: proposedOrderRef.id,
      userId: newActor.userId,
      checkoutMode: newActor.checkoutMode,
      ...(accountEmail ? { accountEmail } : {}),
      stripeSessionId: "",
      stripePaymentStatus: "unpaid",
      checkoutAttemptId,
      checkoutProductId: productId,
      stripeCheckoutIdempotencyKey,
      checkoutStatus: "creating_session",
      stripeCheckoutSnapshot,
      amountTotal: product.price,
      items: orderItems,
      status: "pending",
      deliveryEmailSent: false,
      deliveryEmailAttempts: 0,
      deliveryEmailIdempotencyKey: `docstack-fulfillment-${proposedOrderRef.id}-v1`,
      createdAt: now
    };

    transaction.create(proposedOrderRef, newOrder);
    const attemptRef = newActor.checkoutMode === "guest" ? guestAttemptRef : authenticatedAttemptRef;
    if (!attemptRef) throw new Error("Authenticated checkout attempt is missing its owner reference.");
    transaction.create(attemptRef, {
      orderId: proposedOrderRef.id,
      userId: newActor.userId,
      productId,
      checkoutMode: newActor.checkoutMode,
      createdAt: now,
      updatedAt: now
    });
    return { orderId: proposedOrderRef.id, actor: newActor };
  });

  return resumeCheckoutOrder(attempt.orderId, attempt.actor);
}
