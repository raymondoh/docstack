import * as React from "react";

export function SignInEmail({ url }: { url: string }) {
  return (
    <html><body style={{ fontFamily: "Arial, sans-serif", color: "#18181b", padding: "32px" }}>
      <h1>DocStack</h1>
      <p>Use this link to sign in to DocStack.</p>
      <a href={url} style={{ display: "inline-block", backgroundColor: "#18181b", color: "#ffffff", padding: "14px 22px", borderRadius: "6px" }}>Sign in to DocStack</a>
      <p>This link expires in 15 minutes and can be used only once.</p>
      <p>If you didn’t request this, you can ignore this email.</p>
    </body></html>
  );
}
