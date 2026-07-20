# Extract API Retrieval Fusion

## Summary

- Extracted hybrid retrieval item contracts, RRF runtime contract, default RRF fusion, and injected runtime fusion adapter from `packages/api/src/index.ts` into `packages/api/src/retrieval-fusion.ts`.
- Kept retrieval orchestration, reranking, and route behavior unchanged in the gateway file.
- Added a code-health guardrail to prevent fusion helpers from drifting back into the gateway god file.

## TDD

- RED: added direct `retrieval-fusion` tests and code-health guard, which failed before `retrieval-fusion.ts` existed.
- GREEN: implemented deterministic RRF fusion, WASM/runtime fusion config mapping, missing-runtime-result filtering, and clone-isolated output.

## Verification

- `pnpm --filter @knowledge/api test -- src/retrieval-fusion.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/retrieval-fusion.test.ts`

## Coverage

- `retrieval-fusion.ts`: 100% statements, 96% branches, 100% functions.

## Review Cadence

- This is implementation commit 6 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 4 more implementation commits.
