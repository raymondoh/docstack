import { Loader2 } from "lucide-react";

export type ConnectionButtonState = "idle" | "connecting" | "error";

export function GoogleConnectionButtonView({ state, onClick }: {
  state: ConnectionButtonState;
  onClick?: () => void;
}) {
  return <div className="mt-5">
    <button
      type="button"
      onClick={onClick}
      disabled={state === "connecting"}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60">
      {state === "connecting" && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {state === "connecting" ? "Connecting…" : "Connect Google"}
    </button>
    {state === "error" && <p role="alert" className="mt-3 text-sm text-destructive">
      We couldn&apos;t start the Google connection. Please try again.
    </p>}
  </div>;
}
