# Extract API Retrieval Paths

## Summary

- Extracted summary-tree, table-specific, image/OCR, and graph-expanded retrieval path builders from `packages/api/src/index.ts` into `packages/api/src/retrieval-paths.ts`.
- Extracted shared hybrid retrieval input/result/metric/plan types into `packages/api/src/retrieval-types.ts`.
- Added a code-health guardrail that keeps retrieval path builders out of the gateway file and prevents `retrieval-paths.ts` from importing `./index`.

## Why

- Continues R6 API decomposition after summary-tree builder extraction.
- Keeps retrieval path fanout, merge, filter, and graph-expansion logic in a focused module with existing direct path behavior tests.
- Preserves root exports so existing callers can keep importing from `@knowledge/api`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `retrieval-paths.ts` did not exist.
- GREEN: extracted retrieval path builders and shared retrieval types, then reran code-health and summary-tree retrieval path tests.

## Performance Notes

- Preserved bounded topK/limit caps for summary, table, image, and graph expansion legs.
- Preserved graph traversal bounds: seed entity cap, max depth, fanout, max traversal nodes, and timeout.
- Preserved clone isolation for merged retrieval items and metadata while avoiding any new database reads.

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

- This is implementation commit 4 after review checkpoint `0e46d78`.
