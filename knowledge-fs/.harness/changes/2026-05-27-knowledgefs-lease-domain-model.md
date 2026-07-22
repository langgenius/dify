# KnowledgeFS Lease Domain Model

## Summary

- Added `KnowledgeFsLeaseSchema` with lease type, target type, target id, optional target version,
  virtual path, status, session id, heartbeat, expiry, and metadata fields.
- Added lease enums for read, publish, delete, and reindex operations, plus active, released,
  expired, and failed lifecycle states.
- Reused the KnowledgeFS namespace list for lease virtual path validation to avoid rule drift.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core test`
- `pnpm --filter @knowledge/core typecheck`
