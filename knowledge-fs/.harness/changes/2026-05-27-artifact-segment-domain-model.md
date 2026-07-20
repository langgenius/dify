# Artifact Segment Domain Model

Date: 2026-05-27

## Summary

Completed JH.2.2 by adding the core artifact segment schema that lets large parse
output be represented as bounded inline text or immutable object-backed pages.

## Changes

- Added `ArtifactSegmentTypeSchema` and `ArtifactSegmentSchema` to core models.
- Artifact segments now capture:
  - tenant-independent KnowledgeSpace/document/artifact identity;
  - stable `segmentIndex` and `segmentType`;
  - artifact hash and per-segment checksum;
  - bounded `inlineText` with a 64 KiB maximum;
  - optional immutable `objectKey` using the existing safe object key contract;
  - size, source offsets, source location, metadata, and timestamps.
- Added validation that each segment has either `inlineText` or `objectKey`.
- Added validation that segment `endOffset` cannot precede `startOffset`.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `git diff --check`

## Known Follow-Ups

- The API repository contract, database schema, and parser write path are still
  planned in JH.2.3 through JH.2.5.
- Segment-backed `cat`, `grep`, and compatibility reads remain planned for later
  JH.2 iterations.
