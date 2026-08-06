// src/components/checkout-button.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createCheckoutSession } from "@/actions/checkout";

interface CheckoutButtonProps {
  productId: string;
  priceInCents: number;
}

export function CheckoutButton({ productId, priceInCents }: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  // Format price (e.g., 100 cents -> $1.00)
  const formattedPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(priceInCents / 100);

  const handleCheckout = async () => {
    setIsLoading(true);
    try {
      const { url, error } = await createCheckoutSession(productId);

      if (error) {
        console.error("Checkout failed:", error);
        alert(error); // In a production app, use a toast notification here
        setIsLoading(false);
        return;
      }

      if (url) {
        window.location.href = url; // Redirect to Stripe Checkout
      }
    } catch (err) {
      console.error("Unexpected error:", err);
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleCheckout}
      disabled={isLoading}
      size="lg"
      className="w-full font-medium shadow-sm transition-all">
      {isLoading ? "Redirecting securely..." : `Buy for ${formattedPrice}`}
    </Button>
  );
}
