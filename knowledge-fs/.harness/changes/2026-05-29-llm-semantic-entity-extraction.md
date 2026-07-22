# LLM-backed semantic entity extraction

## Summary

- Added a reusable `createLlmEntityExtractionProvider()` adapter that turns
  strict JSON LLM output into the existing `EntityExtractionProvider` contract.
- Wired the Semantic views `Extract entities` operator to prefer the provider
  extraction flow, then apply extraction quality controls before graph indexing.
- Added a semantic ingestion post-processor so synchronous compute-backed uploads
  and durable document compilation workers can populate entity graph views from
  the same provider extraction flow.
- Added Node API environment configuration for OpenAI or Anthropic-backed
  semantic entity extraction.
- Removed the bootstrap extractor fallback from the operator path so semantic
  graph data is not polluted by regex-derived numbers, ids, or generic words.

## Usage

- `OPENAI_API_KEY` enables OpenAI-backed extraction by default.
- `ANTHROPIC_API_KEY` enables Anthropic-backed extraction when OpenAI is not
  configured.
- `KNOWLEDGE_ENTITY_EXTRACTION_PROVIDER=openai|anthropic|off` pins or disables
  the provider selection.
- `KNOWLEDGE_ENTITY_EXTRACTION_MODEL` overrides the default extraction model.
- `KNOWLEDGE_ENTITY_EXTRACTION_MAX_ENTITIES_PER_NODE` limits per-node output.
- `KNOWLEDGE_ENTITY_EXTRACTION_MAX_NODES_PER_RUN` bounds each operator or
  ingestion semantic extraction batch.
- `KNOWLEDGE_ENTITY_EXTRACTION_MAX_OUTPUT_TOKENS` limits the LLM response size.
- `KNOWLEDGE_RELATION_EXTRACTION_MODEL` and
  `KNOWLEDGE_RELATION_EXTRACTION_MAX_RELATIONS_PER_NODE` tune relation
  extraction.
- `KNOWLEDGE_COMMUNITY_SUMMARY_MODEL` tunes LLM community summaries.

## Rationale

The previous operator path used regex/bootstrap extraction to make semantic
views demonstrable, but it was too noisy for real documents. Reusing the
existing provider extraction flow keeps explicit Admin actions aligned with the
summary-tree style provider architecture and makes entity output explainable,
typed, confidence-scored, and graph-ready.

Without an LLM provider, semantic extraction now fails closed instead of writing
bootstrap graph entries.

## Verification

- `pnpm exec biome check --write packages/api/src/llm-entity-extraction-provider.ts packages/api/src/llm-entity-extraction-provider.test.ts packages/api/src/semantic-operator-actions.ts packages/api/src/semantic-operator-actions.test.ts packages/api/src/gateway-options.ts packages/api/src/index.ts packages/api/src/semantic-operator-schemas.ts apps/api/src/llm-options.ts apps/api/src/llm-options.test.ts apps/api/src/index.ts apps/api/package.json apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/app/api/admin-semantic-views/route.ts apps/admin/app/admin-action-routes.test.ts README.md .harness/changes/2026-05-28-admin-semantic-operator-actions.md .harness/changes/2026-05-29-llm-semantic-entity-extraction.md`
- `pnpm --filter @knowledge/api test -- src/llm-entity-extraction-provider.test.ts src/semantic-operator-actions.test.ts src/semantic-ingestion-postprocessor.test.ts src/document-compilation-worker.test.ts src/gateway-document-write.test.ts`
- `pnpm --filter @knowledge/api-app test -- src/llm-options.test.ts`
- `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts app/admin-action-routes.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api-app typecheck`
- `pnpm --filter @knowledge/admin typecheck`
- `git diff --check`
