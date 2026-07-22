# Projection Publication Repository

## Summary

- Added an API-level ProjectionSet publication repository contract and bounded in-memory implementation.
- Publication records track tenant, knowledge space, projection set fingerprint, projection version, metadata, and lifecycle status.
- Supported lifecycle operations now cover:
  - `candidate` creation.
  - `candidate -> validating`.
  - `candidate|validating -> published`.
  - automatic published-set superseding.
  - rollback from a superseded fingerprint back to published.
  - candidate/inactive cleanup through `inactive`.
- Exported the repository from the API package for follow-up retrieval publication wiring.

## TDD Notes

- Added repository coverage proving:
  - validated candidates can publish.
  - publishing a newer candidate supersedes the prior published fingerprint.
  - rollback restores a previously superseded fingerprint and supersedes the bad current one.
  - candidates can become inactive.
  - inactive or invalid fingerprints reject unsafe transitions.

## Verification

- `pnpm exec biome check --write packages/api/src/projection-publication-repository.ts packages/api/src/projection-publication-repository.test.ts packages/api/src/index.ts`
- `pnpm --filter @knowledge/api test -- src/projection-publication-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
