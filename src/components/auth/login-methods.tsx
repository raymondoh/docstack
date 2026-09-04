import * as React from "react";
import { LoginButton } from "./login-button";
import { EmailLoginForm } from "./email-login-form";

export function LoginMethods({ emailEnabled, callbackUrl }: { emailEnabled: boolean; callbackUrl: string }) {
  return <>
    <LoginButton callbackUrl={callbackUrl} />
    {emailEnabled && <>
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span>or continue with email</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
      <EmailLoginForm callbackUrl={callbackUrl} />
    </>}
  </>;
}
