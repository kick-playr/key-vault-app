# Kick Playr Key Vault

Standalone local vault administration for APP-45. Uses the same stack as the Kick-Playr app and Tenant Explorer: Next.js App Router, React, TypeScript, Tailwind CSS, Heroicons and Clerk.

## Run locally

Requires Node.js 24, a configured Clerk application and the existing `key-vault-api` running on loopback.

```sh
npm ci
cp env.example .env.local
# Set your Clerk publishable key and secret key in .env.local.
npm run dev
```

Open [http://127.0.0.1:3003](http://127.0.0.1:3003). Configure Clerk to allow that local sign-in/redirect origin. Use `127.0.0.1`, not `localhost`: the vault integration is intentionally loopback-only. Without Clerk keys the home page displays setup instructions and vault routes return 503. There is no authentication bypass.

After signing in, enter your environment, tenant/namespace and an existing vault grant token. Use `_shared` for process-scoped manifests. Clerk identifies the user; the scoped vault token independently authorizes API operations. The application does not mint grants or translate Clerk identities into automatic vault privileges. Obtain a grant with only the list/read/write/crypto permissions needed from your vault administrator.

`VAULT_API_ORIGIN` is configured only on the server and defaults to `http://127.0.0.1:4000`. It must be a loopback HTTP origin without credentials, paths or query parameters. The UI never reads the vault master key, MongoDB credentials or the API's bootstrap grants file.

If port 3003 is occupied, run `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 -p 3013` and allow that origin in Clerk. Production mode is `npm run build` then `npm start`, still bound to loopback. This implementation has not been deployed.

## Supported workflows

- **Inventory/search:** Keys and Secrets offer their metadata list endpoints and filtered inventory. Advanced offers combined inventory. Filter by resource kind, exact name, prefix, purpose, enabled status, expiry time and exact tag name/value. Choose any page size from 1 to 25 and use Next page. Selecting metadata fills the resource/version form without reading a value.
- **Keys:** open by name, read exact/latest public JWK, list/select versions, generate RSA 2048/3072 keys, rotate through new versions, edit enabled/validity/tags/usages, encrypt/decrypt using RSA-OAEP-256, permanently delete all versions after typed-name confirmation.
- **Secrets:** open latest/exact versions, set/rotate values up to 25 KiB, list/select versions, edit enabled/validity/tags/content type, permanently delete all versions after confirmation.
- **Advanced:** reconcile a versioned manifest with optionally supplied secrets; validate and load complete runtime snapshots. For `_shared`, change manifest entry scope from `tenant` to `process`.

Cryptography accepts canonical unpadded **base64url**, not ordinary text or padded base64. Encryption handles a single RSA block, not bulk data. Keep the version used to encrypt alongside the ciphertext. Metadata validity times are non-negative epoch seconds; omitted fields stay unchanged. Use `{}` to clear tags and the explicit checkbox to clear content type.

Results remain masked until explicitly revealed. Secret input fields clear on submission. Other form fields survive errors so they can be corrected. After failed reconciliation, **Retry identical reconciliation** resends the original revision, manifest and supplied secrets retained in memory. A new form submission sends the current inputs, including any blank supplied-secret field. Never reconstruct a same-revision retry with a changed payload. Creating keys or setting secrets can create another version on retry; inspect the current versions after an ambiguous failure before repeating those operations.

## Capability boundaries

The current API working tree provides `GET /keys`, `GET /secrets` and `GET /local/inventory`. Inventory requires a separate **list** grant; existing read/write/crypto grants do not imply it. Lists include only the latest non-deleted resource metadata, including disabled and expired resources, with no secret values or key material. **Opened this session** remains a separate bounded in-memory history and fallback for callers without list permission. Disconnect and reconnect to switch namespace; this aborts outstanding calls and clears history, results and credentials. Stale responses cannot populate a new context.

Cursors expire after 15 minutes and are bound to namespace, endpoint, filters, page size and vault generation. Changing filters clears the current pages. A mutation refreshes loaded inventory from the first page; if another caller changes the vault while you page, reload after the reported pagination conflict. Expired/invalid tokens also require a reload. The UI validates continuation links against the active namespace and endpoint and sends only their allowlisted query parameters through its own proxy. It never sends credentials to a nextLink host.

There are no APIs for grant configuration, namespace inventory, provider discovery, certificates, private-key export, backup, recovery, purge, signing, HSM or migration jobs. No APP-43 migration operation is available. Deletion permanently removes all versions and can prevent ordinary manifest reconciliation from recreating that purpose. Deleting keys may make old ciphertext permanently unreadable.

See [API coverage](docs/api-coverage.md) for every supported route, permission and verification mapping.

## Security boundary

Every Next.js vault route validates a Clerk session server-side. The browser sends its vault token in `x-vault-token`, distinct from Clerk's session token; the server forwards it as `Authorization: Bearer …` only to the fixed vault origin. The vault enforces environment, tenant and per-operation permissions. Sign-in alone grants no vault access.

The forwarder allowlists routes/methods, rejects cross-origin/non-loopback requests, validates scope, bounds JSON requests to 128 KiB and JSON responses to 1 MiB, uses a five-second upstream timeout, rejects redirects and returns sanitized errors. It does not forward cookies, browser origins or arbitrary headers. Data-plane API version is fixed at `2025-07-01`; local provisioning routes omit it. Responses are marked `no-store`.

Tokens, secret values, decrypted data and snapshot mappings stay in memory only. There is no local/session storage, payload logging, telemetry, service worker or secret-bearing query string. Navigation clears result/retry data; disconnect and page exit also clear the connection. Revealed results can be observed by someone with access to the screen; manually hide them when finished. Previously disclosed values cannot be remotely erased. Local-only HTTP is a development boundary, not a production security architecture.

## Verification and review

```sh
npm test
npm run typecheck
npm run build
```

Tests use literal contract fixtures and isolated local HTTP resources. They do not connect to live vaults or require real Clerk credentials. [Verification notes](docs/verification.md) record what was exercised and what remains unverified. [Architecture](docs/architecture-proposal.md) records the design and named review requirements.

Live Clerk sign-in, a configured real vault connection, Freddie's desktop/mobile/accessibility assessment and Chris's explicit security approval remain outstanding. Code review and fixture testing do not substitute for those approvals.
