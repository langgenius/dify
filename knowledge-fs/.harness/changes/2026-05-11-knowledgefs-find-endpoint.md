# KnowledgeFS Find Endpoint

## What Changed

- Added authenticated `GET /knowledge-spaces/{id}/fs/find`.
- Added `find` to the KnowledgeFS command registry.
- Added scoped path search filters for `resourceType`, `nameContains`, and metadata key/value.
- Reused KnowledgeFS list response entries so callers get familiar resource path metadata.
- Added tests for metadata-filtered results, pagination, empty filters, and invalid metadata filter shape.

## Why

Sprint 8 requires a metadata-aware KnowledgeFS find command for agents and future MCP tools. It lets callers discover resources under a physical KnowledgeFS path without unbounded listing or host shell access.

## Performance Notes

- The endpoint requires explicit `limit`.
- Search is tenant-scoped through the KnowledgeSpace lookup and path-scoped through physical KnowledgeFS descendants.
- Results use existing stable KnowledgePath cursors.
- Filtering is bounded by the path repository page size and never scans the whole workspace in one call.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`: passed.
- `pnpm --filter @knowledge/api typecheck`: passed.
- `pnpm --filter @knowledge/api test:coverage`: passed.
- `pnpm lint`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- Current filtering is bounded in the command layer. A later database-backed find path should push resource type/name/metadata predicates into indexed SQL for very large workspaces.
