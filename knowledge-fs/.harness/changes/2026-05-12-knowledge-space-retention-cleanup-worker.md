# Knowledge-Space Retention Cleanup Worker

## What Changed

- Added `createKnowledgeSpaceRetentionCleanupWorker()` for JobQueue-backed retention cleanup.
- The worker enqueues `retention.cleanup.knowledge-space` jobs with tenant, knowledge-space, max deletion bounds, projection retention, and request timestamp.
- Processing reads the knowledge-space retention policy, computes the AnswerTrace cutoff, deletes old answer traces, and prunes inactive dense-vector and FTS projections.
- Added tests covering enqueue payloads, policy-driven AnswerTrace cutoff, projection pruning, bounded payload rejection, invalid payloads, and factory bound validation.

## Why

- Sprint 12 cleanup jobs need an orchestration layer that ties retention policy config to the repository cleanup primitives.
- Session context cleanup is represented by the cache repository TTL; the generic cache adapter cannot safely scan session keys, so this worker reports the effective session TTL rather than pretending to batch-delete sessions.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createKnowledgeSpaceRetentionCleanupWorker` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
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

- Parse artifact cleanup still has a per-document pruning primitive but no document-batch cleanup scheduler.
- Projection cleanup remains version-retention based because the current projection model has no update timestamp for true age-based expiration.
