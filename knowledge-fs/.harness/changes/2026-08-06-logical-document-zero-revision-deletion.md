# Logical Document Zero-Revision Deletion

## What Changed

- Relaxed the durable deletion job and tombstone constraints so only `logical_document` targets may use revision `0`.
- Added PostgreSQL and TiDB migration `0037_logical_document_zero_revision_deletion` and refreshed the checked-in migration artifacts.
- Updated database, adapter migration-runner, and API migration-command tests to include migration `0037`.

## Why

A logical document begins at row version `0` and may fail before its first revision becomes active. The deletion repository already accepts that compare-and-swap value, but the persisted deletion job and tombstone constraints previously required every target revision to be at least `1`.

## TDD Notes

- RED: The new artifact exposed stale adapter and API migration-runner expectations, producing six adapter test failures and one API app test failure.
- GREEN: Added `0037` to both runner test baselines and updated the expected migration count and SQL sequence.
- REFACTOR: Kept the shared migration-id fixture structure and changed no runtime runner behavior.

## Performance Notes

- The change only replaces two existing check constraints and adds no queries, round trips, indexes, or unbounded data paths.

## Verification

- `pnpm --filter @knowledge/database test`: passed (110 tests).
- `pnpm --filter @knowledge/adapters test -- src/migration-runner.test.ts`: passed (105 tests).
- `pnpm --filter @knowledge/api-app test -- src/migrate.test.ts`: passed (210 tests).
- `pnpm typecheck`: passed.
- `pnpm build`: passed.
- `pnpm exec biome check apps/api/src/migrate.test.ts packages/adapters/src/migration-runner.test.ts packages/database/src/schema.ts packages/database/src/migration-file.test.ts packages/database/src/migration-artifacts.generated.ts`: passed.
- `pnpm db:migrations:check`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- The migration was verified through deterministic artifact and runner tests, not against live PostgreSQL or TiDB instances.
- Full-repository `pnpm lint` remains blocked by ten pre-existing formatting/size findings in unrelated admin, OpenAPI, contract, and test-support files; all files changed in this slice pass targeted Biome checks.
