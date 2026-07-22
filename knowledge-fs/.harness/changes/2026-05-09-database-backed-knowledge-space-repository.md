# Database-Backed KnowledgeSpace Repository

## What Changed

- Added a minimal `DatabaseAdapter.execute(input)` contract with bounded row execution metadata.
- Added injected executor support to the schema database adapter while preserving schema, migration, planner, capability, and health behavior.
- Added `createDatabaseKnowledgeSpaceRepository()` for tenant-scoped KnowledgeSpace CRUD through parameterized SQL.
- Kept the gateway default on the bounded in-memory repository until runtime database driver wiring is added.

## Why

KnowledgeSpace CRUD had authenticated tenant scope but still only had in-memory persistence. This slice adds the execution boundary needed to move CRUD toward real PostgreSQL/TiDB-backed storage without introducing live driver dependencies yet.

## TDD Notes

- RED: Adapter tests first asserted `database.execute()` behavior before it existed.
- RED: Gateway tests first referenced `createDatabaseKnowledgeSpaceRepository()` before implementation.
- GREEN: Added core execution types, schema adapter executor injection, and the database-backed repository.
- REFACTOR: Kept SQL parameterized, read execution bounded by `maxRows`, and tenant filters on every id-based operation.

## Performance Notes

- All database reads use explicit `maxRows`.
- KnowledgeSpace list uses tenant-scoped slug keyset pagination and reads only `limit + 1`.
- Database repository operations use parameter arrays rather than string-interpolating user input.
- Cross-tenant get/update/delete paths filter by `tenant_id` and return not-found semantics.

## Verification

- Focused verification passed:
  - `pnpm --filter @knowledge/adapters test -- src/database.test.ts`
  - `pnpm --filter @knowledge/adapters test:coverage`
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm --filter @knowledge/core typecheck`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/adapters typecheck`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- No real PostgreSQL/TiDB driver is wired in this slice; executors are injected for tests and future runtime wiring.
- TiDB non-returning write behavior is covered through a follow-up read, but live driver integration still needs its own smoke/integration tests.
