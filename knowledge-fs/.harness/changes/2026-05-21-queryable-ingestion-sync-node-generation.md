# Queryable Ingestion Sync Node Generation

## Summary

- Started the Queryable Ingestion Track in `.harness/docs/iteration-plan.md`.
- Wired synchronous document upload to the incremental reindexer when a compute runtime is explicitly injected.
- Preserved the existing no-compute fallback: uploads still parse and persist artifacts without attempting unavailable WASM chunking.

## TDD Notes

- Red: added a gateway upload test proving injected compute was not called and no `KnowledgeNode` was created.
- Green: added bounded synchronous reindex wiring and a `maxSynchronousUploadNodes` guard.

## Performance Notes

- Node creation is bounded by `maxSynchronousUploadNodes`, defaulting to `20_000`.
- The upload path continues to reuse already-read bytes and does not re-read object storage.
- No additional database fanout is introduced; the reindexer performs one artifact write plus one bounded node batch write.

## Verification

- Passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
