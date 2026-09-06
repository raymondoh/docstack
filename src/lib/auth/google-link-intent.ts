import { createHash, createHmac, randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { decode, type JWT } from "next-auth/jwt";
import { validPersistentUserId } from "./google-identity";

export const GOOGLE_LINK_INTENT_LIFETIME_SECONDS = 10 * 60;
export const GOOGLE_LINK_INTENTS = "authLinkIntents";
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BINDING_PATTERN = /^[a-f0-9]{64}$/u;

export class GoogleLinkIntentError extends Error {
  constructor() {
    super("Google account linking could not be verified.");
    this.name = "GoogleLinkIntentError";
  }
}

export type GoogleLinkSession = { userId: string; sessionBinding: string };
export type GoogleLinkIntentRecord = {
  purpose: "google_link";
  intentVersion: 1;
  userId: string;
  sessionBinding: string;
  stateBinding: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
};

export function createGoogleLinkIntentToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function googleLinkIntentDocumentId(rawToken: string) {
  if (!TOKEN_PATTERN.test(rawToken)) throw new GoogleLinkIntentError();
  return "google-link-v1_" + createHash("sha256")
    .update("docstack:google-link-intent:v1\0" + rawToken).digest("hex");
}

function binding(secret: string, domain: string, value: string) {
  if (secret.length === 0 || value.length === 0) throw new GoogleLinkIntentError();
  return createHmac("sha256", secret).update(domain + "\0" + value).digest("hex");
}

export function googleLinkSessionBinding(rawSessionToken: string, secret: string) {
  return binding(secret, "docstack:google-link-session:v1", rawSessionToken);
}

export function googleLinkStateBinding(state: string, secret: string) {
  if (state.length > 1024) throw new GoogleLinkIntentError();
  return binding(secret, "docstack:google-link-oauth-state:v1", state);
}

function persistentClaims(jwt: JWT | null): string {
  if (!jwt || !validPersistentUserId(jwt.uid) || !validPersistentUserId(jwt.sub) || jwt.uid !== jwt.sub) {
    throw new GoogleLinkIntentError();
  }
  return jwt.uid;
}

export async function decodeGoogleLinkSession(rawSessionToken: string | null, secret: string): Promise<GoogleLinkSession> {
  if (!rawSessionToken) throw new GoogleLinkIntentError();
  try {
    const jwt = await decode({ token: rawSessionToken, secret });
    return { userId: persistentClaims(jwt), sessionBinding: googleLinkSessionBinding(rawSessionToken, secret) };
  } catch {
    throw new GoogleLinkIntentError();
  }
}

export function nextAuthSessionCookieName(secure: boolean) {
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

/**
 * Compatibility bridge for NextAuth 4.24.15's SessionStore chunk naming. This
 * deliberately reads only the canonical browser cookie and never its Bearer
 * fallback. Header order is irrelevant; chunk indices must be unique and
 * contiguous from zero, and a base cookie cannot coexist with chunks.
 */
export function nextAuthSessionCookieFromRequest(request: Request, secure: boolean) {
  const baseName = nextAuthSessionCookieName(secure);
  let whole: string | null = null;
  const chunks = new Map<number, string>();

  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== baseName && !name.startsWith(baseName + ".")) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) throw new GoogleLinkIntentError();

    if (name === baseName) {
      if (whole !== null) throw new GoogleLinkIntentError();
      whole = value;
      continue;
    }

    const suffix = name.slice(baseName.length + 1);
    if (!/^(?:0|[1-9][0-9]*)$/u.test(suffix)) throw new GoogleLinkIntentError();
    const index = Number(suffix);
    if (!Number.isSafeInteger(index) || chunks.has(index)) throw new GoogleLinkIntentError();
    chunks.set(index, value);
  }

  if (whole !== null) {
    if (chunks.size) throw new GoogleLinkIntentError();
    return whole;
  }
  if (!chunks.size) throw new GoogleLinkIntentError();
  const ordered = [...chunks.entries()].sort(([a], [b]) => a - b);
  if (ordered.some(([index], position) => index !== position)) throw new GoogleLinkIntentError();
  const token = ordered.map(([, value]) => value).join("");
  if (!token) throw new GoogleLinkIntentError();
  return token;
}

