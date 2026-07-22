# Extract API KnowledgeSpace Repository

## Summary

- Continued R6 API decomposition by moving KnowledgeSpace repository contracts, bounded in-memory storage, database SQL wiring, tenant slug uniqueness, row mapping, pagination limits, and repository errors into `packages/api/src/knowledge-space-repository.ts`.
- Preserved tenant-scoped CRUD semantics, duplicate slug checks, parameterized SQL, and explicit `maxRows` / `maxListLimit` bounds.
- Added a code-health guardrail to keep KnowledgeSpace repository implementations out of `packages/api/src/index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/knowledge-space-repository.test.ts src/code-health.test.ts` failed because `knowledge-space-repository.ts` did not exist.
- GREEN: implemented `packages/api/src/knowledge-space-repository.ts`, re-exported it, and removed the repository implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/knowledge-space-repository.test.ts src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 6 after review checkpoint `6f3cfc8`; the next mandatory 10-commit health review is not due yet.
