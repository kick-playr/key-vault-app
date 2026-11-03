import React from "react";
import type { Metadata } from "next";
import {serverSecrets} from "../lib/server-secrets";
export const dynamic = "force-dynamic";
import "./globals.css";
export const metadata: Metadata = {
  title: "Key Vault · Kick Playr",
  description: "Independent Key Vault administration for Kick Playr.",
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const environment=await serverSecrets();
  const configured=!!environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY&&!!environment.CLERK_SECRET_KEY;
  const ClerkProvider=configured?(await import("@clerk/nextjs")).ClerkProvider:undefined;
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {configured && ClerkProvider ? (
          <ClerkProvider
            publishableKey={environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
            signInUrl="/sign-in"
            signInFallbackRedirectUrl="/"
            afterSignOutUrl="/"
          >
            {children}
          </ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
