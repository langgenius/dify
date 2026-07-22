# Extract API Retrieval Cache

## Summary

- Extracted query normalization cache and EvidenceBundle cache contracts/implementations from `packages/api/src/index.ts` into `packages/api/src/retrieval-cache.ts`.
- Extracted retrieval metadata filter normalization into `packages/api/src/retrieval-filter-utils.ts`.
- Added a code-health guardrail that keeps cache and filter normalization logic out of the gateway file.

## Why

- Continues R6 API decomposition after retrieval planner extraction.
- Keeps cache key normalization, digest construction, TTL validation, and clone-isolated EvidenceBundle storage in focused modules.
- Allows hybrid retrieval and SQL candidate search to share one filter normalization utility without a gateway dependency.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `retrieval-cache.ts` did not exist.
- GREEN: extracted cache/filter logic and reran code-health plus gateway cache coverage.

## Performance Notes

- Cache keys remain SHA-256 digests and do not include raw query text.
- Query byte limits and TTL validation are preserved.
- Filter normalization deduplicates values once before SQL/cache use and does not add database round trips.

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

- This is implementation commit 6 after review checkpoint `0e46d78`.
