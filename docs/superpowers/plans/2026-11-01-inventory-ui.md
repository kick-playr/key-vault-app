# APP-45 inventory integration

User correction: inventory/search is being built concurrently in key-vault-api. Re-read src/app.ts, inventory.ts, config.ts, Swagger and inventory tests; use that working contract, without modifying the API.

- [x] Test-first: permit GET keys, secrets, local/inventory and only their defined query parameters through the fixed-upstream forwarder. Preserve the fixed data-plane API version. Distinguish PaginationInvalidated/InvalidContinuationToken from reconciliation conflicts using allowlisted error codes only.
- [x] Test-first: inventory helpers validate filters and translate only a matching loopback, namespace-bound nextLink to the local UI proxy; never fetch an arbitrary nextLink URL.
- [x] Test-first: add metadata table with list/search, every implemented filter, page-size 1–25, load next page, fresh search/reload, empty/denied/error states and metadata-only selection into exact-version workflows. List permission never implies read/write/crypto.
- [x] Mount inventory in Keys/Secrets and combined inventory in Advanced. Keep existing open-by-name/session history as a fallback, clearly labelled. Abort/ignore stale inventory on context/section/filter changes and refresh it after writes.
- [x] Run full tests/typecheck/build and code review; update coverage/setup and limitations. API work is concurrent: report the exact source contract reviewed rather than claiming a deployed release.

Executed inline with test-first helpers/forwarder and rendered React flows. Independent review reported no important findings; final checks recorded in docs/verification.md.
