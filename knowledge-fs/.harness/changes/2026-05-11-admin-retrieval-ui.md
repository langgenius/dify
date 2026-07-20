# Admin Retrieval UI

## What Changed

- Added `apps/admin/lib/retrieval-preview.ts`.
- Added a bounded retrieval preview helper that turns query SSE events into Admin UI state.
- Added retrieval preview UI for:
  - streaming answer
  - inline citations
  - confidence
  - freshness
- Added tests for bounded answer accumulation and citation truncation.

## Why

- Phase 2 Sprint 9 requires the Admin Console to expose retrieval workflows with streaming answer preview, citations, confidence, and freshness before the trace viewer work starts.

## Performance And Safety Notes

- `createRetrievalPreview()` rejects answers that exceed `maxAnswerChars`.
- Citations are capped by `maxCitations`.
- The helper consumes already-received SSE events and does not call Hono, database, cache, object storage, or providers.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/retrieval-preview.test.ts app/page.test.tsx` failed because the preview helper and retrieval UI fields were missing.
- Focused verification:
  - `pnpm --filter @knowledge/admin test -- lib/retrieval-preview.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- The retrieval panel currently renders a static preview state. Live browser-side streaming interaction should wire this to `createAdminApiClient().streamQuery()` in the next retrieval UI refinement.
