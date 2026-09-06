"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { beginGoogleConnection } from "@/actions/google-connection";
import { startGoogleConnection } from "@/lib/auth/google-link-client";
import { GoogleConnectionButtonView, type ConnectionButtonState } from "./google-connection-button-view";

export function GoogleConnectionButton() {
  const [state, setState] = useState<ConnectionButtonState>("idle");
  const router = useRouter();

  async function connect() {
    if (state === "connecting") return;
    setState("connecting");
    try {
      const result = await startGoogleConnection(beginGoogleConnection, () =>
        signIn("google", { callbackUrl: "/dashboard/settings?google=connected" }));
      if (result === "already_connected") {
        setState("idle");
        router.refresh();
      } else if (result === "error") {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  return <GoogleConnectionButtonView state={state} onClick={connect} />;
}
