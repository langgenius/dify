# Retrieval Strategy Comparison

## Summary

- Added a bounded evaluation comparison runner for dense-only, FTS-only, and hybrid retrieval strategies.
- The report identifies recall, citation, and no-answer impact for hybrid retrieval compared with the two single-route baselines.

## Changes

- Added `createRetrievalStrategyComparisonRunner()` in `@knowledge/api`.
- Added strategy report types for:
  - `dense-only`
  - `fts-only`
  - `hybrid`
- Added impact deltas:
  - `hybridVsDense`
  - `hybridVsFts`
- Reused the existing golden-question evaluation item semantics for all strategies.

## Performance Notes

- Golden questions are loaded with the same explicit `limit` and cursor bounds as the existing evaluation runner.
- Query embeddings are batched once per comparison run.
- Dense and FTS baseline reads use explicit `topK`.
- Hybrid evaluation uses the injected bounded retriever, preserving existing planner/fusion/rerank guardrails.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/api typecheck`
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

- This slice will be implementation commit 8 after review checkpoint `b7ac774`.
- The 10-commit review checkpoint is not due yet.
