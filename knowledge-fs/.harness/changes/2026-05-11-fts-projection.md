# FTS Projection

## Summary

- Added the Sprint 3 full-text projection boundary.
- `KnowledgeNode` text can now be persisted as ready `fts` `IndexProjection` rows for database-native exact search.

## Behavior

- Added `createFtsProjectionBuilder()` to convert bounded node batches into ready FTS projections.
- Projection metadata records FTS text, parser marker, artifact hash, document asset id, and parse artifact id.
- Database-backed projection persistence now writes `fts_document` separately from JSON metadata.
- PostgreSQL insert SQL uses `to_tsvector('simple', $n)` while TiDB keeps text in a FULLTEXT-indexed column.

## Performance And Safety

- FTS projection building is batch-based and reuses the existing `IndexProjectionRepository`.
- Database writes remain a single parameterized batch insert.
- Schema now includes database-native FTS storage:
  - PostgreSQL `tsvector` with GIN index.
  - TiDB `TEXT` with FULLTEXT index.
- Ready projection listing remains bounded and keyset-paginated by `node_id + id`.

## Verification

- RED confirmed with database schema tests failing because `index_projections_fts_document_idx` was missing.
- Focused verification passed:
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm db:migrations:write`
  - `pnpm db:migrations:check`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/database test:coverage`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- Basic hybrid retrieval is the next Sprint 3 slice.
- Future retrieval SQL should use the new FTS storage through bounded search methods rather than scanning projection metadata JSON.
