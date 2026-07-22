# Metadata Filters

## Summary

- Added retrieval metadata filters for Sprint 6.
- Filters are applied before RRF fusion and reranking.

## Changes

- Added `RetrievalMetadataFilters` to hybrid retrieval inputs.
- Supported filters:
  - `documentTypes`
  - `sourceIds`
  - `createdAfter` / `createdBefore`
  - `entities`
  - `tags`
  - `languages`
  - `freshnessStatuses`
  - `nodeKinds`
- Passed filters through dense-vector and FTS repository calls.
- Extended retrieval SQL to join `document_assets` in the same bounded query.
- Pushed indexed filters for node kind, document MIME type, source id, and document created-at range into SQL.
- Added bounded in-memory candidate filtering before fusion/reranking for metadata fields and safety.
- Added `metadataFilteredCandidates` metric when filters remove candidates.

## Performance Notes

- Retrieval remains two bounded database queries: dense and FTS.
- No post-retrieval N+1 document lookups were introduced.
- SQL-pushed filters use joined document/node fields already available on the retrieval path.
- Metadata fallback filtering runs only over bounded candidate arrays before fusion and reranking.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice will be implementation commit 3 after review checkpoint `f950b59`.
- The next 10-commit review is not due yet.
