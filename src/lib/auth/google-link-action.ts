import type { googleLinkIntentCookie } from "./google-link-intent";

export type BeginGoogleConnectionResult =
  | { status: "ready" }
  | { status: "already_connected" }
  | { status: "error" };

type IntentCookie = ReturnType<typeof googleLinkIntentCookie>;

type BeginGoogleConnectionRuntime = {
  create(request: Request): Promise<
    | { status: "already_connected" }
    | { status: "ready"; cookie: IntentCookie }
  >;
  setCookie(cookie: IntentCookie): Promise<void>;
};

export function googleConnectionRequest(cookieHeader: string | null) {
  return new Request("https://docstack.invalid/dashboard/settings", {
    headers: cookieHeader ? { cookie: cookieHeader } : {}
  });
}

export async function runBeginGoogleConnection(request: Request,
  runtime: BeginGoogleConnectionRuntime): Promise<BeginGoogleConnectionResult> {
  try {
    const prepared = await runtime.create(request);
    if (prepared.status === "already_connected") return { status: "already_connected" };
    await runtime.setCookie(prepared.cookie);
    return { status: "ready" };
  } catch {
    console.error("AUTH_GOOGLE_LINK_START_FAILED");
    return { status: "error" };
  }
}
