# KnowledgeFS `/by-entity`

## What Changed

- Added `GraphIndexRepository.listEntities()` with stable `name + id` keyset pagination.
- Added a KnowledgeFS virtual view at `/knowledge/by-entity`.
- `GET /knowledge-spaces/{id}/fs/ls?path=/knowledge/by-entity` now lists graph entities as virtual directories.
- `GET /knowledge-spaces/{id}/fs/ls?path=/knowledge/by-entity/{entityId}` now lists related document resources by traversing the graph and loading related source nodes in one bounded batch.
- Added tests for root entity listing, entity document listing, pagination, truncation, and invalid nested by-entity paths.
- Fixed graph entity pagination cursor behavior so the cursor points to the last emitted entity and does not skip the next page.

## Why It Changed

- Sprint 15 requires semantic KnowledgeFS views. `/by-entity` is the first one, backed by the graph index created in Sprint 14.
- The implementation keeps the view inside the existing KnowledgeFS command surface and avoids introducing a new endpoint shape.
- Related document listing batches node loading by source node ids and deduplicates document resources in memory within explicit limits.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/graph-index.test.ts` failed because `/knowledge/by-entity` returned an empty physical path listing.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts`
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

- `/by-entity/{entityId}` currently uses graph traversal plus source-node batches and does not materialize a persistent semantic view yet.
- Semantic view freshness and async materialization are planned in upcoming Sprint 15 tasks.
