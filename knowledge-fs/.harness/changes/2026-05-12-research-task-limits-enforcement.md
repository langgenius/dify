# Research Task Limits Enforcement

## What Changed

- Added research task launch limits:
  - `timeoutMs`
  - `maxRetrievalSteps`
  - `maxScannedResources`
  - `maxToolCalls`
- Extended dry-run plans with `retrievalSteps`.
- Added `evaluateResearchTaskLimits(plan, limits)` to report deterministic limit violations.
- `POST /research-tasks` now evaluates limits before enqueueing the durable job.
- Accepted limits are stored on the `ResearchTaskJob` and included in the queue payload for future workers.

## Why

- Sprint 17 requires research tasks to be bounded before expensive execution starts. Agents should not be able to launch work that already exceeds declared timeout, retrieval, scan, or tool-call limits.

## Performance Notes

- Limit enforcement uses the existing dry-run planner and does not execute retrieval, call providers, or write partial results.
- Rejected requests perform one tenant-scoped KnowledgeSpace lookup and one pure planning/evaluation call, then return `422` without queue enqueue.
- Limit validation rejects non-positive or non-integer values before storing job state.

## TDD / Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/research-task-planning.test.ts src/gateway.test.ts` failed because limit evaluation and launch enforcement did not exist.
- GREEN focused checks passed:
  - `pnpm --filter @knowledge/api test -- src/research-task-planning.test.ts src/research-task-job.test.ts src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/index.ts packages/api/src/gateway.test.ts packages/api/src/research-task-planning.ts packages/api/src/research-task-planning.test.ts packages/api/src/research-task-job.ts`
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

- This slice enforces limits at launch based on deterministic estimates. Runtime workers must also check actual counters during Sprint 18 budgeted workflow execution.
- Future durable research task repositories must persist the same limits with the job record.
