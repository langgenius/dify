# KnowledgeFS Artifact Segment FSCK

## Summary

- Added an artifact/segment fsck checker that scans document assets with bounded pagination,
  resolves each current parse artifact by document version, and scans artifact segments with a
  per-artifact segment limit.
- Checked inline segment checksums without loading unrelated artifacts.
- Checked object-backed segment existence, checksum metadata, and size through `headObject` only.
- Returned stable FSCK report issues for missing artifact objects, segment hash mismatches, and
  size mismatches.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-fsck.test.ts`
- `pnpm --filter @knowledge/api typecheck`
