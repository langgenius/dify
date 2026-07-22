# Graph Index Persistence

## What Changed

- Added graph index contracts in `@knowledge/api`:
  - `GraphEntity`
  - `GraphRelation`
  - `GraphIndexRepository`
  - `createInMemoryGraphIndexRepository`
  - `createDatabaseGraphIndexRepository`
  - `createGraphIndexWriter`
- Added bounded in-memory persistence for graph entities and relations.
- Added database-backed entity/relation upserts through `DatabaseAdapter.execute`.
- Added a graph writer that converts quality-controlled extraction metadata into versioned graph entities and relations.
- Added `packages/api/src/graph-index.test.ts` covering in-memory behavior, database SQL behavior, quality filtering, endpoint skipping, and bounds.

## Why

Sprint 14 needs extraction outputs to become a queryable graph index before traversal and graph-assisted retrieval can be built. This slice creates the write side while preserving the existing architecture: TypeScript owns orchestration and database access, and database-facing writes stay behind adapter contracts.

## Performance Notes

- Graph indexing loads source nodes with one bounded `getMany` call.
- In-memory persistence requires explicit `maxEntities`, `maxRelations`, and `maxBatchSize`.
- Database persistence uses batched upserts with parameter arrays and explicit `maxRows`; user/entity text is never interpolated into SQL.
- Relations are only written when both endpoints resolve to eligible graph entities, avoiding dangling traversal edges.
- Existing schema indexes support canonical entity upsert/listing and outgoing/incoming relation traversal.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/graph-index.test.ts` before implementation.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
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

## Known Risks And Follow-Up

- This slice writes graph index records but does not expose traversal APIs yet.
- Relation upsert idempotency currently depends on the writer's deterministic relation ids. A future schema refinement can add an explicit relation edge unique index if traversal updates need direct database-level edge de-duplication independent of generated ids.
