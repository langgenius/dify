# Incremental Reindexer

## What Changed

- Added `createIncrementalReindexer()` to the API package.
- The reindexer checks an existing parse artifact by `documentAssetId + version` and skips chunking/projection work when the `artifactHash` is unchanged.
- Changed artifacts are persisted, chunked through the injected WASM compute runtime, stored as `KnowledgeNode` records in one batch, and passed to configured FTS/dense projection builders in batch.
- Added bounds and validation for `maxNodes`, `projectionVersion`, `knowledgeSpaceId`, projection status, and dense model selection.

## Why It Changed

Sprint 11 requires incremental re-indexing so unchanged documents do not rebuild artifacts, nodes, or projections. This keeps embedding and indexing cost proportional to changed content instead of corpus size.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createIncrementalReindexer` did not exist.
- GREEN focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This slice adds the reusable reindexing service boundary. Wiring it into durable `document.compile` worker execution remains a follow-up.
- Projection publication/evaluation remains controlled by the existing blue-green publication and evaluation slices.
- This is implementation commit 1 after reviewed checkpoint `c8f1064`.
