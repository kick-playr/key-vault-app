import React from "react";
import { auth } from "@clerk/nextjs/server";
import { UserButton } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { VaultConsole } from "../components/vault-console";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  )
    return (
      <main id="main-content" className="setup-page">
        <div className="setup-card">
          <p className="eyebrow">KICK PLAYR / KEY VAULT</p>
          <h1>Configure sign-in</h1>
          <p>
            This standalone console uses Clerk and a scoped vault token. Add
            your Clerk application keys to <code>.env.local</code> using{" "}
            <code>env.example</code>, then restart the app.
          </p>
          <p>Vault access stays disabled until sign-in is configured.</p>
        </div>
      </main>
    );
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  return <VaultConsole key={session.userId} account={<UserButton />} />;
}
