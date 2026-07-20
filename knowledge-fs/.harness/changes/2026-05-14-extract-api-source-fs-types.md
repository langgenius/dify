# Extract API SourceFS Types

## Summary

- Extracted SourceFS result contracts from `packages/api/src/index.ts` into `packages/api/src/source-fs-types.ts`.
- Kept root API exports compatible through `packages/api/src/index.ts`.
- Added a code-health guardrail preventing SourceFS result contracts from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Creates a clean type boundary for a later SourceFS command registry extraction.

## TDD

- RED: added a code-health guardrail first; it failed because `source-fs-types.ts` did not exist.
- GREEN: moved the SourceFS contracts, re-exported the module, and reran focused SourceFS/gateway/code-health tests.

## Performance Notes

- Type-only extraction; SourceFS listing, cat, grep, object storage reads, bounds, and pagination behavior are unchanged.
- No new clone paths, database queries, object storage calls, or memory retention were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/sourcefs.test.ts src/gateway.test.ts`
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

- This is implementation commit 5 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
