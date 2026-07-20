# Research Task Resumability

## What Changed

- Added `resume(jobId)` to `ResearchTaskJobStateMachine`.
- Resume reads the persisted job stage and re-enqueues durable `research.task` work with `resumeFromStage`.
- Resume updates only the queue job id and timestamp; it does not reset the task to `queued`.
- Terminal jobs remain immutable and cannot be resumed.

## Why

- Sprint 17 requires research tasks to resume from the last persisted state after process restart rather than replaying work from the beginning.

## Performance Notes

- Resume performs one job read, one bounded queue enqueue, and one job update.
- It reuses the existing bounded job payload and idempotency-key strategy.
- No partial results are read during resume, avoiding a restart-time query waterfall.

## TDD / Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts` failed because `resume()` did not exist.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/research-task-job.ts packages/api/src/research-task-job.test.ts`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This slice adds the state-machine resume contract only. A durable database-backed research task repository and worker restart orchestration still need to wire this into actual process recovery.
