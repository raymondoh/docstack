"use server";

import { cookies, headers } from "next/headers";
import { createGoogleLinkIntent } from "@/lib/auth/google-link-service";
import {
  googleConnectionRequest,
  runBeginGoogleConnection,
  type BeginGoogleConnectionResult
} from "@/lib/auth/google-link-action";

export async function beginGoogleConnection(): Promise<BeginGoogleConnectionResult> {
  const incomingHeaders = await headers();
  const request = googleConnectionRequest(incomingHeaders.get("cookie"));
  return runBeginGoogleConnection(request, {
    create: createGoogleLinkIntent,
    async setCookie(cookie) {
      const store = await cookies();
      store.set(cookie.name, cookie.value, cookie.options);
    }
  });
}
