# KnowledgeFS Lease Database Schema

## Summary

- Added `knowledge_fs_leases` to the database schema catalog with tenant, space, session,
  lease type, target, virtual path, status, heartbeat, expiry, metadata, acquisition, and update
  fields.
- Added cascading foreign keys to KnowledgeSpace and KnowledgeFS sessions so stale runtime rows
  are removed with their owners.
- Added bounded indexes for active path conflict checks, expired lease cleanup, and session-held
  lease inspection.
- Regenerated PostgreSQL and TiDB initial schema migration artifacts from the checked-in renderer.

## Verification

- `pnpm --filter @knowledge/database test -- src/schema.test.ts`
- `pnpm --filter @knowledge/database test`
- `pnpm --filter @knowledge/database typecheck`
- `pnpm db:migrations:check`
