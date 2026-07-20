# Extract API Graph Index Writer

## Summary

- Extracted graph index writer contracts, metadata entity/relation extraction, graph eligibility parsing, and deterministic graph id generation from `packages/api/src/index.ts` into `packages/api/src/graph-index-writer.ts`.
- Moved graph extraction type sets into `packages/api/src/extraction-types.ts` so validation and writer code share one source of truth.
- Added a code-health guardrail that keeps graph writer and metadata extraction helpers out of the gateway file and prevents the writer module from importing `./index`.

## Why

- Continues R6 API decomposition after the graph repository extraction.
- Keeps graph indexing orchestration near graph repository contracts instead of inside the Hono gateway composition file.
- Further reduces `packages/api/src/index.ts`, while preserving the existing graph indexing tests and summary-tree graph expansion behavior.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `graph-index-writer.ts` did not exist.
- GREEN: extracted the writer and metadata helpers, added the missing deterministic id helper locally, removed duplicate extraction type constants, and reran focused tests.

## Performance Notes

- Preserved one batched `nodes.getMany` call for graph indexing to avoid per-node repository reads.
- Preserved `maxBatchSize`, per-node metadata validation, and bounded graph writer output through repository batch limits.
- No new database round trips, unbounded list APIs, or object buffering paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/graph-index.test.ts src/summary-tree.test.ts`
- `pnpm --filter @knowledge/api test:coverage -- src/graph-index.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 2 after review checkpoint `0e46d78`.
