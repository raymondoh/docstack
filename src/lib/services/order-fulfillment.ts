import * as React from "react";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { z } from "zod";
import { adminDb } from "@/lib/firebase/admin";
import { env } from "@/lib/env";
import { Order } from "@/lib/schemas";
import { ReceiptEmail } from "@/components/emails/receipt-email";
import { siteConfig } from "@/config/siteConfig";
import { RESEND_SAFE_RETRY_WINDOW_MS } from "@/lib/payment-windows";

const resend = new Resend(env.RESEND_API_KEY);
const EMAIL_CLAIM_TTL_MS = 5 * 60 * 1000;
const EMAIL_RETRY_BASE_MS = 60 * 1000;
const EMAIL_RETRY_MAX_MS = 60 * 60 * 1000;

type DeliveryResult = "sent" | "already_sent" | "busy" | "not_due" | "manual_review" | "stale_worker";

type EmailClaim = {
  status: "claimed";
  order: Order;
  claimId: string;
  idempotencyKey: string;
  recipient: string;
};

function manualReviewReason(order: Order, now: number) {
  return `Automatic retry stopped because the first provider attempt was ${Math.floor(
    (now - (order.deliveryEmailFirstAttemptAt ?? now)) / 60000,
  )} minutes ago. Automatic retry stopped before Resend's 24-hour idempotency limit. Provider acceptance is unknown; reconcile manually before resending.`;
}

function nextRetryAt(now: number, attempts: number) {
  const exponent = Math.min(Math.max(attempts - 1, 0), 10);
  return now + Math.min(EMAIL_RETRY_BASE_MS * 2 ** exponent, EMAIL_RETRY_MAX_MS);
}

