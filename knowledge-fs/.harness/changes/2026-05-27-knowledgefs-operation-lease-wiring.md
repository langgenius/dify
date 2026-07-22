# KnowledgeFS Operation Lease Wiring

## Summary

- Added a `KnowledgeFsOperationLeaseCoordinator` that acquires, heartbeats, releases, and marks
  failed operation leases around async work.
- Wired durable document compilation worker processing to publish leases.
- Wired tenant-scoped incremental reindex work to reindex leases.
- Wired bulk document deletion to delete leases through gateway operation options.
- Added tests for coordinator lifecycle behavior, document worker publish leases, reindex leases,
  and bulk delete lease release state.

## Verification

- `pnpm --filter @knowledge/api test -- src/document-compilation-worker.test.ts src/index-reindexer.test.ts src/gateway-document-write.test.ts src/knowledge-fs-operation-leases.test.ts`
- `pnpm --filter @knowledge/api typecheck`
