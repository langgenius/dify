# KnowledgeFS Session Domain Model

## Summary

- Added `KnowledgeFsSessionSchema` and `KnowledgeFsSessionClientKindSchema` to core models.
- Session contracts now validate client kind/version, auth subject, permission snapshot,
  consistency class, heartbeat timestamp, expiry timestamp, tenant/space ids, and metadata.
- Added core schema tests for accepted session records and rejected unsupported client/version/
  consistency values.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `git diff --check`
