import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { UserAccountNav } from "./user-account-nav";
import { LogIn } from "lucide-react";
import { siteConfig } from "@/config/siteConfig";

export async function Navbar() {
  const session = await getServerSession(authOptions);

  // Securely check the email against your .env variable on the server
  const isAdmin = session?.user?.email === process.env.ADMIN_EMAIL;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-8">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background font-bold">
            DS
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground hidden sm:inline-block">
            {siteConfig.name}
          </span>
        </Link>

        {/* Auth Navigation */}
        <div className="flex items-center gap-4">
          {session?.user ? (
            <UserAccountNav user={session.user} isAdmin={isAdmin} />
          ) : (
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background hover:bg-foreground/90 transition-colors shadow-sm">
              Sign In
              <LogIn className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
