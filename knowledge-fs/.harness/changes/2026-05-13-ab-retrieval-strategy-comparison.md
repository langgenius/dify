# A/B Retrieval Strategy Comparison

## Summary

- Added Phase 6 Sprint 20 A/B retrieval strategy comparison.
- The new runner evaluates the same bounded golden-question page against exactly two named retrieval strategies.
- It reports per-strategy retrieval evaluation, challenger-vs-baseline metric deltas, cursor propagation, and a deterministic winner.

## What Changed

- Added `createAbRetrievalStrategyComparisonRunner()`.
- Added A/B-specific contracts:
  - `AbRetrievalStrategy`
  - `AbRetrievalStrategyComparisonRunner`
  - `AbRetrievalStrategyComparisonReport`
  - `AbRetrievalStrategyWinner`
- Reused existing retrieval evaluation primitives:
  - `GoldenQuestionRepository`
  - `EmbeddingProvider`
  - `BasicHybridRetriever`
  - `RetrievalEvaluationReport`
  - metric delta calculation.
- Added validation:
  - exactly two strategies.
  - non-empty unique strategy names.
  - max 80 chars per strategy name.
  - existing `maxQuestions` / `maxTopK` bounds.

## Performance Notes

- Embeddings are generated once per bounded golden-question page.
- Each golden question runs exactly two strategy calls, matching the explicit A/B comparison contract.
- The runner uses the existing paginated `GoldenQuestionRepository` and rejects unbounded page/topK inputs.
- No database schema, list endpoint, or additional query path was introduced.

## TDD / RED

- Added a failing API test that imported `createAbRetrievalStrategyComparisonRunner()` before it existed.
- The RED run failed with `createAbRetrievalStrategyComparisonRunner is not a function`.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice is the TypeScript evaluation runner only.
- Retrieval Studio side-by-side UI is the next Sprint 20 item.
- Persisted A/B experiment history and API endpoints can be added after UI workflow requirements are clearer.

## Cadence

- This will be implementation commit 2 after reviewed checkpoint `7733961`.
- The next 10-commit review is not yet due.
