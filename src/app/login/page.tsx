import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginMethods } from "@/components/auth/login-methods";
import { loginPageState } from "@/lib/auth/login-policy";
import { LoginErrorNotice } from "@/components/auth/auth-notice";
import Link from "next/link";

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = await searchParams;

  // If the user is already logged in, seamlessly bounce them to their dashboard
  const session = await getServerSession(authOptions);
  const emailEnabled = authOptions.providers.some(provider => provider.id === "email");
  const { callbackUrl, redirectTo, errorMessage } = loginPageState(resolvedParams, emailEnabled, !!session?.user);
  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-border/50 bg-background p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-foreground text-xl font-bold text-background mb-4">
            D
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Sign in to DocStack</h2>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to access your purchases and templates.</p>
        </div>

        <LoginErrorNotice message={errorMessage} />
        <div className="mt-8">
          <LoginMethods callbackUrl={callbackUrl} emailEnabled={emailEnabled} />
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline underline-offset-4 hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
