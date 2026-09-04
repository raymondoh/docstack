import * as React from "react";
import { AuthNotice } from "@/components/auth/auth-notice";

export default function CheckEmailPage() {
  return <AuthNotice title="Check your email" message="If the request was accepted, you'll receive a sign-in link shortly. Check your spam folder or try again in a minute if you don't see it." />;
}
