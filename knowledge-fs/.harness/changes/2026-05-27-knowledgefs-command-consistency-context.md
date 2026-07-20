# KnowledgeFS Command Consistency Context

## Summary

- Propagated a validated `consistencyClass` from command input into the core command execution
  context before permission checks, tracing, cost estimation, and handler execution.
- Added KnowledgeFS command policy checks that reject `eventual-preview` for citation-ready or
  content-producing commands: `cat`, `grep`, `diff`, and `open_node`.
- Kept `snapshot-consistent`, `path-consistent`, and `cache-consistent` available for normal read
  commands, with preview semantics reserved for metadata-oriented surfaces.

## Verification

- `pnpm --filter @knowledge/core test -- src/command-registry.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
