import type { BeginGoogleConnectionResult } from "./google-link-action";

export async function startGoogleConnection(
  begin: () => Promise<BeginGoogleConnectionResult>,
  startOAuth: () => Promise<unknown>
) {
  const result = await begin();
  if (result.status !== "ready") return result.status;
  await startOAuth();
  return "redirecting" as const;
}
