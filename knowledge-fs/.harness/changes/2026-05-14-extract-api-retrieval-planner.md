# Extract API Retrieval Planner

## Summary

- Extracted retrieval planner contracts, auto-mode resolution, bounded fanout plan assembly, trace attributes, and default fast-plan fallback from `packages/api/src/index.ts` into `packages/api/src/retrieval-planner.ts`.
- Added a code-health guardrail that keeps retrieval planner logic out of the gateway file and prevents `retrieval-planner.ts` from importing `./index`.
- Kept root exports compatible through `export * from "./retrieval-planner"`.

## Why

- Continues R6 API decomposition after retrieval path extraction.
- Keeps routing/handler composition separate from retrieval planning heuristics and trace emission.
- Preserves planner behavior used by hybrid retrieval and gateway defaults without changing retrieval fanout.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `retrieval-planner.ts` did not exist.
- GREEN: extracted retrieval planner logic and reran code-health plus gateway retrieval planner coverage.

## Performance Notes

- Preserved explicit `maxTopK` validation and bounded dense/FTS/fusion fanout.
- Preserved fast/deep/research multipliers and fast default fallback for unconfigured retrievers.
- Trace attributes remain low-cardinality and do not include raw query text.

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

- This is implementation commit 5 after review checkpoint `0e46d78`.
