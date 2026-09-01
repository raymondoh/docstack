// src/app/product/[slug]/page.tsx
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "@/lib/firebase/admin";
import { Product } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { CheckoutButton } from "@/components/checkout-button";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { siteConfig } from "@/config/siteConfig";

// 1. Generate Dynamic SEO Metadata for sharing links
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const snap = await adminDb.collection("products").where("slug", "==", resolvedParams.slug).limit(1).get();

  if (snap.empty) return { title: "Product Not Found" };

  const product = snap.docs[0].data() as Product;
  return {
    title: `${product.title} | ${siteConfig.name}`,
    description: product.description
  };
}

// 2. The Main Page Component
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const resolvedParams = await params;
  const session = await getServerSession(authOptions);

  // Fetch the product securely from Firebase Admin
  const productsSnap = await adminDb
    .collection("products")
    .where("slug", "==", resolvedParams.slug)
    .where("active", "==", true)
    .limit(1)
    .get();

  if (productsSnap.empty) {
    notFound(); // Triggers Next.js 404 page if slug is invalid
  }

  const doc = productsSnap.docs[0];
  const product = { id: doc.id, ...doc.data() } as Product;

  // Safely handle legacy data missing arrays
  const images = product.images?.length > 0 ? product.images : ["/placeholder-template.jpg"];
  const mainImage = images[0];

  return (
    <main className="min-h-screen bg-background pt-24 pb-16 selection:bg-primary/10">
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        {/* Breadcrumb / Back Navigation */}
        <div className="mb-8">
          <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            ← Back to templates
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
          {/* LEFT COLUMN: Image Gallery */}
          <div className="flex flex-col gap-4">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border/50 bg-muted/30">
              <Image
                src={mainImage}
                alt={product.title}
                fill
                className="object-cover"
                priority // Loads the LCP image instantly
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>

            {/* Thumbnail Strip (Only shows if multiple images exist) */}
            {images.length > 1 && (
              <div className="grid grid-cols-4 gap-4">
                {images.slice(1, 5).map((img, idx) => (
                  <div
                    key={idx}
                    className="relative aspect-video overflow-hidden rounded-lg border border-border/50 bg-muted/30">
                    <Image src={img} alt={`Preview ${idx + 2}`} fill className="object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: Details & Checkout */}
          <div className="flex flex-col pt-2">
            <div className="flex items-center gap-3 mb-4">
              <Badge
                variant="outline"
                className="rounded-md font-mono text-xs uppercase tracking-wider text-muted-foreground border-border/50">
                {product.fileType || "FILE"}
              </Badge>
              <Badge
                variant="outline"
                className="rounded-md font-mono text-xs uppercase tracking-wider text-muted-foreground border-border/50">
                {(product.category || "Uncategorized").replace("-", " ")}
              </Badge>
              {product.salesCount > 50 && (
                <Badge variant="secondary" className="rounded-md text-xs shadow-sm">
                  Trending
                </Badge>
              )}
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl mb-4">{product.title}</h1>

            <p className="text-lg leading-relaxed text-muted-foreground mb-8 text-pretty">{product.description}</p>

            <div className="mt-auto border-t border-border/50 pt-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                  <span>Instant digital download</span>
                  <span>Secure Stripe checkout</span>
                </div>
                <CheckoutButton productId={product.id as string} priceInCents={product.price} />
                {session ? (
                  <p className="text-center text-xs text-muted-foreground mt-4">Logged in as {session.user?.email}</p>
                ) : (
                  <p className="text-center text-xs text-muted-foreground mt-4">
                    Checkout as a guest, or{" "}
                    <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
                      sign in to keep purchases in My Templates
                    </Link>
                    .
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
