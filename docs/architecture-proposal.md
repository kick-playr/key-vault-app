# APP-45 architecture proposal

Status: stack and implementation direction accepted by the user; initial implementation complete with fixture verification. Named review approvals and live integration remain outstanding. Repository: `/Users/Lolo/git/key-vault-app`; existing API changes remain untouched.

## Intent

Standalone vault administration independent of Tenant Explorer. Cover the implemented API through the workflows in api-coverage.md. Keep business rules and authorization in the vault API.

## Approaches

1. Selected stack: Next.js App Router, React, TypeScript, Tailwind CSS, Heroicons and Clerk, matching the existing Kick-Playr applications. Use Next.js server route handlers to forward an allowlisted set of vault routes to one fixed loopback upstream. This keeps the repositories separate and respects the current API's browser-origin restrictions. Server exposure and credential handling remain subject to review.
2. Serve the built UI from the existing Nest API. Fewer moving parts and naturally same-origin, but couples UI hosting to the API and requires modifying its currently dirty working tree.
3. Separate browser origin with API CORS changes. Avoid for the initial delivery: it broadens the API's current browser exposure and still requires API changes.

The user selected the existing Kick-Playr stack instead of Fluent UI. Build original Tailwind-styled components with Heroicons and familiar Azure-inspired navigation; do not copy or embed Azure portal source. Microsoft Fluent UI was assessed as a general component library, not an embeddable Azure Key Vault management UI (https://github.com/microsoft/fluentui/).

Baseline declared in the existing app and Tenant Explorer package manifests: Next.js 16.4.3, React/React DOM 19.3.1, TypeScript ^6.0.3, Tailwind CSS ^4.3.3, Heroicons ^2.2.0, Clerk Next.js ^7.9.x and Node.js 24. Verify package availability and compatibility when scaffolding; these are repository declarations, not an installation result.

## Security architecture building block — pending Chris review

This section describes the implemented initial boundary for Chris to review; it is not a recorded security approval.

- Local-only UI server bound to 127.0.0.1. Validate Host and same-origin requests; no permissive CORS, remote deployment or arbitrary upstream URLs.
- Clerk provides standalone user sign-in, independently of Tenant Explorer navigation. Every vault route handler must validate the Clerk session server-side. Clerk authentication alone does not authorize vault operations: the current API accepts its own scoped bearer grants, not Clerk JWTs.
- Initial grant bridge: an authenticated user enters an existing scoped vault bearer token through a masked field. Keep it only in memory, send it in x-vault-token to avoid colliding with Clerk session authentication, translate it into an upstream bearer header per request, and rely on API grant enforcement. No stored shared administrative token, browser storage or authentication bypass. Reject absent credentials before forwarding. Chris must review this bridge and any requirements for binding vault grants to Clerk user identities; do not infer authorization from sign-in or email alone.
- Fixed upstream configured server-side. Allowlist methods/routes; encode resource path segments. Do not forward browser-selected destinations, cookies or arbitrary headers. Apply request limits, timeouts, no-store responses and safe error handling.
- Environment and tenant remain explicit in every request. Switching context aborts in-flight work and clears resource data, revealed outputs and forms. Prevent stale responses from repopulating a different namespace.
- Sensitive inputs/outputs masked by default; clear them on logout/navigation. No secret-bearing URLs, telemetry, payload logging, service worker or browser persistence. Public JWK only; never request private keys.
- Destructive confirmation names the resource and states permanent all-version deletion. Read, write and crypto actions can fail independently; permission visibility never substitutes for API enforcement.
- Reconcile and runtime snapshots can contain plaintext secrets: treat all mappings as sensitive, including previews and operation results.

## Proposed layout

Persistent connection/namespace header; Keys, Secrets and Advanced navigation. Open/create by name, session resource list, detail and versions pane, compact action forms. Advanced contains manifest reconciliation and snapshot. Show supported local capabilities and limitations. Accessible labels, status announcements, focus management and responsive stacking are required.

## Delivery and outstanding assessments

1. Scaffold Next.js App Router with React, TypeScript, Tailwind, Heroicons, Clerk and fixed-upstream route handlers with fixture-only tests.
2. Verify authentication, route allowlist, namespace isolation, errors and secret handling.
3. Build key/secret/version/lifecycle workflows and cryptography.
4. Build advanced reconciliation/snapshot workflows.
5. Run contract and representative browser flows; document setup and actual limitations.
6. Outstanding: Freddie assesses desktop/mobile and accessibility; Chris records security review and approval. No live secret changes or deployment are included.

## Review state

APP-45 requests Freddie's design assessment and Chris's architecture building block and explicit security approval before engineering. None is recorded in the issue description or comments at the time of analysis. The user explicitly selected the same stack as the existing Kick-Playr applications and subsequently said go. Initial implementation proceeded on that direction; no claim is made that the named approvals occurred. This does not record the named reviews or approval of the proposed Clerk-to-vault grant bridge.
