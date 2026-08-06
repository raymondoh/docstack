// src/app/success/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase/admin";
import { Order } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// If you don't have lucide-react installed, run: npm install lucide-react
import { CheckCircle2, Download, ArrowRight, Mail } from "lucide-react";

interface SuccessPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SuccessPage({ searchParams }: SuccessPageProps) {
  // 1. Await search params (Required in Next.js 15+)
  const resolvedParams = await searchParams;
  const sessionId = resolvedParams.session_id as string;

  if (!sessionId) {
    redirect("/"); // Kick them out if they just typed /success in the URL bar
  }

  let orderData: Order | null = null;
  let customerEmail = "your email";

  try {
    // 2. Securely verify the session with Stripe
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);

    // 3. Get the internal Firebase Order ID we embedded in the metadata
    const orderId = stripeSession.metadata?.orderId;
    customerEmail = stripeSession.customer_details?.email || customerEmail;

    if (orderId) {
      // 4. Fetch the purchased items directly from your database
      const orderSnap = await adminDb.collection("orders").doc(orderId).get();
      if (orderSnap.exists) {
        orderData = orderSnap.data() as Order;
      }
    }
  } catch (error) {
    console.error("Error fetching order details on success page:", error);
    // We don't throw a 500 error here. We let the page render so they at least
    // see the "Success" message and know to check their email.
  }

  return (
    <main className="min-h-screen bg-background pt-24 pb-16 selection:bg-primary/10 flex items-center justify-center">
      <div className="mx-auto w-full max-w-2xl px-6 md:px-8">
        {/* --- HEADER --- */}
        <div className="text-center mb-10">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mb-6 border border-emerald-500/20">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl mb-4">Payment successful</h1>
          <p className="text-lg text-muted-foreground flex items-center justify-center gap-2">
            <Mail className="h-4 w-4" />A receipt has been sent to{" "}
            <span className="font-medium text-foreground">{customerEmail}</span>
          </p>
        </div>

        {/* --- INSTANT DOWNLOAD SECTION --- */}
        {orderData && orderData.items && orderData.items.length > 0 ? (
          <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden mb-8 shadow-sm">
            <div className="border-b border-border/50 bg-muted/40 px-6 py-4">
              <h2 className="font-semibold text-foreground">Your Digital Assets</h2>
              <p className="text-sm text-muted-foreground">Click below to access your files immediately.</p>
            </div>

            <div className="divide-y divide-border/50">
              {orderData.items.map((item, index) => (
                <div key={index} className="flex items-center justify-between p-6 gap-4">
                  <div>
                    <h3 className="font-medium text-foreground leading-snug line-clamp-1">{item.title}</h3>
                    <Badge
                      variant="outline"
                      className="mt-2 text-[10px] font-mono uppercase text-muted-foreground border-border/50">
                      Lifetime Access
                    </Badge>
                  </div>

                  {/* The Instant Access Button */}
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
        ) : (
          /* Fallback if database fetch fails but Stripe succeeded */
          <div className="rounded-xl border border-border/50 bg-muted/20 p-6 text-center mb-8">
            <p className="text-muted-foreground">
              Your templates are being prepared. You will receive an email with your download links shortly.
            </p>
          </div>
        )}

        {/* --- NAVIGATION FOOTER --- */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link href="/dashboard" className="w-full sm:w-auto">
            <Button variant="outline" className="w-full">
              View Order History
            </Button>
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
