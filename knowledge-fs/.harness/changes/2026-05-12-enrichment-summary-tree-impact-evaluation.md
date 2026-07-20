# Enrichment And Summary Tree Impact Evaluation

## What Changed

- Added `createRetrievalImpactEvaluationRunner()`.
- The runner compares three retrieval variants over the same golden-question page:
  - `baseline`
  - `enriched`
  - `summary-tree`
- Added impact deltas:
  - `enrichedVsBaseline`
  - `summaryTreeVsBaseline`
  - `summaryTreeVsEnriched`
- Added tests for successful comparison, empty golden-question pages, embedding result-count mismatch, and bounded evaluation limits.

## Why

Sprint 13 requires a report that compares enriched and summary-tree retrieval against non-enriched baseline retrieval. Reusing the existing golden-question evaluation contract keeps the evaluation output aligned with existing recall, citation hit, and no-answer metrics.

## Performance Notes

- Golden questions are still loaded through the existing bounded repository list API.
- Query embeddings are batched once per evaluation page, not once per retrieval variant.
- Each question runs the three retrieval variants with explicit `topK` and `limit` bounds.
- No new database query path or unbounded accumulation was introduced.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `createRetrievalImpactEvaluationRunner` did not exist.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice adds the reusable evaluation runner only; it does not add a public API route for exporting reports.
- Sprint 14 graph extraction work starts next unless a newer iteration plan supersedes it.
