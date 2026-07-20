# 2026-05-08 Database Migration File Renderer

## Summary

- Added deterministic migration file rendering for the database schema catalog.
- Supports PostgreSQL and TiDB dialect output.
- Keeps migration rendering pure and side-effect free.
- Added tests that ensure table creation statements appear before indexes.

## Files Added Or Updated

- `packages/database/src/migration-file.ts`
- `packages/database/src/migration-file.test.ts`
- `packages/database/src/index.ts`
- `.harness/docs/TEMP-progress-document.md`
- `.harness/changes/2026-05-08-database-migration-file-renderer.md`

## Why

Sprint 1 requires migrations to compile for PostgreSQL and TiDB dialect targets. The schema catalog already renders SQL statements; this slice adds deterministic full migration text suitable for future generated migration files.

## TDD Notes

- RED: Added `packages/database/src/migration-file.test.ts`, then ran `pnpm --filter @knowledge/database test`.
- The test failed because `./migration-file` did not exist.
- GREEN: Added `renderMigrationFile` and exported it from `@knowledge/database`.

## Verification

- `pnpm --filter @knowledge/database test:coverage`: passed.
  - `packages/database`: 100% lines, statements, branches, and functions.
- `pnpm --filter @knowledge/database typecheck`: passed.

## Known Risks And Follow-Up

- This renderer does not write files yet; it only provides deterministic migration text.
- A later dev-env or CI slice can write rendered migrations into tracked files if the project chooses checked-in SQL artifacts.
