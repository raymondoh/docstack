import { NextAuthOptions } from "next-auth";

import GoogleProvider from "next-auth/providers/google";
import { env } from "@/lib/env";
import { authAdapter, ensurePersistentGoogleIdentity } from "@/lib/auth/firestore-identity";
import { AUTH_SESSION_STRATEGY, exposePersistentUserId, persistUserIdInJwt } from "@/lib/auth/session-identity";

export const authOptions: NextAuthOptions = {
  adapter: authAdapter,
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET
    })
  ],
  callbacks: {
    async signIn({ account, profile }) {
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
