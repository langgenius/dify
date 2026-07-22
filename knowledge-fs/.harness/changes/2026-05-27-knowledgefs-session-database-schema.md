# KnowledgeFS Session Database Schema

## Summary

- Added `knowledge_fs_sessions` to the database schema catalog with tenant, space, client,
  permission snapshot, consistency, heartbeat, expiry, metadata, and timestamp fields.
- Added a cascading KnowledgeSpace foreign key so session rows are removed with their space.
- Added bounded lookup indexes for active sessions by tenant/space/expiry and expired-session
  cleanup by tenant/expiry.
- Regenerated PostgreSQL and TiDB initial schema migration artifacts from the checked-in renderer.

## Verification

- `pnpm --filter @knowledge/database test -- src/schema.test.ts`
- `pnpm --filter @knowledge/database test`
- `pnpm --filter @knowledge/database typecheck`
- `pnpm db:migrations:check`
