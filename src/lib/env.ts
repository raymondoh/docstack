import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { authEmailSettingsSchema } from "./auth/email-settings";

// Enforce the cross-field invariant at server initialization, even when general
// env validation is skipped. Never read server secrets in the browser.
if (typeof window === "undefined") {
  authEmailSettingsSchema.parse({
    AUTH_EMAIL_ENABLED: process.env.AUTH_EMAIL_ENABLED,
    AUTH_RATE_LIMIT_SECRET: process.env.AUTH_RATE_LIMIT_SECRET,
  });
}

export const env = createEnv({
  server: {
    // Auth & NextAuth
    ADMIN_EMAIL: z.string().email(),
    NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
    NEXTAUTH_SECRET: z.string().min(1),
    ...authEmailSettingsSchema.shape,
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),

    // Firebase Admin
    // Local development can point to a service-account JSON file.
    // Deployment can continue using the JSON/env credential methods below.
    FIREBASE_SERVICE_ACCOUNT_PATH: z.string().min(1).optional(),
    FIREBASE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),

    // Resend
    RESEND_API_KEY: z.string().startsWith("re_"),
    EMAIL_FROM: z.string().min(1),
    SUPPORT_EMAIL: z.string().email().default("support@yourstore.com"),
    FULFILLMENT_RECONCILIATION_SECRET: z.string().min(32).optional(),

    // Algolia Admin (For indexing)
    ALGOLIA_ADMIN_API_KEY: z.string().min(1).optional(),

    NODE_ENV: z.enum(["development", "test", "production"]),
  },

  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),

    // Firebase Client
    NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1),
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1),
    NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1),

    // Algolia Public
    NEXT_PUBLIC_ALGOLIA_APP_ID: z.string().min(1).optional(),
    NEXT_PUBLIC_ALGOLIA_SEARCH_ONLY_KEY: z.string().min(1).optional(),
  },

  // For Next.js App Router, we must manually destructure the client variables
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    NEXT_PUBLIC_ALGOLIA_APP_ID: process.env.NEXT_PUBLIC_ALGOLIA_APP_ID,
    NEXT_PUBLIC_ALGOLIA_SEARCH_ONLY_KEY: process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_ONLY_KEY,
  },

  // Skip validation for Jest/Vitest or during the build phase if needed
  skipValidation: process.env.NODE_ENV === "test" || !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
