# Research Task Dry-Run Planning

## What Changed

- Added `createResearchTaskDryRunPlanner()` with bounded estimates for:
  - scanned resources,
  - tool calls,
  - input/output/total token usage,
  - p50/p95 latency,
  - USD cost range,
  - cache hit probability.
- Added authenticated `POST /research-tasks/plan`.
- The plan endpoint validates the caller's tenant-scoped `KnowledgeSpace`, uses read scope, and never enqueues durable work.
- OpenAPI now documents the dry-run request and response.

## Why

- Sprint 17 requires agents and users to estimate the cost, latency, scan breadth, and tool-call footprint of a research task before starting expensive asynchronous work.

## Performance Notes

- The endpoint performs one tenant-scoped knowledge-space lookup and one pure in-process planning call.
- Planning uses the existing bounded retrieval planner and enforces `topK <= 50` and query byte limits.
- No object storage, database list, queue enqueue, retrieval execution, provider call, or partial-result write is performed.

## TDD / Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/research-task-planning.test.ts src/gateway.test.ts` failed because `./research-task-planning` and `/research-tasks/plan` did not exist.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-planning.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts packages/api/src/research-task-planning.ts packages/api/src/research-task-planning.test.ts`
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

- The current estimator is deterministic and heuristic. Later workflow slices should replace constants with live provider pricing, retrieval corpus statistics, and durable cache hit telemetry.
- This slice does not enforce limits on launched research tasks; Sprint 17 limits enforcement remains next.
