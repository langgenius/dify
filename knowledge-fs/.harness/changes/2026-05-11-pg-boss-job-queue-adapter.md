# pg-boss Job Queue Adapter

## Summary

- Added a Standalone-oriented `pg-boss` job queue adapter boundary for Phase 3 durable ingestion.
- Wired the Node platform factory to use the pg-boss adapter when a boss client is injected, while keeping the bounded inline fallback for local/dev without a database-backed job runtime.

## Changes

- Added `createPgBossJobQueueAdapter()` in `@knowledge/adapters`.
- Added portable `PgBossClient` contract with `send`, optional `complete`, optional `fail`, and optional `cancel`.
- `enqueue()` sends compact pg-boss payloads with job id, type, attempts, and optional idempotency key.
- `runAfter` maps to pg-boss `startAfter`; `idempotencyKey` maps to `singletonKey`.
- `retry()` re-delivers jobs through pg-boss and updates the external job id.
- `complete()`, `fail()`, and `cancel()` forward lifecycle calls to pg-boss when the corresponding client method exists.
- Added `externalJobId` to `JobRecord` for adapter-level provider job correlation.
- `createNodePlatformAdapter()` accepts `jobBoss` injection and switches `jobs.kind` to `pg-boss`.

## Guardrails

- pg-boss messages do not include raw document bytes or large payload bodies.
- Duplicate idempotency-key enqueue calls do not send duplicate pg-boss jobs.
- Initial delivery failure cancels the inline state and clears local idempotency mapping.
- Retry delivery failure fails closed instead of leaving queued work without a delivery event.
- Inline fallback remains bounded by batch, queue, lease, and retention limits.

## Verification

- RED first:
  - `pnpm --filter @knowledge/adapters test -- src/adapters.test.ts` failed because `./pg-boss-job-queue` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/adapters test -- src/adapters.test.ts`
  - `pnpm --filter @knowledge/adapters typecheck`
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

- This slice is implementation commit 1 after reviewed checkpoint `3b9b4d8` once committed and pushed.
- The next 10-commit health review is not yet due.
