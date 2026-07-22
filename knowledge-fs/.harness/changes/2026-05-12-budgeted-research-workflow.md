# Budgeted Research Workflow

## Summary

- Added a Phase 5 Sprint 18 budgeted research workflow orchestration boundary.
- The workflow runs `dry-run budget planning -> retrieval -> source comparison -> conflict detection -> freshness checking -> citation report`.
- This slice keeps the workflow dependency-injected and does not add a queue worker, HTTP route, database repository, or provider SDK wiring.

## Key Changes

- Added `packages/api/src/research-workflow.ts`.
- Exported workflow contracts from `packages/api/src/index.ts`.
- Added `packages/api/src/research-workflow.test.ts`.

## Behavior

- Validates `knowledgeSpaceId`, `query`, and bounded `topK`.
- Uses the existing dry-run planner before retrieval.
- Rejects budget-exceeded requests before retrieval.
- Rejects limit violations before retrieval.
- Calls injected retriever, source comparison, conflict detection, and freshness checking services.
- Returns a completed workflow report with evidence bundle id, plan, comparison report, conflict report, freshness report, deduplicated citations, summary, and optional trace id.

## Performance Notes

- `maxTopK` bounds retrieval fan-out.
- `maxCitations` bounds final citation report size.
- Budget and limit checks happen before retrieval or provider work.
- Citation aggregation is a single pass over already-returned evidence items.
- No database, object storage, queue, or provider calls are introduced outside injected dependencies.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/research-workflow.test.ts` failed because `./research-workflow` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/research-workflow.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/research-workflow.ts packages/api/src/research-workflow.test.ts packages/api/src/index.ts`

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

- This will be implementation commit 10 after reviewed checkpoint `f7581f5`.
- After commit and push, project health review must run before any further feature implementation.
