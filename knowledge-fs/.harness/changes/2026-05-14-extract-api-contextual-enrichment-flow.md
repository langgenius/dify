# Extract API Contextual Enrichment Flow

## Summary

- Extracted contextual enrichment contracts, provider orchestration, cache key/read/write helpers, budget checks, quality-threshold handling, prompt construction, and result assembly from `packages/api/src/index.ts` into `packages/api/src/contextual-enrichment-flow.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing contextual enrichment flow logic from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Keeps enrichment orchestration, cache boundaries, and prompt construction out of HTTP gateway composition.

## TDD

- RED: added a code-health guardrail first; it failed because `contextual-enrichment-flow.ts` did not exist.
- GREEN: moved the contextual enrichment implementation, re-exported it, and reran focused contextual/code-health tests.

## Performance Notes

- Runtime behavior is unchanged: enrichment loads requested nodes in one `getMany`, writes metadata in one `updateMetadataMany`, enforces `maxBatchSize`, and skips existing or low-quality nodes.
- Cache reads/writes remain bounded by `64 KiB`; oversized or corrupt cache entries are ignored.
- No new database query patterns, object-storage reads, unbounded scans, or memory retention paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/contextual-enrichment.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 9 after review checkpoint `5fcec6c`; the next implementation commit will trigger the mandatory 10-commit health review.
