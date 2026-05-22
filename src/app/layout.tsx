// src/app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { NextAuthProvider } from "@/components/providers/session-provider";
import { Header } from "@/components/header/header";
import { Navbar } from "@/components/layout/navbar";
import "./globals.css";
import { siteConfig } from "@/config/siteConfig";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: `${siteConfig.name} | Premium Business Templates`,
  description: siteConfig.description
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <NextAuthProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {/* <-- ADD THE HEADER HERE --> */}
            <Navbar />

            {/* The rest of your pages will render below the header */}
            {children}
          </ThemeProvider>
        </NextAuthProvider>
      </body>
    </html>
  );
}
