# Bulk Document Delete API

## Summary

- Added `DELETE /knowledge-spaces/{id}/documents/bulk`.
- Added repository delete contracts needed for tenant-scoped cascading cleanup.
- Bulk delete returns a generated `bulkJobId`, per-document deletion summaries, and a total count.

## Behavior

- Requires `knowledge-spaces:write` or `knowledge-spaces:*`.
- Verifies the knowledge space through the authenticated tenant.
- De-duplicates requested document ids before processing.
- For each found document, deletes index projections, knowledge nodes, parse artifacts, the document asset record, and the raw object.
- Missing or cross-tenant documents return item status `not_found`.

## Performance And Safety

- `maxBulkDeleteDocuments` bounds request fanout.
- `maxCascadeDeleteArtifacts`, `maxCascadeDeleteNodes`, and `maxCascadeDeleteProjections` bound derived cleanup.
- Database implementations use parameterized SQL and explicit `maxRows`.
- In-memory implementations enforce the same bounds before deleting.

## Tests

- Added red-first API coverage for the missing route.
- Covered tenant-scoped cascading deletion of object storage, asset, artifact, node, and projection state.
- Covered missing document item reporting, cross-tenant 404, request fanout limit, and invalid cascade bounds.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
