# Extract GoldenQuestion Handlers

## Summary

- Extracted GoldenQuestion and production bad-case route handler registration from `packages/api/src/index.ts` into `packages/api/src/golden-question-handlers.ts`.
- Kept tenant-scoped KnowledgeSpace checks, GoldenQuestion cursor pagination, annotation metadata assembly, and production bad-case trace capture behavior unchanged.
- Left `index.ts` responsible for gateway composition and handler registration wiring only.

## TDD

- Added a code-health regression test that requires `registerGoldenQuestionHandlers` to live outside the gateway entrypoint.
- Confirmed the test failed while `golden-question-handlers.ts` was missing.
- Implemented the extraction and reran focused typecheck/code-health coverage successfully.

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

- This slice is implementation commit 6 after review checkpoint `09193ab`.
- The next mandatory 10-commit project health review is due after 4 more implementation commits.
