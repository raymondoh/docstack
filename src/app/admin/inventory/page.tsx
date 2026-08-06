// // src/app/admin/inventory/page.tsx
// import Link from "next/link";
// import Image from "next/image";
// import { getAdminProducts } from "@/queries/admin";
// // src/app/admin/inventory/page.tsx
// import { Badge } from "@/components/ui/badge";
// import { Button } from "@/components/ui/button";
// import { Plus, Package, FileText, MoreHorizontal, CheckCircle2, XCircle } from "lucide-react";

// export default async function InventoryPage() {
//   const products = await getAdminProducts();

//   return (
//     <div className="flex flex-col gap-8">
//       {/* --- PAGE HEADER & ACTIONS --- */}
//       <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
//         <div>
//           <h1 className="text-3xl font-bold tracking-tight text-foreground">Inventory</h1>
//           <p className="mt-2 text-muted-foreground">Manage your single templates and highly-profitable bundles.</p>
//         </div>
//         <div className="flex items-center gap-3">
//           {/* We will route these to a creation form next */}
//           <Link href="/admin/inventory/new?type=single">
//             <Button variant="outline" className="gap-2 shadow-sm bg-background">
//               <FileText className="h-4 w-4 text-muted-foreground" />
//               New Template
//             </Button>
//           </Link>
//           <Link href="/admin/inventory/new?type=bundle">
//             <Button variant="default" className="gap-2 shadow-sm">
//               <Package className="h-4 w-4" />
//               Create Bundle
//             </Button>
//           </Link>
//         </div>
//       </div>

//       {/* --- DATA TABLE --- */}
//       <div className="rounded-xl border border-border/50 bg-background overflow-hidden shadow-sm">
//         <div className="overflow-x-auto">
//           <table className="w-full text-sm text-left">
//             <thead className="text-xs uppercase bg-muted/40 text-muted-foreground border-b border-border/50">
//               <tr>
//                 <th scope="col" className="px-6 py-4 font-medium tracking-wider">
//                   Product
//                 </th>
//                 <th scope="col" className="px-6 py-4 font-medium tracking-wider">
//                   Type
//                 </th>
//                 <th scope="col" className="px-6 py-4 font-medium tracking-wider">
//                   Status
//                 </th>
//                 <th scope="col" className="px-6 py-4 font-medium tracking-wider">
//                   Price
//                 </th>
//                 <th scope="col" className="px-6 py-4 font-medium tracking-wider">
//                   Sales
//                 </th>
//                 <th scope="col" className="px-6 py-4 text-right">
//                   Actions
//                 </th>
//               </tr>
//             </thead>
//             <tbody className="divide-y divide-border/50">
//               {products.map(product => (
//                 <tr key={product.id} className="hover:bg-muted/10 transition-colors group">
//                   {/* Title & Image Column */}
//                   <td className="px-6 py-4">
//                     <div className="flex items-center gap-4">
//                       <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/30">
//                         {product.images?.[0] ? (
//                           <Image
//                             src={product.images[0]}
//                             alt={product.title}
//                             fill
//                             className="object-cover"
//                             sizes="64px"
//                           />
//                         ) : (
//                           <div className="flex h-full w-full items-center justify-center text-muted-foreground">
//                             {product.isBundle ? (
//                               <Package className="h-4 w-4 opacity-50" />
//                             ) : (
//                               <FileText className="h-4 w-4 opacity-50" />
//                             )}
//                           </div>
//                         )}
//                       </div>
//                       <div className="flex flex-col max-w-[200px] lg:max-w-[300px]">
//                         <span className="font-medium text-foreground truncate" title={product.title}>
//                           {product.title}
//                         </span>
//                         <span className="text-xs text-muted-foreground truncate font-mono">/{product.slug}</span>
//                       </div>
//                     </div>
//                   </td>

//                   {/* Type Column (Single vs Bundle) */}
//                   <td className="px-6 py-4">
//                     {product.isBundle ? (
//                       <Badge
//                         variant="secondary"
//                         className="gap-1.5 text-xs font-medium bg-primary/5 text-primary border-primary/10">
//                         <Package className="h-3 w-3" />
//                         Bundle ({product.includedProductIds?.length || 0})
//                       </Badge>
//                     ) : (
//                       <Badge variant="outline" className="gap-1.5 text-xs font-medium border-border/50">
//                         <FileText className="h-3 w-3 text-muted-foreground" />
//                         Single
//                       </Badge>
//                     )}
//                   </td>

