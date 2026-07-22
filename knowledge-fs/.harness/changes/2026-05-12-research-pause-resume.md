# Research Pause Resume

## Summary

- Added real pause support to `ResearchTaskJobStateMachine`.
- Paused research tasks cancel current queued work, remember the prior stage, and resume from that stage later.

## Key Changes

- Added `paused` to `ResearchTaskJobStage`.
- Added optional `pausedAt`, `pausedFromStage`, and `resumeAfter` job fields.
- Added `pause(id, { reason, resumeAfter? })`.
- Updated `resume(id)` so paused tasks re-enqueue from `pausedFromStage`, restore that stage, and clear pause metadata.
- Added regression coverage in `packages/api/src/research-task-job.test.ts`.

## Performance Notes

- `pause()` performs one job read, one queue cancel, and one job update.
- `resume()` performs one job read, one queue enqueue, and one job update.
- No partial-result scan, list, or database fan-out was added.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts` failed because `machine.pause` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/research-task-job.ts packages/api/src/research-task-job.test.ts`

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

- This will be implementation commit 2 after reviewed checkpoint `55f83ef`.
