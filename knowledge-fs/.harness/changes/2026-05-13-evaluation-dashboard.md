# Evaluation Dashboard

## Summary

- Added an Admin Console evaluation dashboard for Phase 6 quality governance.
- The dashboard summarizes pass rate, recall trend, citation trend, faithfulness, cost, and latency.
- Added a bounded summary helper so dashboard data shaping is testable outside React rendering.

## Key Changes

- Added `createEvaluationDashboardSummary()` in `apps/admin/lib/evaluation-dashboard.ts`.
- Added validation for bounded dashboard runs and metric ranges.
- Added dashboard scorecards for pass rate, recall@K, citation accuracy, and faithfulness.
- Added recall and citation trend bars.
- Added latest and rolling average cost/latency display.
- Added Admin navigation entry for the evaluation dashboard.

## Performance Notes

- Dashboard input is bounded by `maxRuns`.
- Trend rendering is bounded by `maxTrendPoints`.
- Summary computation sorts and scans the bounded run list once.
- This slice is UI-only and does not introduce new API, database, or retrieval runtime query paths.

## TDD

- RED first:
  - `pnpm --filter @knowledge/admin test -- lib/evaluation-dashboard.test.ts app/page.test.tsx` failed because the dashboard helper and UI did not exist.
- GREEN coverage includes:
  - pass-rate and trend summary calculation
  - cost/latency formatting
  - invalid bounds and metric rejection
  - Admin page rendering of dashboard sections

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- lib/evaluation-dashboard.test.ts app/page.test.tsx`
  - `pnpm --filter @knowledge/admin typecheck`
  - `pnpm --filter @knowledge/admin test`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Follow-Up

- A later slice can replace static sample dashboard runs with a tenant-scoped API feed.
- Production bad-case capture remains the next Sprint 19 item after mandatory 10-commit review.

## Review Cadence

- This will be implementation commit 10 after reviewed checkpoint `55f83ef`.
- After commit and push, feature iteration must pause for the mandatory project health review.
