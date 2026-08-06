// src/components/products/product-card.tsx
import Image from "next/image";
import Link from "next/link";
import { Product } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";

interface ProductCardProps {
  product: Product;
}

export function ProductCard({ product }: ProductCardProps) {
  // Format the price from cents (100) to dollars ($1.00)
  // Fallback to 0 if price is somehow missing
  const formattedPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format((product.price || 0) / 100);

  // Safely grab the first image, or a placeholder if none exists
  const thumbnail = product.images?.[0] || "/placeholder-template.jpg";

  // Fallbacks for SEO routing and UI elements missing from legacy test data
  const productUrl = product.slug ? `/product/${product.slug}` : `/product/${product.id}`;
  const categoryLabel = product.category ? product.category.replace("-", " ") : "Uncategorized";
  const fileTypeLabel = product.fileType || "FILE";

  return (
    <Link href={productUrl} className="group block h-full">
      <article className="flex h-full flex-col overflow-hidden rounded-xl border border-border/50 bg-background transition-all duration-300 hover:border-foreground/20 hover:shadow-sm">
        {/* Image Container */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/50 border-b border-border/50">
          <Image
            src={thumbnail}
            alt={`Preview of ${product.title || "Product"}`}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />

          {/* Top-Right Badge */}
          {(product.salesCount || 0) > 50 && (
            <div className="absolute top-3 right-3">
              <Badge
                variant="secondary"
                className="bg-background/90 backdrop-blur-sm hover:bg-background/90 text-xs shadow-sm">
                Trending
              </Badge>
            </div>
          )}
        </div>

        {/* Content Container */}
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-medium leading-snug tracking-tight text-foreground line-clamp-2">
              {product.title || "Untitled Product"}
            </h3>
            <span className="shrink-0 text-sm font-semibold text-foreground">{formattedPrice}</span>
          </div>

          <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
            {product.description || "No description available."}
          </p>

          {/* Footer Metadata with Safe Fallbacks */}
          <div className="mt-auto pt-6 flex items-center gap-2">
            <Badge
              variant="outline"
              className="rounded-md font-mono text-[10px] uppercase tracking-wider text-muted-foreground border-border/50">
              {fileTypeLabel}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-md font-mono text-[10px] uppercase tracking-wider text-muted-foreground border-border/50">
              {categoryLabel}
            </Badge>
          </div>
        </div>
      </article>
    </Link>
  );
}
