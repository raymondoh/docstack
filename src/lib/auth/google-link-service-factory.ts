import type { Account, Profile } from "next-auth";
import {
  createGoogleLinkIntentToken,
  googleLinkIntentCookie,
  googleLinkSessionFromRequest,
  type GoogleLinkSession
} from "./google-link-intent";

type GoogleLinkStore = {
  createGoogleLinkIntentForSession(session: GoogleLinkSession, rawToken: string): Promise<
    | { status: "already_connected" }
    | { status: "ready"; expiresAt: FirebaseFirestore.Timestamp }
  >;
  validateUnboundGoogleLinkIntent(session: GoogleLinkSession, rawToken: string): Promise<void>;
  bindGoogleLinkIntentToState(session: GoogleLinkSession, rawToken: string, state: string,
    secret: string): Promise<void>;
  consumeGoogleLinkIntentAndLink(session: GoogleLinkSession, rawToken: string, state: string,
    secret: string, account: Account | null, profile: Profile | undefined): Promise<
      { status: "linked" | "rejected" }
    >;
};

export function createGoogleLinkService(authUrl: string, secret: string, store: GoogleLinkStore) {
  const secureCookie = () => new URL(authUrl).protocol === "https:";

  async function createGoogleLinkIntent(request: Request) {
    const session = await googleLinkSessionFromRequest(request, secret, secureCookie());
    const rawToken = createGoogleLinkIntentToken();
    const result = await store.createGoogleLinkIntentForSession(session, rawToken);
    if (result.status === "already_connected") return result;
    return { ...result, cookie: googleLinkIntentCookie(rawToken, secureCookie()) };
  }

  return {
    createGoogleLinkIntent,
    runtime: {
      secureCookie,
      session: (request: Request) => googleLinkSessionFromRequest(request, secret, secureCookie()),
      validate: store.validateUnboundGoogleLinkIntent,
      bind: (session: GoogleLinkSession, rawToken: string, state: string) =>
        store.bindGoogleLinkIntentToState(session, rawToken, state, secret),
      consume: (session: GoogleLinkSession, rawToken: string, state: string,
        account: Account | null, profile: Profile | undefined) =>
        store.consumeGoogleLinkIntentAndLink(session, rawToken, state, secret, account, profile)
    }
  };
}
