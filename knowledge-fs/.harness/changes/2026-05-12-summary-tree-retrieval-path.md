# Summary Tree Retrieval Path

## What Changed

- Added `createSummaryTreeRetrievalPath()` as a `BasicHybridRetriever` wrapper.
- Deep retrieval now can perform a top-down summary navigation step:
  - First retrieve `kind: "summary"` candidates.
  - Select bounded section paths from summary results.
  - Retrieve leaf candidates.
  - Prefer leaf candidates under selected summary sections.
- Non-`deep` retrieval modes pass through unchanged.
- Added optional summary navigation metrics:
  - `summaryCandidates`
  - `summarySelectedSections`

## Why

Sprint 13 requires deep mode to use the summary tree as a navigation layer before leaf evidence selection. This wrapper keeps the behavior isolated from the base hybrid retriever and preserves the existing retrieval contract.

## Performance Notes

- The path adds at most one bounded summary retrieval before the leaf retrieval.
- `maxSummaryTopK`, `maxLeafTopK`, and `maxSelectedSections` bound fanout.
- Existing metadata and permission filters are preserved.
- No new database-specific query path or N+1 loading loop is introduced.

## Verification

- RED:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts` failed because `createSummaryTreeRetrievalPath` did not exist.
- GREEN:
  - `pnpm --filter @knowledge/api test -- src/summary-tree.test.ts`
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

- This slice does not expose a new public API flag; callers can compose the wrapper when enabling deep summary navigation.
- Retrieval evaluation comparison for enriched/summary vs baseline remains in Sprint 13.6.
