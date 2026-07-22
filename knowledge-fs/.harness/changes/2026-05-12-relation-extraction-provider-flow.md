# Relation Extraction Provider Flow

## What Changed

- Added `RelationExtractionProvider` and `createRelationExtractionFlow()`.
- Added typed relation extraction output for:
  - `mentions`
  - `defines`
  - `references`
  - `depends_on`
  - `supersedes`
  - `contradicts`
- Relation provider calls receive existing `extractedEntities` from node metadata as context.
- Extraction results are written into `KnowledgeNode.metadata` as:
  - `extractedRelations`
  - `relationExtraction`
- Added tests for typed relation extraction, entity context propagation, metadata clone isolation, missing nodes, invalid provider output, and bounded batch/relation limits.

## Why

Sprint 14 needs relation mentions before graph schema and graph index persistence can be introduced. Keeping relation extraction provider-agnostic allows LLM structured output or external extraction providers to plug into the same node metadata boundary.

## Performance Notes

- The flow loads requested nodes with one bounded `getMany` call.
- The flow persists all updated node metadata with one bounded `updateMetadataMany` call.
- `maxBatchSize` prevents unbounded node fanout.
- `maxRelationsPerNode` prevents provider output from creating unbounded metadata payloads.
- Provider calls are per loaded node, but database reads and writes remain batched.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/contextual-enrichment.test.ts` failed because `createRelationExtractionFlow` did not exist.
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

- This slice stores extracted relations in node metadata only.
- Durable graph schema, graph indexing, confidence/dedup policy, and traversal remain planned in later Sprint 14 tasks.
