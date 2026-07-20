# Database Capability Descriptors

## What Changed

- Added `DatabaseCapabilities` to `@knowledge/core`.
- Added `getCapabilities()` to `DatabaseAdapter`.
- Added schema adapter capability descriptors for:
  - dense vector support
  - full-text support
  - native CJK full-text behavior
  - recursive CTE support
  - concurrent vector and full-text retrieval
  - estimated vector/FTS p99 latency
  - max vector scale
  - SQL permission filtering
  - publication strategy
- Wired Node/PostgreSQL and Cloudflare/TiDB skeletons through the shared capability contract.
- Added tests proving PostgreSQL and TiDB descriptors differ where planner behavior will need to branch.

## Why

The architecture requires retrieval planning to adapt by backend. TiDB and PostgreSQL both serve as the unified database, but they differ in CJK full-text behavior, practical vector scale, and latency assumptions. Exposing this through `DatabaseAdapter` prevents future retrieval code from hard-coding backend conditionals outside the adapter layer.

## TDD Notes

- RED: Added capability descriptor expectations to `packages/adapters/src/database.test.ts`.
- The first run failed because `getCapabilities()` did not exist.
- GREEN: Added the core contract and schema adapter descriptors.

## Performance Notes

- Capability descriptors make latency and scale assumptions explicit before retrieval planner work begins.
- Permission filtering is declared as `sql-where`, preserving the requirement to filter in the database before ranking/evidence assembly.
- No runtime database calls were introduced.

## Verification

- `pnpm --filter @knowledge/adapters test:coverage`: passed.
  - `packages/adapters`: 98.69% lines/statements, 95.97% branches, 100% functions.
- `pnpm --filter @knowledge/adapters typecheck`: passed.
- `pnpm --filter @knowledge/core typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `cargo test --workspace`: passed.

## Known Risks / Follow-Up

- Latency estimates are static planning assumptions until real PostgreSQL/TiDB benchmarks are added.
- Retrieval planner implementation should consume these descriptors instead of branching directly on adapter kind.
