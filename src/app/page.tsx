// src/app/page.tsx
import { getActiveProducts } from "@/queries/products";
import { ProductCard } from "@/components/products/product-card";
import { SearchFilter } from "@/components/products/search-filter";
import { Badge } from "@/components/ui/badge";

interface HomePageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// We remove the static revalidate timer because search parameters make this route dynamic
export default async function HomePage({ searchParams }: HomePageProps) {
  // 1. Parse URL parameters
  const resolvedParams = await searchParams;
  const categoryFilter = typeof resolvedParams.category === "string" ? resolvedParams.category : "all";
  const searchQuery = typeof resolvedParams.q === "string" ? resolvedParams.q.toLowerCase() : "";

  // 2. Fetch ALL active products (Fast and cheap for < 100 items)
  const allProducts = await getActiveProducts("all", 100);

  // 3. Filter in-memory based on the URL state
  const filteredProducts = allProducts.filter(product => {
    // Check Category
    const matchesCategory = categoryFilter === "all" || (product.category ?? "") === categoryFilter;

    // SAFE FALLBACKS: Ensure missing manual data doesn't crash the .toLowerCase() function
    const safeTitle = (product.title || "").toLowerCase();
    const safeDescription = (product.description || "").toLowerCase();
    const safeFileType = (product.fileType || "").toLowerCase();

    // Check Search Query
    const matchesSearch =
      searchQuery === "" ||
      safeTitle.includes(searchQuery) ||
      safeDescription.includes(searchQuery) ||
      safeFileType.includes(searchQuery);

    return matchesCategory && matchesSearch;
  });

  return (
    <main className="min-h-screen bg-background pb-24 pt-16 selection:bg-primary/10">
      {/* --- HERO SECTION --- */}
      <section className="mx-auto max-w-5xl px-6 text-center md:px-8 lg:pt-12">
        <Badge
          variant="secondary"
          className="mb-6 rounded-full px-4 py-1.5 text-sm font-medium border-border/50 shadow-sm">
          Phase 1 Launch
        </Badge>
        <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          Professional business templates. <br className="hidden sm:inline" />
          <span className="text-muted-foreground">Just $1.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          Stop wasting hours formatting documents from scratch. Instantly download high-quality, practical templates
          designed for entrepreneurs and small businesses.
        </p>
      </section>

      {/* --- SEARCH & NAVIGATION --- */}
      <section className="mx-auto mt-16 max-w-7xl px-6 md:px-8 border-b border-border/50 pb-8">
        <SearchFilter />
      </section>

      {/* --- PRODUCT GRID --- */}
      <section className="mx-auto mt-8 max-w-7xl px-6 md:px-8">
        {filteredProducts.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredProducts.map(product => (
              <ProductCard key={product.id || product.slug} product={product} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-24 text-center bg-muted/10">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">No templates found</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              We couldn't find anything matching your search. Try adjusting your filters.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
