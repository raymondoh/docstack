import assert from "node:assert/strict";
import { it } from "node:test";
import type { NextAuthOptions } from "next-auth";
import { emailProviders, type AuthEmailSender } from "./email-provider";
import { authEmailEnabledSchema, authEmailSettingsSchema } from "./email-settings";
import { normalizeIdentityEmail } from "./identity-email";
import { emailRequestOptions, isUnsupportedEmailInitiation } from "./email-request";
import { canonicalClientIp, rateLimitIds, trustedClientIp } from "./email-rate-limit";

const settings = { enabled: true, from: "DocStack <signin@example.com>", apiKey: "re_synthetic", authUrl: "https://example.com" };
const token = "synthetic-link-token";
const url = `https://example.com/api/auth/callback/email?token=${token}&email=buyer%40example.com&callbackUrl=https%3A%2F%2Fexample.com`;

async function captureInfo(run: () => unknown | Promise<unknown>) {
  const original = console.info;
  const calls: unknown[][] = [];
  console.info = (...args: unknown[]) => { calls.push(args); };
  let error: unknown;
  try { await run(); } catch (caught) { error = caught; } finally { console.info = original; }
  return { calls, error };
}

it("logs only constant delivery stages for success and each sanitized failure", async () => {
  async function run(send: AuthEmailSender, requestUrl = url) {
    return captureInfo(async () => {
      const provider = emailProviders(settings, send)[0];
      await provider.sendVerificationRequest({ identifier: "buyer@example.com", token, url: requestUrl, provider, expires: new Date(), theme: {} });
    });
  }
  const successResult = await run(async () => ({ data: { id: "synthetic" } }));
  assert.equal(successResult.error, undefined);
  const success = successResult.calls;
  assert.deepEqual(success.flat(), ["AUTH_EMAIL_SEND_STARTED", "AUTH_EMAIL_LINK_VALIDATION_PASSED", "AUTH_EMAIL_RESEND_STARTED", "AUTH_EMAIL_RESEND_SUCCEEDED"]);
  for (const [send, diagnostic] of [
    [async () => ({ error: { private: url } }), "AUTH_EMAIL_RESEND_RETURNED_ERROR"],
    [async () => { throw new Error(url); }, null]
  ] as const) {
    const result = await run(send);
    assert.match(String(result.error), /Authentication email delivery failed/u);
    const calls = result.calls;
    assert.deepEqual(calls.flat(), ["AUTH_EMAIL_SEND_STARTED", "AUTH_EMAIL_LINK_VALIDATION_PASSED", "AUTH_EMAIL_RESEND_STARTED", ...(diagnostic ? [diagnostic] : []), "AUTH_EMAIL_SEND_FAILED"]);
  }
  const validationResult = await run(async () => ({ data: { id: "unused" } }), url.replace("example.com/", "evil.example/"));
  assert.match(String(validationResult.error), /Authentication email delivery failed/u);
  const validation = validationResult.calls;
  assert.deepEqual(validation.flat(), ["AUTH_EMAIL_SEND_STARTED", "AUTH_EMAIL_LINK_VALIDATION_FAILED", "AUTH_EMAIL_SEND_FAILED"]);
  for (const call of [...success, ...validation]) assert.equal(call.length, 1);
  assert.ok(![...success, ...validation].flat().join(" ").includes("buyer@example.com"));
  assert.ok(![...success, ...validation].flat().join(" ").includes(token));
});

it("validates enabled email and its secret together before request handling", () => {
  for (const flag of [undefined, "", "false"]) {
    const parsed = authEmailSettingsSchema.parse({ AUTH_EMAIL_ENABLED: flag });
    assert.equal(parsed.AUTH_EMAIL_ENABLED, false);
    assert.equal(parsed.AUTH_RATE_LIMIT_SECRET, undefined);
  }
  for (const size of [32, 64]) {
    assert.equal(authEmailSettingsSchema.parse({ AUTH_EMAIL_ENABLED: "true", AUTH_RATE_LIMIT_SECRET: "s".repeat(size) }).AUTH_EMAIL_ENABLED, true);
  }
  for (const secret of [undefined, "", "s".repeat(31)]) {
    assert.throws(() => authEmailSettingsSchema.parse({ AUTH_EMAIL_ENABLED: "true", AUTH_RATE_LIMIT_SECRET: secret }));
  }
  // A supplied short secret is rejected consistently even while disabled.
  assert.throws(() => authEmailSettingsSchema.parse({ AUTH_EMAIL_ENABLED: "false", AUTH_RATE_LIMIT_SECRET: "short" }));
  for (const flag of ["0", "yes", "enabled", "TRUE", true]) {
    assert.throws(() => authEmailSettingsSchema.parse({ AUTH_EMAIL_ENABLED: flag, AUTH_RATE_LIMIT_SECRET: "s".repeat(32) }));
  }
});

it("rejects extra email initiation segments without affecting legitimate auth routes", () => {
  assert.equal(isUnsupportedEmailInitiation(["signin", "email", "extra"]), true);
  assert.equal(isUnsupportedEmailInitiation(["signin", "email", "foo", "bar"]), true);
  for (const segments of [["signin", "email"], ["signin", "google"], ["callback", "google"], ["callback", "email"], ["csrf"], ["providers"], ["session"], ["signout"], ["error"]]) {
    assert.equal(isUnsupportedEmailInitiation(segments), false);
  }
});

