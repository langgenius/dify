# Retrieval Evaluation MVP

## What Changed

- Added `createRetrievalEvaluationRunner()` to `@knowledge/api`.
- Added evaluation result contracts for per-question status and aggregate metrics.
- Evaluation runner now:
  - Reads golden questions through `GoldenQuestionRepository`.
  - Embeds all questions in one bounded provider call.
  - Runs the existing `BasicHybridRetriever` for each golden question.
  - Computes `recallAtK`, `citationHitRate`, `noAnswerRate`, and `totalQuestions`.
  - Reports per-question expected evidence ids, retrieved node ids, citation document ids, matched ids, tags, and status.

## Why

Phase 1 needs an early evaluation loop so retrieval changes can be measured before quality regressions become invisible. This MVP gives later CI and dashboard work a deterministic metric boundary over the golden question set.

## Performance And Safety

- Evaluation requires explicit `limit` and `topK`.
- `maxQuestions` and `maxTopK` cap evaluation work.
- Question embeddings are batched into one provider call to avoid per-question embedding N+1 behavior.
- Retrieval calls are bounded by the validated golden question page size and `topK`.
- The runner validates embedding vector count before retrieval, preventing silent question/vector misalignment.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/gateway.test.ts`; tests failed because `createRetrievalEvaluationRunner` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
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

## Known Risks And Follow-Up

- This slice provides the in-process runner only. It does not add a CLI, API route, dashboard, or CI regression gate.
- Citation hit matching currently treats citation evidence ids as document asset ids and retrieval evidence ids as node ids; future evaluation work should make evidence id kinds explicit.
- Retrieval calls are bounded and parallelized per page; later production evaluation should add concurrency controls for large suites.
