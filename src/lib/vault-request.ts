// Includes one-time Clerk/Vault loader startup in both middleware and route workers.
// Actual upstream Vault execution remains limited to five seconds by the proxy.
// Requests are never automatically retried, particularly writes with unknown outcomes.
export const VAULT_UI_REQUEST_TIMEOUT_MS = 20_000;
