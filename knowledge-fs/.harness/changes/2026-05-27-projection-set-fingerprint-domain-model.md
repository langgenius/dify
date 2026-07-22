# Projection Set Fingerprint Domain Model

## Summary

- Added core ProjectionSet fingerprint material schemas for projection configs and source snapshots.
- Added `buildProjectionSetFingerprint()` using normalized material, stable JSON, and SHA-256.
- Normalized projection configs and source snapshots before hashing so caller ordering does not change the fingerprint.
- Fingerprint material now groups the projection model, projection strategy, projection version, parser policy version, chunker version, node schema version, index version, projection set version, and source document snapshot checksums.

## TDD Notes

- Added core model coverage proving:
  - projection set fingerprint material validates the required model/strategy/version/source fields.
  - reordered projections and source snapshots produce the same fingerprint.
  - parser policy changes produce a different fingerprint.
  - empty projection sets are rejected.

## Verification

- `pnpm exec biome check --write packages/core/src/models.ts packages/core/src/models.test.ts`
- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core typecheck`
