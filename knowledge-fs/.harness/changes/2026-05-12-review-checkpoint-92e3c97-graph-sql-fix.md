# 10-Commit Review Checkpoint 92e3c97: Graph Traversal SQL Fix

## What Changed

- Completed the mandatory health review after the 10 implementation commits following checkpoint `92e3c97`.
- Fixed the database graph traversal recursive CTE root row to emit untyped `NULL` relation columns instead of `CAST(NULL AS CHAR)` and `CAST(NULL AS DOUBLE PRECISION)`.
- Added a regression assertion that database traversal SQL does not contain those unsafe casts.
- Updated the temporary task and progress documents with the review scope, finding, remediation, and residual risk.

## Why It Changed

- The graph traversal API uses one bounded recursive CTE for database-backed traversal.
- Typed null casts in the root row can force incompatible union column types for recursive branch columns such as JSON metadata, timestamp fields, and database-specific numeric types.
- Untyped `NULL` keeps the query parameterized and lets PostgreSQL/TiDB infer relation column types from the recursive branch.

## Verification

- RED first: the graph traversal database test failed while the SQL still emitted `CAST(NULL AS CHAR)`.
- GREEN focused verification:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
- Full verification before push:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- Graph traversal database execution is still verified with a fake executor. Add a live PostgreSQL/TiDB recursive CTE smoke after runtime database driver wiring covers graph traversal.
- Latest reviewed checkpoint after remediation commit: `0ad7592`.
