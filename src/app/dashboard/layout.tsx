import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { FileText, Settings, CreditCard } from "lucide-react";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // 1. Security Gate: Ensure the user is authenticated
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect("/");
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-12 md:flex-row md:px-8 pt-24">
      {/* --- SIDEBAR NAVIGATION --- */}
      <aside className="w-full md:w-64 shrink-0">
        <div className="sticky top-24 space-y-8">
          <div>
            <h2 className="mb-4 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              My Account
            </h2>
            <nav className="flex flex-col gap-1">
              <Link
                href="/dashboard"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-secondary text-foreground transition-colors">
                <FileText className="h-4 w-4" />
                My Templates
              </Link>
              <Link
                href="/dashboard/settings"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              <Link
                href="/dashboard/billing"
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <CreditCard className="h-4 w-4" />
                Billing History
              </Link>
            </nav>
          </div>
        </div>
      </aside>

      {/* --- MAIN CONTENT AREA --- */}
      <main className="flex-1">{children}</main>
    </div>
  );
}
