# Extract API Retrieval Candidates

## Summary

- Extracted retrieval candidate contracts, database row mapping, metadata filtering, permission filtering, and clone helpers from `packages/api/src/index.ts` into `packages/api/src/retrieval-candidates.ts`.
- Kept SQL retrieval and RRF/rerank orchestration unchanged in `index.ts`.
- Added a code-health guardrail to prevent candidate helper logic from drifting back into the gateway file.

## TDD

- RED: added direct `retrieval-candidates` tests and a code-health guard, which failed because `retrieval-candidates.ts` did not exist.
- GREEN: implemented the module and covered DB row mapping, metadata filters, permission filters, invalid permission scopes, and clone isolation.

## Verification

- `pnpm --filter @knowledge/api test -- src/retrieval-candidates.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/retrieval-candidates.test.ts`

## Coverage

- `retrieval-candidates.ts`: 96.95% statements, 85% branches, 100% functions.

## Review Cadence

- This is implementation commit 5 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 5 more implementation commits.
