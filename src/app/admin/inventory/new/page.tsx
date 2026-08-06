import { ProductForm } from "./product-form";
import { getAdminProducts } from "@/queries/admin";
import { Product } from "@/lib/schemas";

interface NewProductPageProps {
  searchParams: Promise<{ type?: string }>;
}

export default async function NewProductPage({ searchParams }: NewProductPageProps) {
  const resolvedParams = await searchParams;
  const initialType = resolvedParams.type === "bundle" ? "bundle" : "single";

  // Fetch all products and filter down to just the singles
  const allProducts = await getAdminProducts();
  const availableSingles = allProducts.filter(p => !p.isBundle);

  return (
    <div className="flex flex-col gap-8 pb-16">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {initialType === "bundle" ? "Create Bundle" : "New Single Template"}
        </h1>
        <p className="mt-2 text-muted-foreground">Fill out the details below to add a new item to your catalog.</p>
      </div>

      {/* Pass the available singles down to the form */}
      <ProductForm initialType={initialType} availableSingles={availableSingles} />
    </div>
  );
}
