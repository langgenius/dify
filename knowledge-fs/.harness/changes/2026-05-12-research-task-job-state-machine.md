# ResearchTaskJob State Machine

## What Changed

- Added `ResearchTaskJob` contracts to `@knowledge/api`.
- Added `createResearchTaskJobStateMachine()` with explicit stage progression:
  - `queued -> planning -> retrieving -> analyzing -> generating -> completed`
  - terminal states: `completed`, `failed`, `canceled`
- Added `createInMemoryResearchTaskJobRepository()` as a bounded, clone-isolated local repository.
- Exported the research task job boundary from `packages/api/src/index.ts`.

## Why

- Phase 5 needs a durable agent-native research lifecycle before APIs, partial results, budget enforcement, resumability, and MCP tools can be layered on top.
- The state machine keeps lifecycle mutation centralized and prevents skipped stages or mutation after terminal states.

## Performance Notes

- The in-memory repository requires `maxJobs >= 1` and rejects capacity overflow instead of growing without bound.
- Batch reads dedupe requested ids before hitting the repository map.
- Task query input is bounded by `maxQueryBytes` before enqueueing work.
- State transitions use one repository read and one update; no loops over external data or repeated database calls are introduced.

## TDD / Verification

- RED: `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts` failed because `./research-task-job` did not exist.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/research-task-job.ts packages/api/src/research-task-job.test.ts packages/api/src/index.ts`
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

- This slice does not add Hono research task endpoints yet; that is the next Sprint 17 item.
- This slice does not add database-backed persistence for research tasks; the state machine contract is ready for a durable repository in a later task.
