# Embedding Model Registry

## Summary

- Added the Phase 3 Sprint 11 embedding model registry boundary.
- Registry entries now record provider, model id, version, dimension, metric, tokenizer, max tokens, status, and metadata.
- Added checked-in PostgreSQL/TiDB migration artifacts for the registry table.

## Changes

- Added `EmbeddingModelSchema` and `EmbeddingModel` to `@knowledge/core`.
- Added `embedding_models` to the database schema catalog.
- Added `embedding_models_model_version_uq` for exact version lookup.
- Added `embedding_models_status_provider_idx` for bounded registry listing with stable keyset pagination.
- Added `createInMemoryEmbeddingModelRegistry()` with bounded capacity and clone isolation.
- Added `createDatabaseEmbeddingModelRegistry()` with parameterized SQL, explicit `maxRows`, and no user-input SQL interpolation.
- Regenerated deterministic initial migration artifacts.

## Performance Notes

- Registry list calls require explicit `limit` and reject requests above `maxListLimit`.
- List pagination is stable on `model_id + id`, matching the database index order.
- Exact model lookup uses the unique `model_id + version` index.
- In-memory fallback rejects unbounded growth through `maxModels`.

## Verification

- RED first:
  - `pnpm --filter @knowledge/core test -- src/models.test.ts`
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- GREEN/full verification:
  - `pnpm --filter @knowledge/core test -- src/models.test.ts`
  - `pnpm --filter @knowledge/database test -- src/schema.test.ts src/migration-file.test.ts`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm db:migrations:write`
  - `pnpm db:migrations:check`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Cadence

- This is implementation commit 7 after reviewed checkpoint `3b9b4d8`.
- The next mandatory 10-commit health review is not yet due.
