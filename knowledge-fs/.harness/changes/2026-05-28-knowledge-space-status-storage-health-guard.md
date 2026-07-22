# KnowledgeSpace Status Storage Health Guard

## Summary

- Hardened `GET /knowledge-spaces/{id}/status` so object-storage health probe failures no longer fail the whole status endpoint.
- The status response now reports `storage.healthy: false` when `adapter.objectStorage.health()` throws.
- This keeps Admin control-plane rendering available during transient S3/MinIO/object-storage probe failures while still surfacing the unhealthy storage state.

## TDD Notes

- Added control-plane diagnostics coverage proving a throwing object-storage health probe returns HTTP 200 with `storage.healthy: false`.
- Kept the behavior scoped to the operator status endpoint; other storage operations still surface their own failures.

## Verification

- `pnpm exec biome check --write packages/api/src/knowledge-space-handlers.ts packages/api/src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
