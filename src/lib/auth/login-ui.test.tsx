import assert from "node:assert/strict";
import { it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { authErrorMessage, loginPageState, resolveLoginCallback } from "./login-policy";
import { googleIdentityFailure } from "./google-signin-result";
import { IdentityConflictError } from "./identity-email";

// Components live outside the auth ESM package; use their actual CJS exports.
const require = createRequire(import.meta.url);
const { LoginMethods } = require("../../components/auth/login-methods.tsx");
const { AuthNotice, LoginErrorNotice } = require("../../components/auth/auth-notice.tsx");
const { AuthHandler } = require("../../../node_modules/next-auth/core/index.js");
const { default: CheckEmailPage } = require("../../app/login/check-email/page.tsx");

it("installed NextAuth routes standard errors through signin to the mapped login notice", async () => {
  const previousUrl = process.env.NEXTAUTH_URL;
  process.env.NEXTAUTH_URL = "https://example.com";
  try {
    const options = { secret: "synthetic-routing-test-secret", providers: [], pages: { signIn: "/login", error: "/login/error" }, logger: { error() {}, warn() {}, debug() {} } };
    for (const code of ["OAuthAccountNotLinked", "OAuthCallback", "OAuthSignin", "OAuthCreateAccount"]) {
      const errorResult = await AuthHandler({ req: { method: "GET", action: "error", error: code, headers: {}, cookies: {}, query: {} }, options });
      const signin = new URL(errorResult.redirect);
      assert.equal(signin.pathname, "/api/auth/signin");
      assert.equal(signin.searchParams.get("error"), code);
      const callbackUrl = "/success?session_id=synthetic";
      const signinResult = await AuthHandler({ req: { method: "GET", action: "signin", error: signin.searchParams.get("error"), headers: {}, cookies: {}, query: { callbackUrl } }, options });
      const login = new URL(signinResult.redirect, "https://example.com");
      assert.equal(login.pathname, "/login");
      assert.equal(login.searchParams.get("error"), code);
      const state = loginPageState(Object.fromEntries(login.searchParams), false, false);
      // v4 expands the callback to an absolute URL. Preserve DocStack's existing
      // relative-only policy: do not silently broaden it in this error-UX fix.
      assert.equal(login.searchParams.get("callbackUrl"), "https://example.com" + callbackUrl);
      assert.equal(state.callbackUrl, "/dashboard");
      assert.equal(state.redirectTo, null);
      const html = renderToStaticMarkup(<LoginErrorNotice message={state.errorMessage} />);
      assert.match(html, /role="alert"/);
      assert.match(html, code === "OAuthAccountNotLinked" ? /previously used/ : /Please try again/);
      assert.doesNotMatch(html, /OAuth/);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousUrl;
  }
});

it("login notices never echo arbitrary query values or trap authenticated sessions", () => {
  const recovery = loginPageState({ error: "OAuthAccountNotLinked", callbackUrl: "/success?session_id=synthetic" }, true, false);
  assert.equal(recovery.callbackUrl, "/success?session_id=synthetic");
  assert.match(recovery.errorMessage!, /previously used/);
  const attacker = "<script>alert(1)</script>";
  const state = loginPageState({ error: attacker, callbackUrl: "//evil.example" }, false, false);
  assert.equal(state.callbackUrl, "/dashboard");
  assert.doesNotMatch(renderToStaticMarkup(<LoginErrorNotice message={state.errorMessage} />), /script|alert\(1\)/);
  assert.match(state.errorMessage!, /couldn't complete sign-in/);
  for (const callbackUrl of ["/success?session_id=synthetic", "/checkout/cancel", "https://evil.example", "http://["]) {
    const signedIn = loginPageState({ error: "OAuthAccountNotLinked", callbackUrl }, true, true);
    assert.equal(signedIn.redirectTo, resolveLoginCallback(callbackUrl));
    assert.equal(signedIn.errorMessage, null);
  }
  assert.equal(loginPageState({}, false, false).errorMessage, null);
  for (const code of ["IDENTITY_CONFLICT", "EMAIL_CHANGE_REQUIRED"] as const) {
    assert.equal(googleIdentityFailure(new IdentityConflictError(code)), false);
    assert.doesNotMatch(authErrorMessage(code, true), /Continue with email/);
  }
});

it("check-email page is static, neutral and contains no submitted identifier", () => {
  const html = renderToStaticMarkup(<CheckEmailPage searchParams={{ email: "attacker@example.com" }} />);
  assert.match(html, /If the request was accepted/);
  assert.match(html, /spam folder/);
  assert.match(html, /href="\/login"/);
  assert.doesNotMatch(html, /attacker|account found|email sent/i);
});

it("resolves only approved relative login callbacks", () => {
  for (const value of [undefined, "", "/dashboard", "/admin", "https://evil.example/success", "//evil.example/success", "https://docstack.invalid/success", "http://[", "/\\evil.example/success", ["/success"]]) {
    assert.equal(resolveLoginCallback(value), "/dashboard");
  }
  for (const value of ["/success", "/success?session_id=synthetic", "/checkout/cancel", "/checkout/cancel?product=synthetic"]) assert.equal(resolveLoginCallback(value), value);
});

it("renders Google only when disabled and both methods when enabled", () => {
  const callbackUrl = resolveLoginCallback("/success?session_id=synthetic");
  const disabled = renderToStaticMarkup(<LoginMethods emailEnabled={false} callbackUrl={callbackUrl} />);
  assert.match(disabled, /Continue with Google/);
  assert.doesNotMatch(disabled, /type="email"|Continue with email|or continue with email/);
  const enabled = renderToStaticMarkup(<LoginMethods emailEnabled callbackUrl={callbackUrl} />);
  assert.match(enabled, /Continue with Google/);
  assert.match(enabled, /or continue with email/);
  assert.match(enabled, /type="email"/);
  assert.match(enabled, /autoComplete="email"/i);
  assert.match(enabled, /Continue with email/);
  // Inspect actual component props: both methods receive the identical callback.
  const tree = LoginMethods({ emailEnabled: true, callbackUrl });
  assert.equal(tree.props.children[0].props.callbackUrl, callbackUrl);
  assert.equal(tree.props.children[1].props.children[1].props.callbackUrl, callbackUrl);
});

it("maps only known error codes to static non-sensitive recovery messages", () => {
  assert.match(authErrorMessage("Verification", true), /expired.*already been used/);
  assert.match(authErrorMessage("AccessDenied", true), /couldn't complete sign-in/);
  assert.match(authErrorMessage("OAuthAccountNotLinked", true), /previously used/);
  assert.match(authErrorMessage("LinkingRequired", true), /Continue with email/);
  assert.doesNotMatch(authErrorMessage("LinkingRequired", false), /Continue with email/);
  assert.match(authErrorMessage("Configuration", true), /temporarily unavailable/);
  const attacker = "<script>attacker@example.com</script>";
  assert.doesNotMatch(renderToStaticMarkup(<AuthNotice title="Unable to sign in" message={authErrorMessage(attacker, true)} />), /attacker|script/);
  assert.equal(googleIdentityFailure(new IdentityConflictError("LINKING_REQUIRED")), "/login/error?error=LinkingRequired");
  assert.equal(googleIdentityFailure(new IdentityConflictError()), false);
  assert.equal(googleIdentityFailure(new Error("LINKING_REQUIRED")), false);
});
