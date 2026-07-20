# Admin UI BFF Constraints

## What Changed

- Added `apps/admin/lib/bff.ts`.
- Added a thin Admin BFF proxy boundary for Next.js route handlers.
- Added `apps/admin/app/api/bff/[...path]/route.ts` to delegate UI-friendly requests to Hono APIs.
- Added a strict allowlist for proxied Hono routes:
  - health and OpenAPI reads
  - KnowledgeSpace CRUD
  - document upload/read/artifact read
  - query streaming
  - trace reads
- Added request body bounds and request/response header allowlists.
- Added forbidden-import scanning for Admin source files so UI/BFF code does not import core runtime packages directly.

## Why

- Phase 2 Sprint 9 requires any Next.js BFF route to stay thin, UI-only, and delegated to Hono rather than owning knowledge, retrieval, ingestion, job, permission, provider, database, or adapter logic.

## Performance And Safety Notes

- The BFF buffers only bounded non-GET request bodies before forwarding.
- Cookies and other ambient browser headers are not forwarded to Hono; only `accept`, `authorization`, `content-type`, and `x-trace-id` are allowed.
- Upstream responses only expose `cache-control`, `content-type`, and `x-trace-id`.
- Route path segments are validated before proxying and unknown paths return `404`.
- Upstream fetch failures map to `502` without leaking stack traces or request details.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/bff.test.ts` failed because `apps/admin/lib/bff.ts` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/admin test -- lib/bff.test.ts`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm --filter @knowledge/admin build`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This BFF boundary intentionally does not proxy large uploads by default; upload UI can continue calling the Hono API directly for large files.
- The forbidden-import scan is test-enforced rather than a dedicated lint plugin; a later pass can promote it into a standalone CI script if Admin grows substantially.
