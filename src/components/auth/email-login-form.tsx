"use client";

import React, { useRef, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { CHECK_EMAIL_PATH, resolveLoginCallback } from "@/lib/auth/login-policy";

export function EmailLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    submitting.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await signIn("email", { email, callbackUrl: resolveLoginCallback(callbackUrl), redirect: false });
      if (!result?.ok || result.error) throw new Error("Initiation unavailable");
      window.location.assign(CHECK_EMAIL_PATH);
    } catch {
      setError("We couldn't start email sign-in. Please try again.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" aria-busy={loading}>
      <label htmlFor="login-email" className="block text-sm font-medium">Email address</label>
      <input id="login-email" name="email" type="email" autoComplete="email" required disabled={loading}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-70" />
      <button type="submit" disabled={loading} className="w-full rounded-md border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-70">Continue with email</button>
      {loading && <p role="status" className="text-sm text-muted-foreground">Starting email sign-in…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
