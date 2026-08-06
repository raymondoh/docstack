// // src/components/products/search-filter.tsx
// "use client";

// import { useCallback, useTransition } from "react";
// import { useRouter, useSearchParams, usePathname } from "next/navigation";
// import { Search } from "lucide-react";
// import { Badge } from "@/components/ui/badge";

// const CATEGORIES = [
//   { id: "all", label: "All Templates" },
//   { id: "contracts", label: "Contracts" },
//   { id: "finance", label: "Finance" },
//   { id: "proposals", label: "Proposals" },
//   { id: "client-management", label: "Client Management" },
//   { id: "productivity", label: "Productivity" },
//   { id: "bundles", label: "Bundles" } // Added bundles so they can easily find the $4+ items
// ];

// export function SearchFilter() {
//   const router = useRouter();
//   const pathname = usePathname();
//   const searchParams = useSearchParams();
//   const [isPending, startTransition] = useTransition();

//   const currentCategory = searchParams.get("category") || "all";
//   const currentQuery = searchParams.get("q") || "";

//   // Update the URL parameters smoothly
//   const createQueryString = useCallback(
//     (name: string, value: string) => {
//       const params = new URLSearchParams(searchParams.toString());
//       if (value && value !== "all") {
//         params.set(name, value);
//       } else {
//         params.delete(name);
//       }
//       return params.toString();
//     },
//     [searchParams]
//   );

//   const handleSearch = (term: string) => {
//     startTransition(() => {
//       router.replace(`${pathname}?${createQueryString("q", term)}`, { scroll: false });
//     });
//   };

//   const handleCategory = (category: string) => {
//     startTransition(() => {
//       router.replace(`${pathname}?${createQueryString("category", category)}`, { scroll: false });
//     });
//   };

//   return (
//     <div className="flex flex-col gap-6 w-full">
//       {/* Search Input */}
//       <div className="relative max-w-lg w-full">
//         <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
//           <Search className="h-4 w-4" />
//         </div>
//         <input
//           type="text"
//           className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 pl-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all shadow-sm"
//           placeholder="Search templates (e.g., 'invoice' or 'contract')..."
//           defaultValue={currentQuery}
//           onChange={e => handleSearch(e.target.value)}
//         />
//         {isPending && (
//           <div className="absolute inset-y-0 right-3 flex items-center">
//             <div className="h-3 w-3 animate-pulse rounded-full bg-primary/50" />
//           </div>
//         )}
//       </div>

//       {/* Category Pills */}
//       <div className="flex flex-wrap items-center gap-2">
//         {CATEGORIES.map(cat => {
//           const isActive = currentCategory === cat.id;
//           return (
//             <button
//               key={cat.id}
//               onClick={() => handleCategory(cat.id)}
//               className="transition-transform active:scale-95">
//               <Badge
//                 variant={isActive ? "default" : "outline"}
//                 className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
//                   !isActive && "hover:bg-muted border-border/50 text-muted-foreground hover:text-foreground"
//                 }`}>
//                 {cat.label}
//               </Badge>
//             </button>
//           );
//         })}
//       </div>
//     </div>
//   );
// }
"use client";

import { useCallback, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const CATEGORIES = [
  { id: "all", label: "All Templates" },
  { id: "contracts", label: "Contracts" },
  { id: "finance", label: "Finance" },
  { id: "proposals", label: "Proposals" },
  { id: "client-management", label: "Client Management" },
  { id: "productivity", label: "Productivity" },
  { id: "bundles", label: "Bundles" }
];

export function SearchFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentCategory = searchParams.get("category") || "all";
  const currentQuery = searchParams.get("q") || "";

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value && value !== "all") {
        params.set(name, value);
      } else {
        params.delete(name);
      }

      return params.toString();
    },
    [searchParams]
  );

  const navigateWithParams = useCallback(
    (queryString: string) => {
      router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
    },
    [router, pathname]
  );

  const handleSearch = (term: string) => {
    startTransition(() => {
      navigateWithParams(createQueryString("q", term));
    });
  };

  const handleCategory = (category: string) => {
    startTransition(() => {
      navigateWithParams(createQueryString("category", category));
    });
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="relative w-full max-w-lg">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
          <Search className="h-4 w-4" />
        </div>

        <input
          type="text"
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 pl-10 text-sm shadow-sm transition-all ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Search templates (e.g., 'invoice' or 'contract')..."
          defaultValue={currentQuery}
          onChange={e => handleSearch(e.target.value)}
        />

        {isPending && (
          <div className="absolute inset-y-0 right-3 flex items-center">
            <div className="h-3 w-3 animate-pulse rounded-full bg-primary/50" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CATEGORIES.map(cat => {
          const isActive = currentCategory === cat.id;

          return (
            <button
              key={cat.id}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleCategory(cat.id)}
              className="transition-transform active:scale-95">
              <Badge
                variant={isActive ? "default" : "outline"}
                className={`cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  !isActive && "border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}>
                {cat.label}
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}
