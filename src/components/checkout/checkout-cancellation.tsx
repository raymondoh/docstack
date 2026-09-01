"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cancelCheckoutSession } from "@/actions/checkout";
import { Button } from "@/components/ui/button";

type CancellationState = "idle" | "cancelling" | "cancelled" | "cancellation_retryable_error";

export function CheckoutCancellation({ productId, isAuthenticated }: { productId: string; isAuthenticated: boolean }) {
  const [state, setState] = useState<CancellationState>("idle");
  const [error, setError] = useState("");
  const startedRef = useRef(false);
  const storageKey = `docstack-checkout-attempt:${productId}`;
  const cancellationKey = `docstack-checkout-cancellation:${productId}`;

  const attemptCancellation = useCallback(async () => {
    const requestToken = sessionStorage.getItem(storageKey);
    if (!requestToken) {
      sessionStorage.removeItem(cancellationKey);
      setState("cancelled");
      window.location.replace("/");
      return;
    }

    sessionStorage.setItem(cancellationKey, "pending");
    setState("cancelling");
    setError("");
    try {
      const result = await cancelCheckoutSession(productId, requestToken);
      if (result.authenticationRequired && !isAuthenticated) {
        const callbackUrl = `/checkout/cancel?product=${encodeURIComponent(productId)}`;
        window.location.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }
      if (result.successUrl) {
        window.location.replace(result.successUrl);
        return;
      }
      if (result.cancelled) {
        sessionStorage.removeItem(storageKey);
        sessionStorage.removeItem(cancellationKey);
        setState("cancelled");
        window.location.replace("/");
        return;
      }

      setError(result.error || "Checkout cancellation could not be confirmed. Your existing attempt remains protected.");
      setState("cancellation_retryable_error");
    } catch (cancellationError) {
      console.error("Checkout cancellation request failed:", cancellationError);
      setError("Checkout cancellation could not be confirmed. Your existing attempt remains protected.");
      setState("cancellation_retryable_error");
    }
  }, [cancellationKey, isAuthenticated, productId, storageKey]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const start = window.setTimeout(() => void attemptCancellation(), 0);
    return () => window.clearTimeout(start);
  }, [attemptCancellation]);

  const isCancelling = state === "idle" || state === "cancelling";

  return (
    <main className="min-h-screen bg-background pt-24 pb-16 flex items-center justify-center">
      <div className="mx-auto w-full max-w-lg px-6 text-center">
        <div className="rounded-xl border border-border/50 bg-muted/20 p-8 shadow-sm">
          {isCancelling && (
            <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          )}
          <h1 className="text-2xl font-bold tracking-tight">
            {state === "cancelled"
              ? "Checkout cancelled"
              : state === "cancellation_retryable_error"
                ? "Cancellation needs another try"
                : "Safely cancelling checkout"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {state === "cancellation_retryable_error"
              ? error
              : state === "cancelled"
                ? "The previous checkout attempt has ended."
                : "Please wait while DocStack confirms that the previous Stripe Checkout Session can no longer be used."}
          </p>
          {state === "cancellation_retryable_error" && (
            <Button className="mt-6" onClick={() => void attemptCancellation()}>
              Retry Cancellation
            </Button>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            A new purchase cannot start until cancellation is confirmed.
          </p>
        </div>
      </div>
    </main>
  );
}
