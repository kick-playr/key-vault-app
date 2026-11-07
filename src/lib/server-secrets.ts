import "server-only";
import { createHash } from "node:crypto";
import { createConsoleSecretsSource } from "./server-secrets-core";
const slot = Symbol.for("kick-playr.vault-console.server-secrets");
type Holder = {
  source: ReturnType<typeof createConsoleSecretsSource>;
  encryptionKey?: string;
  bootstrapKey: string;
};
const globals = globalThis as typeof globalThis &
  Record<symbol, Holder | undefined>;
function currentHolder() {
  // Next dev preserves globals across reloads. Replace the source when bootstrap
  // configuration changes, without storing/logging the token as a cache key.
  const bootstrapKey = createHash("sha256")
    .update(
      JSON.stringify([
        "background-auth-v2",
        process.env.VAULT_URL,
        process.env.VAULT_APPLICATION_ID,
        process.env.VAULT_ENVIRONMENT,
        process.env.VAULT_GRANT,
        process.env.NODE_ENV,
        process.env.SECRETS_KEYS_STRATEGY,
        process.env.LOCAL_KEYVAULT_URL,
        process.env.LOCAL_KEYVAULT_ENVIRONMENT,
        process.env.LOCAL_KEYVAULT_APPLICATION_TOKEN,
        process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
        process.env.SECRETS_KEYS_STRATEGY === "LOCAL_KEYVAULT"
          ? undefined
          : process.env.CLERK_SECRET_KEY,
      ]),
    )
    .digest("hex");
  const previous = globals[slot];
  if (previous?.bootstrapKey === bootstrapKey) return previous;
  previous?.source.close();
  return (globals[slot] = {
    source: createConsoleSecretsSource(process.env),
    bootstrapKey,
    encryptionKey: previous?.encryptionKey,
  });
}
export async function serverSecrets() {
  const holder = currentHolder(),
    environment = await holder.source.load();
  if (environment.SECRETS_KEYS_STRATEGY === "LOCAL_KEYVAULT") {
    const key = environment.CLERK_ENCRYPTION_KEY;
    if (holder.encryptionKey && holder.encryptionKey !== key)
      throw Error("Vault console authentication unavailable");
    if (!holder.encryptionKey) {
      process.env.CLERK_ENCRYPTION_KEY = key;
      holder.encryptionKey = key;
    }
  }
  return environment;
}
export async function signInConfigured() {
  const environment = await serverSecrets();
  return (
    !!environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !!environment.CLERK_SECRET_KEY
  );
}
