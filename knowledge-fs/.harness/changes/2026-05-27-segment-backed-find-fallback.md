# Segment-Backed Find Fallback

Date: 2026-05-27

## Summary

Closed JH.2.7 by adding a bounded segment-aware `find` fallback for exact artifact
paths.

## Changes

- `find` now detects exact artifact paths before falling back to physical descendant
  path scans.
- Artifact segment find supports stable `segmentIndex` cursors through the existing
  artifact segment repository.
- Segment find supports existing `find` filters:
  - `resourceType=artifact`;
  - `nameContains` against `segment-{index}`;
  - `metadataKey` plus `metadataValue` against segment metadata.
- Segment find returns resource entries with segment id, virtual anchor path, segment
  index, segment type, and original segment metadata.
- Existing path-backed `find` behavior remains unchanged.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the API package test suite and passed.

## Known Follow-Ups

- Segment find currently operates on exact artifact paths. Broader descendant scans
  can be added when semantic artifact path conventions are more mature.
- Legacy parse artifact compatibility remains planned in JH.2.8.
