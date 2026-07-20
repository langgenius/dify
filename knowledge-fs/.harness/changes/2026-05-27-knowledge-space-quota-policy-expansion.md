# KnowledgeSpace Quota Policy Expansion

## Summary

- Expanded the KnowledgeSpace manifest quota policy from raw document and basic derived-data limits into a broader pipeline budget model.
- Added nullable/defaulted limits for active jobs, active sessions, graph entities, graph relations, trace bytes, and provider budgets.
- Provider budgets now cover embedding tokens, LLM tokens, parser pages, and rerank requests per day.
- Kept backward-compatible parsing by defaulting missing quota limits to `null`.

## TDD Notes

- Added schema coverage proving:
  - raw bytes, artifact bytes, segment count, node count, projection count, graph counts, trace bytes, active jobs, active sessions, and provider budget fields parse successfully.
  - omitted expanded limits default to `null`.
  - zero/negative quota limits are rejected.

## Verification

- `pnpm --filter @knowledge/core test -- src/models.test.ts`
- `pnpm --filter @knowledge/core typecheck`
- `pnpm --filter @knowledge/api test -- src/storage-quota.test.ts src/knowledge-space-control-plane-diagnostics.test.ts`
- `pnpm --filter @knowledge/api typecheck`
