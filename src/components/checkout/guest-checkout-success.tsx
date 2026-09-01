"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Download, Mail } from "lucide-react";
import { resolveGuestCheckout, type GuestCheckoutResolution } from "@/actions/checkout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type GuestSuccessState =
  | { status: "checking" }
  | {
      status: "ready";
      items: Extract<GuestCheckoutResolution, { status: "ready" }>["items"];
      deliveryEmail?: string;
      emailDeliveryConfirmed: boolean;
    }
  | { status: "failed" }
  | { status: "missing_token" }
  | { status: "unavailable"; message: string }
  | { status: "timed_out" };

export function GuestCheckoutSuccess({ sessionId, productId }: { sessionId: string; productId: string }) {
  const [state, setState] = useState<GuestSuccessState>({ status: "checking" });
  const verificationRunRef = useRef(0);
  const storageKey = `docstack-checkout-attempt:${productId}`;
  const cancellationKey = `docstack-checkout-cancellation:${productId}`;

  const verifyPurchase = useCallback(async () => {
    const runId = ++verificationRunRef.current;
    const requestToken = sessionStorage.getItem(storageKey);
    if (!requestToken) {
      setState({ status: "missing_token" });
      return;
    }

    setState({ status: "checking" });
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const result = await resolveGuestCheckout(sessionId, productId, requestToken);
        if (verificationRunRef.current !== runId) return;

        if (result.status === "ready") {
          sessionStorage.removeItem(storageKey);
          sessionStorage.removeItem(cancellationKey);
          setState({
            status: "ready",
            items: result.items,
            deliveryEmail: result.deliveryEmail,
            emailDeliveryConfirmed: result.emailDeliveryConfirmed
          });
          return;
        }
        if (result.status === "failed") {
          sessionStorage.removeItem(storageKey);
          sessionStorage.removeItem(cancellationKey);
          setState({ status: "failed" });
          return;
        }
        if (result.status === "unauthorized") {
          setState({ status: "unavailable", message: result.error });
          return;
        }
      } catch (error) {
        console.error("Guest purchase verification failed:", error);
      }

      await new Promise(resolve => window.setTimeout(resolve, 2000));
      if (verificationRunRef.current !== runId) return;
    }
    setState({ status: "timed_out" });
  }, [cancellationKey, productId, sessionId, storageKey]);

  useEffect(() => {
    const verificationRun = verificationRunRef.current;
    const start = window.setTimeout(() => void verifyPurchase(), 0);
    return () => {
      window.clearTimeout(start);
      verificationRunRef.current = verificationRun + 1;
    };
  }, [verifyPurchase]);

  if (state.status !== "ready") {
    const checking = state.status === "checking";
    const failed = state.status === "failed";
    const missingToken = state.status === "missing_token";
    const title = failed
      ? "We could not complete this payment"
      : missingToken
        ? "Use your fulfillment email"
        : state.status === "timed_out"
          ? "Confirmation is taking longer than expected"
          : state.status === "unavailable"
            ? "Purchase access could not be verified"
            : "Finalizing your purchase";
    const message = failed
      ? "No downloads have been released. Please try checkout again or contact support if you were charged."
      : missingToken
        ? "This browser no longer has the private checkout token required for instant access. Your paid-order email contains the download links."
        : state.status === "timed_out"
          ? "Your files remain protected. Retry verification, or use the fulfillment email when it arrives."
          : state.status === "unavailable"
            ? state.message
            : "Stripe has returned you to DocStack, and we are securely confirming payment before releasing downloads.";

    return (
      <main className="min-h-screen bg-background pt-24 pb-16 flex items-center justify-center">
        <div className="mx-auto w-full max-w-lg px-6 text-center">
          <div className="rounded-xl border border-border/50 bg-muted/20 p-8 shadow-sm">
            {checking && (
              <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            )}
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-3 text-muted-foreground">{message}</p>
            {(state.status === "timed_out" || state.status === "unavailable") && (
              <Button className="mt-6" onClick={() => void verifyPurchase()}>
                Retry verification
              </Button>
            )}
            <Link href="/" className="mt-6 block text-sm font-medium underline underline-offset-4">
              Return to catalogue
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pt-24 pb-16 selection:bg-primary/10 flex items-center justify-center">
      <div className="mx-auto w-full max-w-2xl px-6 md:px-8">
        <div className="text-center mb-10">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 mb-6 border border-emerald-500/20">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl mb-4">Payment successful</h1>
          {state.emailDeliveryConfirmed && state.deliveryEmail ? (
            <p className="text-lg text-muted-foreground flex items-center justify-center gap-2">
              <Mail className="h-4 w-4" />Your templates are available below and are being sent to{" "}
              <span className="font-medium text-foreground">{state.deliveryEmail}</span>
            </p>
          ) : (
            <p className="text-lg text-muted-foreground">
              Your purchase is complete and your templates are available below. We could not confirm email delivery,
              so please download them in this browser.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden mb-8 shadow-sm">
          <div className="border-b border-border/50 bg-muted/40 px-6 py-4">
            <h2 className="font-semibold text-foreground">Your Digital Assets</h2>
            <p className="text-sm text-muted-foreground">
              {state.emailDeliveryConfirmed
                ? "Keep your fulfillment email for future access."
                : "Download and save these files now so you retain access."}
            </p>
          </div>
          <div className="divide-y divide-border/50">
            {state.items.map(item => (
              <div key={item.productId} className="flex items-center justify-between p-6 gap-4">
                <div>
                  <h3 className="font-medium text-foreground leading-snug line-clamp-1">{item.title}</h3>
                  <Badge variant="outline" className="mt-2 text-[10px] font-mono uppercase text-muted-foreground border-border/50">
                    Guest Purchase
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

        <Link href="/" className="flex justify-center">
          <Button variant="secondary" className="gap-2 group">
            Continue Shopping
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
      </div>
    </main>
  );
}
