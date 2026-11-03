import React from "react";
import {signInConfigured} from "../../../lib/server-secrets";
import { redirect } from "next/navigation";
export default async function SignInPage() {
  if (!(await signInConfigured())) redirect("/");
  const {SignIn}=await import("@clerk/nextjs");
  return (
    <main id="main-content" className="setup-page">
      <div>
        <p className="eyebrow">KICK PLAYR / KEY VAULT</p>
        <SignIn routing="path" path="/sign-in" />
      </div>
    </main>
  );
}
