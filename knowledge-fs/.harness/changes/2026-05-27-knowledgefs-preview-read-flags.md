# KnowledgeFS Preview Read Flags

## Summary

- Added explicit `preview` and `consistencyClass` flags to metadata-oriented KnowledgeFS results.
- Kept all registered KnowledgeFS command cache policies at `{ strategy: "none" }`.
- Added command tests proving `eventual-preview` metadata reads are flagged while content/citation
  reads remain blocked by the consistency policy.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-fs-command-registry.test.ts src/knowledge-fs-response-schemas.test.ts`
- `pnpm --filter @knowledge/core test`
- `pnpm --filter @knowledge/api test -- src/knowledge-path-resolution-cache.test.ts src/knowledge-fs-command-registry.test.ts src/knowledge-fs-request-schemas.test.ts src/knowledge-fs-response-schemas.test.ts src/agent-workspace-snapshot.test.ts src/resource-mount-repository.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/api typecheck`
- `git diff --check`
