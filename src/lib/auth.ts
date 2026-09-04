import { NextAuthOptions } from "next-auth";

import GoogleProvider from "next-auth/providers/google";
import { env } from "@/lib/env";
import { authAdapter, ensurePersistentGoogleIdentity } from "@/lib/auth/firestore-identity";
import { AUTH_SESSION_STRATEGY, exposePersistentUserId, persistUserIdInJwt } from "@/lib/auth/session-identity";
import { emailProviders } from "./auth/email-provider";

export const authOptions: NextAuthOptions = {
  adapter: authAdapter,
  // NextAuth adapter error metadata can include email/token arguments. Never log it.
  logger: {
    error() { console.error("AUTH_OPERATION_FAILED"); },
    warn() { console.warn("AUTH_OPERATION_WARNING"); },
    debug() {}
  },
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt: "select_account"
        }
      }
    }),
    ...emailProviders({ enabled: env.AUTH_EMAIL_ENABLED === true, from: env.EMAIL_FROM, apiKey: env.RESEND_API_KEY, authUrl: env.NEXTAUTH_URL })
  ],
  callbacks: {
    async signIn({ account, profile, email }) {
      // Only the request-scoped, CSRF-validated initiation path can allow this.
      if (email?.verificationRequest === true) return false;
      if (account?.provider !== "google") return true;

      try {
        await ensurePersistentGoogleIdentity(account, profile);
        return true;
      } catch (error) {
        console.error("Persistent Google identity bootstrap failed:", error);
        return false;
      }
    },
    async jwt({ token, user }) {
      // On initial sign in, attach the user data to the token
      if (user) {
        persistUserIdInJwt(token, user);
        token.email = user.email;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      // Pass the token data into the browser session object
      if (session.user) {
        exposePersistentUserId(session, token);
        session.user.role = token.role as string;
      }
      return session;
    }
  },
  pages: {
    signIn: "/login" // Custom login page route
  },
  session: {
    strategy: AUTH_SESSION_STRATEGY,
    maxAge: 30 * 24 * 60 * 60 // 30 days
  },
  secret: env.NEXTAUTH_SECRET
};
