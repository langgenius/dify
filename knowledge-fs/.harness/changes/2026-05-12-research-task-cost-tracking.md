# Research Task Cost Tracking

## What Changed

- Added `budgetUsd` and cost summaries to `ResearchTaskJob`.
- Added `recordCost(jobId, input)` to `ResearchTaskJobStateMachine`.
- Each cost record stores step, provider, usage, timestamp, and USD cost.
- Budget exhaustion automatically cancels the underlying queue job and marks the research task `canceled`.
- `POST /research-tasks` now accepts optional `budgetUsd`; responses include cost state.

## Why

- Sprint 17 requires research workflows to check cost after each step and cancel safely when a task exceeds its budget while keeping existing partial results readable.

## Performance Notes

- Cost mutation is one job read and one job update.
- Cost entries are stored on the bounded research task job object; the surrounding repository remains capped by `maxJobs`.
- Cost input validation rejects negative or non-finite values before mutation.
- Budget cancellation uses the existing queue cancel path and does not touch partial-result storage.

## TDD / Verification

- RED: `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts` failed because `recordCost()` did not exist.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts packages/api/src/research-task-job.ts packages/api/src/research-task-job.test.ts`
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

- Cost entries are in-memory with the current bounded job repository; durable task persistence will need to carry the same fields.
- This slice records supplied step cost. Provider-specific estimation/planning remains for the dry-run planning and workflow slices.
- This commit is the 10th implementation commit after reviewed checkpoint `7a7672c`; feature work must pause for the required project health review immediately after push.
