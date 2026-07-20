# Extract API Retrieval Evaluation Utils

## Summary

- Extracted retrieval evaluation bounds, score validation, A/B strategy validation, and A/B winner selection from `packages/api/src/index.ts` into `packages/api/src/retrieval-evaluation-utils.ts`.
- Kept evaluation runner orchestration in the gateway file while moving pure validation/comparison helpers behind a direct unit-tested boundary.
- Added a code-health guardrail to prevent evaluation utility helpers from drifting back into the gateway god file.

## TDD

- RED: added direct `retrieval-evaluation-utils` tests and code-health guard, which failed before `retrieval-evaluation-utils.ts` existed.
- GREEN: implemented runner option validation, per-run bounds validation, generic numeric bounds, strategy normalization, and deterministic A/B winner ranking.

## Verification

- `pnpm --filter @knowledge/api test -- src/retrieval-evaluation-utils.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/retrieval-evaluation-utils.test.ts`

## Coverage

- `retrieval-evaluation-utils.ts`: 95.34% statements, 95.45% branches, 100% functions.

## Review Cadence

- This is implementation commit 9 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 1 more implementation commit.
