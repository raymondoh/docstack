"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, FileText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "My Templates", icon: FileText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/billing", label: "Billing History", icon: CreditCard }
] as const;

export function DashboardNav() {
  const pathname = usePathname();
  return <nav className="flex flex-col gap-1">
    {items.map(item => {
      const active = pathname === item.href;
      const Icon = item.icon;
      return <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}>
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>;
    })}
  </nav>;
}
