# APP-36 runtime integration boundary

The vault administration UI manages the same local API used by APP-36 server
consumers. Runtime clients use the read-only atomic `/local/runtime-snapshot`
contract in the pinned `key-vault-api` source; ordinary application startup never
uses this UI's reconcile/create/rotate operations.

The named-set snapshot endpoint returns complete version-pinned key sets only to
authorized server consumers. It is intentionally not added to the browser's
proxy route allowlist. Existing explicit admin secret/reconcile workflows remain
separate. No startup provisioning, automatic import or live migration is implied.

APP-36's local applications load secrets at startup and retain memory until
restart. Operators must restart consumers after changing keys/secrets/bindings;
revocation does not erase already loaded values. Never delete an old key version
required to decrypt existing data.

This publication records a reviewable source baseline for the existing APP-45 UI.
Cloud hosting, machine identity, root custody and this UI's own Clerk bootstrap
security are separate APP-47 work. The current localhost UI must not simply be
exposed publicly. No cloud deployment, service restart, secret import, credential
mutation or merge is performed by APP-36 source publication.
