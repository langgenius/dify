# Human Annotation Workflow

## What Changed

- Added `POST /knowledge-spaces/{id}/golden-questions/{questionId}/annotations`.
- Added bounded annotation metadata for answer correctness and evidence relevance labels on `GoldenQuestion` records.
- Added tenant-scoped API behavior, OpenAPI path registration, and route tracing/rate-limit tool naming.
- Added Admin API client support for `annotateGoldenQuestion()`.
- Added Admin BFF allowlisting for the annotation route.
- Added a Human annotation form to the Admin Golden Questions panel.

## Why It Changed

- Sprint 20 requires annotators to mark answer correctness and evidence relevance so evaluation questions can accumulate human review signals.
- Reusing the GoldenQuestion repository keeps this slice small and avoids introducing a new unplanned persistence table before the final polishing work.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because the annotation route returned 404.
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/bff.test.ts app/page.test.tsx` failed because the client method, BFF route, and UI were missing.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/bff.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/admin test:coverage`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/admin typecheck`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Performance Notes

- Each annotation performs one tenant-scoped KnowledgeSpace read, one GoldenQuestion read, and one GoldenQuestion update.
- Evidence relevance labels are capped at 50 per annotation.
- Retained annotation history is capped at 50 records per question.
- No unbounded list API, N+1 database path, or repeated query waterfall was introduced.

## Known Risks And Follow-Up

- Annotation persistence currently uses GoldenQuestion metadata. If review volume grows beyond the bounded MVP workflow, a dedicated annotation table with keyset pagination should replace this metadata-based storage.
