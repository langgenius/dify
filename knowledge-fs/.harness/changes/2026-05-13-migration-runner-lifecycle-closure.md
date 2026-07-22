# Migration Runner And Lifecycle Closure

## Summary

- Started R3 from the code-review remediation plan by adding a minimal versioned migration runner and an idempotent platform close helper.
- Kept the implementation on existing adapter contracts: no real PostgreSQL/TiDB driver wiring and no container-backed migration execution.

## Changes

- Added `runDatabaseMigrations()` in `@knowledge/adapters`, backed by `DatabaseAdapter.execute`.
- Ensured `schema_migrations` is created before reading applied versions and that migrations are recorded only after their SQL succeeds.
- Extended database execution operations with a bounded `schema` operation for migration DDL and allowed the internal `schema_migrations` lifecycle table.
- Added `closePlatformAdapter()` in `@knowledge/core`, which calls optional component close hooks once per platform adapter instance and tolerates missing hooks.

## Verification

- `pnpm --filter @knowledge/adapters test -- src/migration-runner.test.ts`
- `pnpm --filter @knowledge/core test -- src/platform-adapter.test.ts`

## Notes

- The preferred platform health path remains `collectPlatformHealth()`, with component health exceptions converted to unhealthy component states.
- Next R3 hardening can wire the runner into real runtime startup once database driver adapters exist.
