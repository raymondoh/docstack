// src/components/google-signin-button.tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase/client";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

export function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSignIn = async () => {
    setIsLoading(true);
    try {
      // 1. Trigger the Firebase Google Popup
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);

      // 2. Grab the secure token from Firebase
      const idToken = await userCredential.user.getIdToken();

      // 3. Pass the token to our NextAuth Credentials Provider
      const result = await signIn("credentials", {
        idToken,
        redirect: false // Prevent NextAuth from forcibly reloading the page
      });

      if (result?.error) {
        alert("Login failed: " + result.error);
      } else {
        // Refresh the page so the server components see the new session!
        router.refresh();
      }
    } catch (error) {
      console.error("Google sign-in error:", error);
      alert("Sign-in cancelled or failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleSignIn}
      disabled={isLoading}
      className="w-full max-w-sm rounded-md border border-zinc-300 bg-white px-8 py-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
      {isLoading ? "Authenticating..." : "Sign in with Google"}
    </button>
  );
}
