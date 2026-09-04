import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { normalizeIdentityEmail } from "./identity-email";

export const AUTH_RATE_LIMITS = "authRateLimits";
export const EMAIL_LIMIT_POLICY = Object.freeze({ minuteMs: 60_000, hourMs: 3_600_000, emailMinute: 1, emailHour: 5, ipHour: 20, globalHour: 100 });

export function canonicalClientIp(value: string): string {
  const kind = isIP(value);
  if (!kind || value.includes("%")) throw new Error("Trusted client IP unavailable.");
  return kind === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}

export function trustedClientIp(headers: Headers, runtime: { vercel?: string; nodeEnv?: string }): string {
  if (runtime.vercel === "1") {
    // Trust only Vercel's platform header, not arbitrary X-Forwarded-For chains.
    return canonicalClientIp(headers.get("x-vercel-forwarded-for") ?? "");
  }
  // Local development has no trusted proxy; all local callers share one bucket.
  if (runtime.nodeEnv === "development" || runtime.nodeEnv === "test") return "127.0.0.1";
  throw new Error("Trusted client IP unavailable.");
}

export function rateLimitIds(email: string, ip: string, secret: string): string[] {
  const identifier = normalizeIdentityEmail(email);
  if (secret.length < 32) throw new Error("Email rate-limit configuration unavailable.");
  const address = canonicalClientIp(ip);
  return [
    "email-v1_" + createHash("sha256").update("docstack:auth-rate-email:v1\0" + identifier).digest("hex"),
    "ip-v1_" + createHmac("sha256", secret).update("docstack:auth-rate-ip:v1\0" + address).digest("hex"),
    "global-v1"
  ];
}

// Rolling-window logs are bounded to 5 / 20 / 100 timestamps, not unbounded history.
export function createEmailRateLimiter(db: Firestore, secret: string, clock = Date.now) {
  return async (email: string, ip: string): Promise<boolean> => {
    const refs = rateLimitIds(email, ip, secret).map(id => db.collection(AUTH_RATE_LIMITS).doc(id));
    return db.runTransaction(async tx => {
      const snapshots = await tx.getAll(...refs);
      const now = clock();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("Email rate-limit clock unavailable.");
      const caps = [EMAIL_LIMIT_POLICY.emailHour, EMAIL_LIMIT_POLICY.ipHour, EMAIL_LIMIT_POLICY.globalHour];
      const recent = snapshots.map((snap, index) => {
        if (!snap.exists) return [] as number[];
        const data = snap.data()!;
        if (Object.keys(data).length !== 3 || !Object.keys(data).every(key => ["requests", "updatedAt", "cleanupAt"].includes(key)) ||
            !(data.updatedAt instanceof Timestamp) || !(data.cleanupAt instanceof Timestamp) ||
            !Array.isArray(data.requests) || data.requests.length > caps[index] ||
            data.requests.some((value: unknown) => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > now)) {
          throw new Error("Email rate-limit state unavailable.");
        }
        return (data.requests as number[]).filter(time => time > now - EMAIL_LIMIT_POLICY.hourMs);
      });
      if (recent.some((times, index) => times.length >= caps[index]) ||
          recent[0].filter(time => time > now - EMAIL_LIMIT_POLICY.minuteMs).length >= EMAIL_LIMIT_POLICY.emailMinute) return false;
      refs.forEach((ref, index) => tx.set(ref, {
        requests: [...recent[index], now], updatedAt: Timestamp.fromMillis(now),
        cleanupAt: Timestamp.fromMillis(now + 2 * EMAIL_LIMIT_POLICY.hourMs)
      }));
      return true;
    });
  };
}
