# Freshness Checking Service

## Summary

- Added a Phase 5 Sprint 18 freshness checking service boundary.
- The service consumes an `EvidenceBundle` and returns stale evidence warnings with source locations.
- No HTTP route, database execution, storage call, or provider SDK wiring was added in this slice.

## Key Changes

- Added `packages/api/src/freshness-checking.ts`.
- Exported freshness checking contracts from `packages/api/src/index.ts`.
- Added `packages/api/src/freshness-checking.test.ts`.

## Behavior

- Requires a non-empty `knowledgeSpaceId`.
- Validates the incoming bundle through `EvidenceBundleSchema`.
- Emits warnings for evidence items with `freshness.status === "stale"`.
- Optionally emits warnings when `sourceUpdatedAt` exceeds `staleAfterSeconds`.
- Includes source locations, observed/source timestamps, status, reason, severity, and computed age when available.
- Keeps returned warning citations clone-isolated.

## Performance Notes

- `maxEvidenceItems` bounds scan fan-out and memory usage.
- The service performs a single linear pass over already-loaded evidence items.
- It does not perform database, object storage, retrieval, or provider calls.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/freshness-checking.test.ts` failed because `./freshness-checking` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/freshness-checking.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/freshness-checking.ts packages/api/src/freshness-checking.test.ts packages/api/src/index.ts`

## Full Verification

- Passed before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This will be implementation commit 9 after reviewed checkpoint `f7581f5`.
