# Dense Vector Projection

## Summary

- Added the Sprint 3 dense vector projection boundary.
- Projection building now batches `KnowledgeNode` text through the embedding provider and persists `IndexProjection` rows.

## Behavior

- Added bounded in-memory and database-backed `IndexProjectionRepository` implementations.
- Added `createDenseVectorProjectionBuilder()` to embed a node batch once and create ready `dense-vector` projections.
- Projection metadata records dense vector, dimension, embedding provider, model version, artifact hash, document asset id, and parse artifact id.
- Database persistence writes `dense_vector` separately from JSON metadata and keeps the core `IndexProjection` model stable.
- Added ready-projection listing by `knowledgeSpaceId + type + status` with stable `nodeId + id` keyset pagination.

## Performance And Safety

- Dense projection building uses one embedding call per node batch, avoiding N+1 provider requests.
- Repository writes use one parameterized batch insert and explicit `maxRows`.
- List reads require explicit limits, use `limit + 1`, and use a stable keyset cursor.
- Schema index `index_projections_space_type_status_idx` now includes `node_id` and `id` for stable ready-projection pagination.
- Migration artifacts now include nullable dialect-specific `dense_vector` storage.

## Verification

- RED confirmed with database schema tests failing for missing vector storage and stable projection index columns.
- Focused verification passed:
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/database test:coverage`
  - `pnpm db:migrations:write`
  - `pnpm db:migrations:check`
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

- FTS projection is the next Sprint 3 slice.
- Runtime database drivers still need live pgvector/TiDB integration tests before relying on vector search in production.
