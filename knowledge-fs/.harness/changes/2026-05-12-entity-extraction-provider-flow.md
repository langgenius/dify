# Entity Extraction Provider Flow

## What Changed

- Added `EntityExtractionProvider` and `createEntityExtractionFlow()`.
- Added typed entity extraction output for:
  - `person`
  - `organization`
  - `product`
  - `date`
  - `policy`
  - `term`
  - `metric`
- Extraction results are written into `KnowledgeNode.metadata` as:
  - `extractedEntities`
  - `entityExtraction`
- Added tests for typed extraction, metadata clone isolation, missing nodes, empty extraction output, invalid provider output, and bounded batch/entity limits.

## Why

Sprint 14 starts the graph-index foundation. Before graph schema and relation indexing, nodes need a provider-agnostic way to receive structured entity mentions from LLM or external NER providers.

## Performance Notes

- The flow loads requested nodes with one bounded `getMany` call.
- The flow persists all updated node metadata with one bounded `updateMetadataMany` call.
- `maxBatchSize` prevents unbounded node fanout.
- `maxEntitiesPerNode` prevents provider output from creating unbounded metadata payloads.
- No database N+1 read/write loop was introduced.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts` failed because `createEntityExtractionFlow` did not exist.
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

- This slice stores extracted entity mentions in node metadata only.
- Durable graph tables, relation extraction, deduplication, confidence policy, and traversal are planned in later Sprint 14 tasks.
