import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { CheckoutCancellation } from "@/components/checkout/checkout-cancellation";

export const metadata: Metadata = {
  title: "Cancel checkout",
  robots: { index: false, follow: false }
};

interface CheckoutCancelPageProps {
  searchParams: Promise<{ product?: string | string[] }>;
}

export default async function CheckoutCancelPage({ searchParams }: CheckoutCancelPageProps) {
  const resolvedParams = await searchParams;
  const productId = typeof resolvedParams.product === "string" ? resolvedParams.product : "";
  if (!productId || productId.length > 200) redirect("/");

  const session = await getServerSession(authOptions);
  return <CheckoutCancellation productId={productId} isAuthenticated={Boolean(session?.user?.id)} />;
}
