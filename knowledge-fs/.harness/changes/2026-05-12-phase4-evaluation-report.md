# Phase 4 Evaluation Report

## What Changed

- Added `createPhase4EvaluationReport()` in `@knowledge/api`.
- Added a deterministic Phase 4 evaluation fixture at `.harness/evaluation/phase4-evaluation-report.json`.
- Added `packages/api/scripts/phase4-evaluation-report.ts` and root `pnpm eval:phase4`.
- Wired `pnpm eval:phase4` into the root `pnpm check` chain.
- The report compares one bounded golden set across:
  - `baseline`
  - `enriched`
  - `summary-tree`
  - `graph-expanded`
- The report returns recall, citation-hit, and no-answer deltas for graph/enrichment/summary-tree impact against baseline.

## Why

Sprint 16 requires a Phase 4 report that captures graph, enrichment, and summary/tree impact on a golden set. This gives the project a deterministic quality artifact at the Phase 4 milestone without requiring live providers or databases in CI.

## Performance Notes

- The report is generated from a checked-in bounded fixture; it performs no network, database, provider, or filesystem scans beyond reading one JSON file.
- All variants must share the same `goldenSet.totalQuestions`, preventing accidental comparisons across different workloads.
- Metric validation rejects non-unit metrics and mismatched question counts before producing a report.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/phase4-evaluation.test.ts` failed because `./phase4-evaluation` did not exist.
- Focused verification passed with:
  - `pnpm --filter @knowledge/api test -- src/phase4-evaluation.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm eval:phase4`
  - `pnpm exec biome check --write packages/api/src/phase4-evaluation.ts packages/api/src/phase4-evaluation.test.ts packages/api/scripts/phase4-evaluation-report.ts package.json .harness/evaluation/phase4-evaluation-report.json`
- Full verification passed with:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- The report currently uses a deterministic fixture. A future Phase 6 quality-governance slice should generate this from live evaluation runs and expose trends in the evaluation dashboard.
- This report is a milestone artifact, not a separate blocking gate beyond validation in `pnpm check`.
