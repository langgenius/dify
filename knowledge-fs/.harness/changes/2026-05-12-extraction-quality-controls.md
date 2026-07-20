# Extraction Quality Controls

## What Changed

- Added `createExtractionQualityControlFlow()`.
- Entity and relation extraction outputs now can be quality-marked in node metadata.
- Low-confidence, duplicate, and budget-exceeded outputs are retained but marked:
  - `quality.graphEligible: false`
  - `quality.reason`
- Eligible outputs are marked:
  - `quality.graphEligible: true`
- Added aggregate quality stats for controlled nodes.

## Why

Sprint 14 requires low-confidence extraction output to remain auditable while being excluded from graph and semantic views. This creates the quality boundary before durable graph schema and graph indexing.

## Performance Notes

- Requested nodes are loaded through one bounded `getMany` call.
- Updated metadata is persisted through one bounded `updateMetadataMany` call.
- `maxBatchSize`, `maxEligibleEntitiesPerNode`, and `maxEligibleRelationsPerNode` prevent unbounded fanout or metadata growth.
- No database N+1 read/write loop was introduced.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts` failed because `createExtractionQualityControlFlow` did not exist.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice marks graph eligibility in node metadata only.
- Durable graph schema and graph-index persistence are planned in the next Sprint 14 slices.
