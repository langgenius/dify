# Projection Publication Rollback Workflow

## Summary

- Added a small ProjectionSet publication workflow over the publication repository.
- Rollback captures the previously published fingerprint, restores the requested prior fingerprint, and supersedes the bad current fingerprint.
- The workflow only changes publication records; it does not call parsers, builders, reindexers, or projection rebuild paths.

## TDD Notes

- Added workflow coverage proving:
  - rollback restores a previously published fingerprint.
  - the restored projection set keeps its original projection version.
  - the bad current projection set becomes superseded by the restored fingerprint.

## Verification

- `pnpm exec biome check --write packages/api/src/projection-publication-workflow.ts packages/api/src/projection-publication-workflow.test.ts packages/api/src/index.ts`
- `pnpm --filter @knowledge/api test -- src/projection-publication-workflow.test.ts src/projection-publication-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
