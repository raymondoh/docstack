"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function FinalizingPurchase({ failed }: { failed: boolean }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (failed) return;

    const interval = window.setInterval(() => router.refresh(), 2000);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
      setTimedOut(true);
    }, 30000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [failed, router]);

  return (
    <main className="min-h-screen bg-background pt-24 pb-16 flex items-center justify-center">
      <div className="mx-auto w-full max-w-lg px-6 text-center">
        <div className="rounded-xl border border-border/50 bg-muted/20 p-8 shadow-sm">
          {!failed && !timedOut && (
            <div className="mx-auto mb-6 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          )}
          <h1 className="text-2xl font-bold tracking-tight">
            {failed ? "We could not complete this payment" : timedOut ? "Confirmation is taking longer than expected" : "Finalizing your purchase"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {failed
              ? "No downloads have been released. Please try checkout again or contact support if you were charged."
              : timedOut
                ? "Your files are still protected. Refresh this page to check again, or contact support if payment confirmation remains unavailable."
              : "Stripe has returned you to DocStack, and we are securely confirming the payment. Your downloads will appear automatically once confirmation finishes."}
          </p>
          {timedOut && !failed && (
            <Button className="mt-6" onClick={() => router.refresh()}>
              Check payment status
            </Button>
          )}
          <Link href="/dashboard" className="mt-6 inline-block">
            <Button variant="outline">View My Templates</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
