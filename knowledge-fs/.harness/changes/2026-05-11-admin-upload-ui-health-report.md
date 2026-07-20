# Admin Upload UI And Health Report

## What Changed

- Extended the Admin shared API client with:
  - `uploadDocument()`
  - `getDocument()`
  - `getParseArtifact()`
- Added client-side upload bounds through `maxUploadBytes`.
- Added typed parsing for `DocumentAsset` and `ParseArtifact` API responses.
- Added `apps/admin/lib/document-health.ts` for parse status, node count, quality risks, size labels, and publish readiness.
- Updated the Admin Console upload panel to render a multipart upload form.
- Updated the publish readiness panel to show parser status, node count, quality risks, parse element count, and file size.

## Why

- Phase 2 Sprint 9 requires the Admin Console to move from a shell toward upload intake and health reporting while still consuming Hono APIs through shared client boundaries.

## Performance And Safety Notes

- Uploads are rejected before network calls when `File.size` exceeds `maxUploadBytes`.
- Parse artifact and document response parsing clones metadata and element arrays into UI-owned objects.
- Health report risk lists are explicitly capped with `maxRisks`.
- The UI health report is computed locally from already-loaded asset/artifact summaries and does not introduce database, object-storage, or provider calls.

## Verification

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/document-health.test.ts app/page.test.tsx` failed because upload client methods, document health helper, and parser-status UI were missing.
- Focused verification:
  - `pnpm --filter @knowledge/admin test -- lib/api-client.test.ts lib/document-health.test.ts app/page.test.tsx`
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

- The visible form is still an operational UI scaffold; authenticated browser-side submission wiring and live document state refresh should follow in the next Admin UI slices.
- Admin package coverage is not yet promoted into the root `test:coverage` gate; existing behavioral packages remain above 90%.
