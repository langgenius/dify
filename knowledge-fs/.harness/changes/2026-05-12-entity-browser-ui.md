# Entity Browser UI

## What Changed

- Added bounded Admin API client methods for entity graph traversal and KnowledgeFS list reads:
  - `traverseGraph(input)` calls `GET /knowledge-spaces/{id}/graph/traverse`.
  - `listKnowledgeFs(input)` calls `GET /knowledge-spaces/{id}/fs/ls`.
- Added runtime response validation and clone isolation for graph entities, graph relations, traversal metrics, and KnowledgeFS entries.
- Added an Admin Console entity browser panel showing:
  - graph traversal bounds,
  - `/knowledge/by-entity/...` KnowledgeFS view path,
  - entity depth/confidence,
  - relation edges,
  - related document resources.
- Added tests for the Admin client graph/document browse path and rendered Admin Console entity browser content.

## Why

Phase 4 Sprint 16 requires users to browse extracted entities and linked documents through the existing Hono graph traversal and KnowledgeFS APIs. The UI now exposes that workflow without adding a new backend query surface.

## Performance Notes

- Graph traversal client calls are explicitly bounded by depth, fanout, max node count, and timeout.
- KnowledgeFS document listing keeps the existing explicit `limit` requirement and shares the Admin client's max list guard.
- The UI reads from the existing graph traversal and `/knowledge/by-entity` APIs instead of introducing per-entity document waterfalls.
- API responses are cloned at the client boundary to avoid leaking mutable metadata references into UI state.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts` failed because `client.traverseGraph` did not exist and the page did not render `Entity browser`.
- Focused verification passed with:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm exec biome check --write apps/admin/lib/api-client.ts apps/admin/lib/api-client.test.ts apps/admin/app/page.tsx apps/admin/app/page.test.tsx apps/admin/app/globals.css`
- Full verification passed with:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- The current Admin page remains a static server-rendered operational shell. A later slice should wire authenticated runtime state and user-selected entity ids into this panel.
- Large graph visualizations should remain bounded and paginated; this slice intentionally avoids unbounded graph rendering.
