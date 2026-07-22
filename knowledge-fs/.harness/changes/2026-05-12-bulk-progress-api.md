# Bulk Progress API

## What Changed

- Added `GET /bulk-jobs/{id}`.
- Added `BulkOperationRepository` plus bounded in-memory implementation.
- Bulk upload, bulk delete, and bulk reindex now write operation summaries using their returned `bulkJobId`.
- Added batched `DocumentCompilationJobStateMachine.getMany()` and repository support so progress aggregation can fetch compilation job states in one call.

## Why

- Sprint 12 requires callers to poll bulk operation progress with total, completed, and failed item counts.
- Previous bulk routes returned a `bulkJobId` without retaining enough state for follow-up progress reads.

## Performance And Safety

- The in-memory repository enforces `maxOperations` and `maxItems`.
- Progress reads are tenant-scoped and require read scope.
- Compilation-backed progress uses a batched job lookup instead of per-item route calls.
- Bulk delete progress is recorded as completed/not-found immediately because that route is synchronous and bounded.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createInMemoryBulkOperationRepository` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- The default repository is in-memory; production durability should wire this contract to the database runtime in a later slice.
- Bulk job cancellation remains separate from this progress-only slice.
