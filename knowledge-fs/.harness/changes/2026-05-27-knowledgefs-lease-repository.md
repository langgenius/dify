# KnowledgeFS Lease Repository

## Summary

- Added `KnowledgeFsLeaseRepository` with acquire, get, heartbeat, release, and expired-lease
  listing operations.
- Added an in-memory implementation with tenant scoping, clone isolation, capacity bounds, list
  limits, and stable expiry cursors.
- Added mutation conflict detection so active publish/delete/reindex leases block conflicting
  mutation leases on the same virtual path while read leases remain non-blocking.
- Exported the repository contract and memory adapter from the API package.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-lease-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/core typecheck`
