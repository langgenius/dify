# KnowledgeFS Runtime Cleanup Worker

## Summary

- Added delete operations to the KnowledgeFS session and lease repository contracts and in-memory
  adapters.
- Added `KnowledgeFsRuntimeCleanupWorker` to prune expired sessions and leases with tenant scoping,
  stable cursors, and bounded per-run delete limits.
- Added cleanup tests proving expired runtime metadata is deleted while non-expired sessions and
  leases remain available.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-runtime-cleanup-worker.test.ts`
- `pnpm --filter @knowledge/api typecheck`
