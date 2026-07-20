# Review Fix: Research Task Cost Bounds

## What Changed

- Reviewed the 10 implementation commits after checkpoint `7a7672c`; remediation checkpoint is `f7581f5`.
- Found one high-priority performance issue in the new research cost tracking path: per-job cost entries and usage metadata could grow without explicit bounds during long-running research tasks.
- Added `maxCostEntries` and `maxCostUsageBytes` options to `createResearchTaskJobStateMachine()`.
- `recordCost()` now rejects writes that would exceed those bounds before mutating the job record.
- Added TDD coverage for cost entry count and usage payload byte limits.

## Why

- Research tasks are explicitly long-running and can record cost after every step. Even with a bounded job repository, an individual job must not accumulate unbounded cost history or arbitrary usage payloads.
- This keeps the Sprint 17 cost tracking contract aligned with the project's high-performance guardrails.

## Performance Notes

- Cost mutation remains one job read and one job update.
- Each job now has bounded cost-entry cardinality and bounded per-entry usage metadata size.
- Existing budget cancellation behavior and partial-result retention behavior are unchanged.

## TDD / Verification

- RED: `pnpm --filter @knowledge/api test -- src/research-task-job.test.ts` failed because cost entries were not bounded.
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

- Research task persistence is still in-memory by default. The future durable repository must carry the same cost bounds and ideally store cost events separately with paginated reads.
- Dry-run planning remains the next Sprint 17 slice after this review checkpoint is recorded.
