# Advanced Retrieval Metrics

## Summary

- Added an advanced retrieval evaluation runner for context precision, relevance, faithfulness, and citation accuracy.
- The runner reuses the bounded golden-question evaluation flow and adds a batched LLM-as-judge boundary.
- Judge proposals remain read-only evaluation signals; this slice does not persist dashboards or production bad cases.

## Key Changes

- Added `createAdvancedRetrievalEvaluationRunner()`.
- Added `AdvancedRetrievalMetricJudge` with a single `evaluateBatch()` call per bounded evaluation page.
- Added advanced per-question metrics:
  - `contextPrecision`
  - `relevanceScore`
  - `faithfulnessScore`
  - `citationAccuracy`
  - `judgedRelevantEvidenceIds`
- Added advanced aggregate metrics on the evaluation report.
- Added guardrails for:
  - bounded `maxJudgeContextBytes`
  - embedding count mismatches
  - judge result count mismatches
  - unknown or duplicate judge ids
  - invalid score ranges
  - judge evidence ids that do not reference retrieved context

## Performance Notes

- Golden-question listing remains explicitly bounded by `limit` and `maxQuestions`.
- Embeddings are still batched once per evaluation page.
- LLM judging is batched once per evaluation page, avoiding per-question judge round trips.
- Judge context is serialized and rejected if it exceeds `maxJudgeContextBytes`.
- No new database query path or unbounded list/read surface was introduced.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createAdvancedRetrievalEvaluationRunner` did not exist.
- GREEN coverage includes:
  - successful advanced metrics computation
  - batched judge input shape
  - empty-page behavior
  - pagination cursor handling
  - oversized judge context
  - invalid embedding and judge outputs
  - coverage recovery above the 90% branch threshold

## Verification

- Passed:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- Sprint 19 evaluation dashboard can consume the advanced report shape.
- CI regression hardening can later add thresholds for faithfulness and citation accuracy.

## Review Cadence

- This will be implementation commit 9 after reviewed checkpoint `55f83ef`.
