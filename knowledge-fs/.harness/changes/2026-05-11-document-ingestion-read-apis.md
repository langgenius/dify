# Document Ingestion Read APIs

## Summary

- Added authenticated document ingestion read boundaries after upload and parse.
- Exposed tenant-scoped document status and parse artifact reads through the Knowledge Gateway.

## Behavior

- `GET /knowledge-spaces/{id}/documents/{documentId}` returns a scoped `DocumentAsset`.
- `GET /knowledge-spaces/{id}/documents/{documentId}/parse-artifacts/{version}` returns a scoped `ParseArtifact`.
- Both routes require `knowledge-spaces:read` or `knowledge-spaces:*`.
- Missing spaces, missing documents, missing artifact versions, and cross-tenant access all return 404.

## Performance And Safety

- Read paths use existing scoped repository lookups rather than list scans.
- Database-backed repositories continue to use parameterized SQL with explicit `maxRows: 1`.
- Artifact reads verify the tenant-scoped space and document before loading the artifact by indexed asset/version.

## Verification

- RED confirmed with failing API tests for missing OpenAPI paths and missing read routes.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api build`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`

