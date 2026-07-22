# Projection Publication GC

## Summary

- Added projection publication GC preview and execute helpers.
- Extended the publication repository with bounded GC candidate listing and guarded deletion.
- GC candidates include inactive and superseded publication records older than the retention cutoff.
- GC skips fingerprints still referenced by active KnowledgeFS sessions through `metadata.projectionSetFingerprint`.
- Published projection sets cannot be deleted through the GC path.

## TDD Notes

- Added GC coverage proving:
  - inactive retained publication records are returned as dry-run candidates.
  - superseded fingerprints referenced by active sessions are skipped.
  - execute deletes only eligible candidates.
  - the currently published fingerprint remains published after cleanup.

## Verification

- `pnpm exec biome check --write packages/api/src/projection-publication-gc.ts packages/api/src/projection-publication-gc.test.ts packages/api/src/projection-publication-repository.ts packages/api/src/index.ts`
- `pnpm --filter @knowledge/api test -- src/projection-publication-gc.test.ts src/projection-publication-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
