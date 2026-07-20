# CI Regression Blocking Hardening

## What Changed

- Extended `createRetrievalRegressionGate()` with optional advanced quality metrics:
  - `citationAccuracy`
  - `faithfulnessScore`
- Added optional advanced thresholds for minimum scores and baseline drop limits.
- Made advanced metrics fail closed when advanced thresholds are configured but the current or baseline report omits the required metric.
- Updated the checked-in regression report to enable citation accuracy and faithfulness thresholds.
- Updated the regression CLI success output to include advanced metrics when present.

## Why It Changed

Sprint 20 requires CI to block merges on recall, faithfulness, and citation quality. The existing gate only enforced recall, citation-hit, and no-answer metrics, so advanced judge metrics could drift without failing CI.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/retrieval-regression.test.ts` failed because advanced thresholds were ignored and missing advanced metrics did not fail.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/retrieval-regression.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm eval:regression`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Performance Notes

- The gate operates on aggregate metrics only and does not add query, database, or network work.
- Failure output remains bounded by the existing `maxFailures` threshold.
- Advanced metric validation is O(1) over the report.

## Known Risks And Follow-Up

- The checked-in report remains a deterministic fixture. A later production workflow can replace it with a generated evaluation artifact while preserving the same gate contract.
