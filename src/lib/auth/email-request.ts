import type { NextAuthOptions } from "next-auth";
import { normalizeIdentityEmail } from "./identity-email";
import { trustedClientIp } from "./email-rate-limit";
import { VERIFY_REQUEST_PATH } from "./login-policy";

export type EmailRequestDependencies = {
  authUrl: string;
  runtime: { vercel?: string; nodeEnv?: string };
  allow: (email: string, ip: string) => Promise<boolean>;
};

// NextAuth v4 ignores extra segments; reject these before handing it a request.
export function isUnsupportedEmailInitiation(segments: string[]): boolean {
  return segments[0] === "signin" && segments[1] === "email" && segments.length !== 2;
}

export function emailRequestOptions(base: NextAuthOptions, request: Pick<Request, "method" | "headers">,
  segments: string[], deps: EmailRequestDependencies): NextAuthOptions {
  const options = { ...base };
  const initiation = request.method === "POST" && segments.length === 2 && segments[0] === "signin" && segments[1] === "email";
  if (!initiation || !base.providers.some(provider => provider.id === "email")) return options;
  const neutral = new URL(VERIFY_REQUEST_PATH, deps.authUrl).href;
  return {
    ...options,
    // v4 looks up a User before the verificationRequest callback. During this
    // request ONLY, supply its normal unknown-user path without a database lookup.
    // Callback requests retain the real guarded adapter and verified User creation.
    adapter: { ...base.adapter, getUserByEmail: async () => null },
    callbacks: {
      ...base.callbacks,
      async signIn(params) {
        if (params.account?.type === "email" && params.email?.verificationRequest === true) {
          try {
            const email = normalizeIdentityEmail(params.user.email);
            const ip = trustedClientIp(request.headers, deps.runtime);
            if (await deps.allow(email, ip)) return true;
            console.info("AUTH_EMAIL_THROTTLED");
            return neutral;
          } catch {
            // Same neutral response; no send/token creation when storage or IP fails.
            console.warn("AUTH_EMAIL_INITIATION_UNAVAILABLE");
            return neutral;
          }
        }
        return base.callbacks?.signIn ? base.callbacks.signIn(params) : false;
      }
    }
  };
}
