import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGoogleConnectionStateForUser } from "@/lib/auth/firestore-identity";
import { GoogleConnectionCard } from "@/components/account/google-connection-card";

export default async function SettingsPage({ searchParams }: {
  searchParams: Promise<{ google?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const connection = await getGoogleConnectionStateForUser(session.user.id);
  const flowValue = (await searchParams).google;
  const flow = typeof flowValue === "string" ? flowValue : undefined;

  return <div className="flex flex-col gap-8">
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
      <p className="mt-2 text-muted-foreground">Manage your account and sign-in methods.</p>
    </div>
    <GoogleConnectionCard email={session.user.email ?? "Unavailable"} connection={connection} flow={flow} />
  </div>;
}
