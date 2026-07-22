# Extract API Relation Extraction Flow

## Summary

- Extracted relation extraction contracts, provider orchestration, validation, prompt construction, metadata assembly, and relation metadata parsing from `packages/api/src/index.ts` into `packages/api/src/relation-extraction-flow.ts`.
- Re-exported the new relation flow module from the API package root.
- Moved `extractedEntitiesFromNodeMetadata()` into `entity-extraction-flow.ts` so relation extraction and extraction quality controls share the same focused entity boundary without importing from the gateway.
- Added a code-health guardrail preventing relation extraction flow logic from drifting back into the gateway god file.

## TDD

- RED: added a code-health guardrail first; it failed because `relation-extraction-flow.ts` did not exist.
- GREEN: moved the relation extraction implementation and metadata helpers, re-exported the module, and reran focused contextual/code-health tests plus API typecheck and lint.

## Performance Notes

- Relation extraction keeps the existing bounded `maxBatchSize` and `maxRelationsPerNode` validation.
- Repository access remains one `getMany` plus one `updateMetadataMany` per extraction batch, avoiding N+1 node reads or writes.
- Entity/relation metadata parsing remains clone-isolated and bounded by per-node metadata already loaded with the batch.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/contextual-enrichment.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- Full workspace verification is run before commit.

## Review Cadence

- This is implementation commit 1 after review checkpoint `9042d56`.
- The next mandatory health review is due after 9 more implementation commits.
