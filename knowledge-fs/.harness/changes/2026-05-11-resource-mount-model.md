# ResourceMount Model

## What Changed

- Added `ResourceMountSchema` to the core domain model.
- Resource mounts now include:
  - mount path
  - tenant and knowledge-space identity
  - resource type
  - provider
  - mode
  - capabilities
  - source pointer
  - permission scope and snapshot version
  - freshness policy
  - cache policy
  - metadata and sync timestamps
- Added `resource_mounts` to the deterministic database schema and checked-in PostgreSQL/TiDB migrations.
- Added indexes for tenant/space path resolution, resource-type listing, and permission-scope filtering.

## Why

- Phase 1 Sprint 4 requires a ResourceMount model before filesystem commands can expose SourceFS, KnowledgeFS, EvidenceFS, and workspace resources.
- Mount records need explicit policy and capability metadata so later command dispatch can enforce permissions and avoid hardcoded connector behavior.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`: passed.
- `pnpm --filter @knowledge/database test -- src/schema.test.ts`: passed.
- `pnpm db:migrations:write`: passed.
- `pnpm db:migrations:check`: passed.
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

- This slice defines and persists the model only; ResourceMount repositories and command dispatch are still separate follow-up work.
- Live database migration execution is still deferred; checked-in artifacts and drift checks are the current Phase 1 gate.
