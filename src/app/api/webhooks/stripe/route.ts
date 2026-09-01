import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase/admin";
import { Order } from "@/lib/schemas";
import { deliverFulfillmentEmail } from "@/lib/services/order-fulfillment";
import { env } from "@/lib/env";

const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

function paymentIntentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
}

function checkoutEmail(session: Stripe.Checkout.Session) {
  const value = (session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
  return z.string().email().safeParse(value).success ? value : "";
}

async function recordStripeEvent(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const orderId = session.metadata?.orderId;
  if (!orderId) throw new Error("No orderId found in Stripe metadata");

  const orderRef = adminDb.collection("orders").doc(orderId);
  const eventRef = adminDb.collection("stripeWebhookEvents").doc(event.id);
  const now = Date.now();

  return adminDb.runTransaction(async transaction => {
    const [eventSnap, orderSnap] = await Promise.all([transaction.get(eventRef), transaction.get(orderRef)]);

    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found in database`);
    if (eventSnap.exists) return { orderId, paid: session.payment_status === "paid" };

    const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
    if (order.stripeSessionId && order.stripeSessionId !== session.id) {
      throw new Error(`Stripe Session ${session.id} does not match order ${orderId}`);
    }

    const commonUpdate = {
      stripeSessionId: session.id,
      stripePaymentIntentId: paymentIntentId(session) ?? order.stripePaymentIntentId ?? "",
      stripePaymentStatus: order.status === "paid" ? "paid" : session.payment_status,
      lastProcessedStripeEventId: event.id,
      lastProcessedStripeEventType: event.type,
      updatedAt: now
    };
    const isPaidEvent =
      (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") &&
      session.payment_status === "paid";

    if (isPaidEvent) {
      const paidCheckoutEmail = checkoutEmail(session);
      const hasLegacyRecipient = !order.checkoutMode && Boolean(order.customerEmail);
      const hasDeliveryRecipient = Boolean(paidCheckoutEmail) || hasLegacyRecipient;
      const initialDeliveryState = !order.deliveryEmailSent && !order.deliveryEmailStatus
        ? hasDeliveryRecipient
          ? { deliveryEmailStatus: "pending" as const, deliveryEmailNextAttemptAt: now }
          : {
              deliveryEmailStatus: "manual_review" as const,
              deliveryEmailManualReviewReason:
                "Stripe marked the order paid but did not provide a valid checkout email. Downloads remain available; email delivery requires review."
            }
        : {};
      const pendingSchedule =
        hasDeliveryRecipient &&
        !order.deliveryEmailSent &&
        order.deliveryEmailStatus === "pending" &&
        typeof order.deliveryEmailNextAttemptAt !== "number"
          ? { deliveryEmailNextAttemptAt: now }
          : {};

      transaction.update(orderRef, {
        ...commonUpdate,
        status: "paid",
        checkoutStatus: "session_created",
        checkoutFailureReason: "",
        ...(paidCheckoutEmail ? { checkoutEmail: paidCheckoutEmail, deliveryEmail: paidCheckoutEmail } : {}),
        ...initialDeliveryState,
        ...pendingSchedule
      });
    } else if (event.type === "checkout.session.async_payment_failed" && order.status !== "paid") {
      transaction.update(orderRef, { ...commonUpdate, status: "failed", checkoutStatus: "payment_failed" });
    } else if (event.type === "checkout.session.expired" && order.status !== "paid") {
      transaction.update(orderRef, { ...commonUpdate, status: "failed", checkoutStatus: "session_expired" });
    } else {
      transaction.update(orderRef, commonUpdate);
    }

    transaction.create(eventRef, {
      eventId: event.id,
      eventType: event.type,
      orderId,
      stripeSessionId: session.id,
      paymentStatus: session.payment_status,
      createdAt: now
    });

    return { orderId, paid: isPaidEvent };
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature || !endpointSecret) {
      return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid webhook signature";
      console.error(`Webhook signature verification failed: ${message}`);
      return NextResponse.json({ error: message }, { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        const result = await recordStripeEvent(event, session);
        if (result.paid) {
          await deliverFulfillmentEmail(result.orderId);
        }
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook error";
    console.error("Webhook error:", message);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
