# APP-45 API-to-UI coverage

Status: inventoried before implementation; workflows implemented, human matrix review pending. Source: key-vault-api/src/app.ts and src/config.ts, working tree on 2026-11-01. The verification column describes automated coverage implemented in test/operations.test.ts, test/vault-proxy.test.ts, test/console.test.tsx and test/contract-flow.test.ts. See verification.md for executed checks and limitations.

The browser uses `x-vault-token` to keep the vault credential separate from Clerk authentication; the server translates it to the bearer header upstream. Every upstream data-plane request requires `api-version=2025-07-01`, a bearer token, `x-vault-environment` and `x-vault-tenant`. Routes also accept `/namespaces/{environment}/{tenant}`; path and headers must agree. Local provisioning routes omit the API version. Permissions are enforced by the API.

| Method / route | UI workflow | Permission | Automated verification |
| --- | --- | --- | --- |
| POST /keys/{name}/create | Create RSA 2048/3072 key; create new version of existing key | write | Request shape, validation, version creation |
| GET /keys/{name} | Open key by name; public JWK details | read | Latest version, no private fields |
| GET /keys/{name}/{version} | Select exact key version | read | Explicit version preserved |
| GET /keys/{name}/versions | Key versions table | read | Metadata and selection |
| PATCH /keys/{name}/{version} | Edit enabled, validity, tags, key operations | write | Exact version and payload; denied writes |
| DELETE /keys/{name} | Confirm permanent deletion of all versions | write | Typed-name confirmation, cancellation, request |
| POST /keys/{name}/{version}/encrypt | Encrypt a single block using RSA-OAEP-256 | crypto | Base64url encoding, explicit version, failure |
| POST /keys/{name}/{version}/decrypt | Decrypt with exact version; masked output | crypto | Masking, clearing on navigation, denied crypto |
| PUT /secrets/{name} | Set secret or create new version; masked input | write | Payload, value clearing, no persistence |
| GET /secrets/{name} | Open secret by name; masked value with explicit reveal | read | Latest version, masking |
| GET /secrets/{name}/{version} | Read selected version; masked value | read | Exact version, reveal reset |
| GET /secrets/{name}/versions | Secret versions table without values | read | Metadata-only response handling |
| PATCH /secrets/{name}/{version} | Edit enabled, validity, tags, content type | write | Metadata-only payload and response |
| DELETE /secrets/{name} | Confirm permanent deletion of all versions | write | Consequences, cancellation, permission failure |
| POST /local/reconcile | Advanced manifest, revision and masked supplied secrets; show masked snapshot | read + write | Atomic success, revision conflict, no partial success |
| POST /local/snapshot | Advanced manifest validation and masked runtime mappings | read | Missing/different manifest, expired mappings |

## API limitations affecting the interface

- No list-all keys/secrets endpoint. Start with open-by-name and a session-only list of successfully opened/created resources, labelled as such. Do not imply a complete inventory. A complete inventory needs a separately reviewed API extension.
- No namespace, environment, grant, credential or provider management endpoints. Connection inputs supply explicit namespace context; grant configuration remains server bootstrap configuration. Never expose the master key or MongoDB credentials.
- No provider-discovery endpoint. Describe only this local API's implemented capabilities. APP-36 integration remains conditional on an actual contract.
- Rotation is explicit key creation/secret set, retaining old versions. No APP-43 migration endpoint, asynchronous jobs, progress API or migration engine is exposed.
- No certificates, import/export of private keys, recovery, purge, signing, HSM, backup or rotation policy APIs. Do not render working actions for them.
- Deletion is permanent across all versions and can prevent reconciliation from recreating the purpose. Key deletion can make existing ciphertext unrecoverable.
- API accepts loopback Host and same-origin browser requests only. A separately served browser application cannot call it directly without an approved integration approach.

## Cross-cutting verification scope

Use isolated fixtures and a mock upstream; never production secrets. Exercise missing/invalid credentials, read/write/crypto denials, mismatched namespace path/headers, namespace-switch clearing and stale-response cancellation, timeouts, provider failures, malformed responses, validation, empty and loading states. Verify no sensitive values in browser storage, URLs or logs; no cached sensitive responses. Assess desktop/mobile, keyboard navigation, labels, focus restoration, error announcements and destructive confirmation.
