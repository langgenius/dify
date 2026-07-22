# Extract API Extraction Quality Control Flow

## Summary

- Extracted extraction quality control contracts, validation, entity/relation eligibility checks, duplicate detection, stats aggregation, and batch metadata update orchestration from `packages/api/src/index.ts` into `packages/api/src/extraction-quality-control-flow.ts`.
- Re-exported the new flow module from the API package root.
- Reused the focused entity/relation metadata parsing helpers from `entity-extraction-flow.ts` and `relation-extraction-flow.ts`, avoiding a dependency back into the gateway.
- Added a code-health guardrail preventing extraction quality control logic from drifting back into the gateway god file.

## TDD

- RED: added a code-health guardrail first; it failed because `extraction-quality-control-flow.ts` did not exist.
- GREEN: moved the implementation, re-exported it, and reran focused contextual/code-health tests plus API typecheck and lint.

## Performance Notes

- The flow keeps the existing bounded `maxBatchSize`, `maxEligibleEntitiesPerNode`, and `maxEligibleRelationsPerNode` validation.
- Repository access remains one `getMany` plus one `updateMetadataMany` per quality-control batch.
- Eligibility checks are in-memory over already-loaded per-node extracted entity/relation metadata; no new database queries, unbounded reads, or long-lived caches were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/contextual-enrichment.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- Full workspace verification is run before commit.

## Review Cadence

- This is implementation commit 2 after review checkpoint `9042d56`.
- The next mandatory health review is due after 8 more implementation commits.
