import { createHash } from "node:crypto";
import { createElement, type ReactElement } from "react";
import { Resend } from "resend";
import type { EmailConfig } from "next-auth/providers/email";
import { SignInEmail } from "./sign-in-email";
import { normalizeIdentityEmail } from "./identity-email";

type Mail = { from: string; to: string; subject: string; react: ReactElement; text: string };
export type AuthEmailSender = (mail: Mail, options: { idempotencyKey: string }) => Promise<{
  data?: { id: string } | null; error?: unknown;
}>;
export type EmailProviderSettings = { enabled: boolean; from: string; apiKey: string; authUrl: string };

export function emailProviders(settings: EmailProviderSettings, send?: AuthEmailSender): EmailConfig[] {
  if (!settings.enabled) return [];
  const deliver: AuthEmailSender = send ?? ((mail, options) => new Resend(settings.apiKey).emails.send(mail, options));
  return [{
    id: "email", type: "email", name: "Email", from: settings.from, maxAge: 15 * 60,
    server: {}, options: {}, // Required v4 shape; no SMTP transport is loaded or used.
    normalizeIdentifier: normalizeIdentityEmail,
    async sendVerificationRequest({ identifier, url, token }) {
      try {
        const recipient = normalizeIdentityEmail(identifier);
        const link = new URL(url);
        if (link.origin !== new URL(settings.authUrl).origin || link.pathname !== "/api/auth/callback/email" ||
            link.username || link.password || !["http:", "https:"].includes(link.protocol) ||
            link.searchParams.get("email") !== recipient || !token || link.searchParams.get("token") !== token) {
          throw new Error("Invalid authentication link.");
        }
        const idempotencyKey = "auth-signin-v1_" + createHash("sha256")
          .update("docstack:auth-email-send:v1\0" + url).digest("hex");
        const result = await deliver({
          from: settings.from, to: recipient, subject: "Sign in to DocStack",
          react: createElement(SignInEmail, { url }),
          text: `Sign in to DocStack\n\n${url}\n\nThis link expires in 15 minutes and can be used only once.\nIf you didn’t request this, you can ignore this email.`
        }, { idempotencyKey });
        if (result.error || !result.data?.id) throw new Error("Delivery failed.");
      } catch {
        // Never forward provider errors: they can contain recipients or request bodies.
        throw new Error("Authentication email delivery failed.");
      }
    }
  }];
}
