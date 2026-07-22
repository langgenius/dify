# Extract API Knowledge Node Repository

## Summary

- Continued R6 API decomposition by moving `KnowledgeNodeRepository` contracts, bounded in-memory storage, parameterized database SQL, metadata batch updates, document-asset deletion, stable artifact pagination, row mapping, and clone helpers into `packages/api/src/knowledge-node-repository.ts`.
- Kept node reads/writes bounded with explicit batch caps, `maxRows`, `limit + 1` pagination, and `startOffset + id` keyset ordering.
- Added a code-health guardrail to keep knowledge node repository implementations out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/knowledge-node-repository.test.ts src/code-health.test.ts` failed because `knowledge-node-repository.ts` did not exist.
- GREEN: implemented the extracted module, re-exported it, and removed the node repository implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-node-repository.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/knowledge-node-repository.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/knowledge-node-repository.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 9 after review checkpoint `6f3cfc8`; the next implementation commit must trigger the mandatory 10-commit health review after it is committed and pushed.
