# Extract API Retrieval Rerank

## Summary

- Extracted hybrid retrieval reranking helpers from `packages/api/src/index.ts` into `packages/api/src/retrieval-rerank.ts`.
- Kept gateway retrieval orchestration and evidence bundle assembly behavior unchanged while removing reranker provider calls and text fallback helpers from the gateway file.
- Added a code-health guardrail to prevent rerank helpers from drifting back into the gateway god file.

## TDD

- RED: added direct `retrieval-rerank` tests and code-health guard, which failed before `retrieval-rerank.ts` existed.
- GREEN: implemented reranker document mapping, reranked-item clone isolation, missing-result filtering, and rerank/evidence text fallback helpers.

## Verification

- `pnpm --filter @knowledge/api test -- src/retrieval-rerank.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/retrieval-rerank.test.ts`

## Coverage

- `retrieval-rerank.ts`: 98.66% statements, 96.29% branches, 100% functions.

## Review Cadence

- This is implementation commit 7 after review checkpoint `51b0582`.
- Next mandatory 10-commit health review is due after 3 more implementation commits.
