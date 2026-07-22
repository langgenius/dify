# Synchronous Document Ingestion

## Summary

- Connected the authenticated document upload route to parser execution and parse artifact persistence.
- Added bounded in-memory and database-backed `ParseArtifactRepository` implementations.
- Extended `DocumentAssetRepository` with scoped asset lookup and parser status updates.

## Behavior

- Successful uploads now parse the uploaded bytes directly, persist a `ParseArtifact`, update the asset to `parsed`, and return the updated `DocumentAsset`.
- Parser or artifact persistence failures keep the raw uploaded object, best-effort mark the asset as `failed`, and return `Document parsing failed`.
- Asset persistence failures still delete the just-uploaded object to avoid orphaned storage.
- The default parser supports native Markdown/HTML and fails closed for complex formats when Unstructured is not configured.

## Performance And Safety

- The ingestion path reuses the already buffered upload bytes and does not read the object back from object storage.
- Database repositories use parameterized SQL with explicit `maxRows`.
- Document status updates are scoped by `id` and `knowledge_space_id`.
- In-memory parse artifact storage is bounded and clone-isolated.

## Verification

- RED confirmed with failing gateway tests for missing parse artifact repository and document status update support.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api build`
  - `pnpm --filter @knowledge/api test:coverage`

