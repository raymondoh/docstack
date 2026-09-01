"use client";

import { useEffect } from "react";

export function ClearCheckoutAttempt({ productId }: { productId?: string }) {
  useEffect(() => {
    if (productId) {
      sessionStorage.removeItem(`docstack-checkout-attempt:${productId}`);
      sessionStorage.removeItem(`docstack-checkout-cancellation:${productId}`);
    }
  }, [productId]);

  return null;
}
