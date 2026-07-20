# Graph Incremental Maintenance

## What Changed

- Added `GraphIndexRepository.pruneSourceNodes(input)`.
- Added `PruneGraphSourceNodesInput` and `PruneGraphSourceNodesResult` contracts.
- Implemented in-memory pruning for changed/deleted source nodes:
  - Relation source-node ids are pruned in bounded batches.
  - Relations with no remaining source nodes are deleted.
  - Entity source-node ids are pruned.
  - Entities with no remaining source nodes are deleted only when no remaining relation references them.
- Added database-backed parameterized pruning SQL boundaries for PostgreSQL/TiDB skeletons.
- Added tests for source pruning, orphan entity cleanup, relation-preserved entities, database SQL parameterization, dialect rendering, and input bounds.

## Why It Changed

- Sprint 14 requires graph incremental maintenance so updated/deleted documents do not leave stale mentions or orphan graph entities.
- The change keeps maintenance behind the graph repository boundary and processes source nodes as one bounded batch rather than issuing per-node query loops.

## Verification

- RED first: `pnpm --filter @knowledge/api test -- src/graph-index.test.ts` failed because `graph.pruneSourceNodes` was missing.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
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

- The database pruning SQL is currently contract-tested through the injected executor and should receive live PostgreSQL/TiDB smoke coverage once graph maintenance is wired to real database drivers.
- Future document deletion/reindex flows should call `pruneSourceNodes()` before rewriting graph mentions for changed nodes.
