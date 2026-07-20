# Parse Artifact Retention Cleanup Worker

## What Changed

- Added `createParseArtifactRetentionCleanupWorker()` for JobQueue-backed parse artifact version cleanup.
- The worker enqueues `retention.cleanup.parse-artifacts` jobs with tenant, knowledge-space, cursor, document batch limit, artifact-delete bound, and request timestamp.
- Processing uses `DocumentAssetRepository.list()` with an explicit cursor and limit, then prunes parse artifact versions per scanned document according to the active retention policy.
- Added tests covering enqueue payloads, cursor pagination, policy-driven `parseArtifactVersions`, bounded document batches, artifact delete bounds, invalid payloads, and factory validation.

## Why

- Sprint 12 cleanup needs a scheduler-level path for parse artifact retention, not only a single-document repository primitive.
- The implementation keeps document enumeration bounded and cursor-based so cleanup can proceed in small repeatable jobs without unbounded memory or reads.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createParseArtifactRetentionCleanupWorker` did not exist.
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

- Per-document pruning performs one bounded prune call per document in the batch. The batch size is explicit, but a future database-specific bulk prune could reduce cleanup round trips further.
- Raw document object retention still needs object-storage deletion policy wiring when document lifecycle deletion semantics are finalized.
