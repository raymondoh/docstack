import { env } from "@/lib/env";
import {
  bindGoogleLinkIntentToState,
  consumeGoogleLinkIntentAndLink,
  createGoogleLinkIntentForSession,
  validateUnboundGoogleLinkIntent
} from "./firestore-identity";
import {
  createGoogleLinkIntentToken,
  googleLinkIntentCookie,
  googleLinkSessionFromRequest
} from "./google-link-intent";
import type { NextRequest } from "next/server";

function secureCookie() {
  return new URL(env.NEXTAUTH_URL).protocol === "https:";
}

/**
 * Dormant Phase 2A.3b1 primitive. Only a future reviewed server action may call
 * this and set the returned HttpOnly cookie; no HTTP route invokes it today.
 */
export async function createGoogleLinkIntent(request: NextRequest) {
  const session = await googleLinkSessionFromRequest(request, env.NEXTAUTH_SECRET, secureCookie());
  const rawToken = createGoogleLinkIntentToken();
  const result = await createGoogleLinkIntentForSession(session, rawToken);
  return { ...result, cookie: googleLinkIntentCookie(rawToken, secureCookie()) };
}

export const googleLinkRuntime = {
  secureCookie,
  session: (request: NextRequest) =>
    googleLinkSessionFromRequest(request, env.NEXTAUTH_SECRET, secureCookie()),
  validate: validateUnboundGoogleLinkIntent,
  bind: (session: Awaited<ReturnType<typeof googleLinkSessionFromRequest>>, rawToken: string, state: string) =>
    bindGoogleLinkIntentToState(session, rawToken, state, env.NEXTAUTH_SECRET),
  consume: (session: Awaited<ReturnType<typeof googleLinkSessionFromRequest>>, rawToken: string, state: string,
    account: Parameters<typeof consumeGoogleLinkIntentAndLink>[4],
    profile: Parameters<typeof consumeGoogleLinkIntentAndLink>[5]) =>
    consumeGoogleLinkIntentAndLink(session, rawToken, state, env.NEXTAUTH_SECRET, account, profile)
};
