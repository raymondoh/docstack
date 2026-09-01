import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase/admin";
import { authOptions } from "@/lib/auth";
import { Order } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FinalizingPurchase } from "@/components/checkout/finalizing-purchase";
import { ClearCheckoutAttempt } from "@/components/checkout/clear-checkout-attempt";
import { GuestCheckoutSuccess } from "@/components/checkout/guest-checkout-success";
import { CheckCircle2, Download, ArrowRight, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Purchase status",
  robots: { index: false, follow: false }
};

interface SuccessPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  const resolvedParams = await searchParams;
  const sessionId = typeof resolvedParams.session_id === "string" ? resolvedParams.session_id : null;
  if (!sessionId) redirect("/");

  const userSession = await getServerSession(authOptions);
  let orderData: Order;
  let customerEmail = userSession?.user?.email || "your email";

  try {
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    const orderId = stripeSession.metadata?.orderId;
    if (!orderId) redirect("/dashboard");

    const orderSnap = await adminDb.collection("orders").doc(orderId).get();
    if (!orderSnap.exists) redirect("/dashboard");

    orderData = { id: orderSnap.id, ...orderSnap.data() } as Order;
    const sessionMatchesOrder = orderData.stripeSessionId === stripeSession.id;
    if (!sessionMatchesOrder) redirect("/");

    const isGuestOrder = orderData.checkoutMode === "guest" && orderData.userId === null;
    if (isGuestOrder) {
      const productId = orderData.checkoutProductId;
      if (!productId || (typeof resolvedParams.product === "string" && resolvedParams.product !== productId)) {
        redirect("/");
      }
      return <GuestCheckoutSuccess sessionId={stripeSession.id} productId={productId} />;
    }

    if (!userSession?.user?.id) {
      const productContext = orderData.checkoutProductId
        ? `&product=${encodeURIComponent(orderData.checkoutProductId)}`
        : "";
      const callbackUrl = `/success?session_id=${encodeURIComponent(sessionId)}${productContext}`;
      redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    const ownsOrder = orderData.userId === userSession.user.id;
    if (!ownsOrder) redirect("/dashboard");

    customerEmail = orderData.deliveryEmail || stripeSession.customer_details?.email || orderData.customerEmail || "your email";
    const paymentIsPaid = stripeSession.payment_status === "paid";
    const orderIsPaid = orderData.status === "paid";

    if (!paymentIsPaid || !orderIsPaid) {
      const failed = orderData.status === "failed";
      return (
        <>
          {failed && <ClearCheckoutAttempt productId={orderData.checkoutProductId} />}
          <FinalizingPurchase failed={failed} />
        </>
      );
    }
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    console.error("Error verifying checkout success:", error);
    redirect("/dashboard");
  }

  return (
    <main className="min-h-screen bg-background pt-24 pb-16 selection:bg-primary/10 flex items-center justify-center">
      <ClearCheckoutAttempt productId={orderData.checkoutProductId} />
      <div className="mx-auto w-full max-w-2xl px-6 md:px-8">
        <div className="text-center mb-10">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mb-6 border border-emerald-500/20">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl mb-4">Payment successful</h1>
          <p className="text-lg text-muted-foreground flex items-center justify-center gap-2">
            <Mail className="h-4 w-4" />Your templates are available below and are being sent to{" "}
            <span className="font-medium text-foreground">{customerEmail}</span>
          </p>
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden mb-8 shadow-sm">
          <div className="border-b border-border/50 bg-muted/40 px-6 py-4">
            <h2 className="font-semibold text-foreground">Your Digital Assets</h2>
            <p className="text-sm text-muted-foreground">Click below to access your files immediately.</p>
          </div>
          <div className="divide-y divide-border/50">
            {orderData.items.map(item => (
              <div key={item.productId} className="flex items-center justify-between p-6 gap-4">
                <div>
                  <h3 className="font-medium text-foreground leading-snug line-clamp-1">{item.title}</h3>
                  <Badge variant="outline" className="mt-2 text-[10px] font-mono uppercase text-muted-foreground border-border/50">
                    Lifetime Access
                  </Badge>
                </div>
                <a href={item.deliverableUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <Button variant="default" size="sm" className="gap-2 shadow-sm">
                    <Download className="h-4 w-4" />
                    Access Template
                  </Button>
                </a>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/dashboard" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full">View Order History</Button>
          </Link>
          <Link href="/" className="w-full sm:w-auto">
            <Button variant="secondary" className="w-full gap-2 group">
              Continue Shopping
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
