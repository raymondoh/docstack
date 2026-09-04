export const CHECK_EMAIL_PATH = "/login/check-email";
export const AUTH_ERROR_PATH = "/login/error";
// Both accepted and blocked initiation use this NextAuth endpoint, which then
// redirects through pages.verifyRequest to the static customer-facing page.
export const VERIFY_REQUEST_PATH = "/api/auth/verify-request?provider=email&type=email";

export function resolveLoginCallback(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/u.test(value)) return "/dashboard";
  try {
    const url = new URL(value, "https://docstack.invalid");
    if (url.origin === "https://docstack.invalid" && ["/success", "/checkout/cancel"].includes(url.pathname)) return url.pathname + url.search;
  } catch { /* Invalid callbacks use the account dashboard. */ }
  return "/dashboard";
}

export function authErrorMessage(code: unknown, emailEnabled: boolean): string {
  switch (code) {
    case "Verification": return "This sign-in link is invalid, expired, or has already been used. Request a new sign-in link.";
    case "LinkingRequired": return emailEnabled
      ? "We couldn't complete Google sign-in. Try Continue with email using the same address."
      : "We couldn't complete Google sign-in. Try the sign-in method you previously used.";
    case "OAuthAccountNotLinked": return "We couldn't complete Google sign-in. Try the sign-in method you previously used.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount": return "We couldn't complete sign-in. Please try again.";
    case "Configuration": return "Sign-in is temporarily unavailable. Please try again shortly.";
    case "AccessDenied":
    case "EmailSignin":
    default: return "We couldn't complete sign-in. Please try again or try another sign-in method.";
  }
}

export function loginPageState(params: { callbackUrl?: unknown; error?: unknown }, emailEnabled: boolean, authenticated: boolean) {
  const callbackUrl = resolveLoginCallback(params.callbackUrl);
  return {
    callbackUrl,
    redirectTo: authenticated ? callbackUrl : null,
    errorMessage: !authenticated && params.error !== undefined ? authErrorMessage(params.error, emailEnabled) : null,
  };
}
