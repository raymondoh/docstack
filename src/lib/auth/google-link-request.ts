import type { Account, NextAuthOptions, Profile } from "next-auth";
import {
  clearGoogleLinkIntentCookie,
  googleOAuthStateFromResponse,
  readGoogleLinkIntentCookie,
  type GoogleLinkSession
} from "./google-link-intent";

type GoogleLinkRequestRuntime = {
  authUrl: string;
  secureCookie: boolean;
  session(request: Request): Promise<GoogleLinkSession>;
  validate(session: GoogleLinkSession, rawToken: string): Promise<void>;
  bind(session: GoogleLinkSession, rawToken: string, state: string): Promise<void>;
  consume(session: GoogleLinkSession, rawToken: string, state: string,
    account: Account | null, profile: Profile | undefined): Promise<{ status: "linked" | "rejected" }>;
};

function googleInitiation(segments: string[], method: string) {
  return method === "POST" && segments.length === 2 &&
    segments[0] === "signin" && segments[1] === "google";
}

function googleCallback(segments: string[], method: string) {
  return method === "GET" && segments.length === 2 &&
    segments[0] === "callback" && segments[1] === "google";
}

function fixedFailure(runtime: GoogleLinkRequestRuntime) {
  return clearGoogleLinkIntentCookie(new Response(null, {
    status: 302,
    headers: { location: new URL("/login?error=OAuthAccountNotLinked", runtime.authUrl).href }
  }), runtime.secureCookie);
}

export async function runGoogleLinkRequest(request: Request, segments: string[], base: NextAuthOptions,
  nextAuth: (options: NextAuthOptions) => Promise<Response>, runtime: GoogleLinkRequestRuntime) {
  const rawToken = readGoogleLinkIntentCookie(request, runtime.secureCookie);
  if (!rawToken || (!googleInitiation(segments, request.method) && !googleCallback(segments, request.method))) {
    return null;
  }

  if (googleInitiation(segments, request.method)) {
    try {
      const session = await runtime.session(request);
      await runtime.validate(session, rawToken);
      const response = await nextAuth(base);
      const state = await googleOAuthStateFromResponse(response);
      await runtime.bind(session, rawToken, state);
      return response;
    } catch {
      console.error("AUTH_GOOGLE_LINK_INTENT_FAILED");
      return fixedFailure(runtime);
    }
  }

  let session: GoogleLinkSession | null = null;
  try {
    session = await runtime.session(request);
  } catch {
    // NextAuth must still validate its own state before the request-local denial.
  }
  const states = new URL(request.url).searchParams.getAll("state");
  const callbackState = states.length === 1 && states[0] ? states[0] : null;
  const options: NextAuthOptions = {
    ...base,
    callbacks: {
      ...base.callbacks,
      async signIn({ account, profile }) {
        if (!session || !callbackState || account?.provider !== "google") return false;
        try {
          const result = await runtime.consume(session, rawToken, callbackState, account, profile);
          return result.status === "linked"
            ? true
            : new URL("/dashboard/settings?google=error", runtime.authUrl).href;
        } catch {
          console.error("AUTH_GOOGLE_LINK_INTENT_FAILED");
          return false;
        }
      }
    }
  };
  return clearGoogleLinkIntentCookie(await nextAuth(options), runtime.secureCookie);
}
