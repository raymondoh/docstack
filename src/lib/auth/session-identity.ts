import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

export const AUTH_SESSION_STRATEGY = "jwt" as const;

export function persistUserIdInJwt(token: JWT, user?: User) {
  if (user?.id) token.uid = user.id;
  return token;
}

export function exposePersistentUserId(session: Session, token: JWT) {
  if (session.user && typeof token.uid === "string") session.user.id = token.uid;
  return session;
}

export function authenticatedOrderBelongsToUser(orderUserId: string | null, sessionUserId: string) {
  return orderUserId === sessionUserId;
}
