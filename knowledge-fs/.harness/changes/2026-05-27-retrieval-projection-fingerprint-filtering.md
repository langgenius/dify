# Retrieval Projection Fingerprint Filtering

## Summary

- Added projection set read-mode fields to hybrid retrieval input.
- Added retrieval candidate filtering by `metadata.projectionSetFingerprint`.
- Normal/published retrieval now keeps only the published projection set fingerprint when one is supplied.
- Preview and evaluation modes can additionally allow a candidate projection set fingerprint.
- Added a low-cardinality `projectionFilteredCandidates` metric when projections are filtered out.

## TDD Notes

- Added hybrid retrieval coverage proving:
  - normal retrieval excludes candidate projection-set candidates.
  - preview retrieval can include the candidate fingerprint alongside the published fingerprint.
  - projection filtering is reported in retrieval metrics only when candidates are removed.

## Verification

- `pnpm exec biome check --write packages/api/src/hybrid-retrieval.ts packages/api/src/hybrid-retrieval.test.ts packages/api/src/retrieval-candidates.ts packages/api/src/retrieval-types.ts`
- `pnpm --filter @knowledge/api test -- src/hybrid-retrieval.test.ts src/retrieval-candidates.test.ts`
- `pnpm --filter @knowledge/api typecheck`
