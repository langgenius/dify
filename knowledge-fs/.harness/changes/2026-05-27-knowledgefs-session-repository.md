# KnowledgeFS Session Repository

## Summary

- Added `KnowledgeFsSessionRepository` with create, get, heartbeat, and expired-session listing
  operations.
- Added an in-memory implementation with tenant scoping, clone isolation, capacity bounds, list
  limits, and stable expiry cursors.
- Exported the repository contract and memory adapter from the API package.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-session-repository.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
