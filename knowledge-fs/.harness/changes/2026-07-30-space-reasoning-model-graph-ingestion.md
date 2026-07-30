# Space reasoning model for graph ingestion

Date: 2026-07-30

## What changed

- Added a tenant-scoped semantic extraction flow resolver that creates entity and relation
  extraction flows from the owning knowledge space's `retrievalProfile.reasoningModel`.
- Durable document compilation now passes the attempt's frozen retrieval profile into semantic
  post-processing, so one publication candidate cannot mix reasoning-model revisions.
- Synchronous uploads, Source materialization, and the manual entity repair action resolve the
  current knowledge-space manifest and use the same Dify-managed reasoning-model route.
- Automatic graph ingestion is now assembled independently of
  `KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER`. The fixed-provider path remains only as a compatibility
  fallback for callers that explicitly construct it.
- Kept extraction bounded by the existing maximum nodes, entities, relations, and output-token
  settings. Profile resolution performs at most one manifest read and one provider construction per
  semantic run, not per node.

## Why

Knowledge spaces already persist a complete system reasoning-model selection, but graph
post-processing was assembled only when a deployment-wide extraction provider was configured.
Consequently documents could be fully vector-indexed while producing no graph entities or
relations, and Overview correctly displayed zero counts. The graph pipeline must use the same
space-owned model identity as other reasoning capabilities instead of requiring a second global
model configuration.

## Verification

- TDD red phase:
  - a new profile-aware postprocessor test initially failed because the module did not exist;
  - the durable worker test initially showed that the frozen retrieval profile was omitted;
  - synchronous upload and manual repair tests initially showed no profile provider invocation;
  - API app configuration initially had no profile-scoped semantic options.
- Passing focused verification:
  - `pnpm exec vitest run src/knowledge-space-semantic-ingestion-postprocessor.test.ts src/document-compilation-worker.test.ts`
  - `pnpm exec vitest run src/gateway-document-write.test.ts -t "runs semantic operator actions"`
  - `pnpm exec vitest run src/gateway-document-write.test.ts -t "generates queryable knowledge nodes during synchronous upload"`
  - `pnpm test` in `packages/api` (373 files, 4,101 tests; 3 existing skips)
  - `pnpm test` in `apps/api` (42 files, 209 tests)
  - `pnpm test:coverage` in `packages/api` (93.88% lines/statements, 96.36% functions,
    90.03% branches)
  - `pnpm build`
  - `pnpm check`
  - Biome check for all 14 changed TypeScript files
- Repository-wide `pnpm lint` remains blocked by pre-existing formatting findings in unchanged
  Admin/test/contract files and the existing 1.3 MiB OpenAPI artifact exceeding Biome's 1 MiB
  processing limit.

## Risks and follow-up

- Existing documents whose graph was previously skipped are not silently mutated at startup.
  Operators can use the existing entity extraction repair action, now backed by the space reasoning
  model, or run the normal document rebuild path.
- A knowledge space without an activated reasoning profile cannot perform profile-aware graph
  extraction. Durable candidate builds and explicit repair calls fail closed; legacy synchronous
  ingestion retains its existing best-effort error boundary.
- Model output must still satisfy the strict bounded entity/relation JSON contracts. Provider or
  validation errors remain visible on durable and explicit repair paths.
