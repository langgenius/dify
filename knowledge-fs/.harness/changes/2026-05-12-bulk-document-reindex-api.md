# Bulk Document Reindex API

## What Changed

- Added `POST /knowledge-spaces/{id}/documents/bulk/reindex`.
- The endpoint accepts either explicit `documentIds` or `all: true`, requires write scope, and starts durable document compilation jobs for tenant-scoped document assets.
- Added bounded `DocumentAssetRepository.list()` support for in-memory and database-backed repositories.
- Added OpenAPI coverage for the new bulk reindex route and a structured response schema for queued and not-found item results.

## Why

- Sprint 12 bulk operations need an operator-safe way to re-run ingestion for selected documents or a bounded whole-space batch.
- Reindexing must use durable compilation jobs instead of synchronous request work, so retries, status, and cancellation stay on the existing ingestion execution path.

## Performance And Safety

- `maxBulkReindexDocuments` bounds explicit and all-mode selection.
- All-mode selection uses `limit + 1` to detect over-limit batches without loading unbounded results.
- Database listing is tenant-scoped by `knowledge_space_id`, ordered by stable `id`, and uses parameterized SQL plus explicit `maxRows`.
- The endpoint returns `503` when durable compilation jobs are not configured, avoiding hidden in-request reindex work.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed with `404` before route implementation.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Full verification passed:
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- This slice queues jobs but does not add a bulk progress endpoint; that remains the next Sprint 12 follow-up.
- All-mode reindex intentionally rejects batches larger than `maxBulkReindexDocuments`; clients should page or select explicit documents once a progress endpoint exists.
