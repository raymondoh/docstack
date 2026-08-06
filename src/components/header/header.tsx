import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/siteConfig";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 md:px-8">
        {/* LEFT: Logo */}
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            {/* A simple geometric logo placeholder to match the SaaS vibe */}
            <div className="h-6 w-6 rounded bg-foreground flex items-center justify-center">
              <span className="text-background font-bold text-xs">D</span>
            </div>
            <span className="font-bold tracking-tight text-foreground">{siteConfig.name}</span>
          </Link>
        </div>

        {/* RIGHT: Navigation & Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex mr-2">
            <Link href="/" className="transition-colors hover:text-foreground">
              Templates
            </Link>
            <Link href="/dashboard" className="transition-colors hover:text-foreground">
              Dashboard
            </Link>
          </nav>

          <div className="flex items-center border-l border-border/50 pl-2 sm:pl-4 gap-2">
            {/* Our new theme toggle */}
            <ThemeToggle />

            {/* Simple auth routing */}
            <Link href="/dashboard">
              <Button variant="default" size="sm" className="hidden h-8 px-4 shadow-sm sm:flex">
                My Account
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
