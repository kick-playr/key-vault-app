# APP-45 verification — 2026-11-01

## Automated checks

- `npm test`: 28 passing tests across operation construction, server forwarder, rendered React interactions and an isolated HTTP secret-lifecycle fixture.
- `npm run typecheck`: passed.
- `npm run build`: passed with Next.js 16.4.3; home, sign-in and vault route compile successfully.

## Boundary coverage

| Boundary | Evidence |
| --- | --- |
| UI → request | React tests open masked secrets, send exact scope and x-vault-token (not Clerk Authorization), confirm deletion, select exact versions, announce permission errors and discard late responses after disconnect. |
| Retry → request | Timeout regression verifies manifest/revision fields survive and identical reconciliation resends its original supplied secrets without displaying them in the form. |
| Request → forwarder | Forwarder tests require signed-in user and vault credentials, reject origin/scope/route/SSRF attempts, bound/validate JSON and sanitize upstream failures. Fixed API version, safe forwarded headers and no-store are asserted. |
| Forwarder → HTTP fixture | Disposable loopback server exercises missing secret, create, rotate, latest/exact read, metadata versions, denied namespace/read-only writes, disable, denied disabled read, delete and missing-after-delete. No real secrets or databases used. |
| Production app → auth gate | Built server on 127.0.0.1:3013: home returns 200 with Configure sign-in; vault GET returns 503 SignInUnavailable and Cache-Control: no-store without configured Clerk keys. |
| Browser → layout | Temporary fixture-only harness renders the actual console and compiled CSS, clearly labelled without Clerk/live vault. Assessed at desktop 1280px and mobile 390px. Mobile document width equals viewport width (390px), with no horizontal overflow. Key operation completes with masked result and session history; focus moves to status. |

Screenshots: [desktop fixture](screenshots/desktop-fixture.png), [mobile fixture](screenshots/mobile-fixture.png). The temporary harness is outside application routes and is not a production authentication bypass.

## Review and limitations

An independent code review identified Clerk's Authorization-header collision and form-reset/reconciliation-retry issues. Both were fixed with failing-then-passing regression tests; follow-up review reported no additional important findings.

The operation tests cover every route in the matrix, but are not a live Azure conformance certification. The HTTP fixture is not the real Nest/MongoDB API. Real Clerk session verification, provider connectivity and full UI → Clerk → Nest → MongoDB flows remain unverified because no application-specific credentials were supplied. Automated accessibility checks cover labelled controls, roles/statuses and confirmations; they do not replace Freddie's keyboard/screen-reader assessment. Named design/security approvals have not been recorded. No deployment, live secret writes or Jira status changes were performed.

## Inventory/search update

Re-read the API working tree when the user reported its concurrent inventory implementation. Integrated GET /keys and /secrets with fixed API version and GET /local/inventory without an API version. Every implemented search filter is represented, and page size accepts any integer 1–25.

UI tests cover metadata-only list/search parsing and selection, independent list/read grants, valid query forwarding, unknown/duplicate/prototype-named parameter rejection, namespace/endpoint-bound nextLink conversion, expired/invalidated page restart, stale responses after filter changes and first-page refresh after writes. The proxy preserves only the explicitly allowlisted inventory error codes, not arbitrary upstream messages.

Also ran `npm test -- --runTestsByPath test/inventory.spec.ts` in key-vault-api: 1 suite, 5 tests passed using its disposable MongoDB fixture. No API source or configuration was modified. This verifies the current working-tree inventory implementation, not a deployed instance. Earlier screenshots predate the inventory panel and remain initial layout evidence.