async function claimFulfillmentEmail(
  orderId: string,
): Promise<EmailClaim | { status: Exclude<DeliveryResult, "sent" | "stale_worker"> }> {
  const orderRef = adminDb.collection("orders").doc(orderId);
  const now = Date.now();
  const claimId = randomUUID();

  return adminDb.runTransaction(async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found in database`);

    const order = { id: orderSnap.id, ...orderSnap.data() } as Order;
    if (order.status !== "paid") return { status: "busy" as const };

    if (order.deliveryEmailSent || order.deliveryEmailStatus === "sent") {
      if (!order.deliveryEmailSent || order.deliveryEmailStatus !== "sent") {
        transaction.update(orderRef, {
          deliveryEmailSent: true,
          deliveryEmailStatus: "sent",
          updatedAt: now,
        });
      }
      return { status: "already_sent" as const };
    }

    if (order.deliveryEmailStatus === "manual_review") return { status: "manual_review" as const };

    const recipientResult = z
      .string()
      .email()
      .safeParse(order.deliveryEmail || order.customerEmail || "");
    if (!recipientResult.success) {
      transaction.update(orderRef, {
        deliveryEmailStatus: "manual_review",
        deliveryEmailClaimId: "",
        deliveryEmailManualReviewReason:
          "Paid order has no valid Stripe checkout email or legacy customer email. Do not guess a delivery recipient.",
        updatedAt: now,
      });
      return { status: "manual_review" as const };
    }

    const claimIsActive =
      order.deliveryEmailStatus === "sending" &&
      typeof order.deliveryEmailClaimedAt === "number" &&
      now - order.deliveryEmailClaimedAt < EMAIL_CLAIM_TTL_MS;
    if (claimIsActive) return { status: "busy" as const };

    if (
      typeof order.deliveryEmailFirstAttemptAt === "number" &&
      now - order.deliveryEmailFirstAttemptAt >= RESEND_SAFE_RETRY_WINDOW_MS
    ) {
      transaction.update(orderRef, {
        deliveryEmailStatus: "manual_review",
        deliveryEmailClaimId: "",
        deliveryEmailManualReviewReason: manualReviewReason(order, now),
        updatedAt: now,
      });
      return { status: "manual_review" as const };
    }

    if (typeof order.deliveryEmailNextAttemptAt === "number" && order.deliveryEmailNextAttemptAt > now) {
      return { status: "not_due" as const };
    }

    const idempotencyKey = order.deliveryEmailIdempotencyKey || `docstack-fulfillment-${orderId}-v1`;
    transaction.update(orderRef, {
      deliveryEmailSent: false,
      deliveryEmailStatus: "sending",
      deliveryEmailClaimId: claimId,
      deliveryEmailClaimedAt: now,
      deliveryEmailNextAttemptAt: now + EMAIL_CLAIM_TTL_MS,
      deliveryEmailFirstAttemptAt: order.deliveryEmailFirstAttemptAt ?? now,
      deliveryEmailIdempotencyKey: idempotencyKey,
      deliveryEmailAttempts: (order.deliveryEmailAttempts ?? 0) + 1,
      deliveryEmailError: "",
      deliveryEmailManualReviewReason: "",
      updatedAt: now,
    });

    return { status: "claimed" as const, order, claimId, idempotencyKey, recipient: recipientResult.data };
  });
}

async function completeEmailClaim(
  orderId: string,
  claimId: string,
  outcome: { sent: true; providerId: string } | { sent: false; error: string },
) {
  const orderRef = adminDb.collection("orders").doc(orderId);

  return adminDb.runTransaction(async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) throw new Error(`Order ${orderId} not found in database`);

    const order = orderSnap.data() as Order;
    if (order.deliveryEmailSent || order.deliveryEmailStatus === "sent") return outcome.sent;
    if (order.deliveryEmailClaimId !== claimId) return false;

    const now = Date.now();
    if (outcome.sent) {
      transaction.update(orderRef, {
        deliveryEmailSent: true,
        deliveryEmailStatus: "sent",
        deliveryEmailSentAt: now,
        deliveryEmailProviderId: outcome.providerId,
        deliveryEmailError: "",
        deliveryEmailManualReviewReason: "",
        updatedAt: now,
      });
    } else {
      transaction.update(orderRef, {
        deliveryEmailSent: false,
        deliveryEmailStatus: "failed",
        deliveryEmailError: outcome.error.slice(0, 500),
        deliveryEmailNextAttemptAt: nextRetryAt(now, order.deliveryEmailAttempts ?? 1),
        updatedAt: now,
      });
    }
    return true;
  });
}

export async function deliverFulfillmentEmail(orderId: string): Promise<DeliveryResult> {
  const claim = await claimFulfillmentEmail(orderId);
  if (claim.status !== "claimed") return claim.status;

  try {
    const emailResult = await resend.emails.send(
      {
        from: env.EMAIL_FROM,
        to: claim.recipient,
        subject: `Your Templates are Ready | ${siteConfig.name}`,
        react: React.createElement(ReceiptEmail, { order: { ...claim.order, status: "paid" } }),
      },
      { idempotencyKey: claim.idempotencyKey },
    );

    if (emailResult.error) throw new Error(emailResult.error.message);

    const ownsClaim = await completeEmailClaim(orderId, claim.claimId, {
      sent: true,
      providerId: emailResult.data?.id ?? "",
    });
    return ownsClaim ? "sent" : "stale_worker";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email delivery error";
    const ownsClaim = await completeEmailClaim(orderId, claim.claimId, { sent: false, error: message });
    if (!ownsClaim) return "stale_worker";
    throw error;
  }
}

export async function reconcileFulfillmentEmails(limit = 25) {
  const snapshot = await adminDb
    .collection("orders")
    .where("status", "==", "paid")
    .where("deliveryEmailStatus", "in", ["pending", "failed", "sending"])
    .where("deliveryEmailNextAttemptAt", "<=", Date.now())
    .orderBy("deliveryEmailNextAttemptAt", "asc")
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();

  const summary = { examined: snapshot.size, sent: 0, skipped: 0, manualReview: 0, failed: 0 };
  for (const doc of snapshot.docs) {
    const order = doc.data() as Order;
    if (order.status !== "paid") {
      summary.skipped++;
      continue;
    }

    try {
      const result = await deliverFulfillmentEmail(doc.id);
      if (result === "sent") summary.sent++;
      else if (result === "manual_review") summary.manualReview++;
      else summary.skipped++;
    } catch (error) {
      summary.failed++;
      console.error(`Failed to reconcile fulfillment email for order ${doc.id}:`, error);
    }
  }
  return summary;
}
