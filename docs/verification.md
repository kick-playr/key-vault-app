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

## Connection authentication fix

Root cause: the original Connect button performed only format validation and set local connection state without contacting the API. That made a syntactically valid suffixed token appear connected. The API's full-token SHA-256 comparison already rejected altered credentials; the existing unauthorized-resource test and new authentication regression confirm rejection. No valid-token-prefix authorization was reproduced.

Added read-only GET /local/session in the API, protected by the same token and namespace checks as other routes. It requires no additional list/read/write/crypto permission and returns only authenticated=true plus the authorized scope. The UI requires that exact proof before opening; a denial, unavailable API, malformed/mismatched proof or cancellation leaves it disconnected. Token inputs clear immediately, and later 401 responses disconnect and clear revealed results. No real credentials were used in tests or printed.

UI: 35 tests, typecheck and build passed. Independent review reported no important findings. API validation results are recorded in the API repository. Both services must load the updated sources. The local API was restarted after tests; runtime Swagger confirms /local/session is loaded and a fabricated invalid suffixed credential returns 401. The existing UI dev server receives the source update through hot reload.

## Compact console layout

Moved the connected environment, namespace and sole Disconnect control into the top bar. Removed duplicate connection banner, repeated introductions and the redundant session-history panel. Open-by-name remains available without list permission. Inventory view, page size and refresh share a compact desktop toolbar; operation forms/results retain the larger fonts, masked responses and destructive warnings.

Verification: 37 tests passed, including regressions ensuring connected context appears only in the header and Search becomes Refresh after results load (resetting to Search when filters change); typecheck and production build passed. Independent code review reported no important regressions. Actual console components and compiled styles were browser-checked with isolated fixtures at desktop and 390px mobile widths. Resource selection fills the action form; mobile document width equals the viewport (390px), with table overflow confined to its panel. Screenshots: compact-desktop-fixture.png and compact-mobile-fixture.png in docs/screenshots. No live vault data was used.

## APP-50 / release 0.1.3 — 2026-11-01

Source baseline: app origin/development 6e31672d29cd4a32eb96672aeada770c066e1441; API contract read at 31b1e6da97fc988869d9158faccda2ea4371d74c. API unchanged. Approved design and Chris-role security constraints are in Jira APP-50 comments 10127–10128; actual authenticated author is Lolo, not a separate human Chris endorsement.

Node 24.22.0, locked installation (0 vulnerabilities). Baseline: 37 tests passed. Current implementation: **55 tests passed**, `npm run typecheck` passed, `npm run build` produced the optimized Next.js build. New tests were observed failing before their corresponding feature or safety fix. Existing console/proxy/contract tests remain green. No real credentials, live imports, secret writes, key generation, service starts/restarts, merge or deployment.

A synthetic static React form preview was generated offline. Browser file-URL policy denied opening it; no alternate browser or server workaround was attempted. Desktop/mobile CSS and keyboard dialog behavior were reviewed in code/DOM tests, but rendered viewport appearance, live Clerk sign-in, real-vault operations and screen-reader behavior remain unverified. These are explicit Trip/Lolo review limitations, not completed visual QA. Independent exact-head review results will be recorded in Jira and the PR.

Independent review of cfaa18f requested three fixes: stale history closing a new form, same-section discard retaining sensitive input, and large API-valid epochs crashing rendering. Each was reproduced by a failing regression test and fixed; full suite55, typecheck and build passed after the fixes. Navigation now invalidates pending reads/remounts accepted section transitions; out-of-control-range dates remain readable and are preserved unchanged. Mobile navigation wraps all five entries. Production build-generated next-env.d.ts imports are included. Final exact-head re-review is recorded in Jira/PR.

## Purpose labels/search / release 0.1.4 — 2026-11-01

Baseline is published development merge1fe1b229aa5805781ef99112dfaf4304729cbd03. Three new tests were observed failing before implementation: bounded search query validation, scoped proxy forwarding and purpose display with physical-name action targeting. Full app suite now **58 tests passed**; typecheck and optimized build passed. API-side literal name-or-purpose matching, pagination, cursor binding, bounds and absence of secret-value search are tested in the paired API branch. Both packages receive exactly one patch to0.1.4; API must be updated first to support search queries. No service/database starts or restarts, live vault mutations, merge or deployment. Rendered desktop/mobile and live Clerk/vault remain unverified; browser file-preview policy limitation from APP-50 still applies.

