# Bounded Database Query Planner Contract

## What Changed

- Expanded `DatabaseAdapter` with bounded read planning methods:
  - `planListRows(input)`
  - `planBatchGetRows(input)`
- Added shared query-plan input/output types in `@knowledge/core`.
- Added list-plan validation for:
  - required positive integer `limit`
  - `maxListLimit`
  - declared table/index/columns
  - explicit covering index prefixes
  - stable `orderBy`
  - cursor shape and single-direction cursor paging
- Added primary-key batch read planning with:
  - non-empty id lists
  - `maxBatchIds`
  - primary-key-only batch columns
- Added dialect-specific SQL plan rendering for PostgreSQL and TiDB placeholders/quoting.
- Added tests for success paths, bounded failures, index-prefix failures, cursor failures, unknown schema objects, and primary-key batch guardrails.

## Why

The project has strict performance requirements and will later introduce real Drizzle/SQL client execution. This slice establishes the adapter contract first, so database reads cannot be designed as unbounded scans, per-row waterfalls, or index-ambiguous list calls.

## TDD Notes

- RED: Added database planner tests to `packages/adapters/src/database.test.ts`.
- The first run failed because `planListRows`, `planBatchGetRows`, and planner bounds did not exist.
- GREEN: Implemented planner methods and validation in `packages/adapters/src/database.ts`.
- REFACTOR: Added extra guard tests to lift coverage and make error behavior explicit.

## Performance Notes

- List plans require explicit `limit` and reject limits above `maxListLimit`.
- List plans require a declared index and verify the query uses the leading index columns.
- Batch reads use one primary-key `IN (...)` statement instead of one query per id.
- Batch id counts are capped by `maxBatchIds`.
- This still does not open a database connection, so no runtime query round-trips were introduced.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/database.test.ts`: passed.
- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: 98.6% lines/statements, 95.91% branches, 100% functions.
- `pnpm --filter @knowledge/adapters typecheck`: passed.
- `pnpm --filter @knowledge/core typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `cargo test --workspace`: passed.

## Known Risks / Follow-Up

- The planner emits SQL strings for contract validation only; real Drizzle/SQL execution is still a later slice.
- Cursor planning currently supports one direction across ordered columns. Mixed-direction cursor paging should only be added with a dedicated test and SQL strategy.
