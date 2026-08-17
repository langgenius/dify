# Metadata write deletion admission

Date: 2026-08-17

## What changed

- Metadata field creation, rename, and deletion now use the shared knowledge-space deletion
  admission lock instead of querying a non-existent `knowledge_spaces.state` column.
- The shared admission verifies the current `lifecycle_state`, the space's `deletion_job_id`, and
  the durable `deletion_jobs.active_slot` before any metadata mutation runs in the same transaction.
- Added PostgreSQL and TiDB regressions for the canonical admission SQL and for rejecting a write
  while an active durable deletion job exists.

## Why

Creating a metadata field failed in the test environment with PostgreSQL error `42703` because the
repository queried `knowledge_spaces.state`. The current schema stores the lifecycle in
`lifecycle_state`; it has no `state` column. The database error escaped the domain layer and was
reported to the Console as `KNOWLEDGE_FS_INTERNAL_ERROR` with HTTP 503.

Using the shared deletion admission fixes the schema mismatch and preserves the intended race-safe
write fence. A direct column substitution would still miss deletion jobs that have acquired their
durable active slot.

## Verification

- The new PostgreSQL and TiDB tests were first run against the previous implementation and failed
  on the `state` SQL and missing deletion-job admission.
- `pnpm --dir knowledge-fs --filter @knowledge/api exec vitest run
  src/knowledge-space-metadata-repository.test.ts` passed all 16 tests.
- The complete `@knowledge/api` suite passed: 410 files passed, 1 skipped; 4,494 tests passed, 3
  skipped.
- `pnpm --dir knowledge-fs --filter @knowledge/api typecheck` passed.
- `pnpm --dir knowledge-fs build` passed all 12 workspace builds.
- Focused Biome checks for both changed TypeScript files and `git diff --check` passed.

## Risks and follow-up

- A knowledge space with an active deletion job continues to return the existing metadata
  not-found domain result; this change does not alter the public error contract.
- Reads and document metadata reconciliation are unchanged. Only metadata field catalog mutations
  acquire the canonical deletion fence.
