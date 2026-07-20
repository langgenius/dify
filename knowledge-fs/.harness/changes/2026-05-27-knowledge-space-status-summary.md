# KnowledgeSpace Status Summary

## Summary

- Added `GET /knowledge-spaces/{id}/status` as a bounded operator health snapshot for one KnowledgeSpace.
- The status response includes manifest policy versions, storage provider and object-storage health, parser kind and parser policy, projection-set version and per-index projection state, active runtime sessions, active leases, and recent failed staged commits.
- Added active-list support to the KnowledgeFS session and lease repositories so runtime status can distinguish active rows from expired or released rows.
- Extended gateway options with KnowledgeFS runtime session and lease repositories, preserving in-memory defaults for local/dev use while allowing durable wiring later.

## TDD Notes

- Added handler coverage proving the status endpoint is tenant-scoped and returns manifest, storage, parser/index versions, active sessions/leases, failed commits, and projection summaries.
- Added repository tests proving active session listing is knowledge-space-scoped, bounded, cursor-safe, and excludes expired sessions.
- Added repository tests proving active lease listing is knowledge-space-scoped and excludes expired or released leases.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-fs-session-repository.test.ts src/knowledge-fs-lease-repository.test.ts src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api typecheck`
