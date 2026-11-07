import React from "react";
import { StaticVaultConsole } from "../components/static-vault-console";
import { signInConfigured } from "../lib/server-secrets";

import { redirect } from "next/navigation";
import { VaultConsole } from "../components/vault-console";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!(await signInConfigured()))
    return (
      <main id="main-content" className="setup-page">
        <div className="setup-card">
          <p className="eyebrow">KICK PLAYR / KEY VAULT</p>
          <h1>Configure sign-in</h1>
          <p>
            This standalone console uses Clerk and a scoped vault token.
            Configure the public Clerk key and Vault application token in{" "}
            <code>.env</code>.
          </p>
          <p>Vault access stays disabled until sign-in is configured.</p>
        </div>
      </main>
    );
  const { auth } = await import("@clerk/nextjs/server");
  const { UserButton } = await import("@clerk/nextjs");
  const session = await auth();
  if (!session.userId) redirect("/sign-in");
  return process.env.VAULT_APPLICATION_ID ? (
    <StaticVaultConsole key={session.userId} account={<UserButton />} />
  ) : (
    <VaultConsole key={session.userId} account={<UserButton />} />
  );
}
