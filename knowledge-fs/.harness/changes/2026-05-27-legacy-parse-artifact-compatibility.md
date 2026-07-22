# Legacy Parse Artifact Compatibility

Date: 2026-05-27

## Summary

Completed JH.2.8 by adding a bounded compatibility path for artifact reads when
new artifact segment rows are absent.

## Changes

- Added `ParseArtifactRepository.getById` to support artifact-path compatibility
  reads by `targetId`.
- Implemented in-memory and database-backed `getById` behavior.
- Added KnowledgeFS `cat` fallback for artifact paths with no segment rows.
- Legacy fallback pages over parse artifact elements using the same numeric cursor
  convention as segment-backed reads.
- Wired the parse artifact repository into KnowledgeFS command registry and gateway
  construction.
- Added repository and command tests covering `getById` and bounded legacy cat.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts src/parse-artifact-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the API package test suite and passed.

## Known Follow-Ups

- Legacy fallback currently covers `cat`. Segment-backed `grep`/`find` are available
  for segment rows; old parse artifact grep fallback can be added if migration
  feedback shows a need.
- Database-backed artifact segment repository operations are still not implemented.
