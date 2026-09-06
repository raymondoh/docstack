import { env } from "@/lib/env";
import {
  bindGoogleLinkIntentToState,
  consumeGoogleLinkIntentAndLink,
  createGoogleLinkIntentForSession,
  validateUnboundGoogleLinkIntent
} from "./firestore-identity";
import { createGoogleLinkService } from "./google-link-service-factory";

const googleLinkService = createGoogleLinkService(env.NEXTAUTH_URL, env.NEXTAUTH_SECRET, {
  createGoogleLinkIntentForSession,
  validateUnboundGoogleLinkIntent,
  bindGoogleLinkIntentToState,
  consumeGoogleLinkIntentAndLink
});

export const createGoogleLinkIntent = googleLinkService.createGoogleLinkIntent;
export const googleLinkRuntime = googleLinkService.runtime;
