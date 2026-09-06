import type { GoogleConnectionState } from "@/lib/auth/firestore-identity-store";
import { GoogleConnectionButton } from "./google-connection-button";
import { GoogleConnectionCardView } from "./google-connection-card-view";

export function GoogleConnectionCard({ email, connection, flow }: {
  email: string;
  connection: GoogleConnectionState;
  flow?: string;
}) {
  return <GoogleConnectionCardView
    email={email}
    connection={connection}
    flow={flow}
    connectControl={connection.canConnectGoogle ? <GoogleConnectionButton /> : null}
  />;
}
