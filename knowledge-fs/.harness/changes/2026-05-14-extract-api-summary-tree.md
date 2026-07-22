# Extract API Summary Tree Builders

## Summary

- Extracted summary tree builder contracts, maintenance flow, validation helpers, prompt assembly, deterministic summary ids, and summary node generation from `packages/api/src/index.ts` into `packages/api/src/summary-tree.ts`.
- Added a code-health guardrail that keeps summary tree builder implementations out of the gateway file and prevents the new module from importing `./index`.

## Why

- Continues R6 API decomposition after graph index extraction.
- Keeps summary generation workflow code close to its tests and away from route/composition concerns.
- Leaves summary-tree retrieval path filters in `index.ts` for now because they sit directly on hybrid retrieval route/runtime types.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `summary-tree.ts` did not exist.
- GREEN: extracted summary tree builder and maintenance logic and reran focused summary-tree tests.

## Performance Notes

- Preserved batched `nodes.getMany` reads for leaf and reusable summary nodes.
- Preserved explicit `maxLeafNodes`, `maxChangedLeafNodes`, `maxSections`, `maxSummaryNodes`, `maxInputChars`, and `maxSummaryChars` guards.
- No new database round trips or unbounded accumulation paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/summary-tree.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/summary-tree.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 3 after review checkpoint `0e46d78`.
