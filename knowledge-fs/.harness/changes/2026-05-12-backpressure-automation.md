# Backpressure Automation

## Summary

- Added Phase 5 Sprint 18 backpressure automation.
- The controller reads JobQueue stats plus request latency metrics and decides whether to allow, downgrade, or pause research work.
- This slice keeps the pause operation injected and does not add HTTP middleware or durable pause-state storage yet.

## Key Changes

- Added `packages/api/src/backpressure-automation.ts`.
- Exported the backpressure automation contract from `packages/api/src/index.ts`.
- Added `packages/api/src/backpressure-automation.test.ts`.

## Behavior

- High latency or excessive queued jobs marks the system under pressure.
- Deep/research mode is downgraded to fast while under pressure.
- Low-priority research tasks with a task id are paused through the injected pauser.
- Normal/high-priority requests are downgraded but not paused.
- Normal traffic is allowed without mode changes.

## Performance Notes

- Evaluation performs one `JobQueue.stats()` call.
- No database reads, no queue dequeue, and no provider calls are introduced.
- Thresholds are explicit and validated at construction.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/backpressure-automation.test.ts` failed because `./backpressure-automation` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/backpressure-automation.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/backpressure-automation.ts packages/api/src/backpressure-automation.test.ts packages/api/src/index.ts`

## Full Verification

- Passed before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This will be implementation commit 1 after reviewed checkpoint `55f83ef`.
