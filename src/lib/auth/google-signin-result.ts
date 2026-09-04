import { IdentityConflictError } from "./identity-email";
import { AUTH_ERROR_PATH } from "./login-policy";

export function googleIdentityFailure(error: unknown): false | string {
  return error instanceof IdentityConflictError && error.code === "LINKING_REQUIRED"
    ? `${AUTH_ERROR_PATH}?error=LinkingRequired` : false;
}
