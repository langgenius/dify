# IndexProjection Versioning

## Summary

- Added the first Phase 3 Sprint 10 projection-versioning guardrail.
- Dense vector and FTS projection builders can now create non-active `building` candidate versions while existing `ready` projections remain the only rows returned to retrieval callers.

## Changes

- Added `ProjectionBuildStatus` with supported build statuses `ready` and `building`.
- Extended dense vector and FTS projection build inputs with optional `status`.
- Kept default build status as `ready` for existing local/dev and retrieval tests.
- Added candidate-version coverage proving a version 2 `building` projection for the same node does not overwrite or appear alongside the version 1 `ready` projection.

## Guardrails

- Candidate builds use new projection rows and ids; active ready rows are not overwritten.
- `listReadyBySpace()` continues to filter `status === "ready"`, so retrieval does not accidentally read candidate projections.
- Runtime validation rejects unsupported build statuses.
- Existing bounded batch, bounded list, clone isolation, and database parameterization behavior remains unchanged.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because candidate version 2 projections were still created with `status: "ready"`.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- Full verification:
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is implementation commit 5 after reviewed checkpoint `3b9b4d8` once committed and pushed.
- The next 10-commit health review is not yet due.
