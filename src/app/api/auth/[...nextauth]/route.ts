import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { adminDb } from "@/lib/firebase/admin";
import { createEmailRateLimiter } from "@/lib/auth/email-rate-limit";
import { emailRequestOptions, isUnsupportedEmailInitiation } from "@/lib/auth/email-request";
import { runGoogleLinkRequest } from "@/lib/auth/google-link-request";
import { googleLinkRuntime } from "@/lib/auth/google-link-service";

async function handler(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await context.params;
  if (isUnsupportedEmailInitiation(nextauth)) return new Response(null, { status: 404 });
  const options = emailRequestOptions(authOptions, request, nextauth, {
    authUrl: env.NEXTAUTH_URL,
    runtime: { vercel: process.env.VERCEL, nodeEnv: process.env.NODE_ENV },
    allow: createEmailRateLimiter(adminDb, env.AUTH_RATE_LIMIT_SECRET ?? "")
  });
  const googleLinkResponse = await runGoogleLinkRequest(
    request,
    nextauth,
    options,
    scoped => NextAuth(scoped)(request, context),
    {
      authUrl: env.NEXTAUTH_URL,
      secureCookie: googleLinkRuntime.secureCookie(),
      session: googleLinkRuntime.session,
      validate: googleLinkRuntime.validate,
      bind: googleLinkRuntime.bind,
      consume: googleLinkRuntime.consume
    }
  );
  if (googleLinkResponse) return googleLinkResponse;
  return NextAuth(options)(request, context);
}

export const runtime = "nodejs";

export { handler as GET, handler as POST };
