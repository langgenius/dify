# Semantic community view materialization

## Summary

- Added a KnowledgeFS semantic community root at `/knowledge/by-community`.
- Added a bounded semantic community materializer that builds communities from
  graph relations plus entity co-occurrence fallback, writes community summary
  paths, and links source documents under each community.
- Wired ingestion-time semantic post-processing to materialize communities after
  LLM-backed entity extraction, relation extraction, and graph indexing.
- Added an explicit Admin/API operator action:
  `POST /knowledge-spaces/{id}/semantic-views/communities/materialize`.
- Updated Admin Semantic views to show topic groups, readable entities, and
  knowledge communities with summaries and counts.

## Operator Flow

1. Upload or compile a document.
2. Semantic ingestion post-processing extracts entities and relations from
   generated knowledge nodes when an LLM provider is configured.
3. The graph index writer stores canonical entities and typed relations.
4. The community materializer groups related entities into connected
   components, asks the configured LLM provider for a short community summary,
   and writes `/knowledge/by-community/{slug}` plus document child paths.
5. Admin can re-run `Extract entities` and `Materialize communities` manually for
   backfill.

## Verification

- `pnpm --filter @knowledge/api test -- src/semantic-community-materializer.test.ts src/semantic-ingestion-postprocessor.test.ts src/semantic-operator-actions.test.ts src/knowledge-fs-path-utils.test.ts src/route-classification.test.ts src/document-compilation-worker.test.ts`
- `pnpm --filter @knowledge/admin test -- app/admin-action-routes.test.ts app/page.test.tsx lib/api-client.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/admin typecheck`
- `git diff --check`
