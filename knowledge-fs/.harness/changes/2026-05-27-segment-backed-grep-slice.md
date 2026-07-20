# Segment-Backed Grep Slice

Date: 2026-05-27

## Summary

Advanced JH.2.7 by adding segment-backed `grep` for exact artifact paths.

## Changes

- Wired artifact segment access into KnowledgeFS `grep`.
- Exact artifact paths now scan bounded artifact segment pages instead of requiring
  KnowledgeNode rows.
- Grep matches now support `kind: "segment"` with `segmentId`.
- Segment grep returns stable cursors based on segment index and sets `truncated`
  when more segment pages remain.
- Node-backed grep behavior remains unchanged for physical path descendant scans.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`

The targeted test command ran the API package test suite and passed.

## Known Follow-Ups

- JH.2.7 is not fully closed yet: segment-aware `find` fallback still needs a
  focused slice.
- Segment grep currently scans the returned segment page. Multi-page scanning across
  nonmatching segments can be made more ergonomic once caller UX is defined.
