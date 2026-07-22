# Extract API Knowledge Path Repository

## Summary

- Continued R6 API decomposition by moving `KnowledgePathRepository` contracts, bounded in-memory storage, parameterized database SQL, duplicate/capacity/list-limit errors, stable cursor pagination, row mapping, and clone helpers into `packages/api/src/knowledge-path-repository.ts`.
- Kept path listing bounded with explicit `limit + 1` reads and stable `virtualPath + id` keyset cursors.
- Added a code-health guardrail to keep knowledge path repository implementations out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/knowledge-path-repository.test.ts src/code-health.test.ts` failed because `knowledge-path-repository.ts` did not exist.
- GREEN: implemented the extracted module, re-exported it, and removed the path repository implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-path-repository.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 8 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