Compact-search follow-up: reviewed user screenshot7bf48634. Replaced stacked action/search/open-by-name rows with a single wrapping toolbar: 36px search field and buttons, hidden visual label with retained accessible name, placeholder for name/purpose, and native collapsed Open by name disclosure. Empty loading status no longer occupies a grid row. Existing interaction tests now expand the disclosure before opening a resource. All58 tests, typecheck, optimized build and diff check pass; screenshot/rendered viewport validation remains unavailable under the recorded browser-policy/no-service-start limitation. No additional patch bump within this open0.1.4 PR.

## Compact result rows / release 0.1.5 — 2026-11-01

Per user screenshot d6f60597, dense Azure-style list rows now use 6px vertical cell padding, borderless 24px-minimum resource action targets, smaller physical IDs/status/timestamps and tighter mobile cards. Full physical IDs remain visible and wrap, and existing keyboard focus styling remains. CSS only; resource names, requests and selection behavior unchanged. All58 tests, typecheck, CSS formatting and diff check pass. Rendered viewport appearance remains unverified. Work performed directly on development; pre-existing generated next-env.d.ts edit preserved.

## Existing secret-version value panel / release 0.1.6 — 2026-11-02

Added hidden-by-default selected-version value panels in details and metadata editing. Explicit reveal uses existing scoped exact-version GET, validates response identity and size, and only then retains the value in memory. Hide, component remount, pagehide and hidden-tab events clear the value/abort reads. Copy uses the exact retained string rather than the textarea's newline-normalized DOM value. Clipboard denial/unavailability is handled without echoing error text; copied values are not forcibly erased from the system clipboard. Value immutability and New version behavior remain unchanged; no API change.

Four focused tests were observed failing before implementation. Full suite **63 tests passed**, including explicit-only reads, exact scoped request, masking/re-fetch after Hide, multiline/BOM copy preservation, late selected-version responses, permission denial, mismatched version responses, clipboard failure and metadata-editor hidden default without automatic value read. Typecheck, production build and diff check passed. Production build restored the pre-existing next-env.d.ts bytes afterwards. No running service starts/restarts, live secret reads/edits, actual system-clipboard writes or deployment. Rendered/live UI verification remains unverified.

## Copy while hidden / release 0.1.7 — 2026-11-02

Copy is enabled before reveal. An explicit hidden Copy validates and reads the exact selected version, writes only to the clipboard and never puts the value into displayed React state. It refetches independently of Show and retains no hidden cache. ClipboardItem/promise-backed text starts the clipboard operation inside the click gesture on supporting browsers; writeText is the compatibility path. Pending operations disable duplicate clicks, reject stale responses on version/navigation changes and sanitize read/clipboard failures. Server read authorization and lifecycle checks still apply; no claim that Copy bypasses browser permissions.

Full suite67 tests, typecheck, production build and diff check passed after fixing a TypeScript feature-detection expression. Regressions cover hidden default availability, masked copy with original line endings, no retained hidden cache, late version responses, denied read without clipboard write and promise-backed clipboard activation. No live secret or actual system clipboard interaction; generated next-env.d.ts bytes preserved. No API change, service start/restart or deployment.

## Remaining APP-50 follow-ups — 2026-11-02 (app 0.1.7)

Completed hidden-copy safety fix (Hide remains available during clipboard permission wait), optional versionCount parsing and a compact secret-list Versions column. API0.1.5 supplies counts metadata-only; older API responses show a dash rather than invented counts. Search now debounces300ms at3+ characters, leaves existing rows while typing, cancels stale work, shows a short-query hint and reloads unfiltered results on clear. Search timers are cancelled when another operation or form navigation takes precedence. No new secrets/history fan-out, storage or permission changes.

Full70 app tests, typecheck, production build and diff check passed. Regression evidence covers short queries, type-triggered requests, clear-to-reload, count validation and Hide during pending copy. Exact synthetic clipboard tests await the pending write before testing Hide. No real clipboard/vault operations or service restarts; generated next-env.d.ts preserved. API's unrelated untracked APP-49 design was not touched.
