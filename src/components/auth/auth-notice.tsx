import * as React from "react";
import Link from "next/link";

export function LoginErrorNotice({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-md border border-border bg-muted/50 p-4 text-sm leading-relaxed">{message}</p> : null;
}

export function AuthNotice({ title, message }: { title: string; message: string }) {
  return <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
    <div className="w-full max-w-md space-y-6 rounded-2xl border border-border/50 bg-background p-8 shadow-sm">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">{message}</p>
      <Link href="/login" className="inline-block rounded-md underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">Back to Sign in</Link>
    </div>
  </div>;
}
