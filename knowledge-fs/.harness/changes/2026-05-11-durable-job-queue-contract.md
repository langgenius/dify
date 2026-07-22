# Durable JobQueue Contract

## Summary

- Extended the existing bounded inline `JobQueueAdapter` contract for Phase 3 durable ingestion.
- Added lease, heartbeat, retry, cancel, and status semantics while preserving existing enqueue/dequeue/complete/fail compatibility.
- Kept inline behavior bounded for local tests, Cloudflare skeletons, and Standalone skeletons until real Cloudflare Queues / pg-boss adapters are implemented.

## Changes

- Extended core job queue types:
  - `JobStatus` now includes `canceled`.
  - `JobRecord` now includes optional lease, heartbeat, and cancel timestamps.
  - `JobQueueAdapter` now exposes `lease()`, `heartbeat()`, `retry()`, `cancel()`, and `status()`.
  - `JobQueueStats` now includes cumulative `canceled` count.
- Updated `createInlineJobQueueAdapter()`:
  - Added bounded `maxLeaseMs` validation.
  - `lease()` assigns `leaseExpiresAt` and recovers expired running jobs.
  - `heartbeat()` only extends the active worker lease.
  - `retry()` requeues non-terminal jobs with optional `runAfter`.
  - `cancel()` moves jobs to terminal `canceled` state and participates in bounded terminal retention.
  - `status()` returns clone-isolated snapshots or `null` for missing/pruned jobs.
- Kept internal job records on a stable field shape and avoided `delete` for performance.

## Guardrails

- Lease requests require explicit bounded `limit` and `leaseMs`.
- Expired lease recovery reuses the same FIFO map walk as dequeue and does not scan terminal jobs as candidates.
- Terminal retention remains bounded by `maxRetainedJobs`.
- Payload/status snapshots preserve clone isolation.
- The inline adapter remains a skeleton/local implementation; real Cloudflare and pg-boss adapters are still separate Phase 3 tasks.

## Verification

- RED first:
  - `pnpm --filter @knowledge/adapters test -- src/job-queue.test.ts` failed because `queue.lease` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/adapters test -- src/job-queue.test.ts`
  - `pnpm --filter @knowledge/core test -- src/platform-adapter.test.ts`
  - `pnpm --filter @knowledge/adapters typecheck`
  - `pnpm --filter @knowledge/core typecheck`
  - `pnpm --filter @knowledge/adapters test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is review checkpoint `92f4e22` + implementation commit 9 after commit and push.
- The next implementation commit will trigger the mandatory 10-commit health review after it is committed and pushed.
