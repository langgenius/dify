# KnowledgeNode Repository

## Summary

- Added bounded in-memory and database-backed `KnowledgeNode` repositories.
- This completes the Sprint 3 persistence boundary for chunk output without adding API routes yet.

## Behavior

- Added `KnowledgeNodeRepository` with `createMany(nodes)` and `listByArtifact({ parseArtifactId, limit, cursor? })`.
- In-memory persistence supports bounded batch writes, total node capacity, clone isolation, and stable artifact listing.
- Database-backed persistence writes nodes in a single parameterized batch insert and lists by `parse_artifact_id`, `start_offset`, and `id`.
- Pagination uses an explicit `{ startOffset, id }` keyset cursor and reads `limit + 1` rows to compute `nextCursor`.

## Performance And Safety

- Batch writes reject empty input and batches larger than `maxBatchSize`.
- Listing requires explicit `limit` and rejects values above `maxListLimit`.
- Database reads pass explicit `maxRows` and rely on the existing `knowledge_nodes_artifact_offset_idx`.
- User/node text is kept in SQL params and is not interpolated into SQL strings.

## Verification

- RED confirmed with API tests failing because `createInMemoryKnowledgeNodeRepository` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
