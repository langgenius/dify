# Extract API Graph Index Repository

## Summary

- Extracted graph index repository contracts, bounded in-memory implementation, database-backed implementation, traversal SQL, clone helpers, and traversal validation from `packages/api/src/index.ts` into `packages/api/src/graph-index-repository.ts`.
- Extracted graph extraction union types into `packages/api/src/extraction-types.ts` so the new repository module does not depend back on the gateway aggregation file.
- Added a code-health guardrail that keeps graph repository implementations out of `index.ts` and prevents the new module from importing `./index`.

## Why

- Continues R6 API module decomposition from `docs/code-review-issues.md`.
- Keeps the gateway closer to a composition and route wiring surface instead of retaining repository SQL and traversal logic.
- Reduces `packages/api/src/index.ts` from 15,507 to 14,311 lines while preserving graph traversal, pruning, upsert, and retrieval expansion behavior.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `graph-index-repository.ts` did not exist.
- GREEN: moved the implementation, fixed the traversal comparator import, and reran focused graph/index/summary coverage.

## Performance Notes

- Preserved existing explicit graph traversal budgets: `maxDepth`, `fanout`, `maxNodes`, `timeoutMs`, and database `maxRows`.
- Preserved tenant-scoped graph list/traversal/prune filters and parameterized SQL.
- In-memory graph repositories remain bounded by explicit `maxEntities`, `maxRelations`, and `maxBatchSize`.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/graph-index.test.ts src/summary-tree.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/graph-index.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 1 after review checkpoint `0e46d78`.
