import { AuthNotice } from "@/components/auth/auth-notice";
import { authOptions } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth/login-policy";

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  return <AuthNotice title="Unable to sign in" message={authErrorMessage(error, authOptions.providers.some(provider => provider.id === "email"))} />;
}
