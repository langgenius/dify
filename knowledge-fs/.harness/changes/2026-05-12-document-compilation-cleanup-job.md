# Document Compilation Cleanup Job

## What Changed

- Added `createDocumentCompilationCleanupWorker()` with enqueue and process boundaries backed by `JobQueueAdapter`.
- Added bounded terminal cleanup to `DocumentCompilationJobRepository` through `deleteTerminalOlderThan({ tenantId, olderThan, maxJobs })`.
- Implemented the in-memory repository cleanup path for local/dev and tests.
- Added RED-first tests for enqueue payload/idempotency, tenant-scoped terminal cleanup, preservation of queued/recent/cross-tenant jobs, invalid payloads, and cleanup bounds.

## Why

- Sprint 12 cleanup jobs need a concrete job-driven lifecycle foundation before expanding to parse artifacts, stale projections, sessions, answer traces, and task result classes.
- Terminal document compilation jobs are a safe first cleanup target because they are bounded, tenant-scoped, and already represented as durable task state.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/document-compilation-job.test.ts` failed because `createDocumentCompilationCleanupWorker` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/document-compilation-job.test.ts`
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

- This slice cleans terminal document compilation task results only.
- Follow-up cleanup job slices should add parse artifact version pruning, stale projection cleanup, session expiry cleanup, and answer trace retention cleanup using the same explicit tenant/cutoff/max pattern.
