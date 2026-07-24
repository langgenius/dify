# Include bulk operations in the migration-runner test baseline

Date: 2026-07-23

## What changed

- Added `0030_bulk_operations` to the adapters migration-runner test's ordered migration baseline.
- Kept the replay and TiDB preflight fixtures derived from the same baseline so they represent a
  database that has already applied every migration except the migration under test.

## Why

The migration runner correctly discovered and applied the new bulk-operation migration, but six
adapter tests still treated `0029_dify_integration_freezes` as the latest migration. The stale
fixtures therefore reported `0030_bulk_operations` as an unexpected pending migration.

## Verification

- The focused migration-runner suite passed: 18 tests.
- The full `@knowledge/adapters` suite passed: 105 tests.
- The full `@knowledge/database` suite passed: 96 tests.
- `@knowledge/adapters` TypeScript checking passed.
- `pnpm db:migrations:check` passed.
- `pnpm lint:backend` passed across 960 files.
- `git diff --check` passed.

The repository-wide `pnpm check`, full build, coverage, and Docker smoke gates were not repeated for
this test-fixture-only correction; the affected package suites, migration artifact gate, typecheck,
and backend lint were run directly.

## Risks and follow-up

- There is no runtime behavior change. Future migrations still need to be added to this intentionally
  explicit ordered baseline so migration ordering remains reviewed.
