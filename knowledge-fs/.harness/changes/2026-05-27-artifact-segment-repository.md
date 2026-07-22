# Artifact Segment Repository

Date: 2026-05-27

## Summary

Completed JH.2.3 by adding the API repository contract and in-memory implementation
for bounded artifact segments.

## Changes

- Added `ArtifactSegmentRepository` with:
  - `createMany` for bounded batch writes;
  - `listByArtifact` for stable `parseArtifactId` plus `segmentIndex` pagination;
  - `listByChecksum` for hash-based lookup inside a KnowledgeSpace.
- Added in-memory repository bounds for max segments, batch size, and list limit.
- Added duplicate protection for `(knowledgeSpaceId, parseArtifactId, segmentIndex)`.
- Added clone isolation for created and listed segments.
- Exported the repository from the API package barrel.

## Verification

- `pnpm --filter @knowledge/api test -- src/artifact-segment-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the API package test suite and passed.

## Known Follow-Ups

- Durable database schema and SQL-backed repository behavior are planned in JH.2.4.
- Parser output is not yet written into segments; that starts in JH.2.5.
