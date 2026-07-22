# Graph Traversal API

## What Changed

- Added `GraphIndexRepository.traverse(input)` with a bounded traversal result contract.
- Added in-memory graph traversal for local/test execution.
- Added database-backed traversal planning through one recursive CTE query.
- Added authenticated `GET /knowledge-spaces/{id}/graph/traverse`.
- Added OpenAPI response schemas for graph traversal entities, relations, and metrics.
- Expanded `packages/api/src/graph-index.test.ts` with traversal repository, SQL, and Gateway route coverage.

## Why

Sprint 14 requires a graph expansion primitive before deep retrieval can merge hybrid recall with entity/relation traversal. This slice exposes a small, budgeted traversal boundary while keeping graph storage behind the existing database adapter design.

## Performance Notes

- Traversal requires explicit depth, fanout, node, and timeout budgets.
- The Gateway route is tenant-scoped through the KnowledgeSpace repository before traversal runs.
- The database path uses one parameterized recursive CTE query and explicit `maxRows`; it does not loop through per-hop or per-entity database calls.
- In-memory traversal applies fanout per entity and avoids returning relations to omitted entities when `maxNodes` truncates expansion.
- Existing graph schema indexes support outgoing relation traversal by `(knowledge_space_id, subject_entity_id, type, object_entity_id, id)`.

## Verification

- RED confirmed with `pnpm --filter @knowledge/api test -- src/graph-index.test.ts` before implementation.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/graph-index.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- Database recursive CTE execution is contract-tested with an injected executor; live PostgreSQL/TiDB traversal smoke remains a future integration slice.
- The next feature slice must not start until the mandatory 10-commit project health review after checkpoint `92e3c97` is completed.
