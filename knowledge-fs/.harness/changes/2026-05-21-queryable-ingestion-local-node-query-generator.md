# Queryable Ingestion Local Node Query Generator

## Summary

- Completed QI.3 from the Queryable Ingestion Track.
- Added a default local query generator so `/queries` can answer from persisted `KnowledgeNode` records without an external LLM provider.
- Added bounded `KnowledgeNodeRepository.listBySpace()` support for in-memory and database-backed repositories.

## TDD Notes

- Red: gateway query test proved a no-generator local query still returned `503 Query generation unavailable`.
- Green: added local evidence SSE generation, node citation metadata, explicit query bounds, and tenant-scoped node listing.

## Performance Notes

- Local querying reads at most `maxLocalQueryNodes` nodes, defaulting to `20`.
- Repository listing is tenant/space scoped and uses explicit limits; database mode uses keyset pagination by unique `id`.
- Answer output is bounded by `maxLocalQueryAnswerChars`, defaulting to `2_000`.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
