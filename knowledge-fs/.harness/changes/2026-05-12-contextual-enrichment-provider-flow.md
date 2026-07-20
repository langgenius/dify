# Contextual Enrichment Provider Flow

## What Changed

- Added `ContextualEnrichmentProvider` and `createContextualEnrichmentFlow()` in `@knowledge/api`.
- Added `KnowledgeNodeRepository.updateMetadataMany()` to persist contextual metadata in bounded batches.
- Implemented in-memory metadata batch updates with clone isolation.
- Implemented database-backed metadata batch updates with a single parameterized `UPDATE ... CASE` statement followed by one batched read.
- Added `packages/api/src/contextual-enrichment.test.ts` covering successful enrichment, missing nodes, provider failures, invalid bounds, clone isolation, and database parameterization.

## Why

Phase 4 Sprint 13 starts the advanced compiler work by allowing KnowledgeNodes to receive provider-generated contextual descriptions. The first slice keeps the flow provider-agnostic and repository-backed without changing retrieval behavior or introducing budget policy yet.

## Performance Notes

- Node loading uses one bounded `getMany` call.
- Metadata persistence uses one bounded batch update rather than one update per node.
- Provider calls are bounded by `maxBatchSize`; cost controls and cache reuse are intentionally left to the next Sprint 13 slice.
- Database SQL remains parameterized and scoped by `knowledge_space_id`.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts` failed because `createContextualEnrichmentFlow` and `repository.updateMetadataMany` did not exist.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- Provider calls are currently per-node within a bounded batch. The next enrichment cost-control slice should add budget limits, skip rules, and cache reuse before this flow is wired into high-volume ingestion jobs.
