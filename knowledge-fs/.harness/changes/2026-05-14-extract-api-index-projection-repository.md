# Extract API Index Projection Repository

## Summary

- Continued R6 API decomposition by moving `IndexProjectionRepository` contracts, bounded in-memory implementation, database-backed implementation, row mapping, clone helper, version lifecycle validation, delete/prune bounds, and dense/FTS projection SQL parameters into `packages/api/src/index-projection-repository.ts`.
- Kept gateway imports stable through `packages/api/src/index.ts` re-exports while removing the repository implementation from the gateway god file.
- Added a code-health guardrail to prevent index projection repository logic from returning to `index.ts`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/index-projection-repository.test.ts src/code-health.test.ts` failed because `index-projection-repository.ts` did not exist.
- GREEN: implemented the extracted module, re-exported it, and added direct tests for bounded memory behavior, clone isolation, keyset pagination, version publish/rollback/prune, parameterized database pagination, dense/FTS batch insert parameters, and bounded database delete/update/summarize commands.

## Verification

- `pnpm --filter @knowledge/api test -- src/index-projection-repository.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/index-projection-repository.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Coverage

- `index-projection-repository.ts` coverage after focused coverage run: 95.29% statements, 88.73% branches, 100% functions.

## Review Cadence

- This is implementation commit 2 after review checkpoint `51b0582`; the next mandatory health review is due after 8 more implementation commits.
