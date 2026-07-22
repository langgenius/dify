# KnowledgeFS Staged Object GC Mutation

## Summary

- Added the first mutation-side staged object GC executor behind the existing GC dry-run candidate contract.
- Deletes only executable `staged-object` candidates with object keys, ignores non-object cleanup candidates, and returns per-item audit results with idempotency keys.
- Enforces `maxDeletes` before mutating storage so an oversized batch cannot partially delete staged objects.
- Uses KnowledgeFS operation leases when provided and skips candidates that conflict with active leases instead of deleting under concurrent publication.
- Extended the lease target contract to include `staged-commit` so staged object cleanup can share the same concurrency model as publish/delete/reindex operations.

## TDD Notes

- Added failing API coverage first for lease-aware staged object deletion, active lease conflict skipping, and per-item audit output.
- Added bounded mutation coverage proving `maxDeletes` is checked before any object deletion occurs.
- Added core model coverage proving `KnowledgeFsLeaseSchema` accepts `staged-commit` lease targets.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-gc.test.ts`
- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/core typecheck`
