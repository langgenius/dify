# 2026-05-08 Bounded Job Queue Adapter

## Summary

- Expanded the core `JobQueueAdapter` contract beyond health checks.
- Added a bounded inline job queue adapter for local and skeleton runtimes.
- Wired Node and Cloudflare platform adapter skeletons to the inline queue contract.
- Added TDD coverage for enqueue/dequeue/complete/fail, bounded batch size, bounded queued jobs, idempotency, delayed jobs, retry scheduling, and payload clone isolation.

## Files Added Or Updated

- `packages/core/src/platform-adapter.ts`
- `packages/core/src/platform-adapter.test.ts`
- `packages/adapters/src/job-queue.ts`
- `packages/adapters/src/job-queue.test.ts`
- `packages/adapters/src/cloudflare.ts`
- `packages/adapters/src/node.ts`
- `packages/adapters/src/index.ts`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/2026-05-08-bounded-job-queue-adapter.md`

## Why

Sprint 1 requires adapter contracts for job coordination. The platform needs a bounded queue abstraction before ingestion, parsing, indexing, and background evaluation can safely schedule work.

## Performance Notes

- `maxQueuedJobs` is mandatory and must be at least 1.
- `maxBatchSize` is mandatory and must be at least 1.
- `dequeue` rejects unbounded and oversized batch requests.
- Idempotency keys prevent duplicate active jobs for the same logical work.
- Payloads are cloned on enqueue and dequeue so callers cannot mutate retained queue state.
- The implementation avoids `delete` on hot mutable job records to preserve object shape stability.

## TDD Notes

- RED: Added `packages/adapters/src/job-queue.test.ts`, then ran `pnpm --filter @knowledge/adapters test`.
- The test failed because `./job-queue` did not exist.
- GREEN: Added the job queue contract and inline implementation.
- REFACTOR: Fixed strict optional field handling, removed `delete`, and formatted with Biome.

## Verification

- `pnpm --filter @knowledge/adapters test`: passed.
- `pnpm --filter @knowledge/adapters typecheck`: passed.
- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: above 90% for lines, statements, branches, and functions.

## Known Risks And Follow-Up

- This is a bounded inline queue implementation, not the final Cloudflare Queues or pg-boss adapter.
- Future real queue adapters must preserve bounded dequeue semantics, idempotency behavior, and payload immutability at the adapter boundary.
