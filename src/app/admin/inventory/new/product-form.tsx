"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createProduct } from "@/actions/admin/products";
import { uploadProductImage } from "@/lib/firebase/upload";
import { Button } from "@/components/ui/button";
import { Package, FileText, Loader2, UploadCloud, X, CheckSquare, Square } from "lucide-react";
import type { Product } from "@/lib/schemas";

interface ProductFormProps {
  initialType: "single" | "bundle";
  availableSingles: Product[];
}

type CreateProductInput = Omit<Product, "id" | "createdAt" | "updatedAt">;

export function ProductForm({ initialType, availableSingles }: ProductFormProps) {
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [formData, setFormData] = useState<CreateProductInput>({
    title: "",
    slug: "",
    description: "",
    price: initialType === "bundle" ? 400 : 100,
    category: initialType === "bundle" ? "bundles" : "productivity",
    fileType: "ZIP",
    deliverableUrl: "",
    isBundle: initialType === "bundle",
    active: true,
    images: [],
    includedProductIds: [],
    salesCount: 0
  });

  useEffect(() => {
    return () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  useEffect(() => {
    if (formData.isBundle && formData.category !== "bundles") {
      setFormData(prev => ({
        ...prev,
        category: "bundles"
      }));
    }
  }, [formData.isBundle, formData.category]);

  const selectedBundleProducts = useMemo(() => {
    return availableSingles.filter(product => formData.includedProductIds.includes(product.id as string));
  }, [availableSingles, formData.includedProductIds]);

  const totalStandaloneValue = useMemo(() => {
    return selectedBundleProducts.reduce((sum, product) => sum + product.price, 0);
  }, [selectedBundleProducts]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);

    setSelectedFiles(prev => [...prev, ...files]);

    const newPreviews = files.map(file => URL.createObjectURL(file));
    setPreviewUrls(prev => [...prev, ...newPreviews]);

    e.target.value = "";
  };

  const removeImage = (indexToRemove: number) => {
    const previewToRemove = previewUrls[indexToRemove];
    if (previewToRemove) {
      URL.revokeObjectURL(previewToRemove);
    }

    setSelectedFiles(files => files.filter((_, i) => i !== indexToRemove));
    setPreviewUrls(urls => urls.filter((_, i) => i !== indexToRemove));
  };

  const toggleBundleItem = (productId: string) => {
    setFormData(prev => {
      const isCurrentlyIncluded = prev.includedProductIds.includes(productId);

      return {
        ...prev,
        includedProductIds: isCurrentlyIncluded
          ? prev.includedProductIds.filter(id => id !== productId)
          : [...prev.includedProductIds, productId]
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (formData.isBundle && formData.includedProductIds.length === 0) {
      setError("A bundle must contain at least one product.");
      setIsLoading(false);
      return;
    }

    try {
      const uploadedImageUrls = await Promise.all(selectedFiles.map(file => uploadProductImage(file)));

      const finalProductData: CreateProductInput = {
        ...formData,
        images: uploadedImageUrls
      };

      const result = await createProduct(finalProductData);

      if (!result.success) {
        throw new Error(result.error);
      }

      router.push("/admin/inventory");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred during upload.";

      setError(message);
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex max-w-2xl flex-col gap-8">
      {error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* --- BASIC INFO --- */}
      <div className="space-y-6 rounded-xl border border-border/50 bg-background p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-border/50 pb-4">
          {formData.isBundle ? (
            <Package className="h-5 w-5 text-primary" />
          ) : (
            <FileText className="h-5 w-5 text-muted-foreground" />
          )}

          <h2 className="text-lg font-semibold text-foreground">
            {formData.isBundle ? "Create Bundle" : "New Template"} Details
          </h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-foreground">Title</label>
            <input
              required
              type="text"
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={formData.isBundle ? "e.g., The Ultimate Starter Kit" : "e.g., Freelance Contract Template"}
              value={formData.title}
              onChange={e => {
                const title = e.target.value;

                setFormData(prev => ({
                  ...prev,
                  title,
                  slug: title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)+/g, "")
                }));
              }}
            />
          </div>

          {/* Category + Price */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-foreground">Category</label>
              <select
                required
                disabled={formData.isBundle}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.category}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    category: e.target.value as CreateProductInput["category"]
                  }))
                }>
                {formData.isBundle ? (
                  <option value="bundles">Bundle</option>
                ) : (
                  <>
                    <option value="productivity">Productivity</option>
                    <option value="contracts">Contracts</option>
                    <option value="finance">Finance</option>
                    <option value="proposals">Proposals</option>
                    <option value="client-management">Client Management</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Price (in cents)</label>
              <input
                required
                type="number"
                min="100"
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={formData.price}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    price: Number.parseInt(e.target.value, 10) || 100
                  }))
                }
              />
              <p className="mt-1 text-[10px] text-muted-foreground">100 = $1.00</p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">URL Slug</label>
            <input
              required
              type="text"
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
              value={formData.slug}
              readOnly
            />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Description</label>
            <textarea
              required
              rows={4}
              className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="What makes this template valuable?"
              value={formData.description}
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  description: e.target.value
                }))
              }
            />
          </div>
        </div>
      </div>

      {/* --- IMAGE UPLOADS --- */}
      <div className="space-y-6 rounded-xl border border-border/50 bg-background p-6 shadow-sm">
        <h2 className="border-b border-border/50 pb-4 text-lg font-semibold text-foreground">Product Images</h2>

        <div>
          <label className="flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border/80 bg-muted/20 transition-colors hover:bg-muted/50">
            <div className="flex flex-col items-center justify-center pb-6 pt-5 text-muted-foreground">
              <UploadCloud className="mb-2 h-8 w-8" />
              <p className="text-sm font-medium">Click to upload images</p>
              <p className="mt-1 text-xs">PNG, JPG, or WEBP</p>
            </div>

            <input
              type="file"
              className="hidden"
              multiple
              accept="image/png, image/jpeg, image/webp"
              onChange={handleImageSelect}
            />
          </label>
        </div>

        {previewUrls.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {previewUrls.map((url, index) => (
              <div
                key={`${url}-${index}`}
                className="group relative aspect-video overflow-hidden rounded-md border border-border/50">
                <Image src={url} alt={`Preview ${index + 1}`} fill className="object-cover" unoptimized />

                <button
                  type="button"
                  onClick={() => removeImage(index)}
                  className="absolute right-1 top-1 rounded-sm bg-background/80 p-1 opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100">
                  <X className="h-3 w-3" />
                </button>

                {index === 0 && (
                  <div className="absolute bottom-0 left-0 right-0 border-t border-border/50 bg-background/80 py-0.5 text-center text-[10px] font-medium">
                    Main Thumbnail
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- DELIVERY / BUNDLE SETTINGS --- */}
      <div className="space-y-6 rounded-xl border border-border/50 bg-background p-6 shadow-sm">
        <h2 className="border-b border-border/50 pb-4 text-lg font-semibold text-foreground">
          {formData.isBundle ? "Bundle Contents" : "Delivery Settings"}
        </h2>

        {!formData.isBundle && (
          <div>
            <label className="text-sm font-medium text-foreground">Deliverable URL</label>
            <input
              type="url"
              required={!formData.isBundle}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="https://docs.google.com/..."
              value={formData.deliverableUrl}
              onChange={e =>
                setFormData(prev => ({
                  ...prev,
                  deliverableUrl: e.target.value
                }))
              }
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              The secure link the customer receives after payment.
            </p>
          </div>
        )}

        {formData.isBundle && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select the templates to include in this bundle. When a customer purchases this bundle, they will receive
              the download links for all selected items.
            </p>

            <div className="max-h-80 overflow-y-auto overflow-hidden rounded-md border border-border/50 bg-muted/10">
              {availableSingles.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No single templates found. Create some individual templates first before building a bundle.
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {availableSingles.map(product => {
                    const productId = product.id as string;
                    const isSelected = formData.includedProductIds.includes(productId);

                    return (
                      <div
                        key={productId}
                        onClick={() => toggleBundleItem(productId)}
                        className={`flex cursor-pointer items-center gap-4 p-3 transition-colors ${
                          isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                        }`}>
                        <div className="shrink-0 text-primary">
                          {isSelected ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5 opacity-50" />}
                        </div>

                        <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded border border-border/50 bg-muted/50">
                          {product.images?.[0] ? (
                            <Image src={product.images[0]} alt="" fill className="object-cover" />
                          ) : (
                            <FileText className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 opacity-20" />
                          )}
                        </div>

                        <div className="flex flex-1 items-center justify-between gap-4 overflow-hidden">
                          <span className="truncate text-sm font-medium text-foreground">{product.title}</span>
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            ${(product.price / 100).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-1 text-xs font-medium">
              <span className={formData.includedProductIds.length === 0 ? "text-destructive" : "text-primary"}>
                {formData.includedProductIds.length} items selected
              </span>

              <span className="text-muted-foreground">
                Total standalone value: ${(totalStandaloneValue / 100).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* --- ACTIONS --- */}
      <div className="flex items-center justify-end gap-4 border-t border-border/50 pt-6">
        <Button variant="ghost" type="button" onClick={() => router.back()} disabled={isLoading}>
          Cancel
        </Button>

        <Button type="submit" disabled={isLoading} className="min-w-[140px] gap-2">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {selectedFiles.length > 0 ? "Uploading..." : "Saving..."}
            </>
          ) : (
            "Save to Store"
          )}
        </Button>
      </div>
    </form>
  );
}
