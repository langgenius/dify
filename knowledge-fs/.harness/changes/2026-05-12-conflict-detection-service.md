# Conflict Detection Service

## Summary

- Added a Phase 5 Sprint 18 conflict detection service boundary.
- The service consumes a `SourceComparisonReport`, filters comparison differences, calls an injected detector, and returns a bounded conflict report.
- No HTTP route, database execution, object storage, or provider SDK wiring was added in this slice.

## Key Changes

- Added `packages/api/src/conflict-detection.ts`.
- Exported conflict detection contracts from `packages/api/src/index.ts`.
- Added `packages/api/src/conflict-detection.test.ts`.

## Behavior

- Requires a non-empty `knowledgeSpaceId`.
- Limits source comparison findings with `maxFindings`.
- Sends only `difference` findings to the detector.
- Limits detector output with `maxConflicts`.
- Maps conflict evidence node ids back to cited source locations.
- Deduplicates source locations and keeps return values clone-isolated.
- Validates detector confidence is between `0` and `1`.

## Performance Notes

- The service is pure in-process orchestration and performs no database reads.
- Detector fan-out is bounded by `maxFindings`.
- Conflict output memory is bounded by `maxConflicts`.
- Source locations are derived from the already-loaded comparison report to avoid repeated lookups.

## TDD

- RED first:
  - `pnpm --filter @knowledge/api test -- src/conflict-detection.test.ts` failed because `./conflict-detection` did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/api test -- src/conflict-detection.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm exec biome check --write packages/api/src/conflict-detection.ts packages/api/src/conflict-detection.test.ts packages/api/src/index.ts`

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

- This will be implementation commit 8 after reviewed checkpoint `f7581f5`.
