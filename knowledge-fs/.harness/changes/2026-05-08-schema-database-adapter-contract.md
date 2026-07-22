# Schema Database Adapter Contract

## What Changed

- Expanded `DatabaseAdapter` from a health-only placeholder into an explicit schema contract:
  - `dialect`
  - `getSchemaSummary()`
  - `renderMigrationSql()`
  - `checkPerformanceIndexes()`
- Added `createSchemaDatabaseAdapter` in `@knowledge/adapters`.
- Wired Node/Docker skeletons to PostgreSQL schema behavior.
- Wired Cloudflare skeletons to TiDB schema behavior.
- Added adapter tests for PostgreSQL/TiDB migration rendering, performance index checks, and schema summary clone isolation.
- Added `@knowledge/database` as an explicit adapter package dependency.

## Why

Sprint 1 requires the platform adapter layer to expose meaningful database behavior before real query/runtime adapters are introduced. This keeps the current skeleton honest: it still does not open database connections, but it now advertises the actual schema, dialect-specific migration SQL, and required performance indexes through one shared contract.

## TDD Notes

- RED: Added `packages/adapters/src/database.test.ts`, then ran `pnpm --filter @knowledge/adapters test`.
- The first failure confirmed `./database` did not exist.
- GREEN: Added the schema-backed database adapter and wired platform skeletons to it.

## Performance Notes

- The adapter exposes `checkPerformanceIndexes()` so high-traffic access-pattern indexes stay visible through the platform layer.
- Schema summaries are cloned before returning to callers, preventing accidental retained-state mutation.
- This slice introduces no runtime database queries, so there are no new query round-trips or N+1 paths.

## Verification

- `pnpm --filter @knowledge/adapters test`: passed.
- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: 97.95% lines/statements, 95.2% branches, 100% functions.
- `pnpm --filter @knowledge/adapters typecheck`: passed.
- `pnpm --filter @knowledge/core typecheck`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.

## Known Risks / Follow-Up

- This is still a schema-backed skeleton, not a live PostgreSQL/TiDB connection adapter.
- The next database slice should define bounded query execution/list contracts before adding real Drizzle or SQL client integration.
