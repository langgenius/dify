# Extract DocumentCompilation Handlers

## Summary

- Extracted document compilation job status and cancel handler registration from `packages/api/src/index.ts` into `packages/api/src/document-compilation-handlers.ts`.
- Preserved tenant-scoped job visibility, 503 responses when the compilation state machine is unavailable, and 409 responses for non-cancelable jobs.
- Kept the gateway entrypoint focused on composition and route registration.

## TDD

- Added a code-health regression test requiring `registerDocumentCompilationHandlers` outside the gateway entrypoint.
- Confirmed the test failed while `document-compilation-handlers.ts` did not exist.
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

- This slice is implementation commit 7 after review checkpoint `09193ab`.
- The next mandatory 10-commit project health review is due after 3 more implementation commits.
