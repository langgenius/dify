# Extract AnswerTrace Handlers

## Summary

- Extracted AnswerTrace read and query virtual entry handler registration from `packages/api/src/index.ts` into `packages/api/src/answer-trace-handlers.ts`.
- Preserved tenant-scoped trace visibility and virtual evidence/conflict/missing pagination behavior.
- Kept invalid virtual cursor/list requests mapped to bounded 400 responses via `KnowledgeFsValidationError`.

## TDD

- Added a code-health regression test requiring `registerAnswerTraceHandlers` outside the gateway entrypoint.
- Confirmed the test failed while `answer-trace-handlers.ts` did not exist.
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

- This slice is implementation commit 8 after review checkpoint `09193ab`.
- The next mandatory 10-commit project health review is due after 2 more implementation commits.