//                   {/* Status Column */}
//                   <td className="px-6 py-4">
//                     <div className="flex items-center gap-2">
//                       {product.active ? (
//                         <>
//                           <CheckCircle2 className="h-4 w-4 text-emerald-500" />
//                           <span className="text-foreground">Active</span>
//                         </>
//                       ) : (
//                         <>
//                           <XCircle className="h-4 w-4 text-muted-foreground" />
//                           <span className="text-muted-foreground">Draft</span>
//                         </>
//                       )}
//                     </div>
//                   </td>

//                   {/* Price Column */}
//                   <td className="px-6 py-4 font-medium text-foreground">${(product.price / 100).toFixed(2)}</td>

//                   {/* Sales Column */}
//                   <td className="px-6 py-4 text-muted-foreground">{product.salesCount || 0}</td>

//                   {/* Actions Column */}
//                   <td className="px-6 py-4 text-right">
//                     <Link href={`/admin/inventory/${product.id}`}>
//                       <Button
//                         variant="ghost"
//                         size="sm"
//                         className="opacity-0 group-hover:opacity-100 transition-opacity">
//                         Edit
//                       </Button>
//                     </Link>
//                   </td>
//                 </tr>
//               ))}

//               {products.length === 0 && (
//                 <tr>
//                   <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
//                     Your inventory is empty. Create your first template to get started.
//                   </td>
//                 </tr>
//               )}
//             </tbody>
//           </table>
//         </div>
//       </div>
//     </div>
//   );
// }
// src/app/admin/inventory/page.tsx
import Link from "next/link";
import Image from "next/image";
import { getAdminProducts } from "@/queries/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, FileText, CheckCircle2, XCircle } from "lucide-react";

function formatCategoryLabel(category?: string) {
  if (!category) return "Uncategorized";

  return category.replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

export default async function InventoryPage() {
  const products = await getAdminProducts();

  return (
    <div className="flex flex-col gap-8">
      {/* --- PAGE HEADER & ACTIONS --- */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Inventory</h1>
          <p className="mt-2 text-muted-foreground">Manage your single templates and highly-profitable bundles.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/admin/inventory/new?type=single">
            <Button variant="outline" className="gap-2 bg-background shadow-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
              New Template
            </Button>
          </Link>

          <Link href="/admin/inventory/new?type=bundle">
            <Button variant="default" className="gap-2 shadow-sm">
              <Package className="h-4 w-4" />
              Create Bundle
            </Button>
          </Link>
        </div>
      </div>

      {/* --- DATA TABLE --- */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-background shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border/50 bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Product
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Type
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Category
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Price
                </th>
                <th scope="col" className="px-6 py-4 font-medium tracking-wider">
                  Sales
                </th>
                <th scope="col" className="px-6 py-4 text-right">
                  Actions
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border/50">
              {products.map(product => (
                <tr key={product.id} className="group transition-colors hover:bg-muted/10">
                  {/* Product */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-md border border-border/50 bg-muted/30">
                        {product.images?.[0] ? (
                          <Image
                            src={product.images[0]}
                            alt={product.title}
                            fill
                            className="object-cover"
                            sizes="64px"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            {product.isBundle ? (
                              <Package className="h-4 w-4 opacity-50" />
                            ) : (
                              <FileText className="h-4 w-4 opacity-50" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex max-w-[200px] flex-col lg:max-w-[300px]">
                        <span className="truncate font-medium text-foreground" title={product.title}>
                          {product.title}
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">/{product.slug}</span>
                      </div>
                    </div>
                  </td>

                  {/* Type */}
                  <td className="px-6 py-4">
                    {product.isBundle ? (
                      <Badge
                        variant="secondary"
                        className="gap-1.5 border-primary/10 bg-primary/5 text-xs font-medium text-primary">
                        <Package className="h-3 w-3" />
                        Bundle ({product.includedProductIds?.length || 0})
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1.5 border-border/50 text-xs font-medium">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        Single
                      </Badge>
                    )}
                  </td>

                  {/* Category */}
                  <td className="px-6 py-4">
                    <Badge variant="outline" className="border-border/50 bg-muted/20 text-xs capitalize">
                      {formatCategoryLabel(product.category)}
                    </Badge>
                  </td>

                  {/* Status */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {product.active ? (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span className="text-foreground">Active</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                          <span className="text-muted-foreground">Draft</span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Price */}
                  <td className="px-6 py-4 font-medium text-foreground">${(product.price / 100).toFixed(2)}</td>

                  {/* Sales */}
                  <td className="px-6 py-4 text-muted-foreground">{product.salesCount || 0}</td>

                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    <Link href={`/admin/inventory/${product.id}`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="transition-opacity opacity-0 group-hover:opacity-100">
                        Edit
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}

              {products.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                    Your inventory is empty. Create your first template to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
