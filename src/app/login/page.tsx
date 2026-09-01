import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LoginButton } from "@/components/auth/login-button";
import Link from "next/link";

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedParams = await searchParams;
  const requestedCallback = typeof resolvedParams.callbackUrl === "string" ? resolvedParams.callbackUrl : "";
  let callbackUrl = "/dashboard";
  try {
    const parsedCallback = new URL(requestedCallback, "https://docstack.invalid");
    if (
      parsedCallback.origin === "https://docstack.invalid" &&
      ["/checkout/cancel", "/success"].includes(parsedCallback.pathname)
    ) {
      callbackUrl = `${parsedCallback.pathname}${parsedCallback.search}`;
    }
  } catch {
    // Invalid or external callbacks fall back to the authenticated dashboard.
  }

  // If the user is already logged in, seamlessly bounce them to their dashboard
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(callbackUrl);
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

        <div className="mt-8">
          <LoginButton callbackUrl={callbackUrl} />
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
