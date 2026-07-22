# Graph Expansion Into Deep Retrieval

## What Changed

- Added `createGraphExpandedRetrievalPath()` to the API package.
- The deep retrieval wrapper now:
  - Runs the configured hybrid retriever for initial recall.
  - Extracts bounded graph seed entity ids from retrieval item metadata.
  - Performs bounded graph traversal through `GraphIndexRepository.traverse()`.
  - Uses traversed entity names as an entity metadata filter for one graph-expanded recall.
  - Merges graph recall candidates back into the base result with a bounded score boost.
- Added optional graph expansion metrics to `HybridRetrievalMetrics`.
- Added tests for successful graph expansion, no-seed fallback, bound validation, and permission-scoped graph filtering.

## Why It Changed

- Sprint 14 requires deep mode to merge hybrid recall with graph expansion.
- The implementation keeps graph usage behind the existing graph repository contract and avoids unbounded candidate or traversal growth.
- The expansion uses one bounded graph traversal path and one bounded recall pass rather than per-candidate database waterfalls.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts` failed because `createGraphExpandedRetrievalPath` was missing.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification before push:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- Current seed extraction relies on retrieval item metadata containing graph entity ids, such as `graphEntityIds` from node metadata. Keep graph indexing and projection metadata aligned as runtime wiring matures.
- Multi-seed expansion remains explicitly bounded by `maxSeedEntities`; live latency should be watched once real database graph traversal is enabled.
