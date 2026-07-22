# Admin Retrieval Trace Viewer

## What Changed

- Added `apps/admin/lib/trace-summary.ts`.
- Added a bounded trace summary helper for route, recall candidates, filters, rerank, and evidence.
- Updated the Admin trace panel to render the trace summary fields alongside recent document context.
- Added tests for summary mapping and oversized trace-step rejection.

## Why

- Phase 2 Sprint 9 requires a retrieval trace viewer so operators can inspect route selection, recall, filtering, reranking, and evidence behavior.

## Performance And Safety Notes

- Trace summaries reject inputs above `maxSteps`.
- Summary formatting only uses low-cardinality scalar attributes.
- The UI helper performs no database, cache, object-storage, provider, or network calls.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/trace-summary.test.ts app/page.test.tsx` failed because the trace summary helper and UI fields were missing.
- Focused verification:
  - `pnpm --filter @knowledge/admin test -- lib/trace-summary.test.ts app/page.test.tsx`
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

- The trace viewer currently renders a static preview summary. A later slice should wire it to the Hono trace API through the shared Admin client.
