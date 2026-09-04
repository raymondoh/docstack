import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { adminDb } from "@/lib/firebase/admin";
import { createEmailRateLimiter } from "@/lib/auth/email-rate-limit";
import { emailRequestOptions, isUnsupportedEmailInitiation } from "@/lib/auth/email-request";

async function handler(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await context.params;
  if (isUnsupportedEmailInitiation(nextauth)) return new Response(null, { status: 404 });
  const options = emailRequestOptions(authOptions, request, nextauth, {
    authUrl: env.NEXTAUTH_URL,
    runtime: { vercel: process.env.VERCEL, nodeEnv: process.env.NODE_ENV },
    allow: createEmailRateLimiter(adminDb, env.AUTH_RATE_LIMIT_SECRET ?? "")
  });
  return NextAuth(options)(request, context);
}

export const runtime = "nodejs";

export { handler as GET, handler as POST };
