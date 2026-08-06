"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { signOut } from "next-auth/react";
import { User as UserIcon, LayoutDashboard, LogOut, Shield } from "lucide-react";

interface UserAccountNavProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  isAdmin: boolean;
}

export function UserAccountNav({ user, isAdmin }: UserAccountNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking anywhere outside of it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Avatar Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-muted transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background">
        {user.image ? (
          <Image src={user.image} alt="Avatar" width={36} height={36} className="h-full w-full object-cover" />
        ) : (
          <UserIcon className="h-5 w-5 text-muted-foreground" />
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 origin-top-right rounded-lg border border-border/50 bg-background shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none animate-in fade-in slide-in-from-top-2 z-50">
          {/* User Info Header */}
          <div className="flex flex-col space-y-1 p-4 border-b border-border/50 bg-muted/20 rounded-t-lg">
            <p className="text-sm font-medium leading-none text-foreground">{user.name || "Customer"}</p>
            <p className="text-xs leading-none text-muted-foreground truncate mt-1">{user.email}</p>
          </div>

          {/* Navigation Links */}
          <div className="p-2 space-y-1">
            <Link
              href="/dashboard"
              onClick={() => setIsOpen(false)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
              <LayoutDashboard className="h-4 w-4" />
              My Templates
            </Link>

            {isAdmin && (
              <Link
                href="/admin/inventory"
                onClick={() => setIsOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors">
                <Shield className="h-4 w-4" />
                Admin Dashboard
              </Link>
            )}
          </div>

          {/* Sign Out Action */}
          <div className="p-2 border-t border-border/50">
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
