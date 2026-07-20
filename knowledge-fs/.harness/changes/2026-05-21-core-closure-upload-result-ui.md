# Core Closure Upload Result UI

## Summary

- Completed CC.2 from the Core Closure Track.
- Replaced the upload form's direct BFF JSON navigation with a thin Admin upload action route at `/api/admin-upload`.
- The action route reuses the existing Admin BFF proxy and redirects back to `/` with bounded success or error search params.
- The Admin page now renders an upload result card with document id, parser status, file size, SHA-256 prefix, and document/artifact links.

## TDD Notes

- Red: `apps/admin/lib/upload-action.test.ts` first referenced `createUploadDocumentRedirectHandler`, which did not exist.
- Red: `apps/admin/app/page.test.tsx` required `/api/admin-upload`, upload success details, and upload error display; the page still posted directly to BFF and rendered no result card.
- Green: added the upload redirect handler, route, page result parsing, and success/error result cards.

## Performance Notes

- Upload request body remains bounded by the BFF proxy `maxBodyBytes`.
- Upload response JSON is read with a 1 MiB cap before redirect params are produced.
- The upload action forwards only `file` and optional `sourceId` to the API; it strips the UI-only `knowledgeSpaceId` field from the upstream multipart body.
- No extra document or artifact reads occur during redirect handling; CC.3 will add explicit read views.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx lib/upload-action.test.ts`
  - `pnpm build`
  - `pnpm check`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
