# KnowledgeFS Consistency Class Contract

## Summary

- Added focused core coverage for the four supported KnowledgeSpace consistency classes:
  `path-consistent`, `snapshot-consistent`, `cache-consistent`, and `eventual-preview`.
- Added KnowledgeFS API request schema support for optional `consistencyClass` declarations on
  command and route inputs.
- Threaded consistency class declarations through the core command context type so command handlers
  can observe caller consistency expectations.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts src/command-registry.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-fs-request-schemas.test.ts`