it("defaults email off and registers only when explicitly enabled with v4 fields", () => {
  assert.equal(authEmailEnabledSchema.parse(undefined), false);
  assert.equal(authEmailEnabledSchema.parse("false"), false);
  assert.equal(authEmailEnabledSchema.parse("true"), true);
  assert.throws(() => authEmailEnabledSchema.parse("1"));
  assert.deepEqual(emailProviders({ ...settings, enabled: false }), []);
  const provider = emailProviders(settings)[0];
  assert.equal(provider.id, "email");
  assert.equal(provider.type, "email");
  assert.equal(provider.maxAge, 900);
  assert.equal(provider.normalizeIdentifier, normalizeIdentityEmail);
  assert.deepEqual(provider.server, {});
  assert.deepEqual(provider.options, {});
});

it("sends a separate React email and text with bounded token-derived idempotency", async () => {
  const calls: Parameters<AuthEmailSender>[] = [];
  const provider = emailProviders(settings, async (...args) => { calls.push(args); return { data: { id: "synthetic" } }; })[0];
  const params = { identifier: " BUYER@example.com ", token, url, provider, expires: new Date(), theme: {} };
  await provider.sendVerificationRequest(params);
  await provider.sendVerificationRequest(params);
  assert.equal(calls[0][0].to, "buyer@example.com");
  assert.equal(calls[0][0].from, settings.from);
  assert.equal(calls[0][0].react.props.url, url);
  assert.ok(calls[0][0].text.includes(url));
  assert.ok(calls[0][0].text.includes("15 minutes"));
  assert.equal(calls[0][1].idempotencyKey, calls[1][1].idempotencyKey);
  assert.match(calls[0][1].idempotencyKey, /^auth-signin-v1_[a-f0-9]{64}$/u);
  await provider.sendVerificationRequest({ ...params, token: "different", url: url.replace(token, "different") });
  assert.notEqual(calls[2][1].idempotencyKey, calls[0][1].idempotencyKey);
});

it("returned errors, thrown exceptions and foreign URLs fail without exposing delivery details", async () => {
  for (const send of [
    async () => ({ error: { message: url } }),
    async () => { throw new Error(url); },
    async () => ({ data: null })
  ]) {
    const provider = emailProviders(settings, send)[0];
    await assert.rejects(provider.sendVerificationRequest({ identifier: "buyer@example.com", token, url, provider, expires: new Date(), theme: {} }),
      (error: unknown) => error instanceof Error && error.message === "Authentication email delivery failed.");
  }
  let sends = 0;
  const provider = emailProviders(settings, async () => { sends++; return { data: { id: "synthetic" } }; })[0];
  await assert.rejects(provider.sendVerificationRequest({ identifier: "buyer@example.com", token, url: url.replace("example.com/", "evil.example/"), provider, expires: new Date(), theme: {} }));
  assert.equal(sends, 0);
});

it("trusts only validated platform IP and uses a shared local bucket, never arbitrary forwarding", () => {
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4" });
  assert.throws(() => trustedClientIp(headers, { vercel: "1" }));
  headers.set("x-vercel-forwarded-for", "2001:0db8:0:0:0:0:0:1");
  assert.equal(trustedClientIp(headers, { vercel: "1" }), "2001:db8::1");
  assert.equal(canonicalClientIp("2001:db8::1"), "2001:db8::1");
  assert.equal(trustedClientIp(headers, { nodeEnv: "development" }), "127.0.0.1");
  assert.throws(() => trustedClientIp(headers, { nodeEnv: "production" }));
  headers.set("x-vercel-forwarded-for", "1.2.3.4, 5.6.7.8");
  assert.throws(() => trustedClientIp(headers, { vercel: "1" }));
  const ids = rateLimitIds("buyer@example.com", "2001:db8::1", "s".repeat(32));
  assert.ok(!ids.join().includes("@") && !ids.join().includes("2001"));
});

it("request options fail closed on email storage failure without changing Google or the shared adapter", async () => {
  let google = 0;
  const base: NextAuthOptions = {
    providers: emailProviders(settings), adapter: { getUserByEmail: async () => { throw new Error("Identity lookup must not run"); } },
    callbacks: { signIn: async () => { google++; return true; } }
  };
  const deps = { authUrl: settings.authUrl, runtime: { nodeEnv: "test" }, allow: async () => { throw new Error("Storage failed"); } };
  const request = new Request("https://example.com/api/auth/signin/email", { method: "POST" });
  const scoped = emailRequestOptions(base, request, ["signin", "email"], deps);
  assert.equal(await scoped.adapter!.getUserByEmail!("buyer@example.com"), null);
  assert.notEqual(scoped.adapter, base.adapter);
  const result = await scoped.callbacks!.signIn!({ user: { id: "temporary", email: "buyer@example.com" }, account: { provider: "email", type: "email", providerAccountId: "buyer@example.com" }, email: { verificationRequest: true } });
  assert.equal(result, "https://example.com/api/auth/verify-request?provider=email&type=email");
  assert.equal(google, 0);
  const googleOptions = emailRequestOptions(base, request, ["signin", "google"], deps);
  assert.equal(googleOptions.adapter, base.adapter);
  assert.equal(await googleOptions.callbacks!.signIn!({ user: { id: "sub" }, account: { provider: "google", type: "oauth", providerAccountId: "sub" } }), true);
  const callbackOptions = emailRequestOptions(base, request, ["callback", "email"], deps);
  assert.equal(callbackOptions.adapter, base.adapter);
});
