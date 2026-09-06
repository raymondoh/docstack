import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import type { GoogleConnectionState } from "@/lib/auth/firestore-identity-store";

export function GoogleConnectionCardView({ email, connection, flow, connectControl }: {
  email: string;
  connection: GoogleConnectionState;
  flow?: string;
  connectControl?: ReactNode;
}) {
  const showSuccess = flow === "connected" && connection.googleConnected;
  const showError = flow === "error";

  return <div className="overflow-hidden rounded-xl border border-border/50 bg-background shadow-sm">
    <div className="border-b border-border/50 p-6">
      <h2 className="text-lg font-semibold text-foreground">Account connections</h2>
      <p className="mt-1 text-sm text-muted-foreground">Manage the ways you sign in to DocStack.</p>
    </div>
    <div className="space-y-6 p-6">
      {showSuccess && <div role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        Google was connected successfully.
      </div>}
      {showError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        We couldn&apos;t connect that Google account. Make sure you choose the Google account that uses the same email address and try again.
      </div>}
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</p>
        <p className="mt-1 break-all text-sm font-medium text-foreground">{email}</p>
      </div>
      <div className="border-t border-border/50 pt-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Google</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {connection.googleConnected ? "Connected" : connection.canConnectGoogle ? "Not connected" : "Unavailable"}
            </p>
          </div>
          {connection.googleConnected && <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Connected
          </span>}
        </div>
        {connection.canConnectGoogle && <>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
            Connect the Google account that uses the same email address as this DocStack account.
            Your purchases and account will stay exactly where they are.
          </p>
          {connectControl}
        </>}
        {!connection.googleConnected && !connection.canConnectGoogle &&
          <p className="mt-4 text-sm text-muted-foreground">Account connections are temporarily unavailable.</p>}
      </div>
    </div>
  </div>;
}
