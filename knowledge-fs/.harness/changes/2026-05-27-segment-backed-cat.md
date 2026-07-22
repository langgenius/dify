# Segment-Backed KnowledgeFS Cat

Date: 2026-05-27

## Summary

Completed the JH.2.6 command-level slice by allowing `cat` to read artifact paths
from bounded artifact segment pages.

## Changes

- Wired `artifactSegments` into the KnowledgeFS command registry.
- Added artifact-path support to `cat`.
- Added optional `limit` and `cursor` support to cat input and route query parsing.
- Added `nextCursor` to cat responses.
- Segment-backed cat now:
  - reads segments by `(knowledgeSpaceId, parseArtifactId, segmentIndex)`;
  - concatenates inline text or object-backed segment bodies;
  - returns `truncated` and `nextCursor` when more segment pages remain;
  - preserves 404 behavior for artifact paths without segment data.
- Threaded artifact segment support through `diff`, because diff reuses cat internally.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the API package test suite and passed.

## Known Follow-Ups

- Route-level cat pagination has schema support, but broader API integration tests
  can be added when Admin/MCP surfaces start consuming artifact paths directly.
- Segment-aware `grep` and `find` remain planned in JH.2.7.
- Legacy parse artifacts without segments still need explicit compatibility fallback
  in JH.2.8.
