# Contextual Enrichment Cost Controls

## What Changed

- Extended the contextual enrichment flow with optional cost-control inputs:
  - `estimatedCostUsdPerNode`
  - `maxEstimatedCostUsd`
  - `minQualityScore`
  - `forceRefresh`
- Added cache reuse through the existing `CacheAdapter` contract.
  - Cache keys are versioned and hash-based.
  - Cache values are bounded to 64 KiB.
  - Cache keys do not include raw node text.
- Added skip behavior for nodes that already have a contextual description unless callers request `forceRefresh`.
- Added quality-threshold handling so low-quality provider output is skipped without writing node metadata.
- Kept writes batched through `KnowledgeNodeRepository.updateMetadataMany`.

## Why

Sprint 13 contextual enrichment needs provider-cost guardrails before it can safely run over larger node batches. The flow now avoids unnecessary provider calls, rejects work that would exceed the configured budget, and reuses cached provider output for deterministic node/model/prompt inputs.

## Performance Notes

- The flow still uses one batched `getMany` load and one batched metadata update.
- Provider calls remain bounded by `maxBatchSize`.
- Cache usage is optional, bounded, version-aware, and does not store unbounded payloads.
- Budget checks happen before provider calls for all cache misses.

## Verification

- RED: Added contextual enrichment tests for already-enriched skips, cache reuse, budget rejection, quality-threshold skips, option validation, and forced refresh.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/api typecheck`

## Known Risks And Follow-Up

- Cache lookups are per node because the current `CacheAdapter` contract has no batch-get primitive. This remains bounded by `maxBatchSize`; a future cache contract can add `getMany` if enrichment batches grow large enough to justify it.
- This commit is the 10th implementation commit after review checkpoint `c8700a7`; a mandatory health review must run immediately after it is committed and pushed.
