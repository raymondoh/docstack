import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { LayoutDashboard, Package, ShoppingCart, Users } from "lucide-react";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  // THE SECURITY GATE: Replace with your actual admin email
  const ADMIN_EMAIL = "raymondmhylton@gmail.com"; // <-- Update this!

  if (!session?.user || session.user.email !== ADMIN_EMAIL) {
    redirect("/"); // Instantly kick unauthorized users to the homepage
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12 md:flex-row md:px-8 pt-24">
      {/* --- ADMIN SIDEBAR --- */}
      <aside className="w-full md:w-64 shrink-0">
        <div className="sticky top-24 space-y-8">
          <div>
            <h2 className="mb-4 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Command Center
            </h2>
            <nav className="flex flex-col gap-1">
              <Link
                href="/admin"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted hover:text-foreground transition-colors">
                <LayoutDashboard className="h-4 w-4" />
                Overview
              </Link>
              <Link
                href="/admin/inventory"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <Package className="h-4 w-4" />
                Inventory & Bundles
              </Link>
              <Link
                href="/admin/orders"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <ShoppingCart className="h-4 w-4" />
                Orders
              </Link>
            </nav>
          </div>
        </div>
      </aside>

      {/* --- MAIN ADMIN CONTENT --- */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
