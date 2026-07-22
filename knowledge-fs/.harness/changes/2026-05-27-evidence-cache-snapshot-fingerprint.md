# EvidenceBundle Cache Snapshot Fingerprint

## Summary

- Added `snapshotFingerprint` to `EvidenceBundleCacheKeyInput` and included it in the hashed cache
  key payload.
- Kept existing `permissionSnapshot` and `indexProjectionFingerprint` key dimensions while adding
  the broader snapshot pin that covers manifest, source, path, and projection changes.
- Added cache tests proving snapshot fingerprint changes miss and blank fingerprints are rejected.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
