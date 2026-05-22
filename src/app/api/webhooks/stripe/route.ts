import * as React from "react";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase/admin";
import { Order } from "@/lib/schemas";
import { Resend } from "resend";
import { ReceiptEmail } from "@/components/emails/receipt-email";
import { env } from "@/lib/env";
import { siteConfig } from "@/config/siteConfig";

const resend = new Resend(env.RESEND_API_KEY);
const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature || !endpointSecret) {
      return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, endpointSecret);
    } catch (err: any) {
      console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: 400 });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;

      if (!orderId) {
        throw new Error("No orderId found in Stripe metadata");
      }

      const orderRef = adminDb.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        throw new Error(`Order ${orderId} not found in database`);
      }

      const orderData = { id: orderSnap.id, ...orderSnap.data() } as Order;

      const emailResult = await resend.emails.send({
        from: `${siteConfig.name} <no-reply@${siteConfig.url.split("://")[1]}>`,
        to: session.customer_details?.email || orderData.customerEmail,
        subject: "Your Templates are Ready | " + siteConfig.name,
        react: React.createElement(ReceiptEmail, { order: orderData })
      });

      if (emailResult.error) {
        console.error("❌ Failed to send Resend email:", emailResult.error);
      }

      await orderRef.update({
        status: "paid",
        deliveryEmailSent: !emailResult.error,
        updatedAt: Date.now()
      });

      console.log(`✅ Order ${orderId} fulfilled successfully!`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error: any) {
    console.error("❌ Webhook Error:", error.message);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
