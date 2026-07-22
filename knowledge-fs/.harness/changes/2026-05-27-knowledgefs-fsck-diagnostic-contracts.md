# KnowledgeFS FSCK Diagnostic Contracts

## Summary

- Added core FSCK report, issue, target, severity, issue type, repairability, and bounded summary
  schemas.
- Added fsck target references for raw objects, artifact objects, artifact segments, paths, nodes,
  projections, and staged commits.
- Added model tests covering severity/type validation, cursor support, target refs, repairability,
  and non-negative bounded summary counts.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core typecheck`
