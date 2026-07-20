# KnowledgeFS Resource Model

## What Changed

- Extended `KnowledgePath` with physical/semantic view metadata:
  - `viewType`
  - `viewName`
  - `metadata`
- Added checked-in PostgreSQL/TiDB migration columns for KnowledgeFS path views.
- Added `knowledge_paths_space_view_path_idx` on `knowledge_space_id + view_type + view_name + virtual_path + id`.
- Added bounded in-memory and database-backed `KnowledgePathRepository` implementations.
- Added physical-view listing with explicit limits and stable `virtualPath + id` keyset pagination.

## Why

- Sprint 3/Phase 1 needs KnowledgeFS virtual path records that can expose physical views such as `/by-source`, `/by-type`, `/by-time`, and `/by-owner`.
- The repository boundary gives later filesystem commands an indexed, tenant-scoped path model without per-resource query waterfalls.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`: passed.
- `pnpm --filter @knowledge/database test -- src/schema.test.ts`: passed.
- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`: passed.
- `pnpm db:migrations:write`: passed.
- `pnpm db:migrations:check`: passed.
- `pnpm --filter @knowledge/api test:coverage`: passed.
- `pnpm --filter @knowledge/core test:coverage`: passed.
- `pnpm --filter @knowledge/database test:coverage`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm wasm:build`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks And Follow-Up

- This slice models and persists KnowledgeFS paths; it does not yet implement SourceFS/EvidenceFS namespaces, `ResourceMount`, or filesystem commands.
- The next implementation commit reaches the 10-commit review cadence after checkpoint `0105450`, so feature iteration must pause for health review after commit and push.