export async function googleLinkSessionFromRequest(request: Request, secret: string, secureCookie: boolean) {
  return decodeGoogleLinkSession(nextAuthSessionCookieFromRequest(request, secureCookie), secret);
}

export function googleLinkIntentRecord(userId: string, sessionBinding: string, now = Timestamp.now()):
GoogleLinkIntentRecord {
  if (!validPersistentUserId(userId) || !BINDING_PATTERN.test(sessionBinding)) throw new GoogleLinkIntentError();
  return {
    purpose: "google_link",
    intentVersion: 1,
    userId,
    sessionBinding,
    stateBinding: null,
    createdAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + GOOGLE_LINK_INTENT_LIFETIME_SECONDS * 1000)
  };
}

export function validateGoogleLinkIntentRecord(data: FirebaseFirestore.DocumentData | undefined,
  now: Timestamp): GoogleLinkIntentRecord {
  const keys = ["purpose", "intentVersion", "userId", "sessionBinding", "stateBinding", "createdAt", "expiresAt"];
  if (!data || Object.keys(data).length !== keys.length || !Object.keys(data).every(key => keys.includes(key)) ||
      data.purpose !== "google_link" || data.intentVersion !== 1 || !validPersistentUserId(data.userId) ||
      !BINDING_PATTERN.test(data.sessionBinding) ||
      (data.stateBinding !== null && !BINDING_PATTERN.test(data.stateBinding)) ||
      !(data.createdAt instanceof Timestamp) || !(data.expiresAt instanceof Timestamp) ||
      data.expiresAt.toMillis() - data.createdAt.toMillis() !== GOOGLE_LINK_INTENT_LIFETIME_SECONDS * 1000 ||
      data.createdAt.toMillis() > now.toMillis() || data.expiresAt.toMillis() <= now.toMillis()) {
    throw new GoogleLinkIntentError();
  }
  return data as GoogleLinkIntentRecord;
}

export function googleLinkIntentCookieName(secure: boolean) {
  return secure ? "__Secure-docstack.google-link-intent" : "docstack.google-link-intent";
}

export function googleLinkIntentCookie(rawToken: string, secure: boolean) {
  googleLinkIntentDocumentId(rawToken);
  return {
    name: googleLinkIntentCookieName(secure),
    value: rawToken,
    options: {
      httpOnly: true as const,
      sameSite: "lax" as const,
      secure,
      path: "/api/auth",
      maxAge: GOOGLE_LINK_INTENT_LIFETIME_SECONDS
    }
  };
}

export function readGoogleLinkIntentCookie(request: Request, secure: boolean) {
  const name = googleLinkIntentCookieName(secure);
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return TOKEN_PATTERN.test(value) ? value : null;
    }
  }
  return null;
}

function serializeCookie(name: string, value: string, secure: boolean, maxAge: number) {
  return `${name}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function setGoogleLinkIntentCookie(response: Response, rawToken: string, secure: boolean) {
  const cookie = googleLinkIntentCookie(rawToken, secure);
  response.headers.append("Set-Cookie", serializeCookie(cookie.name, cookie.value, secure, cookie.options.maxAge));
  return response;
}

export function clearGoogleLinkIntentCookie(response: Response, secure: boolean) {
  response.headers.append("Set-Cookie", serializeCookie(googleLinkIntentCookieName(secure), "", secure, 0));
  return response;
}

export async function googleOAuthStateFromResponse(response: Response) {
  let redirect = response.headers.get("location");
  if (!redirect && response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await response.clone().json() as { url?: unknown };
      if (typeof body.url === "string") redirect = body.url;
    } catch {
      throw new GoogleLinkIntentError();
    }
  }
  if (!redirect) throw new GoogleLinkIntentError();
  const values = new URL(redirect).searchParams.getAll("state");
  if (values.length !== 1 || !values[0]) throw new GoogleLinkIntentError();
  return values[0];
}
