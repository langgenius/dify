# Core Closure Document Read Pages

## Summary

- Completed CC.3 from the Core Closure Track.
- Added Admin document status and parse artifact pages under `/documents/[spaceId]/[documentId]`.
- Updated upload result links to route to Admin pages instead of raw BFF JSON.
- Extracted shared server auth and byte formatting helpers for Admin server-rendered pages.

## TDD Notes

- Red: upload result tests required Admin document links while the page still linked to BFF JSON.
- Red: document read page tests imported document status and parse artifact pages that did not exist.
- Green: added dynamic Next pages that load tenant-scoped `DocumentAsset` and `ParseArtifact` data with the local dev token.

## Performance Notes

- Document status view performs one `GET document` request.
- Parse artifact view performs one `GET parse artifact` request and does not chain extra document reads.
- Both pages fail closed to an unavailable state on missing auth or API errors.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- app/page.test.tsx app/document-pages.test.tsx`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm build`
  - `pnpm check`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
