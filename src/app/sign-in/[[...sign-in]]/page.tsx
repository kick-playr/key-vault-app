import React from "react";
import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
export default function SignInPage() {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    redirect("/");
  return (
    <main id="main-content" className="setup-page">
      <div>
        <p className="eyebrow">KICK PLAYR / KEY VAULT</p>
        <SignIn routing="path" path="/sign-in" />
      </div>
    </main>
  );
}
