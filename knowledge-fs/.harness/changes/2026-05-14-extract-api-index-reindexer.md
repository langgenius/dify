# Extract API Incremental Reindexer

## Summary

- Extracted incremental reindex contracts, options, validation, and implementation from `packages/api/src/index.ts` into `packages/api/src/index-reindexer.ts`.
- Kept gateway behavior unchanged through `index.ts` re-export and type-only wiring for document compilation.
- Added code-health guardrails so incremental reindexing does not drift back into the gateway god file.

## TDD

- RED: added direct `index-reindexer` tests and a code-health guard; both failed because `index-reindexer.ts` did not exist.
- GREEN: moved the implementation into the new module and added focused coverage for unchanged-artifact skip, changed-artifact rebuild, FTS projection creation, dense model requirement validation, and max-node bounds.

## Verification

- `pnpm --filter @knowledge/api test -- src/index-reindexer.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/index-reindexer.test.ts`

## Coverage

- `index-reindexer.ts`: 95.34% statements, 87.09% branches, 100% functions.

## Review Cadence

- This is implementation commit 4 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 6 more implementation commits.
