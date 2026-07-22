# Extract API Entity Extraction Flow

## Summary

- Extracted entity extraction contracts, provider orchestration, validation, prompt construction, and metadata assembly from `packages/api/src/index.ts` into `packages/api/src/entity-extraction-flow.ts`.
- Re-exported the new flow module from the API package root while keeping relation extraction and quality-control consumers wired through the shared `ExtractedEntity` type.
- Added a code-health guardrail preventing entity extraction flow logic from drifting back into the gateway god file.

## TDD

- RED: added a code-health guardrail first; it failed because `entity-extraction-flow.ts` did not exist.
- GREEN: moved the entity extraction implementation, re-exported it, and reran focused contextual/code-health tests plus API typecheck.

## Performance Notes

- The flow keeps the existing bounded `maxBatchSize` and `maxEntitiesPerNode` validation.
- Repository access remains one `getMany` plus one `updateMetadataMany` per extraction batch, avoiding N+1 node reads or writes.
- Metadata and returned nodes remain clone-isolated; no new unbounded queue, cache, or database access paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/contextual-enrichment.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- Full workspace verification is run before commit.

## Review Cadence

- This is implementation commit 10 after review checkpoint `5fcec6c`.
- After this commit is committed and pushed, feature iteration must pause for the mandatory 10-commit health review before continuing R6 decomposition.
