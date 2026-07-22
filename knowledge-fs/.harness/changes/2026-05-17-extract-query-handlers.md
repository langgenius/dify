# Extract Query Handlers

## Summary

- Extracted query streaming handler registration from `packages/api/src/index.ts` into `packages/api/src/query-handlers.ts`.
- Preserved blank-query validation, tenant-scoped KnowledgeSpace lookup, query generator availability checks, session context recording, and SSE response construction.
- Kept `index.ts` focused on gateway composition while moving query route behavior behind a registration boundary.

## TDD

- Added a code-health regression test requiring `registerQueryHandlers` outside the gateway entrypoint.
- Confirmed the test failed while `query-handlers.ts` did not exist.
- Implemented the handler module and reran focused typecheck/code-health coverage successfully.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This slice is implementation commit 10 after review checkpoint `09193ab`.
- After this commit is pushed, the project must pause feature/refactor work for the mandatory 10-commit health review.
