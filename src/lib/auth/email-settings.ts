import { z } from "zod";

export const authEmailEnabledSchema = z.enum(["true", "false"]).default("false").transform(value => value === "true");

export const authEmailSettingsSchema = z.object({
  AUTH_EMAIL_ENABLED: z.preprocess(value => value === "" ? undefined : value, authEmailEnabledSchema),
  AUTH_RATE_LIMIT_SECRET: z.preprocess(value => value === "" ? undefined : value, z.string().min(32).optional())
}).superRefine((settings, ctx) => {
  if (settings.AUTH_EMAIL_ENABLED && !settings.AUTH_RATE_LIMIT_SECRET) {
    ctx.addIssue({ code: "custom", path: ["AUTH_RATE_LIMIT_SECRET"], message: "Email authentication requires AUTH_RATE_LIMIT_SECRET of at least 32 characters." });
  }
});
