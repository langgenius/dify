# KnowledgeFS Raw Object FSCK

## Summary

- Added a raw document object fsck checker that scans document assets with bounded repository
  pagination.
- Checked object existence, `metadata.sha256`, and object size through `headObject` only, without
  reading or streaming raw bodies.
- Returned stable FSCK report issues for missing raw objects, checksum mismatches, and size
  mismatches.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-fsck.test.ts`
- `pnpm --filter @knowledge/api typecheck`
