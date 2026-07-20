# Admin Semantic Operator Actions

## Summary

- Added explicit API operator actions for semantic topic-view materialization and bootstrap entity extraction.
- Wired the actions into the gateway at:
  - `POST /knowledge-spaces/{id}/semantic-views/topic/materialize`
  - `POST /knowledge-spaces/{id}/semantic-views/entities/extract`
- Added Admin Console buttons in the `Semantic views` panel:
  - `Materialize topic view`
  - `Extract entities`
- Extended the Admin API client and action route tests for the new operator submissions.
- Updated the README Semantic views guide to describe when and how to run the actions.

## Behavior

`Materialize topic view` lists uploaded document assets and writes semantic
KnowledgeFS paths under `/knowledge/by-topic/uploaded-documents/{assetId}` with
fresh semantic-view metadata.

`Extract entities` scans KnowledgeNodes, prefers the configured
`EntityExtractionProvider`/LLM path, applies extraction quality controls, and
invokes the graph index writer so `/knowledge/by-entity` becomes populated. If
no provider is configured, it falls back to the bootstrap extractor to keep local
operator smoke tests usable.

## Verification

- `pnpm exec biome check --write packages/api/src/semantic-operator-schemas.ts packages/api/src/semantic-operator-routes.ts packages/api/src/semantic-operator-actions.ts packages/api/src/semantic-operator-handlers.ts packages/api/src/index.ts packages/api/src/route-classification.ts packages/api/src/route-classification.test.ts packages/api/src/gateway-document-write.test.ts apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/app/api/admin-semantic-views/route.ts apps/admin/app/page.tsx apps/admin/app/page.test.tsx apps/admin/app/admin-action-routes.test.ts`
- `pnpm --filter @knowledge/api test -- src/gateway-document-write.test.ts src/route-classification.test.ts`
- `pnpm --filter @knowledge/api test -- src/semantic-operator-actions.test.ts`
- `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts app/page.test.tsx app/admin-action-routes.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/admin typecheck`
- `pnpm --filter @knowledge/api test:coverage`
- `pnpm check`
- `pnpm build`
- `cargo test --workspace`
- Browser verification at `http://127.0.0.1:3000` confirmed both `Materialize topic view` and `Extract entities` are visible and posted through `/api/admin-semantic-views`.

`pnpm lint` was also run, but it failed on existing full-repository Biome
diagnostics outside this change, including `apps/api/src/index.ts`,
`packages/api/src/artifact-segment-repository.ts`, `packages/api/src/knowledge-fs-command-registry.ts`,
and `packages/api/src/staged-commit-repository.ts`. The files changed for this
operator action were checked with targeted `biome check --write`.

## Risks And Follow-Up

- The entity extractor is a deterministic bootstrap operator, not the final
  LLM-backed extraction pipeline. It is intentionally useful for local operator
  recovery and visibility, while future work can replace the extraction source
  with provider-backed jobs.
- The topic materializer currently creates a default uploaded-documents topic.
  Future iterations can add richer topic inference and per-document topic
  assignment.
