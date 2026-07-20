# Parser Output Artifact Segments

Date: 2026-05-27

## Summary

Completed the JH.2.5 MVP slice by writing parser output into artifact segments for
the synchronous Markdown/HTML upload path while preserving existing `ParseArtifact`
behavior.

## Changes

- Added gateway options for `artifactSegments` and `generateArtifactSegmentId`.
- Added a default in-memory artifact segment repository to the API gateway.
- Wired document write handlers to create text-backed artifact segments after a
  parse artifact is successfully persisted or reindexed.
- Segment rows include artifact/document identity, segment index/type, checksum,
  inline text, source offsets, source location, element metadata, and timestamps.
- Added upload integration coverage proving the existing parse artifact remains
  readable and a corresponding segment is created.

## Verification

- `pnpm --filter @knowledge/api test -- src/gateway-document-write.test.ts src/artifact-segment-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the API package test suite and passed.

## Known Follow-Ups

- Durable compilation workers still need segment writing.
- Segment-backed KnowledgeFS `cat` and `grep` remain planned for JH.2.6 and JH.2.7.
- The current MVP writes inline text segments only; object-backed large segment
  spillover remains a later hardening step.
