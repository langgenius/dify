# KnowledgeFS Staged Object GC Dry-Run

## Summary

- Added a staged object GC dry-run service that lists cleanup candidates without mutating object
  storage or commit state.
- Added candidates for objects under a staged prefix and expired failed staged commits.
- Added stable GC idempotency keys, estimated byte summaries, candidate counts, and staged/failed
  commit counters.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-gc.test.ts`
- `pnpm --filter @knowledge/api typecheck`
