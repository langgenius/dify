# Checked-In Database Migration Artifacts

## What Changed

- Added deterministic initial schema migration artifacts for PostgreSQL and TiDB.
- Updated migration rendering to use a stable migration id instead of a generated timestamp.
- Added `getInitialSchemaMigrationArtifacts()` and `findMigrationArtifactDrift()` to keep generated SQL artifacts tied to the schema catalog.
- Added `pnpm db:migrations:write` and `pnpm db:migrations:check`.
- Added migration drift checking to root `pnpm check`.

## Why

Sprint 1 requires migrations to compile for PostgreSQL and TiDB dialect targets. Checked-in generated SQL artifacts make the current schema auditable, while the drift check prevents catalog changes from silently leaving migration files stale.

## TDD Notes

- RED: Updated `packages/database/src/migration-file.test.ts` to require stable migration ids and checked-in artifact metadata.
- RED: `pnpm db:migrations:check` failed because the script did not exist, then failed again because the SQL artifacts were missing.
- GREEN: Added artifact rendering, drift detection, the migration CLI script, root scripts, and generated SQL files.
- REFACTOR: Kept filesystem CLI code outside `src` so package coverage remains focused on library behavior.

## Performance Notes

- Drift checking performs a bounded comparison over the known migration artifact list.
- No database connections or live migrations run in this slice.
- Existing schema indexes remain the source of truth for high-traffic access patterns and are preserved in the generated SQL.

## Verification

- `pnpm db:migrations:write`: passed.
- `pnpm db:migrations:check`: passed.
- `pnpm --filter @knowledge/database test:coverage`: passed.
  - `packages/database`: 100% lines/statements/branches/functions.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- This slice does not execute migrations against PostgreSQL or TiDB.
- Drizzle definitions remain deferred; the schema catalog is the migration source for now.
- Live database migration tests can be added once container-backed integration tests are accepted.
