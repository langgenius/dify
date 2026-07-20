# Extract API Topic View Materializer

## Summary

- Extracted semantic topic cluster contracts, topic-view materialization input/result contracts, enqueue/process orchestration, path construction, and validation from `packages/api/src/index.ts` into `packages/api/src/topic-view-materializer.ts`.
- Re-exported the new topic view materializer module from the API package root.
- Added a code-health guardrail preventing topic view materializer logic from drifting back into the gateway god file.

## TDD

- RED: added a code-health guardrail first; it failed because `topic-view-materializer.ts` did not exist.
- GREEN: moved the implementation, re-exported it, and reran focused contextual/code-health tests plus API typecheck and lint.

## Performance Notes

- The materializer keeps the existing bounded `maxSummaryNodes`, `maxTopics`, and `maxDocumentsPerTopic` validation.
- Processing still performs one batch `nodes.getMany()` and one `paths.upsertMany()` call for generated materialized paths, avoiding N+1 reads or writes.
- Topic metadata/path responses remain clone-isolated; no new cache, queue retention, or database read path was introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/contextual-enrichment.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- `pnpm check`
- `pnpm build`
- `cargo test --workspace`
- Remaining final verification is run before commit.

## Review Cadence

- This is implementation commit 4 after review checkpoint `9042d56`.
- The next mandatory health review is due after 6 more implementation commits.
