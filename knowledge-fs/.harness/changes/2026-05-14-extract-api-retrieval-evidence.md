# Extract API Retrieval Evidence

## Summary

- Extracted hybrid retrieval item to evidence bundle item mapping from `packages/api/src/index.ts` into `packages/api/src/retrieval-evidence.ts`.
- Kept evidence bundle assembly behavior unchanged while moving freshness, conflict, score, citation, and text mapping out of the gateway file.
- Added a code-health guardrail to prevent evidence mapping helpers from drifting back into the gateway god file.

## TDD

- RED: added direct `retrieval-evidence` tests and code-health guard, which failed before `retrieval-evidence.ts` existed.
- GREEN: implemented clone-isolated citation mapping, freshness defaults, conflict filtering, score projection, and evidence text fallback reuse.

## Verification

- `pnpm --filter @knowledge/api test -- src/retrieval-evidence.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/retrieval-evidence.test.ts`

## Coverage

- `retrieval-evidence.ts`: 97.5% statements, 97.22% branches, 100% functions.

## Review Cadence

- This is implementation commit 8 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 2 more implementation commits.
