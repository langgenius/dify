# Blue-Green Index Publication

## Summary

- Added the first blue-green publication boundary for `IndexProjection` versions.
- Candidate projection versions can now be evaluated with a status summary, published to active `ready`, or rolled back to `failed`.

## Changes

- Extended `IndexProjectionRepository` with:
  - `summarizeVersion(input)` for bounded status-count evaluation.
  - `publishVersion(input)` to promote candidate `building` rows to `ready` and mark previous ready rows `stale`.
  - `rollbackVersion(input)` to mark candidate `building` rows `failed`.
- Implemented the behavior for both bounded in-memory and database-backed repositories.
- Database-backed publication uses parameterized `UPDATE` and aggregate `SELECT` statements.

## Guardrails

- Retrieval still reads only `status = "ready"` rows through `listReadyBySpace()`.
- Publishing does not rewrite vectors or text payloads; it flips compact status fields only.
- Rollback leaves the active ready version untouched and marks only matching candidate rows failed.
- Database queries are tenant/space and projection-type scoped, avoiding cross-space publication.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts` failed because `summarizeVersion()` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Commit Tracking

- This slice is implementation commit 6 after reviewed checkpoint `3b9b4d8` once committed and pushed.
- The next 10-commit health review is not yet due.
