# Extract API Hybrid Retrieval

## Summary

- Extracted database-backed hybrid retrieval SQL execution into `packages/api/src/hybrid-retrieval.ts`.
- Extracted basic hybrid retriever orchestration, degradation handling, metadata filtering, permission filtering, fusion, and reranking into the same focused module.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing hybrid retrieval implementation from drifting back into the gateway.

## Why

- Continues R6 code review remediation by shrinking the API gateway god file and isolating retrieval execution from route construction.
- Keeps SQL retrieval behavior and retrieval orchestration testable without importing gateway internals.

## TDD

- RED: added a code-health guardrail first; it failed because `hybrid-retrieval.ts` did not exist.
- GREEN: moved the repository/retriever implementation and private SQL/timing helpers, then reran focused gateway tests.
- Fixed one behavior regression caught by tests: the no-planner path must continue to use `defaultRetrievalPlan` instead of constructing a configured planner.

## Performance Notes

- Preserved explicit `maxTopK`, `maxRows`, and query-vector validation before database execution.
- Kept SQL parameterized; user query and vectors remain in params instead of SQL string interpolation.
- Preserved parallel dense/FTS execution, in-memory metadata/permission filtering, bounded fusion, and bounded reranking candidate limits.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 8 after review checkpoint `0e46d78`; the next mandatory 10-commit review is not due yet.
