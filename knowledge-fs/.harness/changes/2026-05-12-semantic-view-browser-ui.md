# Semantic View Browser UI

## What Changed

- Added `AdminApiClient.listSemanticView(input)` as a safe helper over the existing Hono `GET /knowledge-spaces/{id}/fs/ls` KnowledgeFS API.
- The helper supports `/knowledge/by-topic`, `/knowledge/by-topic/{key}`, `/knowledge/by-entity`, and `/knowledge/by-entity/{key}` paths while rejecting multi-segment semantic keys.
- Added an Admin Console semantic views panel with:
  - topic browser path context,
  - entity view path context,
  - freshness status counters,
  - topic rows showing build status, stale status, generated version, and document counts.
- Extended Admin page tests and client tests for semantic topic browsing.

## Why

Sprint 16 requires users to browse semantic views by topic, entity, and freshness through Hono APIs. This keeps the UI aligned with the existing KnowledgeFS semantic views instead of inventing a separate read path.

## Performance Notes

- `listSemanticView()` inherits the Admin client's explicit list limit guard and calls the bounded KnowledgeFS `ls` endpoint.
- Semantic view keys are constrained to one path segment to avoid accidental broad path scans or malformed KnowledgeFS traversal.
- Freshness and build status are read from entry metadata already returned by the backend, avoiding extra per-topic lookups.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts` failed because `client.listSemanticView` did not exist and the page did not render `Semantic views`.
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

- The Admin page still renders static sample semantic view data. A later runtime wiring slice should load authenticated semantic view state and topic selections from the API client.
- Any future visual graph/topic expansion should keep list and traversal limits visible in the UI.
