# Document Diff UI

## What Changed

- Added `AdminApiClient.diffKnowledgeFs(input)` for the Hono `GET /knowledge-spaces/{id}/fs/diff` API.
- Added runtime parsing for deterministic text diff operations, stats, and optional semantic diff summaries.
- Added client-side guards that require old and new KnowledgeFS paths to be absolute.
- Added an Admin Console document diff panel with:
  - old/new KnowledgeFS paths,
  - insert/delete/equal stats,
  - side-by-side text diff and semantic summary regions,
  - semantic change evidence.
- Extended Admin client and page tests for text and semantic diff rendering.

## Why

Sprint 16 requires text and semantic diffs to render side-by-side. This exposes the existing KnowledgeFS diff API in the Admin Console and keeps semantic summaries explicitly opt-in through `semantic=true`.

## Performance Notes

- The client performs a single bounded Hono diff request and does not add extra file reads from the UI layer.
- Semantic diff is only requested when `semantic: true` is passed.
- The backend remains the source of truth for text and semantic diff output bounds; the client validates shape before use.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/api-client.test.ts` failed because `client.diffKnowledgeFs` did not exist and the page did not render `Document diff`.
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

- The current Admin page shows static sample diff data. A later runtime wiring slice should connect user-selected KnowledgeFS paths and authenticated tokens to the diff client.
- Very large diffs should continue to rely on backend bounds and future UI virtualization if interactive rendering becomes necessary.
